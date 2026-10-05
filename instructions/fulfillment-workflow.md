<!-- spoolside-fulfillment-workflow-2026-10-05 -->
# Direct order fulfillment
User clarified that Spoolside needs fulfillment, not a separate component mapping step. Existing UI shows Needs mapping and requires a form before fulfillment; remove that status/form and enable direct quality check -> packing -> shipment record for orders without component recipes. Retain source order data, recipe/print history, existing print acceptance checks, cancellation/refund/source-review holds, sequence guards and read-only Woo access.

Flow: open order -> Fulfillment -> assembly/quality checked -> packed -> record shipment. Existing configured print components still require acceptance. No migration or source rewrite.

- [x] F1 Remove setup action/status and align frontend/server fulfillment gates; test direct fulfillment persistence and existing print/hold guards.
- [x] F2 Build/tests, live mobile orders/detail/overview verification, review, docs, commit/push/deploy.

Success: no Mapping status/action, current active unconfigured orders say Fulfillment and can record shipment after checks; existing history/source untouched. UI source is incumbent OrderWorkspace/Overview; screenshots in handoff/spoolside-fulfillment-orders-iphone.png. Deliverables committed/pushed/deployed, user acceptance pending. Linear current executor; established exact-runtime gap retained. R1-R13 covered with inline flow sketch; rollback previous image/source, additive behavior only, no DB migration. Validate npm run build, node --test server/*.test.mjs, npm test and authenticated public mobile read-only verification (no live shipment changes). Scope authorized by direct request, no questions. Excludes Woo writes, deleting recipes/jobs or printer commands.

Verified:18server7browser tests passed; public live order10175 detail shows Fulfillment without setup and quality checkbox enabled. No live writes performed. Existing358orders/print records untouched. Mobile screenshot inspected; source review ship. Issue https://github.com/shelbyklein/spoolside/issues/8 remains open for acceptance.
