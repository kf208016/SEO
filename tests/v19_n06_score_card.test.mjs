// SPEC-002 §3 / §10 N06 — score card title 「技術健康分數」 and the 「本工具沒有檢查的項目」 card
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cached, reportOf, assertSafeDom } from './helpers/report_v19.mjs';
import * as S from './helpers/scenarios.mjs';
import * as C from './helpers/copy_v19.mjs';
import { LIGHTS, CAPPED_P0, CAPPED_P1 } from './helpers/copy.mjs';

// smallest element whose text contains the card title (the card itself or its heading container)
function notCheckedCard(doc) {
  const els = [...doc.querySelectorAll('*')].filter((e) => e.textContent.includes(C.NOT_CHECKED_TITLE) && e.textContent.includes(C.NOT_CHECKED_ITEMS[4]));
  els.sort((a, b) => a.textContent.length - b.textContent.length);
  return els[0];
}

function assertNotCheckedCard(doc, text, label) {
  assert.ok(text.includes(C.NOT_CHECKED_TITLE), label + ': card title');
  assert.ok(text.includes(C.NOT_CHECKED_SUBTITLE), label + ': subtitle verbatim');
  for (const item of C.NOT_CHECKED_ITEMS) assert.ok(text.includes(item), `${label}: item ${item}`);
  // order of the five items
  const idx = C.NOT_CHECKED_ITEMS.map((item) => text.indexOf(item));
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1], `${label}: item ${i + 1} after item ${i}`);
  // five <li> in one list, consecutive, in order
  const lis = C.NOT_CHECKED_ITEMS.map((item) => [...doc.querySelectorAll('li')].find((li) => li.textContent.trim() === item));
  lis.forEach((li, i) => assert.ok(li, `${label}: <li> for item ${i + 1}`));
  const parent = lis[0].parentNode;
  assert.ok(lis.every((li) => li.parentNode === parent), label + ': all five in the same list');
  const siblings = [...parent.children].filter((x) => String(x.tagName).toLowerCase() === 'li');
  assert.deepEqual(
    lis.map((li) => siblings.indexOf(li)),
    [0, 1, 2, 3, 4].map((i) => siblings.indexOf(lis[0]) + i),
    label + ': consecutive',
  );
  const card = notCheckedCard(doc);
  assert.ok(card, label + ': card element');
  const ct = card.textContent;
  assert.ok(!ct.includes('0/5') && !ct.includes('0／5'), label + ': no 0/5');
  assert.ok(!/(^|\D)0\s*分/.test(ct), label + ': no 「0 分」 wording in the card');
  assert.ok(!text.includes('0/5') && !text.includes('0／5'), label + ': no 0/5 anywhere');
  assert.ok(text.includes(C.SCORE_NOTE), label + ': score card fixed note');
}

test('N06 valid (S01): 技術健康分數 shown, 樣本分數 absent; not-checked card with the five items; fixed note', async () => {
  const r = await cached('s01', S.s01);
  assert.equal(r.score.scoreStatus, 'valid');
  for (const detail of [false, true]) {
    const { doc, text } = reportOf(r, { detail });
    const label = `s01 detail=${detail}`;
    assert.ok(text.includes(C.SCORE_TITLE), label + ': 技術健康分數');
    assert.ok(!text.includes('樣本分數'), label + ': 樣本分數 must not appear when valid');
    assert.ok(!text.includes(C.SCORE_UNAVAILABLE), label);
    assert.ok(text.includes(String(r.score.score)), label + ': score number');
    assert.ok(text.includes(LIGHTS.green), label + ': light text unchanged');
    assertNotCheckedCard(doc, text, label);
    assertSafeDom(doc, label);
  }
});

test('N06 sample_only (S13): 技術健康分數 + 「樣本分數：本次只檢查部分頁面」', async () => {
  const r = await cached('s13', S.s13);
  assert.equal(r.score.scoreStatus, 'sample_only');
  for (const detail of [false, true]) {
    const { doc, text } = reportOf(r, { detail });
    const label = `s13 detail=${detail}`;
    assert.ok(text.includes(C.SCORE_TITLE), label);
    assert.ok(text.includes(C.SCORE_SAMPLE_ONLY), label + ': sample wording verbatim');
    assert.ok(!text.includes(C.SCORE_UNAVAILABLE), label);
    assertNotCheckedCard(doc, text, label);
  }
});

test('N06 unavailable (S02, S14, S20): 技術健康分數 title + 無法評分 + reason; not-checked card still shown', async () => {
  for (const [name, b] of [['s02', S.s02], ['s14', S.s14], ['s20', S.s20]]) {
    const r = await cached(name, b);
    assert.equal(r.score.scoreStatus, 'unavailable', name);
    for (const detail of [false, true]) {
      const { doc, text } = reportOf(r, { detail });
      const label = `${name} detail=${detail}`;
      assert.ok(text.includes(C.SCORE_TITLE), label + ': the title is the same for all three statuses');
      assert.ok(text.includes(C.SCORE_UNAVAILABLE), label + ': 無法評分');
      assert.ok(!text.includes('樣本分數'), label);
      assertNotCheckedCard(doc, text, label);
    }
  }
});

test('N06 capped wording and light texts unchanged (S03 P0 -> 40, S11 P1 -> 79)', async () => {
  const a = await cached('s03', S.s03);
  const ra = reportOf(a, { detail: false });
  assert.ok(ra.text.includes(C.SCORE_TITLE));
  if (a.score.capped) assert.ok(ra.text.includes(CAPPED_P0));
  const b = await cached('s11', S.s11);
  const rb = reportOf(b, { detail: false });
  assert.equal(b.score.capped, true);
  assert.ok(rb.text.includes(CAPPED_P1));
  assert.ok(rb.text.includes(LIGHTS.yellow));
  assertNotCheckedCard(rb.doc, rb.text, 's11');
});

test('N06 the five items are not rendered as a score (no 「n/5」 of any kind next to the card title)', async () => {
  const r = await cached('s01', S.s01);
  const { doc } = reportOf(r, { detail: true });
  const card = notCheckedCard(doc);
  assert.ok(!/\d\s*\/\s*5/.test(card.textContent), card.textContent.slice(0, 200));
  assert.ok(!/\d\s*／\s*5/.test(card.textContent));
});
