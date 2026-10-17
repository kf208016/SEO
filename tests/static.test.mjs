// SPEC-001 v1.7 static assets: favicon link in public/index.html and public/favicon.svg
// (the coordinator allowed reading exactly these two static files for this check)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const INDEX = new URL('../public/index.html', import.meta.url);
const FAVICON = new URL('../public/favicon.svg', import.meta.url);

test('V17 index.html links the SVG favicon', async () => {
  const html = await readFile(INDEX, 'utf8');
  assert.ok(html.includes('<link rel="icon" href="/favicon.svg" type="image/svg+xml">'), 'favicon <link> present verbatim');
});

test('V17 favicon.svg exists, is an SVG, has no script and no external http(s) references', async () => {
  const svg = await readFile(FAVICON, 'utf8');
  assert.ok(svg.replace(/^\uFEFF/, '').trimStart().startsWith('<svg'), 'starts with <svg');
  assert.ok(!/<script/i.test(svg), 'no <script');
  assert.ok(!/href\s*=\s*["']?\s*https?:/i.test(svg), 'no href="http…" (no external resources)');
  assert.ok(/#0b2545/i.test(svg), 'dark-blue background #0b2545 (§9 網站圖示)');
});
