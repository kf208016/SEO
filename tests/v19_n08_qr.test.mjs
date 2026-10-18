// SPEC-002 §4.4 / §10 N08 — public/core/qr.js: qrMatrix, qrSvg, QR_BYTE_CAPACITY_M
// Structural assertions plus an independent reader (tests/helpers/qr_decode.mjs) that checks format info,
// mask removal, codeword placement, block interleaving, Reed–Solomon parity and the byte-mode payload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { qrMatrix, qrSvg, QR_BYTE_CAPACITY_M } from '../public/core/qr.js';
import { decodeQr, byteCapacity, EC_M, gridFromPath, functionModules, alignmentPositions } from './helpers/qr_decode.mjs';

const enc = new TextEncoder();
const CAP = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666];

function expectedVersion(text) {
  const n = enc.encode(text).length;
  const i = CAP.findIndex((c) => c >= n);
  return i < 0 ? null : i + 1;
}

// 7×7 finder: dark ring, light ring, 3×3 dark centre; `top`/`left` are the top-left module of the 7×7 box
function assertFinder(m, top, left, label) {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      const expected = ring === 3 || ring <= 1;
      assert.equal(m[top + r][left + c], expected, `${label}: finder module (${top + r},${left + c})`);
    }
  }
}

function assertSeparatorsAndTiming(m, version, label) {
  const size = m.length;
  // separators (light) around the three finders
  for (let i = 0; i < 8; i++) {
    assert.equal(m[7][i], false, `${label}: separator row 7 col ${i}`);
    assert.equal(m[i][7], false, `${label}: separator col 7 row ${i}`);
    assert.equal(m[7][size - 1 - i], false, `${label}: separator row 7 col ${size - 1 - i}`);
    assert.equal(m[i][size - 8], false, `${label}: separator col ${size - 8} row ${i}`);
    assert.equal(m[size - 8][i], false, `${label}: separator row ${size - 8} col ${i}`);
    assert.equal(m[size - 1 - i][7], false, `${label}: separator col 7 row ${size - 1 - i}`);
  }
  // timing patterns on row 6 and column 6 between the finders: dark on even indexes
  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, `${label}: timing row 6 col ${i}`);
    assert.equal(m[i][6], i % 2 === 0, `${label}: timing col 6 row ${i}`);
  }
  // dark module at (row 4V+9, col 8)
  assert.equal(m[4 * version + 9][8], true, `${label}: dark module`);
  // alignment patterns (5×5: dark ring, light ring, dark centre)
  const pos = alignmentPositions(version);
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      const cx = pos[i];
      const cy = pos[j];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ring = Math.max(Math.abs(dx), Math.abs(dy));
          assert.equal(m[cy + dy][cx + dx], ring !== 1, `${label}: alignment (${cy + dy},${cx + dx})`);
        }
      }
    }
  }
}

function assertMatrixShape(q, label) {
  assert.equal(typeof q.version, 'number', label);
  assert.equal(q.size, 17 + 4 * q.version, label + ': size = 17 + 4×version');
  assert.ok(Array.isArray(q.modules), label);
  assert.equal(q.modules.length, q.size, label + ': modules.length === size');
  for (const row of q.modules) {
    assert.equal(row.length, q.size, label + ': row length');
    for (const v of row) assert.equal(typeof v, 'boolean', label + ': every module is a boolean');
  }
  assertFinder(q.modules, 0, 0, label + ' top-left');
  assertFinder(q.modules, 0, q.size - 7, label + ' top-right');
  assertFinder(q.modules, q.size - 7, 0, label + ' bottom-left');
  assertSeparatorsAndTiming(q.modules, q.version, label);
}

test('N08 QR_BYTE_CAPACITY_M is the byte-mode / EC-M capacity table for versions 1–20', () => {
  assert.deepEqual(QR_BYTE_CAPACITY_M, CAP);
  for (let v = 1; v <= 20; v++) assert.equal(byteCapacity(v), CAP[v - 1], 'version ' + v + ' derived from the block table');
});

test('N08 qrMatrix("A") -> version 1, size 21, three finder patterns, boolean grid, separators, timing, dark module', () => {
  const q = qrMatrix('A');
  assert.equal(q.version, 1);
  assert.equal(q.size, 21);
  assertMatrixShape(q, 'A');
});

test('N08 the same input gives the same matrix twice (deterministic); default ecLevel is M', () => {
  for (const text of ['A', 'SEO健檢 a.com 技術健康分數95 待處理:C02,C04', 'x'.repeat(100)]) {
    const a = qrMatrix(text);
    const b = qrMatrix(text);
    assert.deepEqual(a, b, text.slice(0, 20));
    const c = qrMatrix(text, { ecLevel: 'M' });
    assert.deepEqual(a, c, 'explicit M equals the default');
    assert.equal(decodeQr(a).ecl, 'M');
  }
});

test('N08 version thresholds: 14 bytes -> v1, 15 -> v2, 666 -> v20, 667 -> Error qr_too_long', () => {
  assert.equal(qrMatrix('x'.repeat(14)).version, 1);
  assert.equal(qrMatrix('x'.repeat(14)).size, 21);
  assert.equal(qrMatrix('x'.repeat(15)).version, 2);
  assert.equal(qrMatrix('x'.repeat(15)).size, 25);
  assert.equal(qrMatrix('x'.repeat(666)).version, 20);
  assert.equal(qrMatrix('x'.repeat(666)).size, 97);
  assert.throws(() => qrMatrix('x'.repeat(667)), (e) => e instanceof Error && e.message === 'qr_too_long');
  assert.throws(() => qrMatrix('x'.repeat(2000)), /qr_too_long/);
});

test('N08 every version boundary 1–20 picks the smallest version that fits (min and max byte counts)', () => {
  for (let v = 1; v <= 20; v++) {
    const max = CAP[v - 1];
    const min = v === 1 ? 1 : CAP[v - 2] + 1;
    assert.equal(qrMatrix('y'.repeat(max)).version, v, `${max} bytes -> v${v}`);
    assert.equal(qrMatrix('y'.repeat(min)).version, v, `${min} bytes -> v${v}`);
  }
});

test('N08 Chinese input is UTF-8 encoded: 4 CJK chars (12 bytes) -> v1, 5 (15 bytes) -> v2; mixed text by byte length', () => {
  assert.equal(enc.encode('中').length, 3);
  assert.equal(qrMatrix('中'.repeat(4)).version, 1);
  assert.equal(qrMatrix('中'.repeat(4)).size, 21);
  assert.equal(qrMatrix('中'.repeat(5)).version, 2);
  assert.equal(qrMatrix('中'.repeat(5)).size, 25);
  for (const text of ['SEO健檢 goldwatersmartlink.com.tw 技術健康分數95(樣本) 待處理:C02,C04', 'SEO健檢 homesales.com.tw 無法評分 原因:blocked_by_site', '健'.repeat(222), '健'.repeat(221) + 'ab']) {
    const q = qrMatrix(text);
    assert.equal(q.version, expectedVersion(text), text.slice(0, 20));
    assert.equal(q.size, 17 + 4 * q.version);
  }
  assert.throws(() => qrMatrix('健'.repeat(223)), /qr_too_long/, '669 bytes do not fit');
});

test('N08 ecLevel only accepts L / M / Q / H', () => {
  for (const lvl of ['L', 'M', 'Q', 'H']) assert.ok(qrMatrix('A', { ecLevel: lvl }).size === 21, lvl);
  for (const bad of ['X', 'LM', '', 1, null]) assert.throws(() => qrMatrix('A', { ecLevel: bad }), String(bad));
});

test('N08 independent reader: format information valid (EC M), RS parity of every block correct, byte-mode payload decodes to the input', () => {
  const samples = [
    'A',
    'x'.repeat(14),
    'x'.repeat(15),
    'SEO健檢 goldwatersmartlink.com.tw 技術健康分數95(樣本) 待處理:C02,C04',
    'SEO健檢 homesales.com.tw 無法評分 原因:blocked_by_site',
    'LINE 諮詢 QR code 中文 測試 😀',
    'https://line.me/R/oaMessage/%40760zrres/?SEO%E5%81%A5%E6%AA%A2',
  ];
  for (let v = 1; v <= 20; v++) {
    samples.push('v' + v + ':' + 'q'.repeat(CAP[v - 1] - 3 - String(v).length));
    if (v > 1) samples.push('z'.repeat(CAP[v - 2] + 1));
  }
  for (const text of samples) {
    const q = qrMatrix(text);
    assertMatrixShape(q, text.slice(0, 24));
    let d;
    try {
      d = decodeQr(q);
    } catch (e) {
      assert.fail(`decode of ${JSON.stringify(text.slice(0, 24))}… (v${q.version}) failed: ${e.message}`);
    }
    assert.equal(d.ecl, 'M', 'EC level M in the format information');
    assert.ok(d.mask >= 0 && d.mask <= 7);
    assert.equal(d.text, text, 'payload round trip');
    assert.equal(d.count, enc.encode(text).length, 'character count = UTF-8 byte length');
    assert.equal(d.version, expectedVersion(text));
    assert.equal(d.codewords.length, EC_M[q.version][0], 'total codewords');
  }
});

test('N08 function-pattern map of the reader matches the matrix for a v7+ code (version information present and consistent)', () => {
  // v7 is the first version with version information blocks; check the 18 bits are a valid BCH(18,6) word for 7
  const q = qrMatrix('x'.repeat(CAP[6]));
  assert.equal(q.version, 7);
  const size = q.size;
  const f = functionModules(7);
  assert.equal(f.length, size);
  let bitsA = 0;
  let bitsB = 0;
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    bitsA |= (q.modules[b][a] ? 1 : 0) << i;
    bitsB |= (q.modules[a][b] ? 1 : 0) << i;
  }
  let rem = 7;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const expected = (7 << 12) | rem;
  assert.equal(bitsA, expected, 'version information copy 1');
  assert.equal(bitsB, expected, 'version information copy 2');
  const d = decodeQr(q);
  assert.equal(d.text, 'x'.repeat(CAP[6]));
});

// ------------------------------------------------------------------ qrSvg
const svgDoc = (s) => new DOMParser().parseFromString(`<!doctype html><html><body>${s}</body></html>`, 'text/html');

function attrsOf(el) {
  const names = typeof el.getAttributeNames === 'function' ? [...el.getAttributeNames()] : [...el.attributes].map((a) => a.name);
  return names.map((n) => n.toLowerCase());
}

test('N08 qrSvg: <svg …> with viewBox/width/height W=(size+8)×4, white rect, exactly one <path fill="#000">, no style/script/on*/http (besides xmlns)', () => {
  const q = qrMatrix('A');
  const out = String(qrSvg(q));
  const W = (q.size + 8) * 4;
  assert.equal(W, 116);
  assert.ok(out.startsWith('<svg'), out.slice(0, 40));
  assert.ok(out.trimEnd().endsWith('</svg>'));
  assert.ok(out.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(out.includes(`viewBox="0 0 ${W} ${W}"`), 'viewBox');
  assert.ok(out.includes(`width="${W}"`) && out.includes(`height="${W}"`), 'width/height');
  assert.ok(out.includes('role="img"'));
  assert.ok(out.includes('aria-label="LINE 諮詢 QR code"'));
  assert.ok(out.includes('shape-rendering="crispEdges"'));
  assert.ok(new RegExp(`<rect width="${W}" height="${W}" fill="#fff"\\s*/?>`).test(out), 'white background rect');
  assert.equal((out.match(/<path\b/g) || []).length, 1, 'exactly one <path');
  assert.ok(/<path[^>]*\bfill="#000"/.test(out), 'path fill #000');
  assert.ok(!/style\s*=/i.test(out), 'no style attribute');
  assert.ok(!/<style/i.test(out), 'no <style>');
  assert.ok(!/<script/i.test(out), 'no <script>');
  assert.ok(!/\son[a-z]+\s*=/i.test(out), 'no on*= attribute');
  const withoutXmlns = out.replace('xmlns="http://www.w3.org/2000/svg"', '');
  assert.ok(!/http/i.test(withoutXmlns), 'no http anywhere besides the xmlns attribute (href/src/url(…)');
  assert.ok(!/url\(/i.test(out) && !/href/i.test(out) && !/\bsrc=/i.test(out), 'no external references');
  // DOM view
  const doc = svgDoc(out);
  const svg = doc.querySelector('svg');
  assert.ok(svg);
  for (const el of doc.body.querySelectorAll('*')) {
    for (const n of attrsOf(el)) {
      assert.ok(!n.startsWith('on'), 'event attribute ' + n);
      assert.notEqual(n, 'style');
    }
  }
  assert.equal(doc.querySelectorAll('path').length, 1);
  assert.equal(doc.querySelectorAll('script, style, foreignObject, image, use, a').length, 0);
});

test('N08 qrSvg path paints exactly the dark modules (M x y h s v s h -s z, runs may be merged); d uses only [MmHhVvZz0-9 .-]', () => {
  for (const [text, opts] of [
    ['A', {}],
    ['SEO健檢 a.com 技術健康分數95(樣本) 待處理:C02,C04', {}],
    ['x'.repeat(100), { scale: 2, margin: 0 }],
    ['中文', { scale: 3, margin: 1 }],
  ]) {
    const q = qrMatrix(text);
    const out = String(qrSvg(q, opts));
    const scale = opts.scale ?? 4;
    const margin = opts.margin ?? 4;
    const W = (q.size + 2 * margin) * scale;
    assert.ok(out.includes(`viewBox="0 0 ${W} ${W}"`), `W for ${JSON.stringify(opts)}`);
    const m = out.match(/<path[^>]*\sd="([^"]*)"/);
    assert.ok(m, 'path d attribute');
    const d = m[1];
    assert.match(d, /^[MmHhVvZz0-9 .-]+$/, 'd charset');
    assert.ok(/^M/.test(d.trim()), 'd starts with M');
    const grid = gridFromPath(d, q.size, scale, margin);
    assert.deepEqual(grid, q.modules, `painted modules equal the matrix (${text.slice(0, 10)}, ${JSON.stringify(opts)})`);
    const darkCount = q.modules.flat().filter(Boolean).length;
    const moveCount = (d.match(/M/g) || []).length;
    assert.ok(moveCount >= 1 && moveCount <= darkCount, `one subpath per module or per merged run (${moveCount} ≤ ${darkCount})`);
  }
});

test('N08 qrSvg returns a SafeHtml-like value whose String() is the SVG (usable inside html``)', () => {
  const q = qrMatrix('A');
  const out = qrSvg(q);
  assert.ok(out !== null && (typeof out === 'object' || typeof out === 'string'));
  const s = String(out);
  assert.ok(s.startsWith('<svg'));
  assert.equal(String(qrSvg(q)), s, 'deterministic');
});
