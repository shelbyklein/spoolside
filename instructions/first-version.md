# Spoolside first version

Spoolside currently has an empty local/GitHub repository. Build an online, installable React/TypeScript PWA for Shelby's A1 mini fleet, using the supplied artwork. Initial telemetry and controls are demonstrative; real printer connectivity follows through a local bridge.

Scope confirmed: user said "go for it" after recommendation of demo PWA first and code-first design. Target domain: spoolside.shelbyklein.com. No production deployment or printer credentials available.

Target sketch: navy navigation rail | fleet heading and demo indicator | active print details + printer list | editable queue and filament. On mobile, navigation becomes a bottom strip and content a single column. Supplied identity: ../public/spoolside.png. No incumbent screenshot exists (empty workspace).

Success: responsive overview, functioning local interactions, persisted queue/inventory, offline app shell and manifest, TypeScript production build and behavioral browser verification.

## Tasks
- [x] T1 Scaffold React/TypeScript, retain source artwork, define design tokens.
- [x] T2 Implement fleet, printer details, simulated controls, editable queue and filament.
- [x] T3 Add manifest/service worker and offline shell.
- [x] T4 Verify build, behavior, accessibility and desktop/mobile renders; document connection/deployment boundary.

Deliverables: local source, built dist, README, PWA assets, inspected screenshots. Tracking issue: https://github.com/shelbyklein/spoolside/issues/1. Local plan: instructions/first-version.md.

Execution: linear; one implementation owner avoids shared-file overlap. Runtime identifies Codex based on GPT-6; exact variant/effort not exposed. Record this limitation rather than invent metadata. User delegated implementation decisions with "go for it".

Excluded: live printer bridge, cloud sync/auth, camera streaming, slicing, public hosting/DNS. Preserve supplied artwork. No migrations or external service mutations; rollback is removing this new scaffold. Local-storage changes can be reset using the app's explicit reset control.

Validation: npm run build; Playwright browser checks on actual localhost app for navigation, pause/resume, queue add/remove, filament edits and reload persistence; manifest and service worker offline reload; rendered desktop/mobile captures.

Work preparation: authorized to start now; scope settled; GitHub tracking verified. UI sketch above; R12 n/a (no server data/deploy/install). Exact runtime metadata unavailable and recorded. No blocking product decisions.

Verification: npm run build passed; 2 Playwright tests passed (controls, queue, inventory persistence, offline reload, desktop/mobile overflow and screenshots). Desktop and mobile captures inspected. Review evidence: .impeccable/review/. Final deployment and real printer bridge remain pending.
