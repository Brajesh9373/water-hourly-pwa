import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { fileURLToPath } from 'node:url';
import { makeStore } from './lib/store.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(dataDir, { recursive: true });
const store = makeStore(dataDir);
const HOUR = 60 * 60 * 1000;
const PORT = Number(process.env.PORT || 3000);

// For zero-config development, create a VAPID key pair once and persist it.
// IMPORTANT: Back up the data directory (or configure keys through env vars)
// in production. Changing VAPID keys invalidates existing push subscriptions.
const keyFile = path.join(dataDir, 'vapid-keys.json');
let keys;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
} else if (fs.existsSync(keyFile)) {
  keys = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
} else {
  keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(keyFile, JSON.stringify(keys, null, 2), { mode: 0o600 });
  console.log(`Generated VAPID keys and saved them to ${keyFile}`);
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:you@example.com', keys.publicKey, keys.privateKey);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '12kb', type: 'application/json' }));
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

function validSubscription(subscription) {
  if (!subscription || typeof subscription !== 'object') return false;
  if (typeof subscription.endpoint !== 'string' || subscription.endpoint.length > 2048) return false;
  try {
    const url = new URL(subscription.endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    // Accept known browser push services only: prevents this public endpoint
    // from becoming a general-purpose request/SSRF proxy.
    const host = url.hostname.toLowerCase();
    const allowed = host.endsWith('.push.apple.com') ||
      host === 'fcm.googleapis.com' ||
      host === 'updates.push.services.mozilla.com';
    if (!allowed) return false;
  } catch { return false; }
  return Boolean(
    subscription.keys &&
    typeof subscription.keys.p256dh === 'string' &&
    typeof subscription.keys.auth === 'string' &&
    subscription.keys.p256dh.length < 256 &&
    subscription.keys.auth.length < 256
  );
}

app.get('/api/public-key', (_req, res) => res.json({ publicKey: keys.publicKey }));

app.post('/api/subscribe', (req, res) => {
  if (!validSubscription(req.body?.subscription)) {
    return res.status(400).json({ error: 'Invalid push subscription' });
  }
  const record = store.upsert(req.body.subscription, Date.now() + HOUR);
  res.json({ ok: true, nextAt: new Date(record.nextAt).toISOString() });
});

app.post('/api/unsubscribe', (req, res) => {
  if (typeof req.body?.endpoint !== 'string') {
    return res.status(400).json({ error: 'Missing endpoint' });
  }
  store.remove(req.body.endpoint);
  res.json({ ok: true });
});

const message = {
  title: '💧 A little water break',
  body: 'A friendly reminder to drink some water if you need it.',
  url: '/',
  tag: 'hourly-water-reminder'
};

async function send(record) {
  return webpush.sendNotification(record.subscription, JSON.stringify(message), {
    TTL: 60 * 60, urgency: 'normal'
  });
}

const lastTestAt = new Map();
app.post('/api/test', async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'Missing endpoint' });
  const record = store.get(endpoint);
  if (!record) return res.status(404).json({ error: 'No active subscription found' });
  if (Date.now() - (lastTestAt.get(endpoint) || 0) < 60_000) {
    return res.status(429).json({ error: 'Please wait a minute before testing again' });
  }
  lastTestAt.set(endpoint, Date.now());
  try {
    await send(record);
    res.json({ ok: true });
  } catch (error) {
    if ([404, 410].includes(error.statusCode)) store.remove(endpoint);
    console.error('Test push failed:', error.statusCode || error.message);
    res.status(502).json({ error: 'The push service could not accept the test notification' });
  }
});

let checking = false;
async function sendDueReminders() {
  if (checking) return;
  checking = true;
  try {
    for (const record of store.all()) {
      if (record.nextAt > Date.now()) continue;
      try {
        await send(record);
        store.reschedule(record.subscription.endpoint, Date.now() + HOUR);
      } catch (error) {
        const endpoint = record.subscription.endpoint;
        if ([404, 410].includes(error.statusCode)) {
          store.remove(endpoint);
        } else {
          // Retry after five minutes if a push service is temporarily unavailable.
          store.reschedule(endpoint, Date.now() + 5 * 60_000);
          console.error('Push failed:', error.statusCode || error.message);
        }
      }
    }
  } catch (error) {
    console.error('Reminder check failed:', error);
  } finally {
    checking = false;
  }
}

const timer = setInterval(sendDueReminders, 30_000);
timer.unref();
sendDueReminders();
app.listen(PORT, '0.0.0.0', () => console.log(`Water reminders running on http://localhost:${PORT}`));
