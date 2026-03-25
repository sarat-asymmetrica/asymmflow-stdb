import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Timestamp } from 'spacetimedb';

import { DbConnection } from '../src/module_bindings';
import type { Party, Pipeline, Order, MoneyEvent, ActivityLog } from '../src/module_bindings/types';
import {
  buildSeedDashboardSnapshot,
  loadSeedData,
  summarizeSeedData,
  type SeedData,
} from '../src/lib/verification/seedVerification';
import { computeDashboardMetrics } from '../src/lib/business/dashboardMetrics';

type EntityStatusTag = 'Draft' | 'Active' | 'InProgress' | 'Terminal' | 'Cancelled';

type SeedPipeline = SeedData['pipelines'][number];
type SeedOrder = SeedData['orders'][number];
type SeedPurchaseOrder = SeedData['purchaseOrders'][number];
type SeedMoneyEvent = SeedData['moneyEvents'][number];
type SeedParty = SeedData['parties'][number];

const HOST = 'wss://maincloud.spacetimedb.com';
const DB_NAME = 'asymm-flow';
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 100;
const PARTY_SYNC_TIMEOUT_MS = 60_000;
const BOOTSTRAP_NICKNAME = process.env.STDB_BOOTSTRAP_NICKNAME ?? 'CodexSeed';
const BOOTSTRAP_FULL_NAME = process.env.STDB_BOOTSTRAP_FULL_NAME ?? 'Codex Seed';
const BOOTSTRAP_EMAIL = process.env.STDB_BOOTSTRAP_EMAIL ?? 'seed@asymmetrica.ai';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function iterToArray<T>(iterable: Iterable<T>): T[] {
  return Array.from(iterable);
}

function isoToTimestamp(iso: string | null | undefined): Timestamp | undefined {
  if (!iso) return undefined;
  return Timestamp.fromDate(new Date(iso));
}

function toEntityStatus(status: string): { tag: EntityStatusTag } {
  switch (status) {
    case 'Draft':
    case 'InProgress':
    case 'Terminal':
    case 'Cancelled':
      return { tag: status };
    case 'Active':
    default:
      return { tag: 'Active' };
  }
}

function buildOrderKey(partyId: bigint, order: SeedOrder): string {
  return `${partyId}|${order.poReference}|${order.totalFils}`;
}

function normalizeKeyPart(value: string | number | boolean | undefined | null): string {
  return String(value ?? '').trim().toLowerCase();
}

function buildPartyKey(party: SeedParty | Party): string {
  return [
    normalizeKeyPart(party.name),
    normalizeKeyPart('code' in party ? party.code : ''),
    normalizeKeyPart('category' in party ? party.category : ''),
    normalizeKeyPart('isCustomer' in party ? party.isCustomer : false),
    normalizeKeyPart('isSupplier' in party ? party.isSupplier : false),
    normalizeKeyPart('phone' in party ? party.phone : ''),
    normalizeKeyPart('email' in party ? party.email : ''),
    normalizeKeyPart('source' in party ? party.source : ''),
  ].join('|');
}

function buildPurchaseOrderKey(partyId: bigint, po: SeedPurchaseOrder): string {
  return `${partyId}|${po.totalFils}|${po.status}`;
}

function buildPipelineLookupKey(partyId: bigint, pipeline: SeedPipeline | Pipeline): string {
  return [
    partyId.toString(),
    normalizeKeyPart(pipeline.title),
    normalizeKeyPart(pipeline.estimatedValueFils.toString()),
    normalizeKeyPart('opportunityNumber' in pipeline ? pipeline.opportunityNumber : ''),
    normalizeKeyPart('folderNumber' in pipeline ? pipeline.folderNumber : ''),
    normalizeKeyPart('source' in pipeline ? pipeline.source : ''),
  ].join('|');
}

function getPipelineTransitionPath(finalStatus: string): EntityStatusTag[] {
  switch (finalStatus) {
    case 'Draft':
      return ['Draft'];
    case 'Active':
      return ['Draft', 'Active'];
    case 'InProgress':
      return ['Draft', 'Active', 'InProgress'];
    case 'Terminal':
      return ['Draft', 'Active', 'Terminal'];
    case 'Cancelled':
      return ['Draft', 'Cancelled'];
    default:
      throw new Error(`Unsupported pipeline status: ${finalStatus}`);
  }
}

function getMoneyEventSourceTimestamp(event: SeedMoneyEvent): Timestamp | undefined {
  return isoToTimestamp(event.paidAt ?? event.createdAt ?? event.dueDate ?? null);
}

async function connectDb(): Promise<{ conn: DbConnection; identity: string }> {
  return await new Promise((resolve, reject) => {
    let settled = false;

    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB_NAME)
      .onConnect((conn, identity) => {
        console.log(`[seed] connected to ${DB_NAME} as ${String(identity)}`);

        conn.subscriptionBuilder()
          .onApplied(() => {
            if (settled) return;
            settled = true;
            resolve({ conn, identity: String(identity) });
          })
          .onError((_ctx, error) => {
            if (settled) return;
            settled = true;
            reject(error ?? new Error('Subscription failed'));
          })
          .subscribe([
            'SELECT * FROM member',
            'SELECT * FROM party',
            'SELECT * FROM contact',
            'SELECT * FROM pipeline',
            'SELECT * FROM "order"',
            'SELECT * FROM purchase_order',
            'SELECT * FROM money_event',
            'SELECT * FROM activity_log',
          ]);
      })
      .onConnectError((_ctx, error) => {
        if (settled) return;
        settled = true;
        reject(error);
      })
      .build();
  });
}

async function ensureAdmin(conn: DbConnection, identity: string): Promise<void> {
  const members = iterToArray(conn.db.member.iter());
  const currentMember = members.find((member) => String(member.identity) === identity);
  if (currentMember) {
    console.log(`[seed] authenticated member found: ${currentMember.nickname}`);
    return;
  }

  if (members.length > 0) {
    throw new Error(
      `Connected identity ${identity} is not a registered member. Existing members: ${members
        .map((member) => `${member.nickname} <${member.email}>`)
        .join(', ')}`,
    );
  }

  console.log('[seed] no members present; bootstrapping admin identity');
  conn.reducers.bootstrapAdmin({
    nickname: BOOTSTRAP_NICKNAME,
    fullName: BOOTSTRAP_FULL_NAME,
    email: BOOTSTRAP_EMAIL,
  });

  const start = Date.now();
  while (Date.now() - start < 15_000) {
    const refreshed = iterToArray(conn.db.member.iter());
    if (refreshed.some((member) => String(member.identity) === identity)) {
      console.log('[seed] bootstrap admin succeeded');
      return;
    }
    await sleep(250);
  }

  throw new Error('Timed out waiting for bootstrap_admin to create the first member');
}

async function waitForPartySync(conn: DbConnection, expectedCount: number): Promise<Map<string, bigint>> {
  const start = Date.now();
  while (Date.now() - start < PARTY_SYNC_TIMEOUT_MS) {
      const currentParties = iterToArray(conn.db.party.iter());
      if (currentParties.length >= expectedCount) {
        const map = new Map<string, bigint>();
        for (const party of currentParties) {
          map.set(buildPartyKey(party), party.id);
        }
        return map;
      }
    console.log(`[seed] waiting for party sync: ${currentParties.length}/${expectedCount}`);
    await sleep(1000);
  }

  throw new Error(`Timed out waiting for ${expectedCount} parties to sync`);
}

type SeedStats = {
  parties: number;
  contacts: number;
  pipelines: number;
  orders: number;
  purchaseOrders: number;
  customerInvoices: number;
  customerPayments: number;
  supplierInvoices: number;
  supplierPayments: number;
  errors: number;
};

function createSeedStats(): SeedStats {
  return {
    parties: 0,
    contacts: 0,
    pipelines: 0,
    orders: 0,
    purchaseOrders: 0,
    customerInvoices: 0,
    customerPayments: 0,
    supplierInvoices: 0,
    supplierPayments: 0,
    errors: 0,
  };
}

function getPartyIdFromSeedIndex(seedData: SeedData, partyNameToId: Map<string, bigint>, seedIndex: number | undefined): bigint | undefined {
  if (seedIndex === undefined) return undefined;
  const party = seedData.parties[seedIndex];
  return party ? partyNameToId.get(buildPartyKey(party)) : undefined;
}

async function seedLiveDatabase(conn: DbConnection, seedData: SeedData): Promise<SeedStats> {
  const stats = createSeedStats();

  console.log(`[seed] starting live import from ${seedData.parties.length} parties / ${seedData.moneyEvents.length} money events`);

  for (let i = 0; i < seedData.parties.length; i += BATCH_SIZE) {
    const batch = seedData.parties.slice(i, i + BATCH_SIZE);
    for (const party of batch) {
      try {
        conn.reducers.upsertParty({
          id: 0n,
          name: party.name,
          code: party.code ?? '',
          category: party.category ?? '',
          isCustomer: party.isCustomer,
          isSupplier: party.isSupplier,
          grade: { tag: party.grade } as never,
          creditLimitFils: BigInt(party.creditLimitFils),
          paymentTermsDays: BigInt(party.paymentTermsDays),
          productTypes: party.productTypes,
          annualGoalFils: 0n,
          city: party.city ?? '',
          country: party.country ?? '',
          phone: party.phone ?? '',
          email: party.email ?? '',
          source: party.source ?? '',
          active2024: party.active2024 ?? false,
          active2025: party.active2025 ?? false,
          active2026: party.active2026 ?? false,
          notes: party.notes,
          bankIban: '',
          bankSwift: '',
          bankAccountName: '',
        });
        stats.parties += 1;
      } catch (error) {
        console.warn(`[seed] party "${party.name}" failed`, error);
        stats.errors += 1;
      }
    }
    console.log(`[seed] parties: ${Math.min(i + BATCH_SIZE, seedData.parties.length)}/${seedData.parties.length}`);
    await sleep(BATCH_DELAY_MS);
  }

  const partyNameToId = await waitForPartySync(conn, seedData.parties.length);
  console.log(`[seed] party sync complete: ${partyNameToId.size} mapped`);

  for (let i = 0; i < seedData.contacts.length; i += BATCH_SIZE) {
    const batch = seedData.contacts.slice(i, i + BATCH_SIZE);
    for (const contact of batch) {
      const partyId = getPartyIdFromSeedIndex(seedData, partyNameToId, contact.partyIdx);
      if (!partyId) {
        stats.errors += 1;
        continue;
      }
      try {
        conn.reducers.upsertContact({
          id: 0n,
          partyId,
          name: contact.name,
          designation: contact.designation,
          phone: contact.phone,
          email: contact.email,
          isWhatsApp: false,
        });
        stats.contacts += 1;
      } catch (error) {
        console.warn(`[seed] contact "${contact.name}" failed`, error);
        stats.errors += 1;
      }
    }
    console.log(`[seed] contacts: ${Math.min(i + BATCH_SIZE, seedData.contacts.length)}/${seedData.contacts.length}`);
    await sleep(BATCH_DELAY_MS);
  }

  await sleep(300);

  const allPipelines = [...seedData.pipelines, ...(seedData.referencePipelines ?? [])];
  const pipelineIdsBefore = new Set(iterToArray(conn.db.pipeline.iter()).map((row) => row.id));
  const pipelineKeyToId = new Map<string, bigint>();

  for (let i = 0; i < allPipelines.length; i += BATCH_SIZE) {
    const batch = allPipelines.slice(i, i + BATCH_SIZE);
    for (const pipeline of batch) {
      const partyId = getPartyIdFromSeedIndex(seedData, partyNameToId, pipeline.partyIdx);
      if (!partyId) {
        stats.errors += 1;
        continue;
      }
      try {
        conn.reducers.advancePipeline({
          id: 0n,
          partyId,
          title: pipeline.title,
          legacyYear: pipeline.legacyYear,
          opportunityNumber: pipeline.opportunityNumber,
          folderNumber: pipeline.folderNumber,
          folderName: pipeline.folderName,
          sfdcTitle: pipeline.sfdcTitle,
          comment: pipeline.comment,
          ehReference: pipeline.ehReference,
          paymentTerms: pipeline.paymentTerms,
          ownerName: pipeline.ownerName,
          source: pipeline.source,
          sourceNotes: pipeline.sourceNotes,
          deliverySummary: pipeline.deliverySummary,
          newStatus: { tag: 'Draft' } as never,
          estimatedValueFils: BigInt(pipeline.estimatedValueFils),
          winProbabilityBps: BigInt(pipeline.winProbabilityBps),
          competitorPresent: pipeline.competitorPresent,
          oemPriceFils: BigInt(pipeline.oemPriceFils),
          markupBps: BigInt(pipeline.markupBps),
          additionalCostsFils: BigInt(pipeline.additionalCostsFils),
          costingApproved: pipeline.markupBps >= 1200,
          offerSentAt: isoToTimestamp(pipeline.createdAt ?? null),
          lossReason: undefined,
          nextFollowUp: undefined,
        });
      } catch (error) {
        console.warn(`[seed] pipeline "${pipeline.title}" failed`, error);
        stats.errors += 1;
      }
    }
    console.log(`[seed] pipeline drafts: ${Math.min(i + BATCH_SIZE, allPipelines.length)}/${allPipelines.length}`);
    await sleep(BATCH_DELAY_MS);
  }

  await sleep(2000);
  for (const row of iterToArray(conn.db.pipeline.iter())) {
    if (pipelineIdsBefore.has(row.id)) continue;
    const matched = allPipelines.find((pipeline) => {
      const partyId = getPartyIdFromSeedIndex(seedData, partyNameToId, pipeline.partyIdx);
      return partyId !== undefined && buildPipelineLookupKey(partyId, pipeline) === buildPipelineLookupKey(row.partyId, row);
    });
    if (!matched) continue;
    const partyId = getPartyIdFromSeedIndex(seedData, partyNameToId, matched.partyIdx);
    if (partyId !== undefined) {
      pipelineKeyToId.set(buildPipelineLookupKey(partyId, matched), row.id);
    }
  }

  for (let i = 0; i < allPipelines.length; i += BATCH_SIZE) {
    const batch = allPipelines.slice(i, i + BATCH_SIZE);
    for (const pipeline of batch) {
      const partyId = getPartyIdFromSeedIndex(seedData, partyNameToId, pipeline.partyIdx);
      if (!partyId) {
        stats.errors += 1;
        continue;
      }

      const pipelineId = pipelineKeyToId.get(buildPipelineLookupKey(partyId, pipeline));
      if (!pipelineId) {
        console.warn(`[seed] pipeline ID lookup failed for "${pipeline.title}"`);
        stats.errors += 1;
        continue;
      }

      const transitions = getPipelineTransitionPath(pipeline.status);
      for (const status of transitions.slice(1)) {
        try {
          conn.reducers.advancePipeline({
            id: pipelineId,
            partyId,
            title: pipeline.title,
            legacyYear: pipeline.legacyYear,
            opportunityNumber: pipeline.opportunityNumber,
            folderNumber: pipeline.folderNumber,
            folderName: pipeline.folderName,
            sfdcTitle: pipeline.sfdcTitle,
            comment: pipeline.comment,
            ehReference: pipeline.ehReference,
            paymentTerms: pipeline.paymentTerms,
            ownerName: pipeline.ownerName,
            source: pipeline.source,
            sourceNotes: pipeline.sourceNotes,
            deliverySummary: pipeline.deliverySummary,
            newStatus: { tag: status } as never,
            estimatedValueFils: BigInt(pipeline.estimatedValueFils),
            winProbabilityBps: BigInt(pipeline.winProbabilityBps),
            competitorPresent: pipeline.competitorPresent,
            oemPriceFils: BigInt(pipeline.oemPriceFils),
            markupBps: BigInt(pipeline.markupBps),
            additionalCostsFils: BigInt(pipeline.additionalCostsFils),
            costingApproved: pipeline.markupBps >= 1200,
            offerSentAt: isoToTimestamp(pipeline.createdAt ?? null),
            lossReason: status === 'Cancelled' ? pipeline.lossReason ?? 'Historical pipeline import' : undefined,
            nextFollowUp: undefined,
          });
        } catch (error) {
          console.warn(`[seed] pipeline transition "${pipeline.title}" -> ${status} failed`, error);
          stats.errors += 1;
        }
      }

      stats.pipelines += 1;
    }
    console.log(`[seed] pipelines finalized: ${Math.min(i + BATCH_SIZE, allPipelines.length)}/${allPipelines.length}`);
    await sleep(BATCH_DELAY_MS);
  }

  const orderIdsBefore = new Set(iterToArray(conn.db.order.iter()).map((row) => row.id));
  const orderKeyToId = new Map<string, bigint>();

  for (let i = 0; i < seedData.orders.length; i += BATCH_SIZE) {
    const batch = seedData.orders.slice(i, i + BATCH_SIZE);
    for (const order of batch) {
      const partyId = getPartyIdFromSeedIndex(seedData, partyNameToId, order.partyIdx);
      if (!partyId) {
        stats.errors += 1;
        continue;
      }

      let pipelineId: bigint | undefined;
        if (order.pipelineIdx != null) {
          const linkedPipeline = seedData.pipelines[order.pipelineIdx];
          if (linkedPipeline) {
            pipelineId = pipelineKeyToId.get(buildPipelineLookupKey(partyId, linkedPipeline));
          }
        }

      try {
        conn.reducers.manageOrder({
          id: 0n,
          partyId,
          pipelineId,
          source: pipelineId ? 'legacy_seed_linked' : 'legacy_seed_unlinked',
          newStatus: toEntityStatus(order.status) as never,
          totalFils: BigInt(order.totalFils),
          poReference: order.poReference,
          expectedDelivery: isoToTimestamp(order.expectedDelivery ?? null),
        });
        stats.orders += 1;
      } catch (error) {
        console.warn(`[seed] order "${order.poReference}" failed`, error);
        stats.errors += 1;
      }
    }
    console.log(`[seed] orders: ${Math.min(i + BATCH_SIZE, seedData.orders.length)}/${seedData.orders.length}`);
    await sleep(BATCH_DELAY_MS);
  }

  await sleep(2000);
  for (const row of iterToArray(conn.db.order.iter())) {
    if (orderIdsBefore.has(row.id)) continue;
    const matched = seedData.orders.find((order) => {
      const partyId = getPartyIdFromSeedIndex(seedData, partyNameToId, order.partyIdx);
      return partyId !== undefined && buildOrderKey(partyId, order) === `${row.partyId}|${row.poReference}|${row.totalFils}`;
    });
    if (!matched) continue;
    const partyId = getPartyIdFromSeedIndex(seedData, partyNameToId, matched.partyIdx);
    if (partyId !== undefined) {
      orderKeyToId.set(buildOrderKey(partyId, matched), row.id);
    }
  }

  for (let i = 0; i < seedData.purchaseOrders.length; i += BATCH_SIZE) {
    const batch = seedData.purchaseOrders.slice(i, i + BATCH_SIZE);
    for (const purchaseOrder of batch) {
      const partyId = getPartyIdFromSeedIndex(seedData, partyNameToId, purchaseOrder.partyIdx);
      if (!partyId) {
        stats.errors += 1;
        continue;
      }

      let linkedOrderId: bigint | undefined;
      if (purchaseOrder.orderIdx != null) {
        const linkedOrder = seedData.orders[purchaseOrder.orderIdx];
        if (linkedOrder) {
          const linkedPartyId = getPartyIdFromSeedIndex(seedData, partyNameToId, linkedOrder.partyIdx);
          if (linkedPartyId !== undefined) {
            linkedOrderId = orderKeyToId.get(buildOrderKey(linkedPartyId, linkedOrder));
          }
        }
      }

      try {
        conn.reducers.managePurchaseOrder({
          id: 0n,
          partyId,
          orderId: linkedOrderId,
          deliveryTerms: undefined,
          source: linkedOrderId ? 'legacy_seed_linked' : 'legacy_seed_unlinked',
          newStatus: toEntityStatus(purchaseOrder.status) as never,
          totalFils: BigInt(purchaseOrder.totalFils),
        });
        stats.purchaseOrders += 1;
      } catch (error) {
        console.warn(`[seed] purchase order "${buildPurchaseOrderKey(partyId, purchaseOrder)}" failed`, error);
        stats.errors += 1;
      }
    }
    console.log(`[seed] purchase orders: ${Math.min(i + BATCH_SIZE, seedData.purchaseOrders.length)}/${seedData.purchaseOrders.length}`);
    await sleep(BATCH_DELAY_MS);
  }

  const phases: Array<{
    label: string;
    events: SeedMoneyEvent[];
    kind: 'CustomerInvoice' | 'CustomerPayment' | 'SupplierInvoice' | 'SupplierPayment';
    statKey: keyof SeedStats;
    settleDelayMs: number;
  }> = [
    {
      label: 'customer invoices',
      events: seedData.moneyEvents.filter((event) => event.kind === 'CustomerInvoice'),
      kind: 'CustomerInvoice',
      statKey: 'customerInvoices',
      settleDelayMs: 3000,
    },
    {
      label: 'customer payments',
      events: seedData.moneyEvents.filter((event) => event.kind === 'CustomerPayment'),
      kind: 'CustomerPayment',
      statKey: 'customerPayments',
      settleDelayMs: 300,
    },
    {
      label: 'supplier invoices',
      events: seedData.moneyEvents.filter((event) => event.kind === 'SupplierInvoice'),
      kind: 'SupplierInvoice',
      statKey: 'supplierInvoices',
      settleDelayMs: 300,
    },
    {
      label: 'supplier payments',
      events: seedData.moneyEvents.filter((event) => event.kind === 'SupplierPayment'),
      kind: 'SupplierPayment',
      statKey: 'supplierPayments',
      settleDelayMs: 300,
    },
  ];

  for (const phase of phases) {
    for (let i = 0; i < phase.events.length; i += BATCH_SIZE) {
      const batch = phase.events.slice(i, i + BATCH_SIZE);
      for (const event of batch) {
        const partyId = getPartyIdFromSeedIndex(seedData, partyNameToId, event.partyIdx);
        if (!partyId) {
          stats.errors += 1;
          continue;
        }

        let orderId: bigint | undefined;
        if (event.orderIdx != null) {
          const linkedOrder = seedData.orders[event.orderIdx];
          if (linkedOrder) {
            const linkedPartyId = getPartyIdFromSeedIndex(seedData, partyNameToId, linkedOrder.partyIdx);
            if (linkedPartyId !== undefined) {
              orderId = orderKeyToId.get(buildOrderKey(linkedPartyId, linkedOrder));
            }
          }
        }

        try {
          conn.reducers.recordMoneyEvent({
            partyId,
            orderId,
            deliveryNoteId: undefined,
            kind: { tag: phase.kind } as never,
            subtotalFils: BigInt(event.subtotalFils),
            reference: event.reference,
            sourceDate: getMoneyEventSourceTimestamp(event),
            dueDate: phase.kind === 'CustomerInvoice' || phase.kind === 'SupplierInvoice'
              ? isoToTimestamp(event.dueDate)
              : undefined,
          });
          stats[phase.statKey] += 1;
        } catch (error) {
          console.warn(`[seed] ${phase.label.slice(0, -1)} "${event.reference}" failed`, error);
          stats.errors += 1;
        }
      }
      console.log(`[seed] ${phase.label}: ${Math.min(i + BATCH_SIZE, phase.events.length)}/${phase.events.length}`);
      await sleep(BATCH_DELAY_MS);
    }
    await sleep(phase.settleDelayMs);
  }

  return stats;
}

function buildLiveDashboardSnapshot(conn: DbConnection, nowMicros: bigint) {
  const parties = iterToArray(conn.db.party.iter()).map((party) => ({
    id: party.id,
    name: party.name,
    isCustomer: party.isCustomer,
    isSupplier: party.isSupplier,
    grade: party.grade,
  }));

  const pipelines = iterToArray(conn.db.pipeline.iter()).map((pipeline) => ({
    id: pipeline.id,
    partyId: pipeline.partyId,
    title: pipeline.title,
    status: pipeline.status,
    estimatedValueFils: pipeline.estimatedValueFils,
    nextFollowUp: pipeline.nextFollowUp,
  }));

  const orders = iterToArray(conn.db.order.iter()).map((order) => ({
    status: order.status,
  }));

  const moneyEvents = iterToArray(conn.db.moneyEvent.iter()).map((event) => ({
    partyId: event.partyId,
    kind: event.kind,
    status: event.status,
    totalFils: event.totalFils,
    dueDate: event.dueDate ?? undefined,
    paidAt: event.paidAt ?? undefined,
    createdAt: event.createdAt,
  }));

  const activityLogs = iterToArray(conn.db.activityLog.iter()).map((log) => ({
    followUpDue: log.followUpDue ?? undefined,
    followUpDone: log.followUpDone ?? false,
  }));

  const metrics = computeDashboardMetrics({
    parties,
    pipelines,
    orders,
    moneyEvents,
    activityLogs,
    nowMicros,
  });

  return { parties, pipelines, orders, moneyEvents, metrics };
}

function assertEqual(label: string, actual: bigint | number | string, expected: bigint | number | string): void {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

function withServerMoneySemantics(seedData: SeedData): SeedData {
  return {
    ...seedData,
    moneyEvents: seedData.moneyEvents.map((event) => {
      if (event.kind === 'CustomerInvoice' || event.kind === 'SupplierInvoice') {
        const subtotalFils = BigInt(event.subtotalFils);
        const vatFils = Number((subtotalFils * 10n) / 100n);
        return {
          ...event,
          vatFils,
          totalFils: event.subtotalFils + vatFils,
        };
      }

      return {
        ...event,
        vatFils: 0,
        totalFils: event.subtotalFils,
      };
    }),
  };
}

async function validateLiveDatabase(conn: DbConnection, seedData: SeedData): Promise<void> {
  const serverExpectedSeed = withServerMoneySemantics(seedData);
  const expectedSummary = summarizeSeedData(serverExpectedSeed);
  const liveParties = iterToArray(conn.db.party.iter());
  const liveContacts = iterToArray(conn.db.contact.iter());
  const livePipelines = iterToArray(conn.db.pipeline.iter());
  const liveOrders = iterToArray(conn.db.order.iter());
  const livePurchaseOrders = iterToArray(conn.db.purchaseOrder.iter());
  const liveMoneyEvents = iterToArray(conn.db.moneyEvent.iter());

  assertEqual('party count', liveParties.length, expectedSummary.parties);
  assertEqual('contact count', liveContacts.length, expectedSummary.contacts);
  assertEqual('pipeline count', livePipelines.length, expectedSummary.pipelines);
  assertEqual('order count', liveOrders.length, expectedSummary.orders);
  assertEqual('purchase order count', livePurchaseOrders.length, expectedSummary.purchaseOrders);
  assertEqual('money event count', liveMoneyEvents.length, expectedSummary.moneyEvents);

  const sumTotals = (kind: string) =>
    liveMoneyEvents
      .filter((event) => event.kind.tag === kind)
      .reduce((sum, event) => sum + event.totalFils, 0n);

  assertEqual('customer invoice total', sumTotals('CustomerInvoice'), expectedSummary.customerInvoiceTotalFils);
  assertEqual('customer payment total', sumTotals('CustomerPayment'), expectedSummary.customerPaymentTotalFils);
  assertEqual('supplier invoice total', sumTotals('SupplierInvoice'), expectedSummary.supplierInvoiceTotalFils);
  assertEqual('supplier payment total', sumTotals('SupplierPayment'), expectedSummary.supplierPaymentTotalFils);

  const nowMicros = BigInt(Date.parse('2026-03-10T00:00:00.000Z')) * 1000n;
  const expectedSnapshot = buildSeedDashboardSnapshot(serverExpectedSeed, nowMicros);
  const liveSnapshot = buildLiveDashboardSnapshot(conn, nowMicros);

  assertEqual('pipeline value', liveSnapshot.metrics.pipelineValue, expectedSnapshot.metrics.pipelineValue);
  assertEqual('total outstanding', liveSnapshot.metrics.totalOutstanding, expectedSnapshot.metrics.totalOutstanding);
  assertEqual('cash position', liveSnapshot.metrics.cashPosition, expectedSnapshot.metrics.cashPosition);
  assertEqual('customer count', liveSnapshot.metrics.customerCount, expectedSnapshot.metrics.customerCount);
  assertEqual('supplier count', liveSnapshot.metrics.supplierCount, expectedSnapshot.metrics.supplierCount);
  assertEqual('active order count', liveSnapshot.metrics.activeOrderCount, expectedSnapshot.metrics.activeOrderCount);

  const liveTopDebtor = liveSnapshot.metrics.topCustomers[0];
  const expectedTopDebtor = expectedSnapshot.metrics.topCustomers[0];
  if (!liveTopDebtor || !expectedTopDebtor) {
    throw new Error('Top debtor validation failed because one side is empty');
  }
  assertEqual('top debtor name', liveTopDebtor.name, expectedTopDebtor.name);
  assertEqual('top debtor outstanding', liveTopDebtor.outstanding, expectedTopDebtor.outstanding);

  console.log('[seed] validation passed');
  console.log(`[seed] top debtor: ${liveTopDebtor.name} (${liveTopDebtor.outstanding} fils outstanding)`);
  console.log(`[seed] pipeline value: ${liveSnapshot.metrics.pipelineValue} fils`);
  console.log(`[seed] cash position: ${liveSnapshot.metrics.cashPosition} fils`);
}

async function main(): Promise<void> {
  const validateOnly = process.argv.includes('--validate-only');
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const seedPath = path.resolve(scriptDir, '../public/stdb_seed.json');
  const seedData = loadSeedData(seedPath);

  const { conn, identity } = await connectDb();
  if (!validateOnly) {
    await ensureAdmin(conn, identity);

    const initialPartyCount = iterToArray(conn.db.party.iter()).length;
    if (initialPartyCount > 0) {
      throw new Error(`Refusing to seed a non-empty database (${initialPartyCount} parties already present)`);
    }

    const stats = await seedLiveDatabase(conn, seedData);
    console.log(`[seed] reducer dispatch complete with ${stats.errors} errors`);
    if (stats.errors > 0) {
      throw new Error(`Seed finished with ${stats.errors} reducer dispatch errors`);
    }

    await sleep(5000);
  }

  await validateLiveDatabase(conn, seedData);
}

main().catch((error) => {
  console.error('[seed] failed', error);
  process.exitCode = 1;
});
