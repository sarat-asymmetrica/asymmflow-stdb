<script lang="ts">
  // SeedManager.svelte - One-time migration tool
  // Loads stdb_seed.json (legacy transactions enriched with canonical PH context)
  // and calls existing STDB reducers to populate the database with production data.
  //
  // Phases:
  //   1. Insert parties (customers + suppliers)
  //   2. Wait for party sync, build name -> STDB ID map
  //   3. Insert contacts (using party IDs)
  //   4. Insert pipelines from legacy + canonical reference data
  //   5. Insert money events: CustomerInvoices -> CustomerPayments -> SupplierInvoices -> SupplierPayments
  //
  // All phases use existing reducers with full business logic.
  // Orders and purchase orders are intentionally deferred until the historical
  // data can be linked to pipelines without inventing relationships.

  import { getConnection, orders, parties, pipelines, purchaseOrders } from '../db';
  import { get } from 'svelte/store';
  import { Timestamp } from 'spacetimedb';

  interface SeedParty {
    legacyId: string;
    name: string;
    isCustomer: boolean;
    isSupplier: boolean;
    grade: string;
    creditLimitFils: number;
    isCreditBlocked: boolean;
    paymentTermsDays: number;
    productTypes: string;
    notes: string;
    code?: string;
    category?: string;
    city?: string;
    country?: string;
    phone?: string;
    email?: string;
    source?: string;
    active2024?: boolean;
    active2025?: boolean;
    active2026?: boolean;
  }

  interface SeedContact {
    partyIdx: number;
    name: string;
    designation: string;
    phone: string;
    email: string;
  }

  interface SeedMoneyEvent {
    partyIdx: number;
    orderIdx: number | null;
    kind: string;
    status: string;
    subtotalFils: number;
    vatFils: number;
    totalFils: number;
    reference: string;
    dueDate: string | null;
    paidAt: string | null;
    createdAt: string | null;
  }

  interface SeedPipeline {
    partyIdx: number;
    title: string;
    status: string;
    estimatedValueFils: number;
    winProbabilityBps: number;
    competitorPresent: boolean;
    oemPriceFils: number;
    markupBps: number;
    additionalCostsFils: number;
    offerTotalFils?: number;
    revision?: number;
    lossReason?: string | null;
    createdAt?: string | null;
    legacyYear?: number;
    opportunityNumber?: string;
    folderNumber?: string;
    folderName?: string;
    sfdcTitle?: string;
    comment?: string;
    ehReference?: string;
    paymentTerms?: string;
    ownerName?: string;
    source?: string;
    sourceNotes?: string;
    deliverySummary?: string;
  }

  interface SeedOrder {
    partyIdx: number;
    pipelineIdx: number | null;
    status: string;
    totalFils: number;
    poReference: string;
    expectedDelivery?: string | null;
    createdAt?: string | null;
  }

  interface SeedPurchaseOrder {
    partyIdx: number;
    orderIdx: number | null;
    status: string;
    totalFils: number;
  }

  interface SeedStats {
    legacyParties: number;
    canonicalParties: number;
    outputParties: number;
    legacyPipelines: number;
    referencePipelines: number;
    orders: number;
    purchaseOrders: number;
    moneyEvents: number;
    canonicalPartyOnlyAdditions: number;
  }

  interface SeedData {
    parties: SeedParty[];
    contacts: SeedContact[];
    pipelines: SeedPipeline[];
    referencePipelines?: SeedPipeline[];
    orders: SeedOrder[];
    purchaseOrders: SeedPurchaseOrder[];
    moneyEvents: SeedMoneyEvent[];
    stats?: SeedStats;
  }

  type Phase =
    | 'idle'
    | 'loading'
    | 'parties'
    | 'waiting-sync'
    | 'contacts'
    | 'pipelines'
    | 'orders'
    | 'purchase-orders'
    | 'invoices'
    | 'payments'
    | 'supplier-invoices'
    | 'supplier-payments'
    | 'done'
    | 'error';

  let phase = $state<Phase>('idle');
  let progress = $state(0);
  let total = $state(0);
  let message = $state('');
  let errorMsg = $state('');
  let seedData = $state<SeedData | null>(null);
  let stats = $state({
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
  });

  let partyNameToId = $state(new Map<string, bigint>());

  let existingPartyCount = $derived(get(parties).length);
  let alreadySeeded = $derived(existingPartyCount > 10);

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isoToTimestamp(iso: string | null): typeof Timestamp.prototype | undefined {
    if (!iso) return undefined;
    try {
      return Timestamp.fromDate(new Date(iso));
    } catch {
      return undefined;
    }
  }

  function toEntityStatus(status: string): { tag: 'Draft' | 'Active' | 'InProgress' | 'Terminal' | 'Cancelled' } {
    switch (status) {
      case 'Draft':
        return { tag: 'Draft' };
      case 'InProgress':
        return { tag: 'InProgress' };
      case 'Terminal':
        return { tag: 'Terminal' };
      case 'Cancelled':
        return { tag: 'Cancelled' };
      case 'Active':
      default:
        return { tag: 'Active' };
    }
  }

  function getPartyIdFromSeedIndex(seedIndex: number | undefined): bigint | undefined {
    if (seedIndex === undefined || !seedData) return undefined;
    const party = seedData.parties[seedIndex];
    return party ? partyNameToId.get(buildPartyKey(party)) : undefined;
  }

  function buildOrderKey(partyId: bigint, order: SeedOrder): string {
    return `${partyId}|${order.poReference}|${order.totalFils}`;
  }

  function normalizeKeyPart(value: string | number | boolean | undefined | null): string {
    return String(value ?? '').trim().toLowerCase();
  }

  function buildPartyKey(party: SeedParty | { name: string; code: string; category: string; isCustomer: boolean; isSupplier: boolean; phone: string; email: string; source: string }): string {
    return [
      normalizeKeyPart(party.name),
      normalizeKeyPart(party.code),
      normalizeKeyPart(party.category),
      normalizeKeyPart(party.isCustomer),
      normalizeKeyPart(party.isSupplier),
      normalizeKeyPart(party.phone),
      normalizeKeyPart(party.email),
      normalizeKeyPart(party.source),
    ].join('|');
  }

  function buildPurchaseOrderKey(partyId: bigint, po: SeedPurchaseOrder): string {
    return `${partyId}|${po.totalFils}|${po.status}`;
  }

  function buildPipelineLookupKey(
    partyId: bigint,
    pipeline:
      | SeedPipeline
      | {
          title: string;
          estimatedValueFils: bigint;
          opportunityNumber: string;
          folderNumber: string;
          source: string;
        }
  ): string {
    return [
      partyId.toString(),
      normalizeKeyPart(pipeline.title),
      normalizeKeyPart(pipeline.estimatedValueFils.toString()),
      normalizeKeyPart(pipeline.opportunityNumber),
      normalizeKeyPart(pipeline.folderNumber),
      normalizeKeyPart(pipeline.source),
    ].join('|');
  }

  function getPipelineTransitionPath(status: string): Array<'Draft' | 'Active' | 'InProgress' | 'Terminal' | 'Cancelled'> {
    switch (status) {
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
        return ['Draft', 'Active'];
    }
  }

  function getMoneyEventSourceTimestamp(event: SeedMoneyEvent): typeof Timestamp.prototype | undefined {
    return isoToTimestamp(event.paidAt ?? event.createdAt ?? event.dueDate ?? null);
  }

  async function startSeed() {
    const conn = getConnection();
    if (!conn) {
      errorMsg = 'Not connected to SpacetimeDB';
      phase = 'error';
      return;
    }

    stats = {
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
    errorMsg = '';

    phase = 'loading';
    message = 'Loading enriched PH seed data...';
    try {
      const resp = await fetch('/stdb_seed.json');
      if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status}`);
      seedData = (await resp.json()) as SeedData;
      const pipelineCount = seedData.pipelines.length + (seedData.referencePipelines?.length ?? 0);
      message = `Loaded ${seedData.parties.length} parties, ${seedData.contacts.length} contacts, ${pipelineCount} pipelines, ${seedData.moneyEvents.length} money events`;
    } catch (e) {
      errorMsg = `Failed to load seed data: ${e instanceof Error ? e.message : String(e)}`;
      phase = 'error';
      return;
    }

    await sleep(500);

    phase = 'parties';
    total = seedData.parties.length;
    progress = 0;
    message = `Inserting ${total} parties...`;

    const BATCH_SIZE = 20;
    const BATCH_DELAY = 100;

    for (let i = 0; i < seedData.parties.length; i += BATCH_SIZE) {
      const batch = seedData.parties.slice(i, i + BATCH_SIZE);
      for (const p of batch) {
        try {
          conn.reducers.upsertParty({
            id: 0n,
            name: p.name,
            code: p.code ?? '',
            category: p.category ?? '',
            isCustomer: p.isCustomer,
            isSupplier: p.isSupplier,
            grade: { tag: p.grade } as any,
            creditLimitFils: BigInt(p.creditLimitFils),
            paymentTermsDays: BigInt(p.paymentTermsDays),
            productTypes: p.productTypes,
            annualGoalFils: 0n,
            city: p.city ?? '',
            country: p.country ?? '',
            phone: p.phone ?? '',
            email: p.email ?? '',
            source: p.source ?? '',
            active2024: p.active2024 ?? false,
            active2025: p.active2025 ?? false,
            active2026: p.active2026 ?? false,
            notes: p.notes,
            bankIban: '',
            bankSwift: '',
            bankAccountName: '',
          });
          stats.parties++;
        } catch (e) {
          console.warn(`[seed] Party "${p.name}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Parties: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    phase = 'waiting-sync';
    message = `Waiting for ${total} parties to sync from server...`;

    const startWait = Date.now();
    const SYNC_TIMEOUT = 60_000;
    while (Date.now() - startWait < SYNC_TIMEOUT) {
        const currentParties = get(parties);
      if (currentParties.length >= seedData.parties.length) {
        const map = new Map<string, bigint>();
        for (const party of currentParties) {
          map.set(buildPartyKey(party), party.id);
        }
        partyNameToId = map;
        message = `Synced ${currentParties.length} parties and built the name map`;
        break;
      }
      message = `Waiting for sync... ${currentParties.length}/${seedData.parties.length}`;
      await sleep(1000);
    }

    if (partyNameToId.size === 0) {
      errorMsg = 'Timeout waiting for party sync. Try again.';
      phase = 'error';
      return;
    }

    await sleep(500);

    phase = 'contacts';
    total = seedData.contacts.length;
    progress = 0;
    message = `Inserting ${total} contacts...`;

    for (let i = 0; i < seedData.contacts.length; i += BATCH_SIZE) {
      const batch = seedData.contacts.slice(i, i + BATCH_SIZE);
      for (const contact of batch) {
        const partyId = getPartyIdFromSeedIndex(contact.partyIdx);
        if (!partyId) {
          stats.errors++;
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
          stats.contacts++;
        } catch (e) {
          console.warn(`[seed] Contact "${contact.name}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Contacts: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    await sleep(300);

    const allPipelines = [...seedData.pipelines, ...(seedData.referencePipelines ?? [])];
    const pipelineIdsBefore = new Set(get(pipelines).map((row) => row.id));
    const pipelineKeyToId = new Map<string, bigint>();
    phase = 'pipelines';
    total = allPipelines.length;
    progress = 0;
    message = `Inserting ${total} pipelines...`;

    for (let i = 0; i < allPipelines.length; i += BATCH_SIZE) {
      const batch = allPipelines.slice(i, i + BATCH_SIZE);
      for (const pipeline of batch) {
        const partyId = getPartyIdFromSeedIndex(pipeline.partyIdx);
        if (!partyId) {
          stats.errors++;
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
            newStatus: { tag: 'Draft' } as any,
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
        } catch (e) {
          console.warn(`[seed] Pipeline "${pipeline.title}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Pipeline Drafts: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    await sleep(2000);
    for (const row of get(pipelines)) {
      if (pipelineIdsBefore.has(row.id)) continue;
      const matched = allPipelines.find((pipeline) => {
        const partyId = getPartyIdFromSeedIndex(pipeline.partyIdx);
        return partyId !== undefined && buildPipelineLookupKey(partyId, pipeline) === buildPipelineLookupKey(row.partyId, row);
      });
      if (matched) {
        const partyId = getPartyIdFromSeedIndex(matched.partyIdx);
        if (partyId !== undefined) {
          pipelineKeyToId.set(buildPipelineLookupKey(partyId, matched), row.id);
        }
      }
    }

    for (let i = 0; i < allPipelines.length; i += BATCH_SIZE) {
      const batch = allPipelines.slice(i, i + BATCH_SIZE);
      for (const pipeline of batch) {
        const partyId = getPartyIdFromSeedIndex(pipeline.partyIdx);
        if (!partyId) {
          stats.errors++;
          continue;
        }
        const pipelineId = pipelineKeyToId.get(buildPipelineLookupKey(partyId, pipeline));
        if (!pipelineId) {
          stats.errors++;
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
              newStatus: { tag: status } as any,
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
          } catch (e) {
            console.warn(`[seed] Pipeline transition "${pipeline.title}" -> ${status} failed:`, e);
            stats.errors++;
          }
        }
        stats.pipelines++;
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Pipelines: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    await sleep(300);

    const orderIdsBefore = new Set(get(orders).map((row) => row.id));
    const orderKeyToId = new Map<string, bigint>();
    phase = 'orders';
    total = seedData.orders.length;
    progress = 0;
    message = `Inserting ${total} historical orders...`;

    for (let i = 0; i < seedData.orders.length; i += BATCH_SIZE) {
      const batch = seedData.orders.slice(i, i + BATCH_SIZE);
      for (const order of batch) {
        const partyId = getPartyIdFromSeedIndex(order.partyIdx);
        if (!partyId) {
          stats.errors++;
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
            newStatus: toEntityStatus(order.status) as any,
            totalFils: BigInt(order.totalFils),
            poReference: order.poReference,
            expectedDelivery: isoToTimestamp(order.expectedDelivery ?? null),
          });
          stats.orders++;
        } catch (e) {
          console.warn(`[seed] Order "${order.poReference}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Orders: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    await sleep(2000);
    for (const row of get(orders)) {
      if (orderIdsBefore.has(row.id)) continue;
      const matched = seedData.orders.find((order) => {
        const partyId = getPartyIdFromSeedIndex(order.partyIdx);
        return partyId !== undefined && buildOrderKey(partyId, order) === `${row.partyId}|${row.poReference}|${row.totalFils}`;
      });
      if (matched) {
        const partyId = getPartyIdFromSeedIndex(matched.partyIdx);
        if (partyId !== undefined) {
          orderKeyToId.set(buildOrderKey(partyId, matched), row.id);
        }
      }
    }

    await sleep(300);

    phase = 'purchase-orders';
    total = seedData.purchaseOrders.length;
    progress = 0;
    message = `Inserting ${total} historical purchase orders...`;

    for (let i = 0; i < seedData.purchaseOrders.length; i += BATCH_SIZE) {
      const batch = seedData.purchaseOrders.slice(i, i + BATCH_SIZE);
      for (const purchaseOrder of batch) {
        const partyId = getPartyIdFromSeedIndex(purchaseOrder.partyIdx);
        if (!partyId) {
          stats.errors++;
          continue;
        }
        let linkedOrderId: bigint | undefined;
        if (purchaseOrder.orderIdx != null) {
          const linkedOrder = seedData.orders[purchaseOrder.orderIdx];
          if (linkedOrder) {
            const linkedPartyId = getPartyIdFromSeedIndex(linkedOrder.partyIdx);
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
            newStatus: toEntityStatus(purchaseOrder.status) as any,
            totalFils: BigInt(purchaseOrder.totalFils),
          });
          stats.purchaseOrders++;
        } catch (e) {
          console.warn(`[seed] Purchase order "${buildPurchaseOrderKey(partyId, purchaseOrder)}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Purchase orders: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    await sleep(300);

    const customerInvoices = seedData.moneyEvents.filter((event) => event.kind === 'CustomerInvoice');
    phase = 'invoices';
    total = customerInvoices.length;
    progress = 0;
    message = `Inserting ${total} customer invoices...`;

    for (let i = 0; i < customerInvoices.length; i += BATCH_SIZE) {
      const batch = customerInvoices.slice(i, i + BATCH_SIZE);
      for (const event of batch) {
        const partyId = getPartyIdFromSeedIndex(event.partyIdx);
        if (!partyId) {
          stats.errors++;
          continue;
        }
        let orderId: bigint | undefined;
        if (event.orderIdx != null) {
          const linkedOrder = seedData.orders[event.orderIdx];
          if (linkedOrder) {
            const linkedPartyId = getPartyIdFromSeedIndex(linkedOrder.partyIdx);
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
            kind: { tag: 'CustomerInvoice' } as any,
            subtotalFils: BigInt(event.subtotalFils),
            reference: event.reference,
            sourceDate: getMoneyEventSourceTimestamp(event),
            dueDate: isoToTimestamp(event.dueDate),
          });
          stats.customerInvoices++;
        } catch (e) {
          console.warn(`[seed] Invoice "${event.reference}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Customer Invoices: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    message = 'Waiting for invoices to settle before inserting payments...';
    await sleep(3000);

    const customerPayments = seedData.moneyEvents.filter((event) => event.kind === 'CustomerPayment');
    phase = 'payments';
    total = customerPayments.length;
    progress = 0;
    message = `Inserting ${total} customer payments...`;

    for (let i = 0; i < customerPayments.length; i += BATCH_SIZE) {
      const batch = customerPayments.slice(i, i + BATCH_SIZE);
      for (const event of batch) {
        const partyId = getPartyIdFromSeedIndex(event.partyIdx);
        if (!partyId) {
          stats.errors++;
          continue;
        }
        let orderId: bigint | undefined;
        if (event.orderIdx != null) {
          const linkedOrder = seedData.orders[event.orderIdx];
          if (linkedOrder) {
            const linkedPartyId = getPartyIdFromSeedIndex(linkedOrder.partyIdx);
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
            kind: { tag: 'CustomerPayment' } as any,
            subtotalFils: BigInt(event.subtotalFils),
            reference: event.reference,
            sourceDate: getMoneyEventSourceTimestamp(event),
            dueDate: undefined,
          });
          stats.customerPayments++;
        } catch (e) {
          console.warn(`[seed] Payment "${event.reference}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Customer Payments: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    await sleep(300);

    const supplierInvoices = seedData.moneyEvents.filter((event) => event.kind === 'SupplierInvoice');
    phase = 'supplier-invoices';
    total = supplierInvoices.length;
    progress = 0;
    message = `Inserting ${total} supplier invoices...`;

    for (let i = 0; i < supplierInvoices.length; i += BATCH_SIZE) {
      const batch = supplierInvoices.slice(i, i + BATCH_SIZE);
      for (const event of batch) {
        const partyId = getPartyIdFromSeedIndex(event.partyIdx);
        if (!partyId) {
          stats.errors++;
          continue;
        }
        let orderId: bigint | undefined;
        if (event.orderIdx != null) {
          const linkedOrder = seedData.orders[event.orderIdx];
          if (linkedOrder) {
            const linkedPartyId = getPartyIdFromSeedIndex(linkedOrder.partyIdx);
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
            kind: { tag: 'SupplierInvoice' } as any,
            subtotalFils: BigInt(event.subtotalFils),
            reference: event.reference,
            sourceDate: getMoneyEventSourceTimestamp(event),
            dueDate: isoToTimestamp(event.dueDate),
          });
          stats.supplierInvoices++;
        } catch (e) {
          console.warn(`[seed] Supplier invoice "${event.reference}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Supplier Invoices: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    await sleep(300);

    const supplierPayments = seedData.moneyEvents.filter((event) => event.kind === 'SupplierPayment');
    phase = 'supplier-payments';
    total = supplierPayments.length;
    progress = 0;
    message = `Inserting ${total} supplier payments...`;

    for (let i = 0; i < supplierPayments.length; i += BATCH_SIZE) {
      const batch = supplierPayments.slice(i, i + BATCH_SIZE);
      for (const event of batch) {
        const partyId = getPartyIdFromSeedIndex(event.partyIdx);
        if (!partyId) {
          stats.errors++;
          continue;
        }
        let orderId: bigint | undefined;
        if (event.orderIdx != null) {
          const linkedOrder = seedData.orders[event.orderIdx];
          if (linkedOrder) {
            const linkedPartyId = getPartyIdFromSeedIndex(linkedOrder.partyIdx);
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
            kind: { tag: 'SupplierPayment' } as any,
            subtotalFils: BigInt(event.subtotalFils),
            reference: event.reference,
            sourceDate: getMoneyEventSourceTimestamp(event),
            dueDate: undefined,
          });
          stats.supplierPayments++;
        } catch (e) {
          console.warn(`[seed] Supplier payment "${event.reference}" failed:`, e);
          stats.errors++;
        }
      }
      progress = Math.min(i + BATCH_SIZE, total);
      message = `Supplier Payments: ${progress}/${total}`;
      await sleep(BATCH_DELAY);
    }

    phase = 'done';
    const totalInserted = stats.parties +
      stats.contacts +
      stats.pipelines +
      stats.orders +
      stats.purchaseOrders +
      stats.customerInvoices +
      stats.customerPayments +
      stats.supplierInvoices +
      stats.supplierPayments;
    message = `Seed complete! ${totalInserted} records inserted, ${stats.errors} errors`;
  }

  let progressPercent = $derived(total > 0 ? Math.round((progress / total) * 100) : 0);

  const phaseLabels: Record<Phase, string> = {
    idle: 'Ready',
    loading: 'Loading JSON',
    parties: 'Inserting Parties',
    'waiting-sync': 'Waiting for Sync',
    contacts: 'Inserting Contacts',
    pipelines: 'Inserting Pipelines',
    orders: 'Inserting Orders',
    'purchase-orders': 'Inserting Purchase Orders',
    invoices: 'Customer Invoices',
    payments: 'Customer Payments',
    'supplier-invoices': 'Supplier Invoices',
    'supplier-payments': 'Supplier Payments',
    done: 'Complete',
    error: 'Error',
  };
</script>

<div class="seed-panel">
  <div class="seed-header">
    <h3 class="seed-title">Seed from PH Reference Data</h3>
    <p class="seed-desc">
      Import enriched PH business truth, including
      {seedData?.stats?.outputParties ?? 422} parties,
      {seedData?.contacts.length ?? 535} contacts,
      {(seedData?.pipelines.length ?? 67) + (seedData?.referencePipelines?.length ?? 298)} pipelines,
      and {seedData?.stats?.moneyEvents ?? 1615} financial records.
    </p>
  </div>

  {#if phase === 'idle'}
    <div class="seed-actions">
      {#if alreadySeeded}
        <p class="seed-warn">Database already has {existingPartyCount} parties. Seeding again will create duplicates.</p>
      {/if}
      <button class="seed-btn" onclick={startSeed}>
        Seed Database
      </button>
    </div>

  {:else if phase === 'error'}
    <div class="seed-error">
      <span class="seed-error-icon">!</span>
      <p>{errorMsg}</p>
      <button class="seed-btn seed-btn-sm" onclick={() => { phase = 'idle'; }}>Try Again</button>
    </div>

  {:else if phase === 'done'}
    <div class="seed-done">
      <span class="seed-done-icon">&#10003;</span>
      <p class="seed-done-msg">{message}</p>
      <div class="seed-stats-grid">
        <div class="stat-item"><span class="stat-val">{stats.parties}</span><span class="stat-lbl">Parties</span></div>
        <div class="stat-item"><span class="stat-val">{stats.contacts}</span><span class="stat-lbl">Contacts</span></div>
        <div class="stat-item"><span class="stat-val">{stats.pipelines}</span><span class="stat-lbl">Pipelines</span></div>
        <div class="stat-item"><span class="stat-val">{stats.orders}</span><span class="stat-lbl">Orders</span></div>
        <div class="stat-item"><span class="stat-val">{stats.purchaseOrders}</span><span class="stat-lbl">POs</span></div>
        <div class="stat-item"><span class="stat-val">{stats.customerInvoices}</span><span class="stat-lbl">Invoices</span></div>
        <div class="stat-item"><span class="stat-val">{stats.customerPayments}</span><span class="stat-lbl">Payments</span></div>
        <div class="stat-item"><span class="stat-val">{stats.supplierInvoices}</span><span class="stat-lbl">Supp. Inv.</span></div>
        <div class="stat-item"><span class="stat-val">{stats.supplierPayments}</span><span class="stat-lbl">Supp. Pay.</span></div>
        {#if stats.errors > 0}
          <div class="stat-item stat-error"><span class="stat-val">{stats.errors}</span><span class="stat-lbl">Errors</span></div>
        {/if}
      </div>
    </div>

  {:else}
    <div class="seed-progress">
      <div class="progress-phase">
        <span class="phase-label">{phaseLabels[phase]}</span>
        {#if total > 0}
          <span class="phase-count">{progress}/{total} ({progressPercent}%)</span>
        {/if}
      </div>

      <div class="progress-bar-track">
        <div class="progress-bar-fill" style="width: {progressPercent}%"></div>
      </div>

      <p class="progress-msg">{message}</p>

      <div class="seed-stats-row">
        <span>Parties: {stats.parties}</span>
        <span>Contacts: {stats.contacts}</span>
        <span>Pipelines: {stats.pipelines}</span>
        <span>Orders: {stats.orders}</span>
        <span>Inv: {stats.customerInvoices}</span>
        <span>Pay: {stats.customerPayments}</span>
        {#if stats.errors > 0}
          <span class="stat-err">Err: {stats.errors}</span>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .seed-panel {
    background: var(--paper-card);
    border: 1.5px solid var(--ink-06);
    border-radius: var(--radius-lg);
    padding: var(--sp-21);
  }

  .seed-header {
    margin-bottom: var(--sp-16);
  }

  .seed-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--ink);
    margin: 0 0 var(--sp-5);
  }

  .seed-desc {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--ink-60);
    margin: 0;
    line-height: 1.5;
  }

  .seed-actions {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
    align-items: flex-start;
  }

  .seed-warn {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--amber);
    margin: 0;
    padding: var(--sp-8) var(--sp-13);
    background: var(--amber-soft);
    border-radius: var(--radius-sm);
    border: 1px solid var(--amber);
  }

  .seed-btn {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    padding: var(--sp-8) var(--sp-21);
    border-radius: var(--radius-md);
    border: 1.5px solid var(--gold);
    background: var(--gold);
    color: var(--paper);
    cursor: pointer;
    transition: all var(--dur-fast) var(--ease-out);
  }

  .seed-btn:hover {
    background: color-mix(in srgb, var(--gold) 85%, black);
    border-color: color-mix(in srgb, var(--gold) 85%, black);
  }

  .seed-btn-sm {
    font-size: var(--text-xs);
    padding: var(--sp-5) var(--sp-13);
  }

  .seed-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-13);
    text-align: center;
    color: var(--coral);
  }

  .seed-error-icon {
    font-size: 2rem;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--coral-soft);
    border-radius: 50%;
    font-weight: 700;
  }

  .seed-error p {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    margin: 0;
  }

  .seed-done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-16);
    text-align: center;
  }

  .seed-done-icon {
    font-size: 2rem;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--sage-soft);
    color: var(--sage);
    border-radius: 50%;
    font-weight: 700;
  }

  .seed-done-msg {
    font-family: var(--font-ui);
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--ink);
    margin: 0;
  }

  .seed-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: var(--sp-8);
    width: 100%;
    max-width: 560px;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-8);
    background: var(--ink-03);
    border-radius: var(--radius-sm);
  }

  .stat-val {
    font-family: var(--font-data);
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--gold);
  }

  .stat-lbl {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-60);
  }

  .stat-error .stat-val {
    color: var(--coral);
  }

  .seed-progress {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
  }

  .progress-phase {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .phase-label {
    font-family: var(--font-ui);
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--ink);
  }

  .phase-count {
    font-family: var(--font-data);
    font-size: var(--text-sm);
    color: var(--ink-60);
  }

  .progress-bar-track {
    height: 6px;
    background: var(--ink-06);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--gold);
    border-radius: 3px;
    transition: width 0.3s var(--ease-out);
  }

  .progress-msg {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-60);
    margin: 0;
  }

  .seed-stats-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-16);
    font-family: var(--font-data);
    font-size: var(--text-xs);
    color: var(--ink-30);
  }

  .stat-err {
    color: var(--coral);
  }
</style>
