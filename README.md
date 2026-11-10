# Water Break — Hourly Water Reminders for iPhone

A small website/PWA that asks for push-notification permission and sends a friendly water reminder approximately every 60 minutes **after the user enables it**. Reminders are sent by a Node.js backend, so the website does not have to remain open.

## Key iPhone limitation

**On iPhone, push notifications work for Home Screen web apps (iOS 16.4+) — not for an ordinary Safari tab.** Open the HTTPS site in Safari → tap Share → Add to Home Screen → launch Water Break from its new Home Screen icon → tap Enable hourly reminders → Allow. The permission request must come from a tap. An iPhone 16 meets the minimum iOS version requirement.

## Run locally

1. Install Node.js 20 or later.
2. In this folder run:

   ```bash
   npm install
   npm start
   ```
3. Visit `http://localhost:3000` on your computer to inspect the UI. localhost is allowed for local service-worker development.

**Important:** `http://192.168.x.x:3000` from your iPhone is not secure enough for production web push. Deploy to an **HTTPS** URL to test on iPhone.

## Deploy

Deploy this as an **always-on Node.js web service** or a small VM with HTTPS. The server must remain running to check for due reminders every 30 seconds. Serverless static hosting alone is not sufficient for this project.

- Start command: `npm start`
- Server port: `process.env.PORT` (default 3000)
- Persist the directory specified by `DATA_DIR`, defaulting to `<project>/data`, across restarts and deployments.
- Set `VAPID_SUBJECT=mailto:your-real-email@example.com` on your host (replace with your actual contact email).
- When first run, the server creates VAPID keys in `data/vapid-keys.json` and subscriptions in `data/subscriptions.json`. Keep both private, **back them up**, and never delete or publicly serve them.
- Alternatively, set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` as environment variables and keep the same values across deployments.
- Do not use multiple server instances with the JSON store: this demo is intentionally a single-server setup.

A reverse proxy such as Caddy or Nginx can provide HTTPS; many Node hosts provide it automatically.

## How it works

- App registers `/sw.js`, a service worker that displays incoming push notifications.
- Tapping Enable invokes the browser push-subscription prompt; the subscription is sent to the backend.
- Backend records the subscription and schedules its first reminder one hour later.
- A 30-second server-side check sends a push when due and sets the next reminder an hour after a successful send.
- Push services and iOS power/network settings affect **actual delivery times**, so this is a best-effort hourly reminder, not an exact alarm.
- Test notification is available immediately; it has a one-minute per-device cooldown.
- Turn off removes the browser subscription and its server record. iOS Settings can also revoke notifications.

## Privacy

No login or account required. The server stores only device-specific push subscriptions (which contain an endpoint URL and encryption keys) and next-reminder times. Protect these files like secrets. No personal health data is collected.

## Production notes

This is a small single-server example, not a scaled notification platform. Before opening it to large numbers of visitors, add a database, anti-abuse controls, monitoring, backups, and a privacy notice. To prevent accidental duplicate scheduling, run one server process only.

## Apple references

- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
