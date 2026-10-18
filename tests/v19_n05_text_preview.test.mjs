// SPEC-002 §2.2 / §10 N05 — report block 「爬蟲在首頁讀到的文字（未執行 JavaScript）」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cached, reportOf, assertSafeDom, homeEntry, CONTACT } from './helpers/report_v19.mjs';
import * as S from './helpers/scenarios.mjs';
import * as V from './helpers/scenarios_v19.mjs';
import * as C from './helpers/copy_v19.mjs';

const len = (s) => Array.from(s).length;

function previewBlock(doc) {
  const h2 = [...doc.querySelectorAll('h2')].find((h) => h.textContent.includes(C.PREVIEW_TITLE));
  const badge = [...doc.querySelectorAll('span')].find((s) => {
    const cls = String(s.getAttribute('class') || '').split(/\s+/);
    return cls.includes('badge') && cls.includes('evidence') && s.textContent.trim() === C.PREVIEW_BADGE;
  });
  const outline = doc.querySelector('ol.heading-outline');
  const preview = doc.querySelector('p.text-preview');
  return { h2, badge, outline, preview };
}

test('N05 analyzable home (S01): title, badge, fixed note, heading outline and preview text; both modes', async () => {
  const r = await cached('s01', S.s01);
  const home = homeEntry(r.snapshot).page;
  assert.ok(home, 'home PageInfo');
  for (const detail of [false, true]) {
    const { doc, text, out } = reportOf(r, { detail, contactUrl: CONTACT });
    const label = `detail=${detail}`;
    const { h2, badge, outline, preview } = previewBlock(doc);
    assert.ok(h2, label + ': <h2> with the block title');
    assert.ok(badge, label + ': <span class="badge evidence">已驗證・不計分</span>');
    assert.ok(text.includes(C.PREVIEW_NOTE), label + ': fixed note verbatim');
    assert.ok(outline, label + ': <ol class="heading-outline">');
    const lis = [...outline.querySelectorAll('li')];
    assert.equal(lis.length, home.headings.length, label + ': one <li> per heading (S01 home has few headings)');
    lis.forEach((li, i) => {
      const h = home.headings[i];
      assert.equal(li.getAttribute('class'), `level-${h.level}`, label + ': li class');
      assert.equal(li.textContent, `H${h.level}　${h.text}`, label + ': li text H{n}　{text}');
    });
    assert.ok(preview, label + ': <p class="text-preview">');
    const expected = home.textPreview + (home.textLength > 300 ? '…' : '');
    assert.equal(preview.textContent, expected, label + ': preview text (+ … when textLength > 300)');
    assert.ok(len(home.textPreview) <= 300);
    // position: after the three section tiles, before the GEO table
    const iTitle = out.indexOf(C.PREVIEW_TITLE);
    const iGeo = out.indexOf(C.GEO_TABLE_TITLE);
    const iTiles = out.indexOf('計分問題');
    assert.ok(iTitle > 0 && iGeo > iTitle, label + ': preview block before the GEO table');
    assert.ok(iTiles >= 0 && iTitle > iTiles, label + ': preview block after the section tiles');
    assertSafeDom(doc, label);
  }
});

test('N05 heading outline: simple mode at most 10 entries, full mode at most 30 (home with 36 headings)', async () => {
  const r = await cached('headingRichHome', () => V.headingRichHome(35));
  const home = homeEntry(r.snapshot).page;
  assert.equal(home.headings.length, 30, 'parse keeps 30');
  const simple = reportOf(r, { detail: false });
  const full = reportOf(r, { detail: true });
  const simpleLis = [...simple.doc.querySelectorAll('ol.heading-outline li')];
  const fullLis = [...full.doc.querySelectorAll('ol.heading-outline li')];
  assert.equal(simpleLis.length, 10);
  assert.equal(fullLis.length, 30);
  assert.equal(simpleLis[0].textContent, 'H1　專業五金零件供應'); // goodSiteRoutes home h1
  assert.equal(simpleLis[1].textContent, 'H2　標題 1');
  assert.equal(simpleLis[0].getAttribute('class'), 'level-1');
  assert.equal(simpleLis[1].getAttribute('class'), 'level-2');
  assert.equal(fullLis[29].textContent, 'H2　標題 29');
  // the first 10 of the full list equal the simple list
  assert.deepEqual(
    fullLis.slice(0, 10).map((li) => li.textContent),
    simpleLis.map((li) => li.textContent),
  );
});

test('N05 home without visible text -> （原始 HTML 裡沒有可見文字）; no headings -> （原始 HTML 裡沒有 H1–H3 標題）', async () => {
  const r = await cached('noTextHome', V.noTextHome);
  assert.equal(r.snapshot.homeAnalyzable, true);
  const home = homeEntry(r.snapshot).page;
  assert.equal(home.textPreview, '');
  assert.equal(home.textLength, 0);
  for (const detail of [false, true]) {
    const { doc, text } = reportOf(r, { detail });
    const { h2, preview, outline } = previewBlock(doc);
    assert.ok(h2, 'block shown');
    assert.ok(preview, 'text-preview element');
    assert.equal(preview.textContent, C.PREVIEW_NO_TEXT);
    assert.ok(!outline || outline.querySelectorAll('li').length === 0, 'no heading entries');
    const muted = [...doc.querySelectorAll('p.muted')].find((p) => p.textContent.trim() === C.PREVIEW_NO_HEADINGS);
    assert.ok(muted, '<p class="muted">（原始 HTML 裡沒有 H1–H3 標題）</p>');
    assert.ok(text.includes(C.PREVIEW_NOTE));
  }
});

test('N05 home with text but no H1–H3 -> muted message for headings, preview shows the text', async () => {
  const r = await cached('noHeadingHome', V.noHeadingHome);
  const home = homeEntry(r.snapshot).page;
  assert.deepEqual(home.headings, []);
  const { doc } = reportOf(r, { detail: true });
  const { preview } = previewBlock(doc);
  assert.equal(preview.textContent, home.textPreview);
  assert.ok(home.textPreview.includes('這一頁有文字'));
  assert.ok([...doc.querySelectorAll('p.muted')].some((p) => p.textContent.trim() === C.PREVIEW_NO_HEADINGS));
});

test('N05 home not analyzable (503 / robots blocks the tool / robots Disallow all) -> the block does not appear', async () => {
  for (const [name, b] of [['s20', S.s20], ['s02', S.s02], ['s17', S.s17], ['s14', S.s14]]) {
    const r = await cached(name, b);
    assert.equal(r.snapshot.homeAnalyzable, false, name);
    for (const detail of [false, true]) {
      const { doc, text } = reportOf(r, { detail });
      assert.ok(!text.includes(C.PREVIEW_TITLE), `${name} detail=${detail}: no block title`);
      assert.ok(!text.includes(C.PREVIEW_NOTE), `${name} detail=${detail}: no fixed note`);
      assert.equal(doc.querySelector('ol.heading-outline'), null, `${name} detail=${detail}`);
      assert.equal(doc.querySelector('p.text-preview'), null, `${name} detail=${detail}`);
    }
  }
});

test('N05 the preview text of the N03-style home ends with … and is exactly the 300-char textPreview', async () => {
  const r = await cached('headingRichHome', () => V.headingRichHome(35));
  const home = homeEntry(r.snapshot).page;
  assert.ok(home.textLength > 300, 'precondition');
  const { doc } = reportOf(r, { detail: false });
  const p = doc.querySelector('p.text-preview');
  assert.ok(p.textContent.endsWith('…'));
  assert.equal(p.textContent.slice(0, -1), home.textPreview);
  assert.equal(len(home.textPreview), 300);
});
