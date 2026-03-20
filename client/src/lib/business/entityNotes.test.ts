import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmptyNoteStore,
  addNote,
  updateNote,
  deleteNote,
  togglePin,
  filterNotes,
  getNotesForEntity,
  computeNoteSummary,
  saveNoteStore,
  loadNoteStore,
} from './entityNotes';
import type { EntityNoteStore } from './entityNotes';

// ─── localStorage Mock ────────────────────────────────────────────────────

const storage = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem(key: string): string | null {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      storage.set(key, value);
    },
    removeItem(key: string): void {
      storage.delete(key);
    },
    clear(): void {
      storage.clear();
    },
  },
  writable: true,
  configurable: true,
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function seedStore(): EntityNoteStore {
  let store = createEmptyNoteStore();
  store = addNote(store, 'customer', 'C001', 'Acme Corp', 'general', 'Welcome note', 'First contact with client.', 'alice');
  store = addNote(store, 'customer', 'C001', 'Acme Corp', 'payment', 'Payment terms', 'Net 30 agreed.', 'alice');
  store = addNote(store, 'supplier', 'S001', 'Steel Inc', 'delivery', 'Late shipment', 'Shipment delayed by 3 days.', 'bob');
  store = addNote(store, 'order', 'O001', 'Order #1234', 'issue', 'Quality concern', 'Minor defects reported on batch.', 'carol');
  store = addNote(store, 'pipeline', 'P001', 'Big Deal', 'commercial', 'Pricing update', 'Revised pricing sent to customer.', 'alice');
  return store;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('entityNotes', () => {
  beforeEach(() => {
    storage.clear();
  });

  // 1. addNote
  describe('addNote', () => {
    it('creates a note with correct fields and grows the store', () => {
      let store = createEmptyNoteStore();
      assert.equal(store.notes.length, 0);
      assert.equal(store.version, 1);

      store = addNote(store, 'customer', 'C001', 'Acme Corp', 'general', 'Hello', 'Body text', 'alice');

      assert.equal(store.notes.length, 1);
      assert.equal(store.version, 2);

      const note = store.notes[0];
      assert.match(note.id, /^NOTE-\d{8}-\d{4}$/);
      assert.equal(note.entityType, 'customer');
      assert.equal(note.entityId, 'C001');
      assert.equal(note.entityName, 'Acme Corp');
      assert.equal(note.noteType, 'general');
      assert.equal(note.title, 'Hello');
      assert.equal(note.content, 'Body text');
      assert.equal(note.createdBy, 'alice');
      assert.equal(note.pinned, false);
      assert.ok(note.createdAt);
      assert.ok(note.updatedAt);
    });
  });

  // 2. updateNote
  describe('updateNote', () => {
    it('modifies the correct note and bumps version', () => {
      const store = seedStore();
      const targetId = store.notes[1].id;

      const updated = updateNote(store, targetId, { title: 'Revised terms', content: 'Net 45 now.' });

      assert.equal(updated.notes.length, store.notes.length);
      assert.equal(updated.version, store.version + 1);

      const note = updated.notes.find((n) => n.id === targetId);
      assert.ok(note);
      assert.equal(note.title, 'Revised terms');
      assert.equal(note.content, 'Net 45 now.');
      assert.equal(note.noteType, 'payment');
    });

    it('returns same store when noteId not found', () => {
      const store = seedStore();
      const result = updateNote(store, 'NOTE-00000000-9999', { title: 'Ghost' });
      assert.equal(result, store);
    });
  });

  // 3. deleteNote
  describe('deleteNote', () => {
    it('removes the specified note from the store', () => {
      const store = seedStore();
      const targetId = store.notes[2].id;

      const result = deleteNote(store, targetId);

      assert.equal(result.notes.length, store.notes.length - 1);
      assert.equal(result.version, store.version + 1);
      assert.equal(result.notes.find((n) => n.id === targetId), undefined);
    });

    it('returns same store when noteId not found', () => {
      const store = seedStore();
      const result = deleteNote(store, 'NOTE-00000000-9999');
      assert.equal(result, store);
    });
  });

  // 4. togglePin
  describe('togglePin', () => {
    it('flips the pinned state of a note', () => {
      const store = seedStore();
      const targetId = store.notes[0].id;
      assert.equal(store.notes[0].pinned, false);

      const pinned = togglePin(store, targetId);
      const note1 = pinned.notes.find((n) => n.id === targetId);
      assert.ok(note1);
      assert.equal(note1.pinned, true);

      const unpinned = togglePin(pinned, targetId);
      const note2 = unpinned.notes.find((n) => n.id === targetId);
      assert.ok(note2);
      assert.equal(note2.pinned, false);
    });
  });

  // 5. filterNotes by type
  describe('filterNotes by type', () => {
    it('returns only notes matching the given noteType', () => {
      const store = seedStore();
      const results = filterNotes(store, { noteType: 'payment' });

      assert.equal(results.length, 1);
      assert.equal(results[0].noteType, 'payment');
    });

    it('returns only notes matching the given entityType', () => {
      const store = seedStore();
      const results = filterNotes(store, { entityType: 'customer' });

      assert.equal(results.length, 2);
      for (const n of results) {
        assert.equal(n.entityType, 'customer');
      }
    });
  });

  // 6. filterNotes by search (case-insensitive)
  describe('filterNotes by search', () => {
    it('matches title and content case-insensitively', () => {
      const store = seedStore();

      const byTitle = filterNotes(store, { searchQuery: 'PRICING' });
      assert.equal(byTitle.length, 1);
      assert.equal(byTitle[0].title, 'Pricing update');

      const byContent = filterNotes(store, { searchQuery: 'defects' });
      assert.equal(byContent.length, 1);
      assert.equal(byContent[0].noteType, 'issue');
    });
  });

  // 7. filterNotes pinned only
  describe('filterNotes pinnedOnly', () => {
    it('returns only pinned notes', () => {
      let store = seedStore();
      store = togglePin(store, store.notes[0].id);
      store = togglePin(store, store.notes[3].id);

      const results = filterNotes(store, { pinnedOnly: true });

      assert.equal(results.length, 2);
      for (const n of results) {
        assert.equal(n.pinned, true);
      }
    });
  });

  // 8. getNotesForEntity
  describe('getNotesForEntity', () => {
    it('returns notes matching both entityType and entityId', () => {
      const store = seedStore();
      const results = getNotesForEntity(store, 'customer', 'C001');

      assert.equal(results.length, 2);
      for (const n of results) {
        assert.equal(n.entityType, 'customer');
        assert.equal(n.entityId, 'C001');
      }
    });

    it('returns empty array for non-existent entity', () => {
      const store = seedStore();
      const results = getNotesForEntity(store, 'customer', 'C999');
      assert.equal(results.length, 0);
    });
  });

  // 9. computeNoteSummary
  describe('computeNoteSummary', () => {
    it('produces correct counts and breakdown', () => {
      let store = seedStore();
      store = togglePin(store, store.notes[0].id);

      const summary = computeNoteSummary(store);

      assert.equal(summary.totalNotes, 5);
      assert.equal(summary.pinnedCount, 1);

      assert.equal(summary.byType.general, 1);
      assert.equal(summary.byType.payment, 1);
      assert.equal(summary.byType.delivery, 1);
      assert.equal(summary.byType.issue, 1);
      assert.equal(summary.byType.commercial, 1);
      assert.equal(summary.byType.technical, 0);

      assert.equal(summary.byEntity.length, 4);
      const acme = summary.byEntity.find((e) => e.entityId === 'C001');
      assert.ok(acme);
      assert.equal(acme.count, 2);
      assert.equal(acme.entityName, 'Acme Corp');

      assert.ok(summary.recentNotes.length <= 10);
      assert.equal(summary.recentNotes.length, 5);
    });
  });

  // 10. localStorage round-trip
  describe('localStorage round-trip', () => {
    it('saves and loads a store preserving all data', () => {
      const store = seedStore();
      saveNoteStore(store);

      const loaded = loadNoteStore();

      assert.deepEqual(loaded, store);
    });

    it('returns empty store when nothing is saved', () => {
      const loaded = loadNoteStore();
      assert.equal(loaded.notes.length, 0);
      assert.equal(loaded.version, 1);
    });

    it('returns empty store when localStorage contains invalid data', () => {
      localStorage.setItem('asymmflow_entity_notes', '{"bad":true}');
      const loaded = loadNoteStore();
      assert.equal(loaded.notes.length, 0);
      assert.equal(loaded.version, 1);
    });
  });
});
