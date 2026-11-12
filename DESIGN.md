# Spoolside design

Operate surface: monitor printers, manage a queue, and track filament. Supplied artwork governs identity. A calm workshop with a poolside palette: navy navigation, pale daylight surfaces, turquoise activity, and restrained orange attention.

## Tokens
Every value lives as a variable in `:root` in `src/style.css`; use the token, not a literal.
- Type: 12, 13, 14, 15, 16, 19, 24, 30px (`--text-xs` to `--text-3xl`), plus 38px for the printer's progress number. Nothing under 12px. Display: self-hosted Manrope 600/700; body: DM Sans 400/500/600.
- Text: navy #102d44 headings, #193347 reading text, `--text-soft` and `--muted` for secondary text (both at least 4.5:1 on white, the workspace and the grey fills). `--faint` is for icons and disabled controls, never text.
- Surfaces: workspace #f6f8f8, white panels, `--surface-alt` / `--surface-strong` for chips, thumbnails and badges, divider #e1e8e8.
- Brand: teal #087b78 (activity, primary buttons), teal tint #e4f2ef, orange #ef862e, Claude #c2622d.
- States come in pairs (accent, tint, text that reads on the tint): `ok` (teal), `wait` (amber), `alert` (red), `info` (blue), `warn` (orange), `done` (green). Pills, Needs you rows and toasts use these, never one-off colours.
- Radii: 6px buttons and inputs, 10px cards inside panels and menus, 14px panels and dialogs, 999px pills.
- Stacking, low to high: raised, lifted spool, phone home, tab bar, menus, dialog, dialog over a dialog, Claude panel, toasts.
- Spacing: 4, 8, 12, 16, 20, 24, 32, 40px.
- `--tap` is 44px. Focus: one orange 3px ring (`--focus-ring`) with a 2px white halo, on `:focus-visible` only, so it reads on white, tints, navy and the water.

## Composition and behavior
Desktop uses persistent navy navigation. The Overview leads with Needs you, then reminders, the print queue and one-line orders, with the printer list beside them. From 761 to 1150px the Overview is one column with a strip of printer tiles directly under Needs you. At 760px and under, navigation becomes a five-tab bottom bar: Home, Printers, PlayCase, Queue (with a count) and More, a sheet holding Personal, Supplies and Settings; More shows as selected on those pages. Panels become one column. Status combines text and dots; color is never the only state signal. Demo data says so (printer details read "Demo"; Settings offers a demo reset). Offline state remains explicit.

Touch: at 1150px and under, and on any coarse pointer, every button, link, tab, select and input is at least 44px tall, icon-only controls as wide, and checkboxes and radios are tapped by a 44px label. Desktop with a mouse keeps its compact sizes.

## Dialogs
Every dialog is `src/Dialog.tsx`: a named `role="dialog"` with a title, Close, a body that scrolls inside itself and an optional footer for actions. Sizes: normal (480px), wide (980px; printer and asset details, upload, categories) and panel (Claude's side panel). At 760px and under, normal dialogs are bottom sheets with a rounded top; wide ones and the panel fill the screen. Escape and the backdrop close it unless it's busy; Tab stays inside; focus goes in on open and back to the opener on close; the page behind doesn't scroll. A dialog opened from a dialog stacks over it, and only the top one answers Escape.

Anything that asks "are you sure?" uses the in-app confirm (`src/Confirm.tsx`), never the browser's `confirm()`. Cancel has focus; stop and delete use the red danger button. It works from inside another dialog.

## Toasts
`notify()` (`src/Toast.tsx`). Success and info are navy with a check or an i and clear after 4.5s. Errors use the alert colours and icon, are announced as alerts, and stay until dismissed; where the action can be repeated they offer Retry. Up to three show at once, and a repeated message replaces the earlier one. They sit at the bottom centre, just above the phone tab bar; on a phone with a dialog open they move to the top, and they always sit above dialogs.

## Loading, failure and empty
While data loads, areas show placeholder rows (`src/Skeleton.tsx`; they stop shimmering when the load fails) and counts show a dash: never an empty message or a zero. When a refresh fails after a good load, the last data stays, dimmed and inert, under "Can't reach Spoolside. Showing what loaded at …" with Retry. Empty messages appear only once data has arrived and is empty; having no printers at all gets its own message on Printers and the phone home.

## Needs you
One list with one row shape (`src/NeedsYou.tsx`) on the Overview, Printers and the phone home: a coloured edge for urgency (alert, warn, wait, info, ok), a photo or icon, what happened, and the actions on the right (below the text on a phone).

## Folding sections
Long detail folds. `src/Fold.tsx` is a header button with a title and a one-line summary over content that stays mounted while closed; printer details use it for Bed check, Start a print and Recent prints. Sliced prints are grouped by part type in sections that fold and remember their state. Supplies folds each printer's spools to one line and shows each filament's two best offers with "Show all".

## Orders extension
Orders reuse the same reading surface and navy navigation. Search and stage filters lead into order rows with inline production detail; no new visual identity is introduced. Wide layouts place component/job records beside fulfillment; smaller layouts stack them. Commercial order state and production stage are separately labeled. Orange denotes attention, teal denotes production; cancelled orders retain a text label. On a phone, rows start closed as one line (number, phone and colour, progress) and open on tap; an open row shows its number once, in the header that closes it.

## Phone and hosted entry
Primary target is iPhone12 Pro Max, 428×926 CSS pixels. The phone opens on the water home: the spool with floating order cases, Needs you, reminders, Upload (a bottom sheet), and a pill per printer plus one for open orders. Home Screen layouts reserve top/bottom safe areas. Hosted login uses supplied artwork, navy background, pale reading surface and self-hosted Manrope heading. Server sessions protect hosted access.

## Live workspace
Hosted views use real order and printer data with explicit sync/save/error states. Orders default to Open orders. Technical form metadata yields to friendly fulfillment fields. Printer illustrations and simulated controls are omitted from live views; last report time and stale status identify telemetry freshness. Local preview retains demo behavior.

## Order notifications
Settings offers device-scoped new-order/change switches, explicit permission opt-in, a test and disable action. iPhone browser visits explain installation requirements. Success copy distinguishes push-service acceptance from phone receipt; errors preserve retry paths. Checkbox rows and buttons retain 44px touch targets.

## PIN entry
Hosted login preserves artwork and palette, with one masked eight-digit field using the phone numeric keypad. Failure messages include retry guidance; no PIN appears in UI captures.

## Overview orders
After Needs you, reminders and the queue, the Overview lists up to ten open store orders, oldest first, one line each: number, phone and colour, progress ("2 of 3 printed"), and Ship once it's ready. Each row opens that order on the Orders page; the full checklist stays there. View orders opens the order workspace.

## Direct fulfillment
Order rows show Fulfillment instead of a component setup status. Details lead from store line items to quality/assembly and packing checks; no setup form. Existing component and print histories remain available.

Library now separates Assets, Assemblies and Sliced prints. Assets include Sleeves and show missing editable designs independently from production status ("Up to date" / "Needs an update"). On a phone, search, Filter and add share one row over a sideways-scrolling row of part types. Assemblies are manually authored name/SKU/component/quantity lists using existing asset IDs; no membership is inferred. Existing text group cards, Current-first sorting and numerical phone groups remain. The Inventory page was removed; old `/inventory` links open Orders.
