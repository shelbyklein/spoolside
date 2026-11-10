<!-- cricut-svg-library-2026-11-09 -->
# Cricut SVG templates in the Spoolside asset library

Spoolside needs to store the revised PlayPad suction-tape cutting templates as native SVG assets. Shelby requested adding these files to Spoolside and explicitly identified them as vectors for Cricut, not 3D prints. The current asset uploader requires STL, design storage rejects SVG, and personal projects accept only 3D formats. The live SVG upload returned HTTP 400, `Invalid design file`; no vector asset has been added.

## Evidence and proposed flow

- `server/assets.mjs:addDesign` permits c4d/blend/f3d/step/stp/ai, excluding SVG. `Assets.add` parses STL geometry.
- `server/projects.mjs:upload` also excludes SVG. `src/AssetLibrary.tsx:UploadDialog` requires an STL, and the detail view only distinguishes STL and design-only assets.
- Existing PlayPad component assets and their shared C4D source already exist. They must remain unchanged.
- [Current-code upload dialog (local frontend with live read-only API data)](assets/cricut-svg/current-upload.png).
- [Proposed library card and flow](assets/cricut-svg/proposed-library.svg). The sketch is illustrative; the implementation previews the actual SVG.

Flow: Library Upload SVG → validate simple cut geometry with explicit physical dimensions → store original bytes and add vector asset → show SVG preview and dimensions → Download SVG → Cricut Design Space. SVG assets never enter the sliced-print library or printer queue.

## Scope and decisions

Use native vector assets in the existing Library/PlayPad category. Add a Cut template type, a dedicated SVG upload path, and a Download SVG action; preserve existing STL and editable-design behavior. Import three exact updated files from `/Users/shelbyklein/Chatterbox/Studios/PlayCase Product/patch/tape-cutting/`: `PlayPad tape - single.svg`, `PlayPad tape - 4x1 row.svg`, and `PlayPad tape - 25 per AirStick sheet.svg`. Their keychain clearance is removed; dimensions and button positions are already verified. Status is Up to date for the requested template revision; physical cut acceptance remains separate.

## Success criteria

1. A native SVG asset can be uploaded through the Library UI/API and found under PlayPad after reloading; verify API readback and desktop/mobile rendering.
2. Its preview displays the actual vector, physical dimensions remain exact, and authenticated downloaded bytes match the source SHA-256.
3. No SVG appears in sliced prints or exposes printer-start controls, STL preview, or a missing-STL warning. Existing printer, order, assembly, and STL workflows retain behavior.
4. All three revised PlayPad SVGs are imported once, with reusable source identities and verified download links.

## Dependency-ordered work

| ID | Task | Acceptance |
|---|---|---|
| V1 | Add native SVG asset storage/API and metadata. Reuse existing asset/design storage where possible; no schema migration required. Parse/validate a bounded basic-SVG subset, reject DTDs, scripts, event handlers, foreignObject, external references and invalid dimensions. Preserve source bytes for download. | Server tests cover valid upload/update/download, exact bytes, malformed/active SVG rejection, no STL parsing and no sliced-print entry. |
| V2 | Extend Library upload, Cut template filter/card/detail, actual SVG preview, size labels, and Download SVG. Keep source/design controls appropriate to vector files. | Browser test uploads a small SVG via the real `/library` entry point, opens it, downloads it and verifies persistence; screenshots at 1280×900 and 390×844 show no model/print controls on a vector. |
| V3 | Run validation and prepare a focused commit/PR with change-specific documentation. Use an isolated worktree; leave current untracked handoff assets and other agents' work untouched. | `node --test server/assets.test.mjs server/server.test.mjs`; `npm run build`; relevant Playwright library test, then required repository checks. Review diff contains only SVG-library work. |
| V4 | Deploy only after the work approval includes deployment; snapshot database and stored library files first. Import the three revised SVGs into the existing PlayPad category using stable source paths, then verify live UI and source hashes. | Live UI readback and all three SHA-256 matches; vector assets are absent from `/api/library`; existing component IDs and links unchanged. |

Checklist:
- [x] V1 Native SVG assets and server tests.
- [x] V2 Library vector upload, preview, download and rendered checks.
- [x] V3 Validation, focused PR/commit and documentation.
- [x] V4 Approved deployment, exact template import and live readback.

## Deliverables and end states

- Code, tests and docs: focused committed/merged change once implementation and repository landing are approved.
- Production: deployed native SVG support after the deployment gate.
- Data: three revised SVG assets imported and verified live; no print or Cricut cut started.
- Current preparation: plan and visuals saved locally; GitHub issue linked below; product code is unchanged.

## Boundaries

No slicer, printer-control, material, bed, order, WooCommerce, automatic-print, assembly membership, CAD, Cricut project or cut-setting changes. Do not wrap SVG in fake STL/AI/3MF, rename its extension, convert the native cut file to raster, or mark an unsliced template as a print. Preserve unrelated current files and all existing asset IDs/status/notes. Existing extension validation remains in place for other file kinds.

## Rollback

Before deployment, save the running image/revision plus copies of the asset SQLite DB and private library/design storage. Keep original SVGs locally. On rollback, retain or export any newly uploaded SVGs, then restore the prior app image; delete only the three newly created vector entries if needed and after confirming they have no new references. Do not restore a whole DB snapshot over subsequent unrelated writes; use targeted reversal or reconcile first. No schema migration is expected.

## Work preparation

- Confirmed outcome: add the revised Cricut SVG templates to Spoolside as vector files, as directly requested. Native SVG support is a required implementation dependency discovered during upload.
- Mode: linear; one executor can cover the small shared storage/UI change without overlapping lanes.
- Models: current session; exact model/effort unavailable. No agents will be dispatched.
- Now/later decision: now. Shelby approved implementation, deployment, and template import with "do it now" after the presented plan.
- Open implementation questions: none blocking. Source paths, file kinds, exact templates, category and exclusion from printing are settled.
- Readiness: R1–R13 pass; issue tracking/readback and visual-file existence checked before handoff. Implementation started in isolated worktree `/Users/shelbyklein/Vibes/worktrees/spoolside-cricut-svg-14` on branch `codex/cricut-svg-14`; baseline bcc58d6. V1 and V2 complete: static-SVG validation, exact-byte native storage/download, source-preserving re-import, dedicated vector UI, and actual browser upload/download/reload checks pass. V3 validation complete; committing the focused change. V4 is pending deployment.
- Issue: https://github.com/shelbyklein/spoolside/issues/14

## Implementation validation

- Production build passes. All 94 server tests pass, including malformed/active SVG rejection, native dimensions, stable IDs, exact download bytes, and exclusion from STL/sliced-print paths.
- The vector browser test passes real API-backed upload, native preview decoding, exact downloaded SVG, reload, card/type filter, desktop/mobile rendering, and no page errors or horizontal overflow. All 35 browser tests now pass: 34 passed in the full run, and the one existing upload-label test passed after updating its selector for the intentional “STL or SVG file” label.
- [Desktop browser evidence](../handoff/cricut-svg-desktop.png) and [mobile browser evidence](../handoff/cricut-svg-mobile.png) inspected. These are local built frontend checks with a test backend, not production acceptance.

- Reusable importer: `node scripts/import-cricut-templates.mjs /absolute/path/to/patch/tape-cutting` adds only the three native SVG assets to the existing PlayPad category and verifies dimensions and downloaded source hashes.

## Production delivery

Implementation merged in PR #15 at feb3603015dfcc2a4fd27bbcfc6c60d1681d8833 and deployed. Backup: before-cricut-svg-20261110T024144Z, including prior image, SQLite snapshot and stored files. All three native SVGs imported into PlayPad; downloaded SHA-256 and physical dimensions match originals. Live authenticated Chrome preview, Download SVG and size readback inspected. No SVG entries in sliced prints; existing nonvector assets remain available. No print or cut started.

- [Import IDs, URLs, dimensions and hashes](../handoff/cricut-svg-import-report.json)
- [Inspected live production screenshot](../handoff/cricut-svg-live-desktop.png)

Implementation and activation complete; issue remains open for user acceptance. Physical Cricut cut acceptance is separate.
