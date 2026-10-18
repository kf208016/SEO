// SPEC-002 §9 / §10 N15 — S12 XSS site + valid lineId + hostile siteHost: CTA, <pre>, QR stay inert
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineSummary, lineMessageUrl } from '../public/core/report.js';
import { render, parseReport } from './helpers/pipeline.mjs';
import { cached, assertSafeDom, textOf, CONTACT } from './helpers/report_v19.mjs';
import * as S from './helpers/scenarios.mjs';
import { LINE_ID } from './helpers/copy_v19.mjs';

const EVIL_HOST = '"><svg onload=alert(1)>';

async function evilResult() {
  const base = await cached('s12', S.s12);
  const snapshot = { ...base.snapshot, siteHost: EVIL_HOST };
  return { ...base, snapshot };
}

test('N15 desktop: no script / style / on* / javascript:, hostile host shown as text in <pre>, one safe QR svg', async () => {
  const r = await evilResult();
  const summary = buildLineSummary(r.snapshot, r.findings, r.score);
  assert.ok(summary.includes(EVIL_HOST), 'precondition: the summary carries the hostile host');
  for (const detail of [false, true]) {
    for (const contactUrl of [CONTACT, 'javascript:alert(5)', null]) {
      const out = render(r, { detail, contactUrl, lineId: LINE_ID, mobile: false });
      const doc = parseReport(out);
      const label = `desktop detail=${detail} contact=${contactUrl}`;
      assertSafeDom(doc, label);
      assert.equal(doc.querySelectorAll('script').length, 0, label);
      const pre = doc.querySelector('pre.line-summary');
      assert.ok(pre, label + ': <pre class="line-summary">');
      assert.equal(pre.textContent, summary, label + ': pre text equals the summary');
      assert.ok(pre.textContent.includes(EVIL_HOST), label + ': hostile string is text');
      assert.equal(pre.querySelectorAll('*').length, 0, label + ': no element inside <pre>');
      const svgs = [...doc.querySelectorAll('svg')];
      assert.equal(svgs.length, 1, label + ': exactly one svg (the QR)');
      const svg = svgs[0];
      assert.equal(svg.getAttribute('onload'), null, label);
      const path = svg.querySelector('path');
      assert.ok(path, label + ': QR path');
      assert.match(path.getAttribute('d'), /^[MmHhVvZz0-9 .-]+$/, label + ': path d charset');
      assert.equal(svg.querySelectorAll('script, style, foreignObject, image, use, a').length, 0, label);
      for (const el of svg.querySelectorAll('*')) {
        for (const attr of ['href', 'xlink:href', 'style']) assert.equal(el.getAttribute(attr), null, label + ': ' + attr);
      }
      assert.ok(!/<svg onload/i.test(out), label + ': the hostile svg tag never appears unescaped');
    }
  }
});

test('N15 mobile: oaMessage href carries the hostile host percent-encoded; no svg; note text inert', async () => {
  const r = await evilResult();
  const summary = buildLineSummary(r.snapshot, r.findings, r.score);
  for (const detail of [false, true]) {
    const out = render(r, { detail, contactUrl: CONTACT, lineId: LINE_ID, mobile: true });
    const doc = parseReport(out);
    const label = `mobile detail=${detail}`;
    assertSafeDom(doc, label);
    const oa = [...doc.querySelectorAll('a')].filter((a) => String(a.getAttribute('href') || '').startsWith('https://line.me/R/oaMessage/'));
    assert.equal(oa.length, 1, label);
    const href = oa[0].getAttribute('href');
    assert.equal(href, lineMessageUrl(LINE_ID, summary), label);
    assert.ok(!href.includes('<') && !href.includes('>') && !href.includes('"'), label + ': encoded');
    assert.ok(href.includes(encodeURIComponent(EVIL_HOST)), label);
    assert.equal(doc.querySelectorAll('svg').length, 0, label);
    assert.ok(textOf(doc).includes('送出後我們會收到：' + summary), label);
  }
});

test('N15 hostile lineId values never become a link or a QR', async () => {
  const r = await evilResult();
  for (const bad of ['@760zrres" onclick="alert(1)', '@760zrres<svg onload=alert(1)>', 'javascript:alert(1)', '@760zrres/../../x']) {
    for (const mobile of [true, false]) {
      const out = render(r, { detail: true, contactUrl: CONTACT, lineId: bad, mobile });
      const doc = parseReport(out);
      const label = `lineId=${bad} mobile=${mobile}`;
      assertSafeDom(doc, label);
      assert.equal([...doc.querySelectorAll('a')].filter((a) => String(a.getAttribute('href') || '').includes('oaMessage')).length, 0, label);
      assert.equal(doc.querySelectorAll('svg').length, 0, label);
      assert.equal(doc.querySelector('pre.line-summary'), null, label);
    }
  }
});

test('N15 the S12 payloads (title, URL, canonical, robots, sitemap) stay inert with the LINE options on, both modes', async () => {
  const r = await evilResult();
  for (const mobile of [true, false]) {
    const out = render(r, { detail: true, contactUrl: CONTACT, lineId: LINE_ID, mobile });
    const doc = parseReport(out);
    assertSafeDom(doc, 'mobile=' + mobile);
    for (const img of doc.querySelectorAll('img')) assert.notEqual(img.getAttribute('src'), 'x');
    const text = textOf(doc);
    assert.ok(text.includes(S.XSS_TITLE_TEXT), 'malicious title shown as text');
    assert.ok(text.includes('# <script>alert("robots")</script>'), 'robots.txt source shown as text');
  }
});
