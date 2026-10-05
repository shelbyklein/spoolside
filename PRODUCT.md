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

## Operating Context
Intended online home: https://spoolside.shelbyklein.com. Repository: https://github.com/shelbyklein/spoolside. The first version uses clearly labeled demo data. Real local-network printer access requires a separate bridge; its implementation and credentials are not part of this version.

## Capabilities and Constraints
Responsive fleet overview; printer details; simulated pause/resume; editable job queue; filament inventory; locally persisted demo changes; installable and offline-capable app shell. No actual printer commands are sent. PlayCase order management is confirmed product scope and remains to be implemented. Proposed workflow: connect orders to print jobs, track production and fulfillment, and retain shipping details. Confirmed order source: WooCommerce at https://playcase.gg. Product variants, customer data fields, and shipping integration are open decisions. Cloud synchronization, accounts, bridge, and deployment remain subsequent work.

## Brand Commitments
Spoolside name and user-supplied spool floating in water image, preserved at public/spoolside.png. The image supplies turquoise, orange, and navy identity.

## Evidence on Hand
Implemented demo PWA with verified local browser flows. User-supplied artwork. No live printer credentials, verified telemetry, or order integration yet.

## Product Principles
Make active work easy to scan. Keep simulated and live data unmistakable. Surface actionable printer states. Keep routine operations usable on phone and desktop.
