import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectSvg } from './svg.mjs';

export const svg = (content = '<path d="M0 0 L10 0 L10 20 Z" fill-rule="evenodd"/>') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="65.896881mm" height="40.795244mm" viewBox="0 0 65.896881 40.795244"><title>PlayPad &amp; tape</title>${content}</svg>`);

test('static SVG preserves exact millimetre dimensions', () => {
  assert.deepEqual(inspectSvg(svg()).size, [65.896881, 40.795244]);
});

test('SVG rejects active content, foreign namespaces, links and malformed documents', () => {
  const invalid = [
    svg('<script>alert(1)</script>'),
    svg('<path d="M0 0" onload="alert(1)"/>'),
    svg('<foreignObject/>'),
    svg('<image href="https://example.com/image.png"/>'),
    svg('<path d="M0 0" fill="&#x75;rl(https://example.com)"/>'),
    svg('<g xmlns="http://www.w3.org/1999/xhtml"><path/></g>'),
    svg('<path style="fill:red"/>'),
    svg('<path d="M0 0"></g>'),
    Buffer.from('<!DOCTYPE svg [<!ENTITY a "test">]>' + svg().toString()),
    Buffer.from('<?xml-stylesheet href="https://example.com/style.css"?>' + svg().toString()),
    Buffer.from(svg().toString().replace('65.896881mm', '100%')),
    Buffer.from(svg().toString().replace('40.795244mm', '0mm')),
    Buffer.from(svg().toString().replace('40.795244mm', '99999mm')),
    Buffer.from(svg().toString().replace('0 0 65.896881 40.795244', '0 0 NaN 5')),
    svg('<use href="#shape"/>'),
    svg('<g/>').subarray(0, 30),
    Buffer.from([255, 254, 0, 1]),
  ];
  for (const value of invalid) assert.throws(() => inspectSvg(value), /static SVG/);
});
