# Handheld v3 design import — 2026-10-06

The 12 editable splits from `Design Files/Extracted/Handheld` are stored privately in Spoolside. Every downloaded C4D file was checked against the split manifest SHA-256. The open Cinema 4D document and original Dropbox files were not changed. External textures were not packaged with these splits.

Run `node scripts/import-handheld-designs.mjs --dry-run` to review the import, or omit the flag to repeat it. The importer verifies split hashes, refuses to replace different existing design contents, keeps existing asset design links, and never changes existing assembly components or restores removed components. The private PIN is read from the existing local configuration; no files or credentials belong in Git.

## Verified links

- Handheld Top (excluding its separately split Inserts), Bottom, D-pad, Start button and Touch Pin: generated C4D geometry matches existing STL vertices to approximately 0.000004 mm after converting C4D centimetres to STL millimetres and axes `(x,z,y)`.
- Their statuses, names, notes and STL files are unchanged. Top remains Needs update.

## Standard assembly

Added D-pad, one Start button and AB Buttons ×2. The second AB button is offset `(-13.92, -6.50, 0)` mm from the printable STL, matching the cap positions in the source. The C4D AB stem is 0.5 mm shorter; cap heights match, so no vertical adjustment was applied. The assembly remains unconfirmed and incomplete. Plus and all nine other assemblies were preserved.

## Seven designs awaiting reconciliation

- AB Buttons: two roots in the design; STL prints one button, with a different stem length.
- AB Button Membrane: design and current STL have different dimensions/geometry.
- D-pad Membrane: design thickness differs by about 0.2 mm from the soft STL.
- Start Select Membrane: shifted in the source, with a small shape/thickness difference from the current STL.
- D-pad Touch Pins: four generated pieces, no matching existing STL asset.
- Trigger Touch Points: generated design lacks some geometry present in the current bridge STL; existing bridge design retained.
- Inserts: design contains a pair; current STL is one insert and differs in height; existing Insert design retained.

All seven are available in each asset's Design file picker, but are not automatically linked. Remaining assembly work includes the second Start/Select button and membranes, pins, bridge and inserts. Do not mark the assembly complete or apply Standard offsets to Plus without reviewing those pieces.

## Verification

- Twelve design downloads verified by SHA-256.
- Five exact links read back through the live API.
- All 107 existing assets preserved except the five intended design links.
- All nine unrelated assemblies preserved.
- Second importer run: zero new links and zero assembly additions.
- Live browser rendered the Standard assembly without JavaScript errors; screenshot in `handoff/spoolside-handheld-import-desktop.png`.

This imports native designs, not printer-ready sliced 3MF files, and does not make orders ready to print.
