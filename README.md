# Spoolside

An installable dashboard at **https://spoolside.shelbyklein.com**, hosted on Beelink. The hosted workspace reads PlayCase WooCommerce orders and live LAN telemetry from three A1 mini printers. Production notes, component recipes, jobs and fulfillment checks persist in server-side SQLite. Local preview remains a clearly labeled demo.

## Run

```sh
npm ci
npm run dev
```

## Build and verify

```sh
npm run build
npx playwright install chromium
npm test
```

The tests run the production preview on port 4173 and exercise simulated pause/resume, job addition/removal/reordering, inventory persistence, offline reload, order quantities and reprints, fulfillment/cancellation guards, linked-order navigation, and responsive layouts. Fonts are self-hosted. The generated service worker precaches the app shell, fonts, and identity assets.

## Features

- PlayCase sample orders with search, production filters, inline details, and component mapping
- Quantity-aware order jobs, failed-print replacements, and production history
- Assembly/packing gates, local demo shipment tracking and notes
- Cancelled-order guard and active queue separated from finished/failed job records
- Fleet overview and printer status filters
- Printer detail drawer with simulated temperatures and progress
- Local queue with add, reorder, and remove
- Editable filament weights
- Responsive phone navigation and desktop layout
- Manifest, app icons, install prompt where supported, and offline demo access
- Settings with explicit reset and connection guidance

## Hosting: Beelink

Spoolside is deployed at https://spoolside.shelbyklein.com from `/srv/projects/spoolside` on Beelink. Compose binds the Node application to `127.0.0.1:3110`; a dedicated Cloudflare tunnel publishes HTTPS. No router port-forwarding or changes to other apps.

The server requires a six-digit PIN login, hashes the PIN with scrypt, stores hashed session tokens in SQLite, uses secure HttpOnly SameSite cookies, checks POST origins, and persistently limits failed logins per visitor (eight failures, 15-minute cooldown) and across the workspace (100 active failures). It accepts Cloudflare client IP only from the configured Docker gateway; set `SPOOLSIDE_PROXY_ADDRESS` from the actual project network. Logout awaits service-worker/cache cleanup before navigation. PIN and previous credentials remain outside Git in restricted files. `deploy/.env.example` describes required environment values; live `.env` and tunnel credentials must never be committed.

```sh
node --test server/*.test.mjs
# On Beelink, from /srv/projects/spoolside/deploy:
docker compose -f compose.yaml -f tunnel-compose.yaml up -d --build
```

Server state uses the `spoolside_spoolside-data` volume. Consistent SQLite backups are written hourly and on graceful shutdown to `/srv/projects/spoolside/backups`, retaining 48 hourly copies under the existing Beelink backup root. API responses are never service-worker cached and hosted records are not saved to localStorage.

## Live connections

The dedicated WooCommerce key is read-only. Orders sync every minute with pagination; the import contains order numbers, dates, commercial status, items, variants, quantities and refund indicators, without billing, shipping-address or payment fields. A failed sync retains the last successful snapshot. Active orders are the mobile default; completed and delivered orders appear as fulfilled in store. Refunds and non-processing statuses hold production work.

Private `deploy/woocommerce.json` and `deploy/printers.json` are mounted read-only under `/run/spoolside`. They are excluded from Git. Each printer connection uses MQTT TLS with a pinned certificate and fingerprint; snapshot requests read status only. The UI refreshes every ten seconds, with printer reports considered stale after 90 seconds. New printer certificates require deliberate configuration updates.

Production records belong to Spoolside: assembly, packing and tracking edits do not change WooCommerce. Queue records do not start printer jobs or mirror a printer's physical queue. Printer controls, camera, slicing/upload, multiple users remain pending. See `instructions/live-connections.md` for validation and rollback.

## Artwork

`public/spoolside.png` is the exact image supplied by Shelby in chat; the PWA icons are resized copies. No separate logo was generated.

## iPhone workflow and notifications

Primary target is iPhone 12 Pro Max (428 × 926 CSS pixels). On mobile, Spoolside opens Orders with compact collapsed rows; printer overview remains one tap away. Layout includes Home Screen safe-area insets.

Phone notifications are implemented using Web Push. In Safari on iOS 16.4+, add Spoolside to Home Screen, open the installed app, then Settings → Order notifications → Enable notifications. Choose new orders and/or existing order changes (status, items, refunds). Tap Send test notification and verify receipt on the phone. Browser permission and actual device delivery are required; server acceptance alone does not prove receipt.

Subscriptions and delivery queues live in SQLite and are included in workspace backups. A persistent private `deploy/vapid.json` (subject/publicKey/privateKey) is mounted read-only; never commit or rotate it routinely. The first successful import establishes a silent baseline. The import transaction also queues per-device events, with retries (up to eight attempts / 48 hours), expired subscription removal and notification tags for duplicate replacement. Order reads run every minute; pending delivery attempts run every 15 seconds. Alerts omit customer, payment and address data. Disable on this device removes its subscription and pending sends; other devices remain enabled. Lock-screen visibility follows phone settings.

Delivery uses standard Apple/Google/Mozilla/Windows push services. This is at-least-once delivery: a crash immediately after service acceptance can retry the same tag. No guaranteed receipt, sound or exact timing is claimed. Notification clicks open authenticated Orders. Existing printer/production notifications remain pending.

PIN login uses `SPOOLSIDE_PIN_HASH` (salt:scrypt hash); no username is required. The private current PIN is held outside Git. Existing sessions and push subscriptions survive this login change. Authentication/API routes are excluded from offline app-shell navigation fallback.
