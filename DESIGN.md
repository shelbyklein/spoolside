# Spoolside design

Operate surface: monitor printers, manage a queue, and track filament. Supplied artwork governs identity. A calm workshop with a poolside palette: navy navigation, pale daylight surfaces, turquoise activity, and restrained orange attention.

## Tokens
- Navy: #102d44
- Reading text: #193347
- Secondary text: #61727b
- Workspace: #f6f8f8
- White panels: #ffffff
- Active teal: #087b78
- Active print surface: #e4f2ef
- Divider: #e1e8e8
- Orange: #ef862e
- Display: self-hosted Manrope 600/700; body: DM Sans 400/500/600.
- Spacing: 4, 8, 12, 16, 20, 24, 32, 40px. Panel radius 14px; buttons 6–7px.

## Composition and behavior
Desktop uses persistent navy navigation, one featured print paired with a compact fleet list, then queue and inventory. Below 1150px the fleet stacks. At 760px navigation becomes a bottom bar and panels become one column. Status combines text and dots; color is never the only state signal. Demo identification stays visible at the top. Detail drawer supports Escape and trapped Tab focus. Offline state remains explicit.

## Direction reasoning
The source image's orange spool, navy figure, and water underpin a quiet workshop reading surface. Alternatives considered: dense tool dashboard, material swatch book, maker publication, shared studio noticeboard, poolside lounge, print journal, daylight workshop (selected). The reference challengers' useful disciplines were state consistency, hierarchy, focus, grid, section wayfinding, and data precision. Literal maps, poster walls, manuals and barcode graphics would weaken printer scanning; their decorative grammar is omitted.

## Orders extension
Orders reuse the same reading surface and navy navigation. Search and stage filters lead into order rows with inline expanded production detail; no new visual identity is introduced. Wide layouts place component/job records beside fulfillment; smaller layouts stack them. Commercial order state and production stage are separately labeled. Sample-data provenance stays visible. Orange denotes mapping attention, teal denotes production; cancelled orders retain a text label.

## Phone and hosted entry
Primary target is iPhone12 Pro Max, 428×926 CSS pixels. Mobile opens the compact Orders list with details collapsed; desktop keeps the fuller default view. Home Screen layouts reserve top/bottom safe areas; mobile order filter/search controls have at least 44px height. Hosted login uses supplied artwork, navy background, pale reading surface and self-hosted Manrope heading. Server sessions protect hosted access; sample-data labeling remains visible.

## Live workspace
Hosted views use real order and printer data with explicit sync/save/error states. Phone defaults to Active orders. Technical form metadata yields to friendly fulfillment fields. Printer illustrations and simulated controls are omitted from live views; last report time and stale status identify telemetry freshness. Local preview retains demo behavior.

## Order notifications
Settings offers device-scoped new-order/change switches, explicit permission opt-in, a test and disable action. iPhone browser visits explain installation requirements. Success copy distinguishes push-service acceptance from phone receipt; errors preserve retry paths. Checkbox rows and buttons retain 44px touch targets.

## PIN entry
Hosted login preserves artwork and palette, with one masked six-digit field using the phone numeric keypad. Failure messages include retry guidance; no PIN appears in UI captures.

## Overview orders
Overview starts with up to five open store orders before printers, using compact quantity/date/stage rows. Held work stays visible, each row opens its matching details, and View orders opens the existing order workspace. Phone default remains Orders.

## Direct fulfillment
Order rows show Fulfillment instead of a component setup status. Details lead from store line items to quality/assembly and packing checks; no setup form. Existing component and print histories remain available.
