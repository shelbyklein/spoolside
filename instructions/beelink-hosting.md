<!-- spoolside-beelink-hosting-2026-10-05 -->
# Beelink hosting

User selected Beelink and authorized hosting Spoolside at spoolside.shelbyklein.com. Verified SSH user sklein, Docker access, existing loopback services and Cloudflare tunnel authentication. Deploy only the Spoolside Compose project under /srv/projects/spoolside, isolated on 127.0.0.1:3110; preserve all other services.

Deliverable: Node server serving PWA, password login with server-side sessions, persistent SQLite session store, isolated Docker Compose app, dedicated Cloudflare tunnel and domain. Live WooCommerce/printer connectivity is not present yet. Demo data stays browser-local.

Tasks:
- [x] H1 Add server/authentication and hosted login UI; test session access/login/logout and origin guard.
- [x] H2 Build container, deploy loopback-only, verify health/login. Preserve previous release directory if present.
- [x] H3 Dedicated tunnel/DNS, verify HTTPS authentication and protected API, document host service.

Execution linear, same session; exact runtime variant/effort gap retained. Existing source scope authorized. No additional agents required for deployment; skill-required UI finish review only.

Validation: npm run build, npm test, node --test server/server.test.mjs, Docker health and unauthenticated 401, authenticated API and public domain behavior. Rollback: stop only spoolside Compose; remove Spoolside route/DNS if necessary; retain data and release artifacts. Password/bootstrap and tunnel credentials are outside Git with restricted file permissions.

Hosting should enable later server-side WooCommerce credentials and local-network printer connection from Beelink. No store credentials or customer data imported in this stage.

Verified 2026-10-05: Docker app healthy; loopback API unauthenticated 401; public HTTPS login, authenticated Beelink /api/status, mobile Orders entry and logout verified with browser at 428x926. 5 app browser tests and 3 server tests pass locally; server tests also pass inside deployed container. Cloudflare tunnel ID 4e2611e4-adac-4eec-9608-7fb81988bb68. Public DNS resolves through 1.1.1.1 and 8.8.8.8; Mac default resolver still holds initial NXDOMAIN, so public browser verification used explicit correct DNS resolution. Actual iPhone acceptance and notification delivery remain pending.

Final auth fixes: async logout revokes server session, awaits service-worker unregister and CacheStorage deletion, then navigates to login. Revisit root in the same worker-controlled browser is verified to require login. Login throttling trusts CF-Connecting-IP only from the exact configured Docker gateway; two-client isolation tested.
