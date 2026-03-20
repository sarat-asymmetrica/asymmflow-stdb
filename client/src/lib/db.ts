/**
 * AsymmFlow — SpacetimeDB Connection Store
 *
 * Wraps the generated DbConnection in Svelte writable stores so components
 * reactively update when table data changes.
 */

import { writable, derived, type Writable } from 'svelte/store';
import { DbConnection, type ErrorContext } from '../module_bindings';
import type {
  Member, Party, Contact, Pipeline, Order, LineItem, AccessKey, AuthSession,
  PurchaseOrder, DeliveryNote, DeliveryNoteItem, GoodsReceivedNote, GrnItem,
  MoneyEvent, ActivityLog, AiAction, BankTransaction, DocSequence,
  ChatMessage, AiMemory, FxRate, Product, StockEntry,
} from '../module_bindings/types';
import type { Identity } from 'spacetimedb';

// Re-export types so components can import from one place
export type {
  Member, Party, Contact, Pipeline, Order, LineItem, AccessKey, AuthSession,
  PurchaseOrder, DeliveryNote, DeliveryNoteItem, GoodsReceivedNote, GrnItem,
  MoneyEvent, ActivityLog, AiAction, BankTransaction, DocSequence,
  ChatMessage, AiMemory, FxRate, Product, StockEntry,
};
export type { DbConnection } from '../module_bindings';

// ── Connection state ──────────────────────────────────────────────────────────

export const connected = writable(false);
export const identity: Writable<Identity | null> = writable(null);
export const connectionError: Writable<string | null> = writable(null);

// ── Table stores ──────────────────────────────────────────────────────────────

export const members: Writable<Member[]>             = writable([]);
export const accessKeys: Writable<AccessKey[]>       = writable([]);
export const authSessions: Writable<AuthSession[]>   = writable([]);
export const parties: Writable<Party[]>              = writable([]);
export const contacts: Writable<Contact[]>           = writable([]);
export const pipelines: Writable<Pipeline[]>         = writable([]);
export const orders: Writable<Order[]>               = writable([]);
export const lineItems: Writable<LineItem[]>         = writable([]);
export const purchaseOrders: Writable<PurchaseOrder[]> = writable([]);
export const deliveryNotes: Writable<DeliveryNote[]> = writable([]);
export const deliveryNoteItems: Writable<DeliveryNoteItem[]> = writable([]);
export const grns: Writable<GoodsReceivedNote[]> = writable([]);
export const grnItems: Writable<GrnItem[]> = writable([]);
export const moneyEvents: Writable<MoneyEvent[]>     = writable([]);
export const activityLogs: Writable<ActivityLog[]>       = writable([]);
export const aiActions: Writable<AiAction[]>             = writable([]);
export const bankTransactions: Writable<BankTransaction[]> = writable([]);
export const docSequences: Writable<DocSequence[]>         = writable([]);
export const chatMessages: Writable<ChatMessage[]>         = writable([]);
export const aiMemories: Writable<AiMemory[]>              = writable([]);
export const fxRates: Writable<FxRate[]>                   = writable([]);
export const products: Writable<Product[]>                 = writable([]);
export const stockEntries: Writable<StockEntry[]>          = writable([]);

// ── Live connection ──────────────────────────────────────────────────────────

let conn: DbConnection | null = null;

export function getConnection(): DbConnection | null {
  return conn;
}

// ── Derived stores ────────────────────────────────────────────────────────────

/** Map from identity hex string → nickname for fast display lookups. */
export const nicknameMap = derived(members, ($members) => {
  const map = new Map<string, string>();
  for (const m of $members) {
    map.set(String(m.identity), m.nickname);
  }
  return map;
});

/** The Member record for the currently authenticated user. */
export const currentMember = derived(
  [members, identity],
  ([$members, $identity]) => {
    if (!$identity) return null;
    const idStr = String($identity);
    return $members.find((m) => String(m.identity) === idStr) ?? null;
  }
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function iterToArray<T>(iterable: Iterable<T>): T[] {
  const arr: T[] = [];
  for (const item of iterable) arr.push(item);
  return arr;
}

function setupTableSync(c: DbConnection): void {
  const db = c.db;

  const sync = <T>(store: Writable<T[]>, tbl: { onInsert: (fn: () => void) => void; onDelete: (fn: () => void) => void; iter: () => Iterable<T> }) => {
    const refresh = () => store.set(iterToArray(tbl.iter()));
    tbl.onInsert(refresh);
    tbl.onDelete(refresh);
  };

  sync(members,        db.member);
  sync(accessKeys,     db.accessKey);
  sync(authSessions,   db.authSession);
  sync(parties,        db.party);
  sync(contacts,       db.contact);
  sync(pipelines,      db.pipeline);
  sync(orders,         db.order);
  sync(lineItems,      db.lineItem);
  sync(purchaseOrders, db.purchaseOrder);
  sync(deliveryNotes,  db.deliveryNote);
  sync(deliveryNoteItems, db.deliveryNoteItem);
  sync(grns, db.goodsReceivedNote);
  sync(grnItems, db.grnItem);
  sync(moneyEvents,    db.moneyEvent);
  sync(activityLogs,    db.activityLog);
  sync(aiActions,       db.aiAction);
  sync(bankTransactions, db.bankTransaction);
  sync(docSequences,     db.docSequence);
  sync(chatMessages,     db.chatMessage);
  sync(aiMemories,       db.aiMemory);
  sync(fxRates,          db.fxRate);
  sync(products,         db.product);
  sync(stockEntries,     db.stockEntry);
}

function flushAllTables(c: DbConnection): void {
  const db = c.db;
  members.set(iterToArray(db.member.iter()));
  accessKeys.set(iterToArray(db.accessKey.iter()));
  authSessions.set(iterToArray(db.authSession.iter()));
  parties.set(iterToArray(db.party.iter()));
  contacts.set(iterToArray(db.contact.iter()));
  pipelines.set(iterToArray(db.pipeline.iter()));
  orders.set(iterToArray(db.order.iter()));
  lineItems.set(iterToArray(db.lineItem.iter()));
  purchaseOrders.set(iterToArray(db.purchaseOrder.iter()));
  deliveryNotes.set(iterToArray(db.deliveryNote.iter()));
  deliveryNoteItems.set(iterToArray(db.deliveryNoteItem.iter()));
  grns.set(iterToArray(db.goodsReceivedNote.iter()));
  grnItems.set(iterToArray(db.grnItem.iter()));
  moneyEvents.set(iterToArray(db.moneyEvent.iter()));
  activityLogs.set(iterToArray(db.activityLog.iter()));
  aiActions.set(iterToArray(db.aiAction.iter()));
  bankTransactions.set(iterToArray(db.bankTransaction.iter()));
  docSequences.set(iterToArray(db.docSequence.iter()));
  chatMessages.set(iterToArray(db.chatMessage.iter()));
  aiMemories.set(iterToArray(db.aiMemory.iter()));
  fxRates.set(iterToArray(db.fxRate.iter()));
  products.set(iterToArray(db.product.iter()));
  stockEntries.set(iterToArray(db.stockEntry.iter()));
}

// ── Connect ──────────────────────────────────────────────────────────────────

const HOST      = 'wss://maincloud.spacetimedb.com';
const DB_NAME   = 'asymm-flow';
const TOKEN_KEY = `stdb_token_${DB_NAME}`;

/**
 * Initiate the SpacetimeDB connection.
 * Call once from App.svelte onMount.
 */
export function connect(): void {
  conn = DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withToken(localStorage.getItem(TOKEN_KEY) ?? undefined)
    .onConnect((_conn, id, token) => {
      localStorage.setItem(TOKEN_KEY, token);
      identity.set(id);
      connected.set(true);
      connectionError.set(null);

      console.log('[stdb] connected, identity:', String(id).slice(0, 16));

      // Register callbacks BEFORE subscribing
      setupTableSync(_conn);

      // Subscribe to all public tables
      _conn.subscriptionBuilder()
        .onApplied(() => {
          console.log('[stdb] subscription applied — flushing tables');
          flushAllTables(_conn);
          console.log('[stdb] sync complete');
        })
        .onError((_ctx: ErrorContext) => {
          console.error('[stdb] subscription error');
        })
        .subscribe([
          'SELECT * FROM member',
          'SELECT * FROM access_key',
          'SELECT * FROM auth_session',
          'SELECT * FROM party',
          'SELECT * FROM contact',
          'SELECT * FROM pipeline',
          'SELECT * FROM "order"',
          'SELECT * FROM line_item',
          'SELECT * FROM purchase_order',
          'SELECT * FROM delivery_note',
          'SELECT * FROM delivery_note_item',
          'SELECT * FROM goods_received_note',
          'SELECT * FROM grn_item',
          'SELECT * FROM money_event',
          'SELECT * FROM activity_log',
          'SELECT * FROM ai_action',
          'SELECT * FROM bank_transaction',
          'SELECT * FROM doc_sequence',
          'SELECT * FROM chat_message',
          'SELECT * FROM ai_memory',
          'SELECT * FROM fx_rate',
          'SELECT * FROM product',
          'SELECT * FROM stock_entry',
        ]);
    })
    .onDisconnect(() => {
      console.log('[stdb] disconnected');
      connected.set(false);
      conn = null;
    })
    .onConnectError((_ctx: ErrorContext, err: Error) => {
      console.error('[stdb] connection error:', err);
      connectionError.set(err.message);
      connected.set(false);
    })
    .build();
}
