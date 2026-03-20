// ─── Types ────────────────────────────────────────────────────────────────

export type NoteType = 'general' | 'delivery' | 'issue' | 'payment' | 'commercial' | 'technical';
export type EntityType = 'customer' | 'supplier' | 'order' | 'pipeline' | 'purchase_order';

export interface EntityNote {
  id: string;
  entityType: EntityType;
  entityId: string;
  entityName: string;
  noteType: NoteType;
  title: string;
  content: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
}

export interface EntityNoteStore {
  notes: EntityNote[];
  version: number;
}

export interface NoteFilter {
  entityType?: EntityType;
  entityId?: string;
  noteType?: NoteType;
  searchQuery?: string;
  pinnedOnly?: boolean;
}

export interface EntityNoteSummary {
  totalNotes: number;
  byType: Record<NoteType, number>;
  byEntity: Array<{ entityType: EntityType; entityId: string; entityName: string; count: number }>;
  pinnedCount: number;
  recentNotes: EntityNote[];
}

// ─── Constants ────────────────────────────────────────────────────────────

const STORAGE_KEY = 'asymmflow_entity_notes';

const ALL_NOTE_TYPES: readonly NoteType[] = [
  'general',
  'delivery',
  'issue',
  'payment',
  'commercial',
  'technical',
] as const;

// ─── ID Generation ────────────────────────────────────────────────────────

let _counter = 0;

function generateNoteId(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  _counter += 1;
  const seq = String(_counter).padStart(4, '0');
  return `NOTE-${yyyy}${mm}${dd}-${seq}`;
}

// ─── Store Lifecycle ──────────────────────────────────────────────────────

export function createEmptyNoteStore(): EntityNoteStore {
  return { notes: [], version: 1 };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────

export function addNote(
  store: EntityNoteStore,
  entityType: EntityType,
  entityId: string,
  entityName: string,
  noteType: NoteType,
  title: string,
  content: string,
  createdBy: string,
): EntityNoteStore {
  const now = new Date().toISOString();
  const note: EntityNote = {
    id: generateNoteId(),
    entityType,
    entityId,
    entityName,
    noteType,
    title,
    content,
    createdBy,
    createdAt: now,
    updatedAt: now,
    pinned: false,
  };
  return {
    ...store,
    notes: [...store.notes, note],
    version: store.version + 1,
  };
}

export function updateNote(
  store: EntityNoteStore,
  noteId: string,
  updates: { title?: string; content?: string; noteType?: NoteType; pinned?: boolean },
): EntityNoteStore {
  const idx = store.notes.findIndex((n) => n.id === noteId);
  if (idx === -1) return store;

  const existing = store.notes[idx];
  const updated: EntityNote = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  const notes = [...store.notes];
  notes[idx] = updated;

  return { ...store, notes, version: store.version + 1 };
}

export function deleteNote(store: EntityNoteStore, noteId: string): EntityNoteStore {
  const filtered = store.notes.filter((n) => n.id !== noteId);
  if (filtered.length === store.notes.length) return store;
  return { ...store, notes: filtered, version: store.version + 1 };
}

export function togglePin(store: EntityNoteStore, noteId: string): EntityNoteStore {
  const idx = store.notes.findIndex((n) => n.id === noteId);
  if (idx === -1) return store;

  const existing = store.notes[idx];
  const updated: EntityNote = {
    ...existing,
    pinned: !existing.pinned,
    updatedAt: new Date().toISOString(),
  };

  const notes = [...store.notes];
  notes[idx] = updated;

  return { ...store, notes, version: store.version + 1 };
}

// ─── Queries ──────────────────────────────────────────────────────────────

export function filterNotes(store: EntityNoteStore, filter: NoteFilter): EntityNote[] {
  let results = store.notes;

  if (filter.entityType !== undefined) {
    results = results.filter((n) => n.entityType === filter.entityType);
  }
  if (filter.entityId !== undefined) {
    results = results.filter((n) => n.entityId === filter.entityId);
  }
  if (filter.noteType !== undefined) {
    results = results.filter((n) => n.noteType === filter.noteType);
  }
  if (filter.pinnedOnly) {
    results = results.filter((n) => n.pinned);
  }
  if (filter.searchQuery !== undefined && filter.searchQuery !== '') {
    const q = filter.searchQuery.toLowerCase();
    results = results.filter(
      (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
    );
  }

  return results;
}

export function getNotesForEntity(
  store: EntityNoteStore,
  entityType: EntityType,
  entityId: string,
): EntityNote[] {
  return store.notes.filter((n) => n.entityType === entityType && n.entityId === entityId);
}

// ─── Summary ──────────────────────────────────────────────────────────────

export function computeNoteSummary(store: EntityNoteStore): EntityNoteSummary {
  const byType: Record<NoteType, number> = {
    general: 0,
    delivery: 0,
    issue: 0,
    payment: 0,
    commercial: 0,
    technical: 0,
  };

  for (const note of store.notes) {
    byType[note.noteType] += 1;
  }

  const entityMap = new Map<string, { entityType: EntityType; entityId: string; entityName: string; count: number }>();
  for (const note of store.notes) {
    const key = `${note.entityType}::${note.entityId}`;
    const existing = entityMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      entityMap.set(key, {
        entityType: note.entityType,
        entityId: note.entityId,
        entityName: note.entityName,
        count: 1,
      });
    }
  }

  const pinnedCount = store.notes.filter((n) => n.pinned).length;

  const sorted = [...store.notes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const recentNotes = sorted.slice(0, 10);

  return {
    totalNotes: store.notes.length,
    byType,
    byEntity: Array.from(entityMap.values()),
    pinnedCount,
    recentNotes,
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────

export function saveNoteStore(store: EntityNoteStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function loadNoteStore(): EntityNoteStore {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return createEmptyNoteStore();

  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'notes' in parsed &&
    'version' in parsed &&
    Array.isArray((parsed as EntityNoteStore).notes)
  ) {
    return parsed as EntityNoteStore;
  }

  return createEmptyNoteStore();
}

// ─── Reporting ────────────────────────────────────────────────────────────

export function formatNotesReport(notes: EntityNote[]): string {
  if (notes.length === 0) return 'No notes found.';

  const lines: string[] = [`Notes Report (${notes.length} note${notes.length === 1 ? '' : 's'})`, ''];

  for (const note of notes) {
    const pin = note.pinned ? ' [PINNED]' : '';
    lines.push(`[${note.id}] ${note.title}${pin}`);
    lines.push(`  Type: ${note.noteType} | Entity: ${note.entityType}/${note.entityId} (${note.entityName})`);
    lines.push(`  By: ${note.createdBy} | Created: ${note.createdAt}`);
    lines.push(`  ${note.content}`);
    lines.push('');
  }

  return lines.join('\n');
}
