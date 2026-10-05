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
