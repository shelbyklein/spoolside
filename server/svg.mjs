import { DOMParser } from '@xmldom/xmldom';

const NS = 'http://www.w3.org/2000/svg';
const tags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'title', 'desc']);
const attributes = new Set(['xmlns', 'width', 'height', 'viewBox', 'version', 'id', 'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'transform', 'preserveAspectRatio']);

// Cut files are a bounded, static SVG subset. Keep the native bytes (and units),
// but never serve active SVG content, CSS, links, foreign XML, or external data.
export function inspectSvg(buf) {
  const invalid = () => { throw Error('Choose a static SVG cut template with width and height in mm'); };
  if (!Buffer.isBuffer(buf) || !buf.length || buf.length > 10 * 1024 * 1024) invalid();
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { invalid(); }
  if (/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(source)) invalid();
  let xml;
  try { xml = new DOMParser({ onError: invalid }).parseFromString(source, 'image/svg+xml'); } catch { invalid(); }
  const root = xml.documentElement;
  if (!root || root.tagName !== 'svg' || root.namespaceURI !== NS) invalid();
  let nodes = 0, geometry = 0;
  const walk = (node, depth = 0) => {
    if (++nodes > 20000 || depth > 32) invalid();
    if (node.nodeType === 1) {
      if (!tags.has(node.tagName) || node.namespaceURI !== NS) invalid();
      if (!['svg', 'g', 'title', 'desc'].includes(node.tagName)) geometry++;
      for (let i = 0; i < node.attributes.length; i++) {
        const a = node.attributes.item(i);
        if (!attributes.has(a.name) || /url\s*\(|[<>]/i.test(a.value)) invalid();
        if (a.name === 'xmlns' && a.value !== NS) invalid();
      }
    } else if (![3, 8].includes(node.nodeType)) invalid();
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c, depth + 1);
  };
  walk(root);
  const mm = value => {
    if (!/^\d+(?:\.\d+)?mm$/.test(value || '')) invalid();
    const n = parseFloat(value);
    if (!(n > 0 && n <= 5000)) invalid();
    return n;
  };
  const size = [mm(root.getAttribute('width')), mm(root.getAttribute('height'))];
  const view = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (!geometry || view.length !== 4 || !view.every(Number.isFinite) || view[2] <= 0 || view[3] <= 0) invalid();
  return { size };
}
