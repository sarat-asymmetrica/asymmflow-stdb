import assert from 'node:assert/strict';

import { buildAccessKeyInviteEmail, loadResendConfig, saveResendConfig } from './resend';

const cases: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void | Promise<void>): void {
  cases.push({ name, fn });
}

test('buildAccessKeyInviteEmail renders the access key, role, and notes', () => {
  const email = buildAccessKeyInviteEmail({
    assignedName: 'Stanley',
    role: 'Manager',
    accessKey: 'PH-MGR-A1B2C3',
    notes: 'Use your PH Trading email when redeeming this key.',
  });

  assert.match(email.subject, /Manager/);
  assert.match(email.html, /PH-MGR-A1B2C3/);
  assert.match(email.html, /PH Trading email/);
});

test('buildAccessKeyInviteEmail escapes admin-supplied HTML in notes', () => {
  const email = buildAccessKeyInviteEmail({
    assignedName: 'Stanley',
    role: 'Manager',
    accessKey: 'PH-MGR-A1B2C3',
    notes: '<script>alert(1)</script>',
  });

  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('Resend config round-trips through Neutralino storage when available', async () => {
  let stored = '';
  (globalThis as Record<string, unknown>).Neutralino = {
    storage: {
      async getData() {
        return stored;
      },
      async setData(_key: string, value: string) {
        stored = value;
      },
    },
  };

  await saveResendConfig({ apiKey: 'rk_live', fromEmail: 'ops@example.com' });
  const loaded = await loadResendConfig();

  assert.equal(loaded.apiKey, 'rk_live');
  assert.equal(loaded.fromEmail, 'ops@example.com');

  delete (globalThis as Record<string, unknown>).Neutralino;
});

test('Resend config falls back to localStorage when Neutralino storage is unavailable', async () => {
  const storage = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
  };

  await saveResendConfig({ apiKey: 'rk_local', fromEmail: 'local@example.com' });
  const loaded = await loadResendConfig();

  assert.equal(loaded.apiKey, 'rk_local');
  assert.equal(loaded.fromEmail, 'local@example.com');
});

let failures = 0;
for (const testCase of cases) {
  try {
    console.log(`RUN | ${testCase.name}`);
    await testCase.fn();
    console.log(`PASS | ${testCase.name}`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`FAIL | ${testCase.name}`);
    console.error(message);
  }
}

process.exit(failures);
