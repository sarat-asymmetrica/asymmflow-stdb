export interface ResendConfig {
  apiKey: string;
  fromEmail: string;
}

const RESEND_CONFIG_KEY = 'asymm_resend_config';
let warnedLocalFallback = false;

type NeutralinoStorageApi = {
  getData: (key: string) => Promise<string>;
  setData: (key: string, value: string) => Promise<void>;
};

function getNeutralinoStorage(): NeutralinoStorageApi | null {
  const storage = (globalThis as { Neutralino?: { storage?: NeutralinoStorageApi } }).Neutralino?.storage;
  return storage ?? null;
}

function warnLocalFallback(): void {
  if (warnedLocalFallback) return;
  warnedLocalFallback = true;
  console.warn('Neutralino storage unavailable; falling back to localStorage for Resend config.');
}

export async function loadResendConfig(): Promise<ResendConfig> {
  const neutralinoStorage = getNeutralinoStorage();
  if (neutralinoStorage) {
    try {
      const raw = await neutralinoStorage.getData(RESEND_CONFIG_KEY);
      if (!raw) return { apiKey: '', fromEmail: '' };
      const parsed = JSON.parse(raw) as Partial<ResendConfig>;
      return {
        apiKey: String(parsed.apiKey ?? ''),
        fromEmail: String(parsed.fromEmail ?? ''),
      };
    } catch {
      return { apiKey: '', fromEmail: '' };
    }
  }

  if (typeof localStorage === 'undefined') {
    return { apiKey: '', fromEmail: '' };
  }
  warnLocalFallback();
  try {
    const raw = localStorage.getItem(RESEND_CONFIG_KEY);
    if (!raw) return { apiKey: '', fromEmail: '' };
    const parsed = JSON.parse(raw) as Partial<ResendConfig>;
    return {
      apiKey: String(parsed.apiKey ?? ''),
      fromEmail: String(parsed.fromEmail ?? ''),
    };
  } catch {
    return { apiKey: '', fromEmail: '' };
  }
}

export async function saveResendConfig(config: ResendConfig): Promise<void> {
  const serialized = JSON.stringify(config);
  const neutralinoStorage = getNeutralinoStorage();
  if (neutralinoStorage) {
    await neutralinoStorage.setData(RESEND_CONFIG_KEY, serialized);
    return;
  }

  if (typeof localStorage === 'undefined') return;
  warnLocalFallback();
  localStorage.setItem(RESEND_CONFIG_KEY, serialized);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildAccessKeyInviteEmail(input: {
  assignedName: string;
  role: string;
  accessKey: string;
  notes?: string;
}): { subject: string; html: string } {
  const recipient = escapeHtml(input.assignedName.trim() || 'team member');
  const role = escapeHtml(input.role);
  const accessKey = escapeHtml(input.accessKey);
  const notes = input.notes?.trim();
  return {
    subject: `Your AsymmFlow access key (${input.role})`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
        <h2 style="margin:0 0 12px">Welcome to AsymmFlow</h2>
        <p>Hello ${recipient},</p>
        <p>Your role is <strong>${role}</strong>. Use the access key below to register this browser identity:</p>
        <p style="font-size:20px;font-weight:700;letter-spacing:1px">${accessKey}</p>
        <p>Open the app, enter your nickname, full name, email, and this access key on the sign-in screen.</p>
        ${notes ? `<p><strong>Notes:</strong> ${escapeHtml(notes)}</p>` : ''}
      </div>
    `.trim(),
  };
}

export async function sendResendEmail(
  config: ResendConfig,
  email: { to: string; subject: string; html: string },
): Promise<void> {
  const apiKey = config.apiKey.trim();
  const fromEmail = config.fromEmail.trim();
  if (!apiKey) throw new Error('Resend API key is required');
  if (!fromEmail) throw new Error('Resend fromEmail is required');
  if (!email.to.trim()) throw new Error('Recipient email is required');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [email.to.trim()],
      subject: email.subject,
      html: email.html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend request failed (${response.status}): ${body}`);
  }
}
