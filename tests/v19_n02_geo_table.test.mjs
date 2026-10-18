// SPEC-002 §1.1 / §10 N02 — honest GEO table wording in the report
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES } from '../public/core/sources.js';
import { cached, reportOf, assertSafeDom, CONTACT } from './helpers/report_v19.mjs';
import * as S from './helpers/scenarios.mjs';
import * as C from './helpers/copy_v19.mjs';

test('N02 GEO table title, fixed note and status wording (S04: allowed and disallowed rows), both modes', async () => {
  const r = await cached('s04', S.s04);
  for (const detail of [false, true]) {
    const { doc, text } = reportOf(r, { detail, contactUrl: CONTACT });
    const label = `detail=${detail}`;
    assert.ok(text.includes(C.GEO_TABLE_TITLE), label + ': new title');
    assert.ok(text.includes(C.GEO_TABLE_NOTE), label + ': fixed note verbatim');
    assert.ok(text.includes(C.GEO_STATUS.declared_allowed), label + ': robots.txt 未禁止');
    assert.ok(text.includes(C.GEO_STATUS.declared_disallowed), label + ': ⛔ robots.txt 禁止');
    assert.ok(!text.includes('✅'), label + ': no green check mark anywhere');
    assert.ok(!text.includes('🟢'), label + ': no green circle');
    assert.ok(!text.includes('規則允許'), label + ': old 規則允許 gone');
    assert.ok(!text.includes('規則封鎖'), label + ': old 規則封鎖 gone');
    assert.ok(!text.includes(C.OLD_GEO_TABLE_TITLE), label + ': old table title gone');
    assertSafeDom(doc, label);
  }
});

test('N02 the declared_allowed cell contains no 允許 and no mark; the disallowed cell shows ⛔ robots.txt 禁止', async () => {
  const r = await cached('s04', S.s04);
  const { doc } = reportOf(r, { detail: false });
  const cells = [...doc.querySelectorAll('td')];
  const allowed = cells.filter((td) => td.textContent.includes(C.GEO_STATUS.declared_allowed));
  assert.ok(allowed.length >= 1, 'at least one 未禁止 cell');
  for (const td of allowed) {
    const t = td.textContent.trim();
    assert.equal(t, C.GEO_STATUS.declared_allowed, 'cell text is exactly the status: ' + t);
    assert.ok(!t.includes('允許'));
  }
  const blocked = cells.filter((td) => td.textContent.includes('robots.txt 禁止'));
  assert.ok(blocked.length >= 4, 'GPTBot, ClaudeBot, OAI-SearchBot, PerplexityBot rows');
  for (const td of blocked) assert.equal(td.textContent.trim(), C.GEO_STATUS.declared_disallowed);
  // row check: the Googlebot row carries 未禁止, the GPTBot row carries 禁止
  const rowOf = (token) => [...doc.querySelectorAll('tr')].find((tr) => [...tr.querySelectorAll('td, th')].some((c) => c.textContent.trim() === token));
  assert.ok(rowOf('Googlebot').textContent.includes(C.GEO_STATUS.declared_allowed));
  assert.ok(rowOf('GPTBot').textContent.includes(C.GEO_STATUS.declared_disallowed));
});

test('N02 column header 首頁的 robots.txt 宣告 replaces 首頁規則', async () => {
  const r = await cached('s04', S.s04);
  for (const detail of [false, true]) {
    const { doc, text } = reportOf(r, { detail });
    const ths = [...doc.querySelectorAll('th')].map((th) => th.textContent.trim());
    assert.ok(ths.includes(C.GEO_HOME_HEADER), `detail=${detail}: header present in ${JSON.stringify(ths)}`);
    assert.ok(!ths.includes(C.OLD_GEO_HOME_HEADER), `detail=${detail}: old header gone`);
    assert.ok(!text.includes(C.OLD_GEO_HOME_HEADER), `detail=${detail}: 首頁規則 not in the text`);
  }
});

test('N02 the note is followed by the cloudflare-ai-default source link', async () => {
  const r = await cached('s04', S.s04);
  const src = SOURCES['cloudflare-ai-default'];
  assert.ok(src, 'SOURCES has cloudflare-ai-default');
  assert.equal(src.url, 'https://blog.cloudflare.com/content-independence-day-no-ai-crawl-without-compensation/');
  for (const detail of [false, true]) {
    const { doc, out } = reportOf(r, { detail });
    const a = [...doc.querySelectorAll('a')].find((x) => x.getAttribute('href') === src.url);
    assert.ok(a, `detail=${detail}: link to the Cloudflare source`);
    assert.equal(a.getAttribute('target'), '_blank');
    // the link comes after the note in the output
    assert.ok(out.indexOf(C.GEO_TABLE_NOTE) >= 0 && out.indexOf(src.url) > out.indexOf(C.GEO_TABLE_NOTE), `detail=${detail}: link after the note`);
  }
});

test('N02 unknown status wording stays ❔ 無法判斷 (S14); four groups and bot-table class unchanged', async () => {
  const r = await cached('s14', S.s14);
  const { doc, text } = reportOf(r, { detail: false });
  assert.ok(text.includes(C.GEO_STATUS.unknown));
  assert.ok(!text.includes('✅'));
  for (const g of ['搜尋引擎', 'AI 搜尋', 'AI 訓練', '使用者即時讀取']) assert.ok(text.includes(g), g);
  assert.equal(doc.querySelectorAll('table.bot-table').length, 4);
  assert.ok(text.includes(C.GEO_TABLE_TITLE));
  assert.ok(text.includes(C.GEO_TABLE_NOTE));
});
