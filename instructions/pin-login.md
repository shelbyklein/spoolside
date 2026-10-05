<!-- spoolside-pin-login-2026-10-05 -->
# PIN login
Replace username/password with one six-digit PIN, a masked numeric input and native phone keypad. User requested implementation; PIN preference prompted (generated default or custom). Preserve secure server sessions, notifications, order state and printer bridge. Credentials remain outside Git; only a scrypt hash is deployed. Existing sessions remain valid.

UI flow: /login -> six-digit masked PIN -> origin/format/hash/rate-limit checks -> existing HttpOnly session -> live workspace. Current layout server/auth.css is preserved; one PIN field replaces both credentials. Worker must exclude /login and API navigation from app-shell fallback so expired sessions can reach the real login.

- [x] P1 Replace credential validation/form/env with PIN; persist per-client attempt throttling and test wrong/malformed PIN, restart lockout, origin/auth/session guards.
- [x] P2 Generate or accept PIN privately, deploy config and app without invalidating push subscriptions; build and browser/API verification.
- [x] P3 Public iPhone login render/readback, review, docs, commit/push. User login acceptance remains pending.

Success: only six digits authenticate; phone input uses numeric keyboard; repeated failures are persistently limited; production live API is accessible after PIN login; notifications/state intact. Deliverables committed/pushed/deployed, screenshot handoff/spoolside-pin-login-iphone.png, issue open for acceptance.

Validation: npm run build; node --test server/*.test.mjs; npm test; actual authenticated public flow and protected API. Rollback: preserve private prior .env and login file; image tag before deploy; revert code/config while keeping sessions/state/VAPID.

Work preparation: linear current Codex executor, exact runtime metadata gap retained from established project workflow. Scope/now/deployment authorized by ongoing direct request; no implementation lanes. Readiness: R1-R13 covered; R9 gap retained. Exclusions: account/user redesign, Woo writes/printer controls, VAPID rotation. PIN value pending optional preference; no custom value assumed.

## Verified delivery
Issue: https://github.com/shelbyklein/spoolside/issues/6. Build, 17 server tests and seven browser tests passed. Public PIN login accepted and authenticated API returned 358 orders/three printers; numeric masked six-character input verified. iPhone-sized screenshot inspected: handoff/spoolside-pin-login-iphone.png. Independent finish review: ship. Config deployed privately; original credentials/config and pre-pin image retained for rollback. Existing sessions/push subscriptions retained; user/iPhone acceptance open.
