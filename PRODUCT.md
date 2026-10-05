# Spoolside
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Delegated by "go for it" after recommendation: React + TypeScript and Vite; installable PWA.

## Users
Shelby Klein, monitoring and managing multiple Bambu Lab A1 mini 3D printers and PlayCase customer orders.

## Product Purpose
A single online workshop dashboard for monitoring printers and managing PlayCase orders. Printer progress, temperatures, queued work, and filament support the order fulfillment workflow.

## Primary Device and Notifications
Primary access is an iPhone 12 Pro Max, used for a quick look at PlayCase orders. Design the order overview and actionable states for that device first. Phone notifications support new orders and status/item/refund changes with per-device preferences and opt-in. iOS Web Push requires a supported iOS version, an installed Home Screen PWA, and explicit notification permission.

## Operating Context
Hosting: Beelink home server at https://spoolside.shelbyklein.com. Repository: https://github.com/shelbyklein/spoolside. Local preview uses demo data; hosted access uses real orders and printer telemetry.

## Capabilities and Constraints
Password-protected single-user PWA. Read-only PlayCase WooCommerce orders sync every minute. Three LAN A1 mini printers report pinned-TLS MQTT telemetry with stale/error states. Hosted production recipes, jobs, notes, assembly/packing checks and tracking references persist in SQLite and are shared across devices. No billing/address/payment fields are imported. No Woo writes or physical printer commands are sent. Active orders open by default on phone. Filament inventory starts empty; manual queue jobs accept material and color text until inventory setup is added. Consistent database backups retain 48 hourly copies. Camera, slicing/upload, multi-user accounts and actual iPhone notification receipt remains pending.

## Brand Commitments
Spoolside name and user-supplied spool floating in water image, preserved at public/spoolside.png. The image supplies turquoise, orange, and navy identity.

## Evidence on Hand
Implemented demo PWA with verified local browser flows. User-supplied artwork. Authenticated WooCommerce import and three live printers verified on Beelink; public mobile screenshots in handoff/.

## Product Principles
Make active work easy to scan. Keep simulated and live data unmistakable. Surface actionable printer states. Keep routine operations usable on phone and desktop.
