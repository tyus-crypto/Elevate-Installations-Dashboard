// Text-message alerts via Twilio's REST API (no SDK needed).
//
// Configure with environment variables:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN          (required)
//   TWILIO_FROM_NUMBER  or  TWILIO_MESSAGING_SERVICE_SID   (one required)
//   ALERT_PHONE_NUMBERS  (optional) comma-separated fallback recipients,
//                        used when a project has no PM phone of its own.
//
// IMPORTANT (US): carriers block texts from unregistered numbers. The
// sender must have A2P 10DLC registration or toll-free verification
// complete before messages are delivered. See README.
//
// Sending never throws: a failed text must never block a customer's
// hold-up report from being saved. Problems are logged and reported back
// as { sent: false, reason }.

const TWILIO_BASE = process.env.TWILIO_API_BASE || 'https://api.twilio.com';

function isConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
    (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID));
}

// Turn "(225) 555-0142", "225-555-0142", "1 225 555 0142" or "+12255550142"
// into "+12255550142". Returns null if it doesn't look like a real number.
function normalizePhone(input) {
  if (!input) return null;
  const raw = String(input).trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? '+' + digits : null;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

function fallbackRecipients() {
  return (process.env.ALERT_PHONE_NUMBERS || '').split(',').map(normalizePhone).filter(Boolean);
}

// Who should be texted for a project: its PM's number if set, otherwise the
// company-wide fallback list.
function recipientsFor(project) {
  const own = normalizePhone(project && project.pmPhone);
  return own ? [own] : fallbackRecipients();
}

async function sendOne(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const params = new URLSearchParams({ To: to, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) params.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
  else params.set('From', process.env.TWILIO_FROM_NUMBER);

  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const res = await fetch(`${TWILIO_BASE}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = `${j.code || ''} ${j.message || ''}`.trim(); } catch {}
    throw new Error(`Twilio responded ${res.status}${detail ? ': ' + detail : ''}`);
  }
}

// Send `body` to every recipient. Returns { sent: boolean, reason?, count }.
async function sendAlert(recipients, body) {
  if (!isConfigured()) return { sent: false, reason: 'not-configured', count: 0 };
  if (!recipients.length) return { sent: false, reason: 'no-recipient', count: 0 };
  let ok = 0;
  for (const to of recipients) {
    try { await sendOne(to, body); ok++; }
    catch (e) { console.error('[sms] failed to text', to.slice(0, -4) + '****', '-', e.message); }
  }
  return ok > 0 ? { sent: true, count: ok } : { sent: false, reason: 'send-failed', count: 0 };
}

module.exports = { isConfigured, normalizePhone, recipientsFor, sendAlert };
