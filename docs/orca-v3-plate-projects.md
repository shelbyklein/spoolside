# Orca v3 plate project preparation

`python3 scripts/split-orca-plates.py SOURCE.3mf --output NEW_FOLDER` prepares single-plate **unsliced** projects. It refuses to overwrite files and does not accept sliced G-code archives. Originals, embedded mesh bytes, orientations, object settings, material settings, batch quantities and disabled instances are retained. Each project is translated from the original Orca plate grid to plate 1; no arrangement or orientation is applied. An output manifest records source and output SHA-256 hashes.

On 2026-10-06, outputs were prepared under `Print Files/Orca/Spoolside v3 Plates` in the Playcase Dropbox Product folder:

| Folder | Occupied plates | Saved material |
| --- | --- | --- |
| Faceplates | 14 | TPU-AMS |
| Membranes | 3 | TPU |
| Parts | 16 | PLA |

The 15-plate Faceplates 2026 project and its matching attachment were processed once. Two empty plates across the inputs were skipped. All 33 projects loaded through OrcaSlicer 2.4.2 CLI; independent transformed geometry checks put every printable instance within the 180 × 180 mm A1 mini bed. ZIP integrity, object counts, one-plate metadata, original mesh bytes and settings bytes were checked.

These inputs contain **no G-code**. They have not been imported into the printer-ready library, have not made any order Ready, and have not been sent to a printer. The user previously chose manual slicing. Open a project, review the settings, slice, then export a sliced `.gcode.3mf` for Spoolside. The saved PLA/TPU profiles need review for the user's conductive PLA/Filaflex materials. Experimental and older variants remain present; no production approval is inferred from the file names.

The splitter assumes Orca's standard 1.2 × bed-size grid with ceil(sqrt(plate count)) columns. For other project layouts, independently check transformed bounds before accepting the outputs. Source geometry/settings are private and excluded from Git.
