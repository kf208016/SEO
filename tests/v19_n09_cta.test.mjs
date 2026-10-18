// SPEC-002 §4.3 / §10 N09 — CTA block with LINE summary (mobile oaMessage link / desktop QR + copy button)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineSummary, lineMessageUrl } from '../public/core/report.js';
import { cached, reportOf, assertSafeDom, CONTACT } from './helpers/report_v19.mjs';
import * as S from './helpers/scenarios.mjs';
import * as C from './helpers/copy_v19.mjs';

const OA = 'https://line.me/R/oaMessage/%40760zrres/?';
const links = (doc) => [...doc.querySelectorAll('a')];
const oaLinks = (doc) => links(doc).filter((a) => String(a.getAttribute('href') || '').startsWith('https://line.me/R/oaMessage/'));
const contactLinks = (doc) => links(doc).filter((a) => a.getAttribute('href') === CONTACT);
const buttonsNamed = (doc, text) => [...doc.querySelectorAll('a.button, a[class~="button"]')].filter((a) => a.textContent.trim() === text);

function summaryOf(r) {
  return buildLineSummary(r.snapshot, r.findings, r.score);
}

test('N09 mobile + valid lineId + contact: oaMessage button with the summary, note 送出後我們會收到, secondary contact link, no QR', async () => {
  const r = await cached('s01', S.s01);
  const summary = summaryOf(r);
  for (const detail of [false, true]) {
    const { doc, text } = reportOf(r, { detail, contactUrl: CONTACT, lineId: C.LINE_ID, mobile: true });
    const label = `detail=${detail}`;
    assert.ok(text.includes(C.CTA_TITLE), label + ': CTA title');
    const oa = oaLinks(doc);
    assert.equal(oa.length, 1, label + ': one oaMessage link');
    const a = oa[0];
    assert.ok(a.getAttribute('href').startsWith(OA), label + ': ' + a.getAttribute('href'));
    assert.equal(a.getAttribute('href'), lineMessageUrl(C.LINE_ID, summary), label + ': href = lineMessageUrl(lineId, summary)');
    assert.equal(a.textContent.trim(), C.CTA_MOBILE_BUTTON, label + ': button text');
    assert.ok(String(a.getAttribute('class') || '').split(/\s+/).includes('button'), label + ': class button');
    assert.equal(a.getAttribute('target'), '_blank');
    for (const t of ['noopener', 'noreferrer', 'nofollow']) assert.ok(String(a.getAttribute('rel') || '').split(/\s+/).includes(t), label + ': rel ' + t);
    const note = [...doc.querySelectorAll('p.muted')].find((p) => p.textContent.startsWith(C.CTA_MOBILE_NOTE_PREFIX));
    assert.ok(note, label + ': <p class="muted">送出後我們會收到：…</p>');
    assert.equal(note.textContent, C.CTA_MOBILE_NOTE_PREFIX + summary, label + ': note carries the summary');
    const secondary = contactLinks(doc).find((x) => x.textContent.trim() === C.CTA_MOBILE_SECONDARY);
    assert.ok(secondary, label + ': 或直接加入 LINE 官方帳號 link to contact');
    assert.equal(doc.querySelectorAll('svg').length, 0, label + ': no QR on mobile');
    assert.equal(doc.querySelector('pre.line-summary'), null, label + ': no <pre> on mobile');
    assert.equal(doc.querySelector('[data-copy="summary"]'), null, label + ': no copy button on mobile');
    assert.ok(!text.includes(C.CTA_QR_NOTE), label);
    assertSafeDom(doc, label);
  }
});

test('N09 desktop + valid lineId + contact: QR svg in div.qr, note, <pre class="line-summary">, copy button, contact button and note', async () => {
  const r = await cached('s01', S.s01);
  const summary = summaryOf(r);
  for (const detail of [false, true]) {
    const { doc, text, out } = reportOf(r, { detail, contactUrl: CONTACT, lineId: C.LINE_ID, mobile: false });
    const label = `detail=${detail}`;
    assert.ok(text.includes(C.CTA_TITLE), label);
    assert.ok(out.includes('<svg'), label + ': <svg present');
    const qr = doc.querySelector('div.qr');
    assert.ok(qr, label + ': <div class="qr">');
    assert.equal(qr.querySelectorAll('svg').length, 1, label + ': the QR svg is inside div.qr');
    assert.equal(doc.querySelectorAll('svg').length, 1, label + ': exactly one svg in the report');
    assert.ok(text.includes(C.CTA_QR_NOTE), label + ': QR note');
    const pre = doc.querySelector('pre.line-summary');
    assert.ok(pre, label + ': <pre class="line-summary">');
    assert.equal(pre.textContent, summary, label + ': pre text is the summary');
    const btn = doc.querySelector('button[data-copy="summary"]');
    assert.ok(btn, label + ': copy button');
    assert.equal(btn.getAttribute('type'), 'button');
    const cls = String(btn.getAttribute('class') || '').split(/\s+/);
    assert.ok(cls.includes('copy-summary') && cls.includes('no-print'), label + ': classes copy-summary no-print');
    assert.equal(btn.textContent.trim(), C.CTA_COPY_BUTTON);
    const contactBtn = buttonsNamed(doc, C.CTA_DESKTOP_BUTTON).find((a) => a.getAttribute('href') === CONTACT);
    assert.ok(contactBtn, label + ': contact button 加入 LINE 官方帳號諮詢');
    assert.ok(text.includes(C.CTA_DESKTOP_NOTE), label + ': desktop note');
    assert.equal(oaLinks(doc).length, 0, label + ': no oaMessage link on desktop');
    assert.ok(!text.includes(C.CTA_MOBILE_BUTTON), label);
    // the QR encodes the oaMessage URL? not required by the spec — only check the svg is safe
    const svg = qr.querySelector('svg');
    assert.equal(svg.getAttribute('aria-label'), 'LINE 諮詢 QR code');
    assert.equal(svg.getAttribute('role'), 'img');
    assertSafeDom(doc, label);
  }
});

test('N09 invalid lineId ("", javascript:x, 760zrres, @, too long, non-string) -> v1.8 CTA: contact button only, no oaMessage, no svg, no pre', async () => {
  const r = await cached('s01', S.s01);
  for (const bad of ['', 'javascript:x', '760zrres', '@', '@' + 'a'.repeat(41), '@760 zrres', '@760zrres<svg>', null, undefined]) {
    for (const mobile of [true, false]) {
      const { doc, text } = reportOf(r, { detail: false, contactUrl: CONTACT, lineId: bad, mobile });
      const label = `lineId=${JSON.stringify(bad)} mobile=${mobile}`;
      assert.equal(oaLinks(doc).length, 0, label + ': no oaMessage');
      assert.equal(doc.querySelectorAll('svg').length, 0, label + ': no svg');
      assert.equal(doc.querySelector('pre.line-summary'), null, label);
      assert.equal(doc.querySelector('[data-copy="summary"]'), null, label);
      assert.ok(text.includes(C.CTA_TITLE), label + ': CTA still shown because contact is https');
      const btn = buttonsNamed(doc, C.CTA_DESKTOP_BUTTON).find((a) => a.getAttribute('href') === CONTACT) || contactLinks(doc).find((a) => a.textContent.trim() === C.CTA_DESKTOP_BUTTON);
      assert.ok(btn, label + ': contact button as in v1.8');
      assert.ok(!text.includes(C.CTA_MOBILE_BUTTON), label);
      assert.ok(!text.includes(C.CTA_MOBILE_NOTE_PREFIX), label);
      assertSafeDom(doc, label);
    }
  }
});

test('N09 lineId is trimmed before validation (" @760zrres " is valid)', async () => {
  const r = await cached('s01', S.s01);
  const { doc } = reportOf(r, { detail: false, contactUrl: CONTACT, lineId: ' @760zrres ', mobile: true });
  const oa = oaLinks(doc);
  assert.equal(oa.length, 1);
  assert.ok(oa[0].getAttribute('href').startsWith(OA));
});

test('N09 contact null + valid lineId: mobile -> oaMessage without secondary link; desktop -> QR + pre + copy, no contact button', async () => {
  const r = await cached('s01', S.s01);
  const m = reportOf(r, { detail: false, contactUrl: null, lineId: C.LINE_ID, mobile: true });
  assert.ok(m.text.includes(C.CTA_TITLE));
  assert.equal(oaLinks(m.doc).length, 1);
  assert.equal(contactLinks(m.doc).length, 0);
  assert.ok(!m.text.includes(C.CTA_MOBILE_SECONDARY));
  assert.equal(m.doc.querySelectorAll('svg').length, 0);
  const d = reportOf(r, { detail: false, contactUrl: null, lineId: C.LINE_ID, mobile: false });
  assert.ok(d.text.includes(C.CTA_TITLE));
  assert.equal(d.doc.querySelectorAll('div.qr svg').length, 1);
  assert.ok(d.doc.querySelector('pre.line-summary'));
  assert.ok(d.doc.querySelector('button[data-copy="summary"]'));
  assert.equal(contactLinks(d.doc).length, 0);
  assert.equal(buttonsNamed(d.doc, C.CTA_DESKTOP_BUTTON).length, 0, 'no contact button without contact');
  assert.ok(!d.text.includes(C.CTA_DESKTOP_NOTE), 'the "paste the summary" note belongs to the contact button');
  assertSafeDom(m.doc, 'mobile');
  assertSafeDom(d.doc, 'desktop');
});

test('N09 contact null + invalid lineId -> no CTA block at all', async () => {
  const r = await cached('s01', S.s01);
  for (const bad of ['', '760zrres', 'javascript:x', null]) {
    for (const mobile of [true, false]) {
      const { doc, text } = reportOf(r, { detail: false, contactUrl: null, lineId: bad, mobile });
      const label = `lineId=${JSON.stringify(bad)} mobile=${mobile}`;
      assert.ok(!text.includes(C.CTA_TITLE), label + ': no CTA title');
      assert.equal(doc.querySelectorAll('a.button').length, 0, label + ': no CTA button');
      assert.equal(oaLinks(doc).length, 0, label);
      assert.equal(doc.querySelectorAll('svg').length, 0, label);
      assert.equal(doc.querySelector('pre.line-summary'), null, label);
    }
  }
});

test('N09 non-https contact with a valid lineId behaves like contact null (LINE part still shown)', async () => {
  const r = await cached('s01', S.s01);
  for (const bad of ['http://line.me/R/ti/p/@x', 'javascript:alert(1)', 'https://u:p@line.me/x']) {
    const d = reportOf(r, { detail: false, contactUrl: bad, lineId: C.LINE_ID, mobile: false });
    assert.equal(d.doc.querySelectorAll('div.qr svg').length, 1, bad);
    assert.equal(buttonsNamed(d.doc, C.CTA_DESKTOP_BUTTON).length, 0, bad + ': no contact button');
    assertSafeDom(d.doc, bad);
  }
});

test('N09 the summary in the CTA follows the audit (S13 sample_only, S02 unavailable)', async () => {
  for (const [name, b] of [['s13', S.s13], ['s02', S.s02], ['s06', S.s06]]) {
    const r = await cached(name, b);
    const summary = summaryOf(r);
    const m = reportOf(r, { detail: true, contactUrl: CONTACT, lineId: C.LINE_ID, mobile: true });
    assert.equal(oaLinks(m.doc)[0].getAttribute('href'), lineMessageUrl(C.LINE_ID, summary), name + ' mobile href');
    assert.ok(m.text.includes(C.CTA_MOBILE_NOTE_PREFIX + summary), name + ' mobile note');
    const d = reportOf(r, { detail: true, contactUrl: CONTACT, lineId: C.LINE_ID, mobile: false });
    assert.equal(d.doc.querySelector('pre.line-summary').textContent, summary, name + ' desktop pre');
    assert.equal(d.doc.querySelectorAll('div.qr svg').length, 1, name + ' desktop qr');
  }
});

test('N09 the oaMessage button is the only element with class button on mobile; the CTA title stays verbatim', async () => {
  const r = await cached('s01', S.s01);
  const { doc, text } = reportOf(r, { detail: false, contactUrl: CONTACT, lineId: C.LINE_ID, mobile: true });
  const buttons = [...doc.querySelectorAll('a.button')];
  assert.equal(buttons.length, 1);
  assert.ok(buttons[0].getAttribute('href').startsWith(OA));
  assert.ok(text.includes('需要完整健檢、修正與上線後追蹤？'));
});
