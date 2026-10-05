<!-- spoolside-overview-orders-2026-10-05 -->
# Overview orders
Overview currently shows printers, queue and filament; real PlayCase orders require a separate navigation step. Add a compact active-order section before printers, showing count, quantities, dates and production stages. Each row opens its matching order details; View all opens Orders. Preserve phone Orders default, source privacy, existing production/push/auth behavior and visual identity.

Flow sketch: Overview -> [PlayCase orders: active count | View all] -> [order number, date, product, units, stage] -> matching Orders detail. Up to five current source-order rows, excluding completed/delivered/cancelled/refunded/failed. Pending/on-hold entries remain visible with truthful stage; no data mutations. Current visual evidence: handoff/spoolside-real-orders-iphone.png.

- [x] O1 Add responsive overview summary and loading/empty/error context, exact row navigation; verify hosted fixture including held order and all-orders navigation.
- [x] O2 Build/server/browser checks, public mobile+desktop render/readback, finish review; commit/push/deploy per existing authorized project workflow.

Success: overview exposes current live orders without demo substitution, phone row taps open matching details including held orders, empty summary remains actionable. Code/docs committed and pushed, deployed, inspected screenshots in handoff/spoolside-overview-orders-iphone.png and desktop.png; user acceptance open. Linear current Codex executor; exact metadata gap retained. Readiness R1-R13 covered; R9 established runtime gap retained; no blocking decisions. Implementation now per direct request. Rollback prior image/code, no schema changes. Validate npm run build, npm test, node --test server/*.test.mjs and authenticated public overview at428x926/1440x1000. Excludes source edits, notification changes or redesign.

Verified: build,17server7browser tests passed; hosted fixture covers held-order detail navigation and fulfilled exclusion. Authenticated public Overview displays five open orders; matching detail opens on tap. Mobile/desktop screenshots inspected; supplied sidebar artwork verified after image-load wait. Independent finish review: ship. Tracking: https://github.com/shelbyklein/spoolside/issues/7. User acceptance remains open.
