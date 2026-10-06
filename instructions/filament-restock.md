# Filament inventory and restock
Track the three exact materials Shelby supplied: Bambu TPU for AMS, Recreus Conductive Filaflex for touch pins (variant 45921625833731), and Proto-pasta Conductive PLA for other parts. Destination 30360; default ranking fastest arrival, then delivered cost per kg. Bambu usage awaits clarification, editable in product card. Linear execution by current Codex session, preserving existing authorization to implement/deploy scoped Spoolside changes.

Current inventory is shared workspace spools, limited to 1000g, and incorrectly labels every spool Bambu PLA Basic. Add material identity/capacity to existing records, preserve old records. Add persistent material catalogue, server-side six-hour vendor refresh using fixed official product pages and JSON-LD (not shipping weight). Filter 1.75mm spools, exclude 2.85mm and sample coils; show refills separately. Shipping/date quotes entered from checkout, tied to ZIP and expiry. Unknown prices, ETA, stock and failed refresh stay unknown/stale, never fastest/cheapest recommendations. Extra sellers can be added as explicitly user-recorded offers; no arbitrary server URL fetching, purchases, carts, slicing or printer starts.

Flow: Filament -> material cards with usage, remaining inventory, Add spool -> restock offers sorted fastest with variant filters -> Buy product link / Quote form -> save shipping and arrival date -> compare known delivered $/kg. Settings store ZIP and sort. Add supplier offer records exact material, link, grams and price.

Acceptance: survive restart, preserve existing inventory, correct USD/1.75mm and net weights, quote invalidated for ZIP changes/stale/past date; unavailable/stale offers cannot win. Build, server parser/ranking/persistence tests, browser inventory/quote/ZIP flows, authenticated desktop and iPhone screenshots. Rollback source only; additive material tables and inventory metadata remain intact.
- [x] Catalogue, refresh, quote/ranking persistence and tests.
- [x] Material/inventory/restock UI and browser checks.
- [x] Live supplier refresh, inspected screenshots, docs, deploy and push.

## Delivery evidence
Implemented and deployed to Beelink. Live catalogue has 14 exact-material offers: Bambu 8, Recreus 2 (official and 3DJake), Proto-pasta 4 (official and 3DJake). Fixed supplier sources refresh on startup and every six hours. Live API default ZIP 30360 / fastest sort verified; all sources refreshed without errors. Unknown arrival dates remain unknown; generic US estimates are labeled. Bambu part usage left unset pending user clarification. Existing inventory retained, no invented spool amounts. No purchases or printer commands.

42 server tests, 10 browser tests and production build pass. Live desktop / iPhone screenshots inspected, no page errors or horizontal overflow; shipping dialog Escape verified. Evidence in handoff/spoolside-filament-desktop.png, spoolside-filament-iphone.png, spoolside-filament-quote.png. Credential and unrelated C4D files excluded from commit.
