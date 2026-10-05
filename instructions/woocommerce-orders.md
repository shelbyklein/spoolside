# PlayCase WooCommerce order integration

Confirmed source: WooCommerce at **https://playcase.gg**. Spoolside is the production workspace; WooCommerce retains customer, payment, and commercial order records. Existing demo PWA is at /Users/shelbyklein/Vibes/Spoolside; intended hosting at spoolside.shelbyklein.com.

## Observed state
- Public playcase.gg responds HTTP 200 and advertises WordPress REST API.
- No PlayCase local site exists in canonical /Users/shelbyklein/Studio inventory.
- No authenticated PlayCase site profile is available in the current Novamira setup.
- No WooCommerce credentials or private orders accessed. No website changes made.

## Proposed integration
1. Authenticated Spoolside backend reads WooCommerce orders via server-held credentials; never put consumer secrets in PWA JavaScript/local storage.
2. Initial paginated import, then signed webhooks with periodic reconciliation. Match store + WooCommerce order ID; reject duplicate or out-of-order deliveries and refresh current order data.
3. Preserve line-item IDs, product/variation IDs, SKU, quantity and relevant variant attributes. Map line items to component print recipes and filament choices without guessing unknown variants.
4. Separate commercial order state from Spoolside production state: needs mapping, queued, printing, assembly, ready to ship, shipped, blocked. Failed prints can be reprinted without duplicating order quantities.
5. Link component jobs to printer assignments and order line items. Reconcile cancellations/refunds before continuing production; surface work already started for review.
6. First live phase reads WooCommerce; Spoolside keeps its own production notes. Writing shipment/status back to WooCommerce is a later explicit action, using the existing store fulfillment workflow.

## Open decisions before implementation
- Private dashboard hosting and authentication provider.
- WooCommerce server credentials and actual enabled REST/webhook capabilities.
- Exact product/component recipes, variants, print times and quality checks.
- Shipping provider and whether labels/tracking are managed in WooCommerce or Spoolside.
- Smallest customer-data subset required and retention policy.

## Verification plan
Use a non-production WooCommerce test order or sanitized fixture; cover pagination, duplicate webhook, invalid signature, stale event, cancellation, partial refund, missing variation mapping and reprint. Confirm customers cannot access another order/workspace; confirm no keys or addresses are bundled in static assets. Inspect desktop/mobile order-to-print workflow before live activation.

Status: integration brief prepared, not implemented or connected. No deployment or production write is authorized by merely selecting the order source.
