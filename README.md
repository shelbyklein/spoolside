# Spoolside

An installable online dashboard for a Bambu Lab A1 mini fleet, intended for **spoolside.shelbyklein.com**. The first version is a working **demo**: all printer telemetry and pause/resume controls are simulated. Queue, printer state, and filament inventory persist in this browser's local storage.

## Run

```sh
npm ci
npm run dev
```

## Build and verify

```sh
npm run build
npx playwright install chromium
npm test
```

The tests run the production preview on port 4173 and exercise simulated pause/resume, job addition/removal/reordering, inventory persistence, offline reload, order quantities and reprints, fulfillment/cancellation guards, linked-order navigation, and responsive layouts. Fonts are self-hosted. The generated service worker precaches the app shell, fonts, and identity assets.

## Features

- PlayCase sample orders with search, production filters, inline details, and component mapping
- Quantity-aware order jobs, failed-print replacements, and production history
- Assembly/packing gates, local demo shipment tracking and notes
- Cancelled-order guard and active queue separated from finished/failed job records
- Fleet overview and printer status filters
- Printer detail drawer with simulated temperatures and progress
- Local queue with add, reorder, and remove
- Editable filament weights
- Responsive phone navigation and desktop layout
- Manifest, app icons, install prompt where supported, and offline demo access
- Settings with explicit reset and connection guidance

## Deployment

Host `dist/` on an HTTPS static host and assign `spoolside.shelbyklein.com` through that provider's domain setup. No domain, DNS, hosting, or production site has been changed by this build. No printer credentials are collected.

## PlayCase orders

Spoolside will also manage PlayCase orders. The demo now links sample orders to print jobs and tracks production, fulfillment, and local shipping references. Orders will originate in WooCommerce at https://playcase.gg. Connection credentials and customer-data handling need to be defined before implementation; the dashboard does not yet import live WooCommerce orders.

## Live printer phase

A hosted browser cannot directly reach printers on a private LAN. The next phase needs an authenticated bridge on an always-on computer on that LAN, plus an online service for authorization and status delivery. Verify current A1 mini firmware/LAN protocol and remote-control support before implementing. Keep printer access codes on the bridge, authenticate every workspace, separate commands from telemetry, and show stale/disconnected status. Remote commands require explicit UI actions and server-side authorization. Never expose printers directly to the public internet.

This version does not provide slicing, upload-to-printer, cloud synchronization, accounts, cameras, or live commands. Do not mistake the demo's manually entered queue for the printer's own queue.

## Artwork

`public/spoolside.png` is the exact image supplied by Shelby in chat; the PWA icons are resized copies. No separate logo was generated.
