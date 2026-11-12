// The UI audit: every page at desktop, tablet and phone size, and every dialog, measured against the rules in
// DESIGN.md (instructions/ui-ux-pass.md, S1 and S2), on the made-up farm in mock-farm.ts.
//
// It's a ratchet. KNOWN lists today's failures; the spec passes when what it finds matches KNOWN exactly. A new
// failure fails it, and so does a fix: when a count goes down or a dialog check starts passing, update KNOWN to the
// numbers in the error message (each later task removes the entries it fixes). The goal of the UI pass is an empty KNOWN.
//
// Pages are measured whole (not just the part on screen). The checks:
//   offRight     visible elements reaching past the viewport's right edge (camera feeds, canvases and the phone Library's
//                sideways-scrolling type chips aside)
//   smallTap     controls whose smaller side is under 44 px (820 and 428 only; checkboxes and radios by their label)
//   tinyText     text under 12 px (428 only)
//   lowContrast  text under 4.5:1 on its solid background, 3:1 when large (24 px, or 18.66 px bold);
//                text over images, gradients or canvas, and disabled controls, are skipped
//   unnamed      controls with no accessible name
// Dialogs, opened from their real buttons at 1440 and 428:
//   named        role="dialog" with an accessible name
//   escape       Escape closes it
//   trap         with focus inside, after 12 Tabs (or one more than it has controls), focus is still inside it
//   return       closed with focus inside it, focus goes back to the control that opened it
//   scroll       while it's open, the wheel doesn't scroll the page behind it
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { mockFarm, LIVE } from './mock-farm';

type Size = 1440 | 820 | 428;
type Check = 'offRight' | 'smallTap' | 'tinyText' | 'lowContrast' | 'unnamed';
type DialogCheck = 'named' | 'escape' | 'trap' | 'return' | 'scroll';

// Today's failures: counts per page, and failing checks per dialog (space-separated). In the plan's terms: phone Library
// offRight is P6, smallTap / tinyText / lowContrast are P11, the dialogs are P8.
const KNOWN: Record<Size, { pages: Record<string, Partial<Record<Check, number>>>; dialogs: Record<string, string> }> = {
  1440: {
    pages: {
    },
    dialogs: {},
  },
  820: {
    pages: {
    },
    dialogs: {}, // dialogs are opened at 1440 and 428 only
  },
  428: {
    pages: {
    },
    dialogs: {},
  },
};

// Everything is dated from one moment, and the page clock is frozen at it, so "3 min ago" and "Nov 9" never change.
const NOW = Date.parse('2026-11-11T15:00:00-05:00');
const SIZES: Record<Size, { width: number; height: number; phone: boolean }> = {
  1440: { width: 1440, height: 900, phone: false },
  820: { width: 820, height: 1180, phone: false },
  428: { width: 428, height: 926, phone: true },
};
const CHECKS: Check[] = ['offRight', 'smallTap', 'tinyText', 'lowContrast', 'unnamed'];
const DIALOG_CHECKS: DialogCheck[] = ['named', 'escape', 'trap', 'return', 'scroll'];

// Each page, and what has to be on it before it counts as loaded.
const PAGES: { name: string; path: string; sizes?: Size[]; open?: (page: Page) => Promise<void>; ready: (page: Page, size: Size) => Locator[] }[] = [
  { name: 'overview', path: '/overview', ready: (p, s) => (s === 428 ? [p.locator('.water-home .home-pill').first(), p.locator('.home-notes')] : [p.locator('.queue-order-group').first(), p.locator(s === 820 ? '.printer-tile' : '.printer-row').first(), p.locator('.order-line').first(), p.locator('.home-notes')]) },
  { name: 'printers', path: '/printers', ready: (p) => [p.locator('.printer-card').nth(4), p.locator('.needs-you')] },
  // Phone rows start closed; the audit opens them all so the full rows are measured too.
  { name: 'orders', path: '/orders', open: async (p) => { const closed = p.locator('.order-line.collapsed .order-line-open'); await p.locator('.orders-list article').first().waitFor(); while (await closed.count()) await closed.first().click(); }, ready: (p) => [p.locator('.overview-order-row').first(), p.locator('.order-cost').first()] },
  { name: 'queue', path: '/queue', ready: (p) => [p.locator('.queue-order-group').first()] },
  { name: 'library', path: '/library', ready: (p) => [p.locator('.asset-pill').first(), p.locator('.part-card').first()] },
  { name: 'assemblies', path: '/library/assemblies', ready: (p) => [p.locator('.assembly-tile').first(), p.getByText('Preview unavailable'), p.locator('.tile-cost').first()] },
  { name: 'sliced', path: '/library/sliced', ready: (p) => [p.locator('.sliced-card').nth(9), p.locator('.part-chip').first()] },
  { name: 'personal', path: '/personal', ready: (p) => [p.locator('.personal-project-card').first()] },
  { name: 'supplies', path: '/supplies', ready: (p) => [p.locator('.material-offer').first(), p.locator('.loaded-printers'), p.locator('.costing-settings')] },
  { name: 'settings', path: '/settings', ready: (p) => [p.locator('.settings-printers li').first(), p.locator('.notification-settings button.primary')] },
  { name: 'home', path: '/', sizes: [428], ready: (p) => [p.locator('.water-home .home-pill').first(), p.locator('.home-notes')] },
];

// Each dialog in src/ (grep 'role="dialog"'), and the button that opens it. `before` gets to where that button is.
const DIALOGS: { name: string; path: string; sizes?: Size[]; opener: (page: Page) => Locator; before?: (page: Page) => Promise<void> }[] = [
  { name: 'upload-menu', path: '/', sizes: [428], opener: (p) => p.getByRole('button', { name: 'Upload', exact: true }) }, // the phone's Upload sheet; wide screens get a dropdown
  { name: 'more', path: '/printers', sizes: [428], opener: (p) => p.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'More', exact: true }) }, // the phone tab bar's More sheet
  { name: 'printer-details', path: '/printers', opener: (p) => p.getByRole('button', { name: 'Dogwood, Ready' }) },
  { name: 'reviews', path: '/printers', opener: (p) => p.getByRole('article', { name: 'Prints to review' }).getByRole('button', { name: 'Review' }) },
  { name: 'teach-bed', path: '/printers', opener: (p) => p.getByRole('article', { name: 'Dogwood is waiting on its bed' }).getByRole('button', { name: 'Teach empty bed' }) },
  { name: 'import', path: '/printers', before: async (p) => { await p.getByRole('button', { name: 'Elm, Ready' }).click(); }, opener: (p) => p.getByRole('dialog', { name: 'Elm details' }).getByRole('region', { name: 'Recent prints' }).getByRole('button', { name: 'Add to library' }) },
  { name: 'claude', path: '/printers', opener: (p) => p.getByRole('button', { name: 'Ask Claude' }).first() },
  { name: 'order-print', path: '/queue', opener: (p) => p.getByRole('region', { name: 'Order print queue' }).getByRole('button', { name: 'Print case', exact: true }).first() },
  { name: 'sliced-print', path: '/library/sliced', opener: (p) => p.locator('.sliced-card').first().getByRole('button', { name: 'Print', exact: true }) },
  { name: 'print-settings', path: '/library/sliced', opener: (p) => p.locator('.sliced-card').first().getByRole('button', { name: 'Print settings' }) },
  { name: 'print-details', path: '/library/sliced', opener: (p) => p.locator('.sliced-card').first().getByRole('button', { name: /^Edit print details for / }) },
  { name: 'plate-assets', path: '/library/sliced', opener: (p) => p.locator('.sliced-card').first().getByRole('button', { name: 'Edit assets' }) },
  { name: 'plate-viewer', path: '/library/sliced', opener: (p) => p.locator('.sliced-card').first().getByRole('button', { name: /^View .* in 3D$/ }) },
  { name: 'asset-detail', path: '/library', opener: (p) => p.locator('.asset-pill').first() },
  { name: 'upload-asset', path: '/library', opener: (p) => p.locator('button.upload-asset') },
  { name: 'filter-assets', path: '/library', sizes: [428], opener: (p) => p.getByRole('button', { name: /^Filter/ }) }, // the phone Library's Filter sheet
  { name: 'categories', path: '/library', before: async (p) => { const f = p.getByRole('button', { name: /^Filter/ }); if (await f.count()) await f.click(); }, opener: (p) => p.locator('button.categories-button') },
  { name: 'new-project', path: '/personal', opener: (p) => p.getByRole('button', { name: 'New project' }) },
  { name: 'shipping-quote', path: '/supplies', opener: (p) => p.getByRole('button', { name: 'Add a delivery quote' }).first() },
  // The in-app confirm (src/Confirm.tsx), opened over printer details: Alder's Stop.
  { name: 'confirm-stop', path: '/printers', before: async (p) => { await p.getByRole('button', { name: /^Alder, / }).first().click(); }, opener: (p) => p.getByRole('dialog', { name: 'Alder details' }).locator('.print-controls').getByRole('button', { name: 'Stop' }) },
];

async function open(browser: Browser, size: Size) {
  const { width, height, phone } = SIZES[size];
  const context = await browser.newContext({
    viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/New_York',
    ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  const page = await context.newPage();
  await mockFarm(page, {}, { now: NOW });
  return { context, page };
}

// Loaded: the page's own content is there, fonts are in, and nothing on screen still says it's loading.
async function settle(page: Page, ready: Locator[]) {
  for (const l of ready) await expect(l).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const busy = /^(Loading\b|Connecting to camera|Rendering preview|Checking…$|Working out the cost|Taking a fresh photo|…$)/;
    const onScreen = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
    for (const el of document.querySelectorAll('body *')) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (own && busy.test(own) && onScreen(el)) return false;
    }
    // Camera frames on screen have arrived.
    return [...document.querySelectorAll('.printer-feed')].every((f) => !onScreen(f) || !f.querySelector('.printer-feed-empty')?.textContent?.includes('Connecting'));
  });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

// The measurements, run in the page. Returns a short description of every element that fails each check.
function measure({ minTap, tiny }: { minTap: number | null; tiny: boolean }) {
  const describe = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ''}`;
  };
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }); };
  const all = [...document.querySelectorAll('body *')].filter(visible);
  const controls = all.filter((el) => el.matches('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=radio], [role=switch]'));
  const texts = all.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 1));

  const offRight = all.filter((el) => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 2 && r.width < innerWidth * 2 && !el.closest('.printer-feed, canvas, .type-chips'); });

  const smallTap = minTap === null ? [] : controls.filter((el) => {
    let r = el.getBoundingClientRect();
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) { const label = el.closest('label') || el.labels?.[0]; if (label) r = label.getBoundingClientRect(); }
    return Math.min(r.width, r.height) < minTap;
  });

  const tinyText = tiny ? texts.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12) : [];

  // Colours as [r, g, b, a] (0-255, alpha 0-1).
  const rgba = (c: string): number[] => {
    const v = (c.match(/[\d.]+/g) || ['0', '0', '0', '0']).map(Number);
    if (c.startsWith('color(srgb')) return [v[0] * 255, v[1] * 255, v[2] * 255, v[3] ?? 1];
    return [v[0], v[1], v[2], v[3] ?? 1];
  };
  const over = (top: number[], under: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3]));
  const luminance = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  // The solid colour behind an element, or null when it's on a picture, gradient or canvas.
  const background = (el: Element): number[] | null => {
    const box = el.getBoundingClientRect(), layers: number[][] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none' || e.matches('canvas, video, img')) return null;
      for (const sibling of e.children) if (sibling !== el && !sibling.contains(el) && sibling.matches('img, canvas, video, picture') && overlaps(sibling.getBoundingClientRect(), box)) return null;
      const c = rgba(cs.backgroundColor);
      if (c[3] > 0) { layers.push(c); if (c[3] >= 0.99) break; }
    }
    return layers.reverse().reduce((under, top) => over(top, under), [255, 255, 255]);
  };
  const lowContrast = texts.filter((el) => {
    if (el.closest('[disabled], [aria-disabled="true"]') || el.closest('label')?.querySelector(':disabled')) return false;
    const bg = background(el);
    if (!bg) return false;
    const cs = getComputedStyle(el);
    let opacity = 1;
    for (let e: Element | null = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    const fg = rgba(cs.color);
    if (fg[3] === 0) return false;
    const shown = over([fg[0], fg[1], fg[2], fg[3] * opacity], bg);
    const [a, b] = [luminance(shown), luminance(bg)];
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(cs.fontSize), large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    return ratio < (large ? 3 : 4.5);
  });

  // Accessible names, close to what a screen reader gets: aria-labelledby, aria-label, a label, then the content
  // (with images' alt text), then placeholder or title.
  const content = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent || '';
    if (!(node instanceof Element) || node.getAttribute('aria-hidden') === 'true' || node.matches('select, option, textarea')) return '';
    if (node.getAttribute('aria-label')) return node.getAttribute('aria-label')!;
    if (node.matches('img')) return node.getAttribute('alt') || '';
    return [...node.childNodes].map(content).join(' ');
  };
  const name = (el: Element) => {
    const by = el.getAttribute('aria-labelledby');
    const parts = [by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ') : '', el.getAttribute('aria-label') || ''];
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      parts.push(...[...(el.labels || [])].map(content));
      if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) parts.push(el.value);
    } else parts.push(content(el));
    parts.push(el.getAttribute('placeholder') || '', el.getAttribute('title') || '');
    return parts.join(' ').trim();
  };
  const unnamed = controls.filter((el) => !name(el));

  const list = (els: Element[]) => els.map(describe);
  return { offRight: list(offRight), smallTap: list(smallTap), tinyText: list(tinyText), lowContrast: list(lowContrast), unnamed: list(unnamed) };
}

// "3 × button.icon-button "Close"" lines for an error message.
const summarize = (items: string[], max = 12) => {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i, (counts.get(i) || 0) + 1);
  const lines = [...counts].sort((a, b) => b[1] - a[1]).slice(0, max).map(([d, n]) => `      ${n > 1 ? `${n} × ` : ''}${d}`);
  return lines.join('\n') + (counts.size > max ? `\n      … and ${counts.size - max} more kinds` : '');
};
const literal = (counts: Partial<Record<Check, number>>) => `{ ${CHECKS.filter((c) => counts[c]).map((c) => `${c}: ${counts[c]}`).join(', ')} }`;

test.describe.configure({ mode: 'parallel' });

for (const size of [1440, 820, 428] as Size[]) {
  for (const p of PAGES.filter((x) => !x.sizes || x.sizes.includes(size))) {
    test(`${p.name} at ${size}`, async ({ browser }, info) => {
      const { context, page } = await open(browser, size);
      await page.goto(LIVE + p.path);
      if (p.open) { await expect(page.locator('main').first()).toBeVisible(); await p.open(page); }
      await settle(page, p.ready(page, size));
      const found = await page.evaluate(measure, { minTap: size === 1440 ? null : 44, tiny: size === 428 });
      await info.attach('measurements', { body: JSON.stringify(found, null, 1), contentType: 'application/json' });
      const counts = Object.fromEntries(CHECKS.map((c) => [c, found[c].length])) as Record<Check, number>;
      const known = KNOWN[size].pages[p.name] || {};
      const changed = CHECKS.filter((c) => counts[c] !== (known[c] || 0));
      const message = changed.length
        ? `KNOWN[${size}].pages['${p.name}'] no longer matches. Found ${literal(counts)}, KNOWN has ${literal(known)}.\n` +
          changed.map((c) => `  ${c}: ${known[c] || 0} → ${counts[c]}${counts[c] > (known[c] || 0) ? ' (new failures)' : ' (fixed: lower the count in KNOWN)'}\n${summarize(found[c])}`).join('\n')
        : '';
      await context.close();
      expect(changed, message).toEqual([]);
    });
  }
}

const frames = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

// Whether the newest dialog is still open, and whether focus is inside it.
const dialogState = (page: Page) => page.evaluate(() => {
  const d = document.querySelector('[data-audit-dialog]');
  const open = !!d && d.isConnected && !!d.checkVisibility();
  return { open, focusInside: open && d!.contains(document.activeElement), focusOnOpener: !!document.activeElement?.hasAttribute('data-audit-opener') };
});

// Go to the dialog's page, give the page behind room to scroll, and open the dialog from its button.
async function openDialog(page: Page, d: (typeof DIALOGS)[number]) {
  await page.goto(LIVE + d.path);
  await d.before?.(page);
  const opener = d.opener(page);
  await expect(opener).toBeVisible();
  await opener.evaluate((el) => {
    el.setAttribute('data-audit-opener', '');
    document.querySelectorAll('[role=dialog]').forEach((x) => x.setAttribute('data-audit-before', ''));
    // The page behind scrolls in <main> on a phone and in the document elsewhere; make sure it has room to.
    let scroller: Element | null = null;
    for (let e = el.parentElement; e && !scroller; e = e.parentElement) if (/(auto|scroll)/.test(getComputedStyle(e).overflowY) && !e.closest('[role=dialog]')) scroller = e;
    if (!scroller && el.closest('[role=dialog]')) for (let e = el.closest('[role=dialog]')!.parentElement; e && !scroller; e = e.parentElement) if (/(auto|scroll)/.test(getComputedStyle(e).overflowY)) scroller = e;
    const spacer = document.createElement('div');
    spacer.setAttribute('data-audit-spacer', '');
    spacer.style.height = '2400px';
    (scroller && scroller !== document.documentElement && scroller !== document.body ? scroller : document.body).appendChild(spacer);
    (scroller || document.scrollingElement!).setAttribute('data-audit-scroller', '');
  });
  await opener.click();
  const dialog = page.locator('[role=dialog]:not([data-audit-before])').last();
  await expect(dialog).toBeVisible();
  await dialog.evaluate((el) => el.setAttribute('data-audit-dialog', ''));
  await frames(page);
  return dialog;
}

// Close it some other way when Escape didn't: its Close or Cancel button, then a click outside it.
async function closeDialog(page: Page, dialog: Locator) {
  if (!(await dialogState(page)).open) return;
  const button = dialog.getByRole('button', { name: /^(Close\b.*|Cancel|Done)$/ }).first();
  if (await button.isVisible()) await button.click();
  if (!(await dialogState(page)).open) return;
  await page.mouse.click(2, 2);
  await expect.poll(async () => (await dialogState(page)).open, { message: 'the dialog could not be closed' }).toBe(false);
}

for (const size of [1440, 428] as Size[]) {
  for (const d of DIALOGS) {
    if (d.sizes && !d.sizes.includes(size)) continue;
    test(`dialog ${d.name} at ${size}`, async ({ browser }) => {
      const { context, page } = await open(browser, size);
      const result = {} as Record<DialogCheck, boolean>;

      const dialog = await openDialog(page, d);
      result.named = await dialog.evaluate((el) => {
        const by = el.getAttribute('aria-labelledby');
        return !!((el.getAttribute('aria-label') || '').trim() || (by && by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join('').trim()));
      });
      // Wheel over the backdrop (or the dialog itself when it fills the screen) and watch the page behind.
      const point = await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const spots = [[6, innerHeight / 2], [innerWidth - 6, innerHeight / 2], [innerWidth / 2, 6], [innerWidth / 2, innerHeight - 6]];
        const outside = spots.find(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit && !el.contains(hit) && (x < r.left || x > r.right || y < r.top || y > r.bottom); });
        return outside || [r.left + r.width / 2, r.top + r.height / 2];
      });
      const scrollTop = () => page.evaluate(() => document.querySelector('[data-audit-scroller]')!.scrollTop);
      const before = await scrollTop();
      await page.mouse.move(point[0], point[1]);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(250);
      result.scroll = (await scrollTop()) === before;

      // Escape straight after opening, wherever the dialog left focus.
      await page.keyboard.press('Escape');
      await frames(page);
      result.escape = !(await dialogState(page)).open;
      await closeDialog(page, dialog);

      // Again from a fresh page, from the keyboard. Focus starts inside (put there if the dialog didn't), and has to
      // stay inside after tabbing past everything in it (12 Tabs, or more for a long dialog).
      const again = await openDialog(page, d);
      const focusables = await again.evaluate((el) => {
        const all = [...el.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.matches(':disabled') && x.checkVisibility());
        if (!el.contains(document.activeElement)) all[0]?.focus();
        return all.length;
      });
      for (let i = 0; i < Math.max(12, focusables + 2); i++) await page.keyboard.press('Tab');
      result.trap = (await dialogState(page)).focusInside;
      // Closed with focus inside it (Escape, else its Close button), focus goes back to the button that opened it.
      await again.evaluate((el) => { if (!el.contains(document.activeElement)) el.querySelector<HTMLElement>('a[href], button:not(:disabled), input, select, textarea')?.focus(); });
      await page.keyboard.press('Escape');
      await frames(page);
      await closeDialog(page, again);
      await frames(page);
      result.return = (await dialogState(page)).focusOnOpener;
      await context.close();

      const failing = DIALOG_CHECKS.filter((c) => !result[c]).join(' ');
      const known = (KNOWN[size].dialogs[d.name] || '').split(/\s+/).filter(Boolean).sort((a, b) => DIALOG_CHECKS.indexOf(a as DialogCheck) - DIALOG_CHECKS.indexOf(b as DialogCheck)).join(' ');
      expect(failing, `KNOWN[${size}].dialogs['${d.name}'] no longer matches: it fails "${failing}", KNOWN has "${known}". ` + (failing ? `Set it to '${failing}'.` : 'Remove the entry.')).toBe(known);
    });
  }
}

test('KNOWN only names pages and dialogs the audit opens', () => {
  for (const size of [1440, 820, 428] as Size[]) {
    for (const name of Object.keys(KNOWN[size].pages)) expect(PAGES.some((p) => p.name === name && (!p.sizes || p.sizes.includes(size))), `KNOWN[${size}].pages['${name}']`).toBe(true);
    for (const name of Object.keys(KNOWN[size].dialogs)) expect(size !== 820 && DIALOGS.some((d) => d.name === name), `KNOWN[${size}].dialogs['${name}']`).toBe(true);
    for (const counts of Object.values(KNOWN[size].pages)) for (const [check, n] of Object.entries(counts)) expect(CHECKS.includes(check as Check) && n! > 0, `KNOWN[${size}] ${check}: ${n}`).toBe(true);
    for (const checks of Object.values(KNOWN[size].dialogs)) for (const c of checks.split(/\s+/).filter(Boolean)) expect(DIALOG_CHECKS, `KNOWN[${size}] dialog check ${c}`).toContain(c);
  }
});

test('a Needs you photo link keeps its name when the photo fails to load', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/New_York' });
  const page = await context.newPage();
  await mockFarm(page, { 'GET /api/dispatch/:printer/bed-warning.jpg': { status: 404, body: '', contentType: 'text/plain' } }, { now: NOW });
  await page.goto(LIVE + '/printers');
  const link = page.getByRole('link', { name: /bed photo/ }).first();
  await expect(link).toBeVisible();
  await expect(link.locator('img')).toHaveCSS('visibility', 'hidden');
  await expect(link).toHaveAccessibleName(/^Open .+'s bed photo$/);
  await context.close();
});
