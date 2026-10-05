<!-- spoolside-live-connections-2026-10-05 -->
# Live connections

User requested real printer and WooCommerce connections and confirmed LAN. Protected PWA currently displays samples. Verified production WooCommerce 11.0.1 at pc:/home/runcloud/webapps/PlayCase, home/siteurl https://playcase.gg. OrcaSlicer has three N1 printer addresses and codes, retained privately.

Scope: read Woo orders/line items/variants/quantities/refunds, persist independent production workflow server-side, read LAN MQTT telemetry with stale/error states. No billing/payment/customer addresses imported; no products/orders modified; no printer control commands. Hosted app must not substitute demo samples when connection fails. Local preview remains demo.

Tasks:
- [x] L1 Verify dedicated read-only Woo key and saved LAN printer connectivity.
- [x] L2 Server order reconciliation, production persistence/API validation and secure backup coverage.
- [x] L3 MQTT telemetry cache, accurate partial/stale/disconnected reporting.
- [x] L4 Hosted UI uses live data/state API with no customer data in browser storage/SW; labels/empty/error states honest.
- [x] L5 Build, server and browser tests, public mobile renders, live readback, deployment/docs.

Success: real store items/status replace hosted samples, telemetry per printer verified, production state persists server-side and reloads across devices. Source screenshots handoff/spoolside-live-iphone.png; flow instructions/assets/orders-flow.svg. Layout inherited.

Deliverables tested/committed/pushed/deployed source and evidence. Mode linear; exact runtime metadata gap retained from initial session. User authorization covers dedicated read-only key and connection/deploy work. No credentials logged or committed.

Validation: npm run build; npm test; node --test server/*.test.mjs; actual private Woo/MQTT reads; authenticated public browser at 428x926. Cover pagination, cancellation/refund state, persisted notes/recipes/jobs, duplicate jobs, partial telemetry and stale states.

Rollback: snapshot old Docker image and SQLite backup before migrations/deploy; preserve former browser demo data; revoke only new dedicated WC key if needed; revert image/DB/config. Backups copy consistent SQLite into /srv/projects/spoolside/backups (existing backup root); no router port changes. No camera, slicing, cloud account, notifications or live commands in this phase.

Work preparation: implementation authorized; LAN confirmed; hosting/authentication settled; unknown printer reachability reported individually. All readiness requirements covered, R9 exact runtime gap retained.

## Verified delivery (October 5, 2026)
Dedicated read-only Woo key provisioned privately; 358 orders imported (5 processing). Three pinned-TLS printers report live telemetry from Beelink. Authenticated public iPhone-size verification confirmed API save/reload and restoration of an existing production note, no JavaScript errors, no localStorage records. Mobile order/printer screenshots: handoff/spoolside-real-orders-iphone.png and handoff/spoolside-real-printers-iphone.png. Build, 10 server tests and 6 browser tests passed, including hosted source filter, server-backed notes and edits preserved during refresh. Independent review fixes preserve historical jobs across store item changes with a production review hold, show connected/preparing/unknown states accurately, and enable material entry with empty inventory. A consistent verified-live.sqlite backup and graceful-shutdown backup are present. Detector's sole warning concerns intentional demo print geometry, omitted in live views. Notifications, physical controls and Woo order writes remain pending. User acceptance remains open.

Independent finish review: ship after four material findings resolved. User acceptance remains pending; keep issue open.
