<!-- spoolside-pwa-icon-2026-10-05 -->
# Home Screen app icon
User requested PWA use existing Spoolside app icon. App page declares icons but PIN page lacks icon/manifest metadata, and authenticated static routes redirect logged-out icon requests. Reuse supplied artwork, add 180x180 Apple icon and links on both pages, expose only icon/manifest files before login; workspace/API authentication stays intact. No new design/data/auth/session changes.

Flow: login or app -> Apple touch icon + manifest -> same Spoolside Home Screen icon. Existing public/icon-192.png and icon-512.png inspected; Apple derivative resized from512, originals preserved.
- [x] I1 Build and tests verify logged-out icon/manifest200 and API401, correct dimensions/links.
- [x] I2 Deploy, verify public metadata/icon bytes; commit/push. Actual Home Screen icon refresh requires reinstall if iOS retains old icon.

Success: both entry points reference actual app artwork and anonymous icon requests return PNG, not login HTML. Deliverables committed/pushed/deployed. Linear current executor; established runtime metadata gap retained. R1-R13 covered; visual source existing icon512 and flow above. Rollback previous source/image; no schema/config migration. Tests npm run build; node --test server/*.test.mjs; npm test; public unauthenticated readback. Deployment authorized by ongoing project instruction.

Verified19server7browser tests pass; public login Apple icon returns200 image/png180x180 while protectedAPI401. Deployment healthy; issue9 open for device acceptance.
