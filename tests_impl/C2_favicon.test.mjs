import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

import { VERSION } from '../public/core/version.js';

test('C2 index.html 宣告 SVG favicon', async () => {
  const source = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(source.includes('<link rel="icon" href="/favicon.svg" type="image/svg+xml">'));

  const { document } = parseHTML(source);
  const icon = document.querySelector('link[rel="icon"]');
  assert.ok(icon);
  assert.equal(icon.getAttribute('href'), '/favicon.svg');
  assert.equal(icon.getAttribute('type'), 'image/svg+xml');
});

test('C2 favicon 是深藍底、白色放大鏡且沒有 script 或外部參照的純 SVG', async () => {
  const source = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
  assert.equal(source.startsWith('<svg'), true);
  assert.match(source, /#0b2545/iu);
  assert.match(source, /(?:fill|stroke)="#(?:fff|ffffff)"/iu);
  assert.doesNotMatch(source, /<script\b/iu);
  assert.doesNotMatch(source, /(?:xlink:)?href\s*=/iu);
  assert.doesNotMatch(source, /\b(?:src|data)\s*=/iu);
  assert.doesNotMatch(source, /url\s*\(/iu);
});

test('C2 公開版本為 1.8.0', () => {
  assert.equal(VERSION, '1.8.0');
});
