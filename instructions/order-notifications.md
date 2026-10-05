<!-- spoolside-order-notifications-2026-10-05 -->
# Phone order notifications

Spoolside imports WooCommerce orders every minute but currently has no notification delivery. Add persistent Web Push for new orders and existing order status/item/refund changes, with explicit per-device opt-in and preferences. The user requested implementation now, continuing the established Beelink deployment scope.

Current code: server/workspace.mjs sync persists order snapshots; server/index.mjs runs minute polling; VitePWA generates an app-shell worker; Settings has installation instructions. Preserve read-only Woo access, printer telemetry, production workflow, login and cache privacy.

UI sketch: [notification settings](assets/notifications-settings.svg). Current UI evidence: [hosted orders](../handoff/spoolside-real-orders-iphone.png).

Flow: Woo poll -> atomic snapshot plus event/outbox -> persistent per-device retry -> Web Push service -> service worker notification -> authenticated Orders view. First successful snapshot is baseline; historical orders do not generate alerts. Event content contains only order number and update type, not customer/address/payment data. Phone permission remains a browser action.

Success criteria:
1. New/status/item/refund changes generate deduplicated persisted events after baseline; restarts retain retries (server tests).
2. Opt-in, preferences, test and disable work through authenticated/origin-checked APIs; invalid or expired subscriptions are rejected/removed (server/browser tests).
3. iPhone Settings explains Home Screen/iOS requirements, supported browsers request permission only on tap, errors are actionable (public mobile screenshot).
4. Beelink deploy has private durable VAPID identity and healthy live orders/printers. Actual phone receipt is user verification pending, never inferred from a push service response.

Tasks:
- [x] N1 Persistent notification subscriptions, atomic outbox, retries, expiry and validation; test baseline/new/status/refund/items, restart/dedupe/error cleanup.
- [x] N2 Authenticated APIs and worker notification/click handling; verify privacy, origins, endpoint constraints and payloads.
- [x] N3 Settings opt-in/preferences/test/disable states and browser regression; verify public mobile render and finish review.
- [x] N4 Private VAPID provision, backup/deploy, live readbacks, docs and commit/push. Phone delivery acceptance stays pending until actual iPhone test.

Deliverables: code/tests/docs committed and pushed, app built and deployed on Beelink, GitHub issue open for phone acceptance. Linear execution: current Codex session; exact model/effort metadata is not exposed, retained as the established runtime gap. No implementation lanes.

Rollback: consistent SQLite backup and image tag before deploy; new tables are additive. Restore prior image to disable sender, preserve DB and VAPID files for resumption; disabling device deletes subscription and queued deliveries. Never rotate VAPID keys routinely, which invalidates existing subscriptions.

Validation: npm run build, node --test server/*.test.mjs, npm test. Mock transport verifies encrypted send inputs/retries, not phone delivery. Headless public Settings verification at 428x926 and real authenticated API/readbacks on Beelink. User enables notifications and tests in installed iPhone PWA as final device acceptance.

Work preparation: scope confirmed by direct request; implementation now; deployment authorized by ongoing project instruction. Readiness R1-R13 covered, R9 runtime gap retained from established execution context. No blocking design choices. Exclusions: printer/production notifications, Woo writes, physical controls, shipping integration, external messaging channels. Permission and real phone receipt require the user's device.

## Delivery evidence
GitHub tracking: https://github.com/shelbyklein/spoolside/issues/5 (phone acceptance open). Build passed; 16 server and 7 browser tests passed. Public authenticated notification configuration is enabled; generated worker imports push-handlers.js; no JavaScript errors in mobile Settings. Screenshots: handoff/spoolside-notifications-iphone.png and handoff/spoolside-notifications-setup.png. Beelink health is green; persistent subscriptions and delivery tables verified, currently zero devices/queued alerts. Private persistent VAPID identity mounted. Pre-notifications database backup, pre-notifications image and verified post-deploy backup saved. Actual iPhone opt-in/receipt is pending.

Review fixes: desktop click selects Orders; repeat refund fingerprint detects subsequent refunds without phantom migration alerts; expired/disabled device UI returns to enable even if browser unsubscribe fails; preference switches update promptly and retain active queued alerts. Historical print/order data preserved.

Independent finish review: ship; phone acceptance remains open.
