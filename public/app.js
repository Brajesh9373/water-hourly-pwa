const enableButton = document.getElementById('enable');
const enableLabel = document.getElementById('enable-label');
const testButton = document.getElementById('test');
const stopButton = document.getElementById('stop');
const status = document.getElementById('status');
const installGuide = document.getElementById('install-guide');

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const needsInstall = isIOS && !standalone;
let registration;
let publicKey;
let subscription;

function setStatus(text) { status.textContent = text; }
function base64ToBytes(base64) {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
function showEnabled(nextAt) {
  enableButton.hidden = true;
  stopButton.hidden = false;
  testButton.hidden = false;
  if (nextAt) {
    const time = new Date(nextAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    setStatus(`Reminders are on. Next reminder around ${time}.`);
  } else {
    setStatus('Reminders are on. Your next reminder is about an hour away.');
  }
}
function showDisabled() {
  enableButton.hidden = false;
  enableButton.disabled = needsInstall;
  enableLabel.textContent = needsInstall ? 'Open from Home Screen to enable' : 'Enable hourly reminders';
  stopButton.hidden = true;
  testButton.hidden = true;
  if (needsInstall) {
    installGuide.hidden = false;
    setStatus('Once installed, open the app and enable notifications.');
  } else if (Notification.permission === 'denied') {
    setStatus('Notifications were blocked. Allow them in iPhone Settings → Notifications → Water Break.');
  } else {
    setStatus('No account needed. You can turn reminders off anytime.');
  }
}

async function initialize() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    enableLabel.textContent = 'Notifications unavailable';
    setStatus('This browser does not support push reminders. Try an updated browser.');
    return;
  }
  if (!window.isSecureContext) {
    enableLabel.textContent = 'Secure connection needed';
    setStatus('Use an HTTPS website to receive reminders.');
    return;
  }
  if (needsInstall) {
    showDisabled();
    return;
  }
  try {
    const results = await Promise.all([
      navigator.serviceWorker.register('/sw.js'),
      fetch('/api/public-key').then((r) => { if (!r.ok) throw new Error('Server unavailable'); return r.json(); })
    ]);
    registration = await navigator.serviceWorker.ready;
    publicKey = results[1].publicKey;
    subscription = await registration.pushManager.getSubscription();
    if (subscription && Notification.permission === 'granted') {
      // Re-sync in case the server was restarted; it does not reset the timer.
      const saved = await post('/api/subscribe', { subscription: subscription.toJSON() });
      showEnabled(saved.nextAt);
    } else {
      subscription = null;
      showDisabled();
    }
  } catch (error) {
    enableButton.disabled = true;
    enableLabel.textContent = 'Unable to connect';
    setStatus(`Setup failed: ${error.message}`);
  }
}

enableButton.addEventListener('click', async () => {
  if (!registration || !publicKey || needsInstall) return;
  enableButton.disabled = true;
  enableLabel.textContent = 'Enabling…';
  try {
    // Start subscribe() directly inside the tap handler. The iOS prompt must
    // be triggered by the user, not a timer or automatic page-load request.
    const pendingSubscription = registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToBytes(publicKey)
    });
    subscription = await pendingSubscription;
    const saved = await post('/api/subscribe', { subscription: subscription.toJSON() });
    showEnabled(saved.nextAt);
  } catch (error) {
    enableButton.disabled = false;
    enableLabel.textContent = 'Try enabling reminders again';
    setStatus(Notification.permission === 'denied'
      ? 'Notifications are blocked. Enable them in iPhone Settings → Notifications → Water Break.'
      : `Could not enable reminders: ${error.message}`);
  }
});

testButton.addEventListener('click', async () => {
  if (!subscription) return;
  testButton.disabled = true;
  setStatus('Sending a test notification…');
  try {
    await post('/api/test', { endpoint: subscription.endpoint });
    setStatus('Test sent. Check your notifications.');
  } catch (error) {
    setStatus(`Test failed: ${error.message}`);
  } finally { testButton.disabled = false; }
});

stopButton.addEventListener('click', async () => {
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  stopButton.disabled = true;
  try {
    await subscription.unsubscribe();
    subscription = null;
    showDisabled();
    setStatus('Hourly reminders are turned off.');
    // Device unsubscribing stops delivery even if server cleanup fails.
    try { await post('/api/unsubscribe', { endpoint }); }
    catch { setStatus('Reminders stopped on this device. Server cleanup will happen after the old subscription expires.'); }
  } catch (error) {
    setStatus(`Could not fully stop reminders: ${error.message}`);
  } finally { stopButton.disabled = false; }
});

initialize();
