// SPEC-001 §8 html.js / report.js — S12 (XSS, DOM-based) plus layout and fixed copy of the report
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { html, raw, escapeHtml, safeHref } from '../public/core/html.js';
import { renderReport } from '../public/core/report.js';
import { VERSION } from '../public/core/version.js';
import { runPipeline, render, parseReport } from './helpers/pipeline.mjs';
import * as S from './helpers/scenarios.mjs';
import * as C from './helpers/copy.mjs';

const CONTACT = 'https://line.me/R/ti/p/@kinsui-example';

function attrNames(el) {
  if (typeof el.getAttributeNames === 'function') return [...el.getAttributeNames()];
  return [...(el.attributes || [])].map((a) => a.name);
}

function textOf(doc) {
  return (doc.body || doc.documentElement).textContent;
}

function assertSafeDom(doc, label) {
  assert.equal(doc.querySelectorAll('script').length, 0, `${label}: <script> element`);
  assert.equal(doc.querySelectorAll('style').length, 0, `${label}: <style> element`);
  for (const el of doc.querySelectorAll('*')) {
    for (const name of attrNames(el)) {
      const n = String(name).toLowerCase();
      assert.ok(!n.startsWith('on'), `${label}: event attribute ${name} on <${el.tagName}>`);
      assert.notEqual(n, 'style', `${label}: style attribute on <${el.tagName}>`);
      if (['href', 'src', 'action', 'formaction', 'xlink:href', 'data'].includes(n)) {
        const v = String(el.getAttribute(name) || '').replace(/[\u0000- ]/g, '').toLowerCase();
        assert.ok(!v.startsWith('javascript:'), `${label}: javascript: URL in ${name} on <${el.tagName}>`);
      }
    }
  }
  for (const a of doc.querySelectorAll('a')) {
    const href = a.getAttribute('href') || '';
    if (/^https?:/i.test(href)) {
      assert.equal(a.getAttribute('target'), '_blank', `${label}: target on ${href}`);
      const rel = String(a.getAttribute('rel') || '').toLowerCase().split(/\s+/);
      for (const t of ['noopener', 'noreferrer', 'nofollow']) assert.ok(rel.includes(t), `${label}: rel ${t} on ${href}`);
    }
  }
}

const cache = new Map();
async function result(name) {
  if (!cache.has(name)) {
    const sc = S.ALL_SCENARIOS[name]();
    cache.set(name, runPipeline(sc.site, sc.start));
  }
  return cache.get(name);
}

async function report(name, opts) {
  const r = await result(name);
  const out = render(r, opts);
  assert.equal(typeof out, 'string');
  const doc = parseReport(out);
  return { r, out, doc, text: textOf(doc) };
}

// ------------------------------------------------------------------ S12
test('S12 XSS payloads in title / URL / canonical / robots / sitemap stay inert (DOM check, both modes)', async () => {
  for (const detail of [false, true]) {
    for (const contactUrl of [CONTACT, 'javascript:alert(5)', null]) {
      const { doc, text } = await report('s12', { detail, contactUrl });
      assertSafeDom(doc, `s12 detail=${detail} contact=${contactUrl}`);
      for (const img of doc.querySelectorAll('img')) assert.notEqual(img.getAttribute('src'), 'x');
      if (detail) {
        assert.ok(text.includes(S.XSS_TITLE_TEXT), 'malicious title shown as text');
        assert.ok(text.includes('# <script>alert("robots")</script>'), 'robots.txt source shown as text');
      }
    }
  }
});

test('Report safety holds for other scenarios (no script/style/on*/javascript:, external links hardened)', async () => {
  for (const name of ['s01', 's02', 's04', 's06', 's10', 's13', 's14', 's21', 'foreignSitemap']) {
    for (const detail of [false, true]) {
      const { doc } = await report(name, { detail, contactUrl: CONTACT });
      assertSafeDom(doc, `${name} detail=${detail}`);
    }
  }
});

// ------------------------------------------------------------------ layout & fixed copy
test('Report header, time (Taipei), pages crawled／15, footer with VERSION', async () => {
  const { text } = await report('s01', { detail: false, contactUrl: null });
  assert.ok(text.includes(C.REPORT_TITLE));
  assert.ok(text.includes('2026-10-17 10:03'), 'Taipei time YYYY-MM-DD HH:mm');
  assert.ok(text.includes('8／15'), 'pages crawled／15');
  assert.ok(text.includes(C.FOOTER));
  assert.ok(text.includes(VERSION));
});

test('Report always contains llms.txt box, can/cannot prove and scope & limits copy', async () => {
  for (const name of ['s01', 's02']) {
    for (const detail of [false, true]) {
      const { text } = await report(name, { detail, contactUrl: null });
      assert.ok(text.includes(C.CAN_PROVE), `${name} can prove`);
      assert.ok(text.includes(C.CANNOT_PROVE), `${name} cannot prove`);
      for (const s of C.SCOPE_LIMITS) assert.ok(text.includes(s), `${name} scope: ${s}`);
      assert.ok(text.includes(C.LLMS_TXT), `${name} llms.txt`);
    }
  }
});

test('Score block: valid / sample_only / unavailable wording and light text', async () => {
  const a = await report('s01', { detail: false });
  assert.equal(a.r.score.scoreStatus, 'valid');
  assert.ok(!a.text.includes('樣本分數'));
  assert.ok(!a.text.includes('無法評分'));
  assert.ok(a.text.includes('分數'));
  assert.ok(a.text.includes(C.LIGHTS.green));

  const b = await report('s13', { detail: false });
  assert.equal(b.r.score.scoreStatus, 'sample_only');
  assert.ok(b.text.includes('樣本分數'));
  assert.ok(b.text.includes('本次只檢查部分頁面'));

  const c = await report('s02', { detail: false });
  assert.equal(c.r.score.scoreStatus, 'unavailable');
  assert.ok(c.text.includes('無法評分'));
  assert.ok(c.text.includes(C.LIGHTS.red));

  const d = await report('s14', { detail: false });
  assert.equal(d.r.score.grade, 'gray');
  assert.ok(d.text.includes(C.LIGHTS.gray));

  const e = await report('s21', { detail: false });
  assert.equal(e.r.score.grade, 'yellow');
  assert.ok(e.text.includes(C.LIGHTS.yellow));
});

test('Capped score wording (P0 -> 40, P1 -> 79)', async () => {
  const a = await report('s03', { detail: false });
  if (a.r.score.capped) assert.ok(a.text.includes(C.CAPPED_P0));
  const b = await report('s11', { detail: false });
  assert.equal(b.r.score.capped, true);
  assert.ok(b.text.includes(C.CAPPED_P1));
  const c = await report('s01', { detail: false });
  assert.ok(!c.text.includes(C.CAPPED_P0) && !c.text.includes(C.CAPPED_P1));
});

test('Bot table: title, four groups, status labels, user-fetch note', async () => {
  const a = await report('s04', { detail: false });
  assert.ok(a.text.includes(C.BOT_TABLE_TITLE));
  for (const g of C.BOT_GROUPS) assert.ok(a.text.includes(g), g);
  assert.ok(a.text.includes(C.BOT_STATUS.declared_allowed));
  assert.ok(a.text.includes(C.BOT_STATUS.declared_disallowed));
  assert.ok(a.text.includes(C.USER_FETCH_NOTE));
  for (const t of ['Googlebot', 'GPTBot', 'Perplexity-User']) assert.ok(a.text.includes(t), t);
  const b = await report('s14', { detail: false });
  assert.ok(b.text.includes(C.BOT_STATUS.unknown));
});

test('Fixed copy containing <meta …> is displayed as text (T04 fix)', async () => {
  for (const detail of [false, true]) {
    const { doc, text } = await report('s03', { detail });
    assert.ok(text.includes(C.COPY.T04.fix), `detail=${detail}`);
    const robotsMeta = [...doc.querySelectorAll('meta')].filter((m) => String(m.getAttribute('name') || '').toLowerCase() === 'robots');
    assert.equal(robotsMeta.length, 0, 'the <meta> in the fix text must not become an element');
    assert.ok(text.includes(C.SEVERITY_LABEL.P0));
    assert.ok(text.includes(C.EVIDENCE_LABEL.verified));
  }
});

test('Simple mode: every scored finding is visible; INFO only as a count; detail mode shows INFO cards', async () => {
  const a = await report('s06', { detail: false });
  for (const f of a.r.findings.filter((x) => x.scored)) {
    assert.ok(a.text.includes(f.title.slice(0, 300)), `scored ${f.id} visible in simple mode`);
  }
  const simple = await report('s16', { detail: false });
  const full = await report('s16', { detail: true });
  assert.ok(simple.r.ids.includes('T18'));
  assert.ok(!simple.text.includes(C.COPY.T18.title), 'INFO title hidden in simple mode');
  assert.ok(full.text.includes(C.COPY.T18.title), 'INFO card shown in detail mode');
});

test('Simple mode shows the first 5 affected URLs plus "另有 n 筆"', async () => {
  const { r, text } = await report('s10', { detail: false });
  assert.equal(r.byId.T12.count, 6);
  assert.ok(text.includes('另有 1 筆'));
});

test('CTA only when safeHref(contactUrl) is https', async () => {
  const a = await report('s01', { detail: false, contactUrl: CONTACT });
  assert.ok(a.text.includes(C.CTA_TITLE));
  const link = [...a.doc.querySelectorAll('a')].find((x) => x.textContent.includes(C.CTA_BUTTON));
  assert.ok(link, 'CTA link present');
  assert.ok(link.getAttribute('href').startsWith('https://line.me/'));
  for (const bad of [null, 'http://line.me/R/ti/p/@x', 'javascript:alert(1)', 'https://u:p@line.me/x']) {
    const b = await report('s01', { detail: false, contactUrl: bad });
    assert.ok(!b.text.includes(C.CTA_BUTTON), `no CTA button for ${bad}`);
  }
});

test('renderReport signature: default options produce a string', async () => {
  const r = await result('s01');
  const out = renderReport(r.snapshot, r.findings, r.score, r.bots);
  assert.equal(typeof String(out), 'string');
  assertSafeDom(parseReport(String(out)), 'defaults');
});

// ------------------------------------------------------------------ html.js
// v1.5: html`` returns a SafeHtml object whose toString() is the HTML (see A8 test below).
const frag = (s) => new DOMParser().parseFromString(`<!doctype html><html><body>${String(s)}</body></html>`, 'text/html');

test('escapeHtml escapes & < > " \'', () => {
  const input = `<a href="x">'&amp;`;
  const out = escapeHtml(input);
  assert.ok(!/[<>"']/.test(out), out);
  assert.ok(out.includes('&lt;') && out.includes('&gt;') && out.includes('&amp;'));
  assert.equal(frag(out).body.textContent, input);
});

test('html`` escapes interpolations, maps arrays, keeps SafeHtml and raw()', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const a = frag(html`<p>${evil}</p>`);
  assert.equal(a.querySelectorAll('img').length, 0);
  assert.equal(a.querySelector('p').textContent, evil);
  const b = frag(html`<ul>${['<b>1</b>', '2'].map((x) => html`<li>${x}</li>`)}</ul>`);
  assert.equal(b.querySelectorAll('li').length, 2);
  assert.equal(b.querySelectorAll('b').length, 0);
  assert.equal(b.querySelector('li').textContent, '<b>1</b>');
  const c = frag(html`<div>${['<i>', '</i>']}</div>`);
  assert.equal(c.querySelectorAll('i').length, 0);
  const d = frag(html`<div>${raw('<b>static</b>')}</div>`);
  assert.equal(d.querySelectorAll('b').length, 1);
  const e = frag(html`<div>${html`<em>${'<x>'}</em>`}</div>`);
  assert.equal(e.querySelectorAll('em').length, 1);
  assert.equal(e.querySelector('em').textContent, '<x>');
  const f = frag(html`<a title="${'" onclick="alert(1)'}">t</a>`);
  assert.equal(f.querySelector('a').getAttribute('onclick'), null);
});

test('safeHref: only http/https without credentials, normalised', () => {
  assert.equal(safeHref('https://a.com'), 'https://a.com/');
  assert.equal(safeHref('http://a.com/x y'), 'http://a.com/x%20y');
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>', 'ftp://a.com/', 'https://u:p@a.com/', 'https://u@a.com/', '//evil.com/', 'not a url', '', null, undefined]) {
    assert.equal(safeHref(bad), null, String(bad));
  }
});

// ------------------------------------------------------------------ v1.5 A8: html returns SafeHtml, renderReport returns a string
test('A8 html returns a SafeHtml object whose String() is the HTML; nesting needs no raw(); renderReport returns a string', async () => {
  const h = html`<p>${'x'}</p>`;
  assert.equal(typeof h, 'object');
  assert.notEqual(h, null);
  assert.equal(String(h), '<p>x</p>');
  assert.equal(String(html`<div>${html`<b>${'<i>'}</b>`}</div>`), '<div><b>&lt;i&gt;</b></div>');
  assert.equal(String(html`<ul>${['a', '<b>'].map((x) => html`<li>${x}</li>`)}</ul>`), '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
  const r = await result('s01');
  for (const opts of [undefined, { detail: true, contactUrl: CONTACT }]) {
    const out = opts ? renderReport(r.snapshot, r.findings, r.score, r.bots, opts) : renderReport(r.snapshot, r.findings, r.score, r.bots);
    assert.equal(typeof out, 'string');
  }
});
