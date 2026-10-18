// SPEC-002 §5.2 / §5.3 / §10 N11 — C12 & G03 copy, proxy User-Agent, public/bot.html, index.html and report links to /bot.html
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser } from 'linkedom';
import { proxyFetch } from '../src/proxy.js';
import { cached, reportOf, CONTACT } from './helpers/report_v19.mjs';
import * as S from './helpers/scenarios.mjs';
import * as C from './helpers/copy_v19.mjs';
import { splitTemplate, SCOPE_LIMITS } from './helpers/copy.mjs';

const BOT_HTML = new URL('../public/bot.html', import.meta.url);
const INDEX_HTML = new URL('../public/index.html', import.meta.url);

test('N11 C12 summary is the new copy verbatim (S06)', async () => {
  const r = await cached('s06', S.s06);
  assert.ok(r.ids.includes('C12'));
  assert.equal(r.byId.C12.summary, C.C12_SUMMARY);
  assert.equal(r.byId.C12.title, '使用了 FAQ 結構化資料');
  assert.equal(r.byId.C12.severity, 'INFO');
});

test('N11 G03 summary is the new copy verbatim with {tokens} (S04: GPTBot, ClaudeBot)', async () => {
  const r = await cached('s04', S.s04);
  assert.ok(r.ids.includes('G03'));
  const [pre, post] = splitTemplate(C.G03_SUMMARY, 'tokens');
  const s = r.byId.G03.summary;
  assert.ok(s.startsWith(pre), s);
  assert.ok(s.endsWith(post), s);
  const middle = s.slice(pre.length, s.length - post.length);
  for (const t of ['GPTBot', 'ClaudeBot']) assert.ok(middle.includes(t), t);
  assert.ok(s.includes('封鎖後，這些模型的內建知識可能較少提到貴公司；要不要開放是經營上的決定，不算問題。'));
  assert.ok(!s.includes('這是經營者的選擇'), 'old tail gone');
});

// ------------------------------------------------------------------ proxy User-Agent
test('N11 proxyFetch sends the new User-Agent verbatim (page and robots), and nothing else changed in the header set', async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : {}));
    calls.push({ url: typeof input === 'string' ? input : input.url, headers });
    return new Response('User-agent: *\nDisallow:\n', { status: 200, headers: { 'content-type': 'text/plain' } });
  };
  const resolveImpl = async () => ({ ok: true, addresses: ['93.184.216.34'] });
  for (const [url, kind] of [
    ['https://a.com/', 'page'],
    ['https://a.com/robots.txt', 'robots'],
  ]) {
    calls.length = 0;
    const { meta } = await proxyFetch(url, kind, 'a.com', { fetchImpl, resolveImpl, deadlineMs: 3000 });
    assert.equal(meta.error, null, kind);
    assert.equal(calls.length, 1, kind);
    assert.equal(calls[0].headers.get('user-agent'), C.USER_AGENT, kind + ': UA');
    assert.ok(!calls[0].headers.get('user-agent').includes('goldwatersmartlink.com.tw/)'), 'old UA gone');
    assert.deepEqual([...calls[0].headers.keys()].sort(), ['accept', 'accept-language', 'user-agent'], kind + ': header set unchanged');
  }
});

// ------------------------------------------------------------------ public/bot.html
test('N11 public/bot.html exists, is zh-Hant-TW, has no script, uses /styles.css and the favicon, with the exact <title>', async () => {
  const html = await readFile(BOT_HTML, 'utf8');
  assert.ok(!/<script/i.test(html), 'no <script');
  assert.ok(/<html[^>]*\slang="zh-Hant-TW"/i.test(html), 'lang zh-Hant-TW');
  assert.ok(/<link[^>]*rel="stylesheet"[^>]*href="\/styles\.css"/i.test(html) || /<link[^>]*href="\/styles\.css"[^>]*rel="stylesheet"/i.test(html), 'stylesheet /styles.css');
  assert.ok(/<link[^>]*rel="icon"[^>]*href="\/favicon\.svg"/i.test(html) || /<link[^>]*href="\/favicon\.svg"[^>]*rel="icon"/i.test(html), 'favicon link');
  assert.ok(html.includes(`<title>${C.BOT_PAGE_TITLE}</title>`), 'title verbatim');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
  assert.ok(!/javascript:/i.test(html));
});

test('N11 public/bot.html contains every §5.3 sentence verbatim, the robots.txt block, the UA, the contact links and an English summary', async () => {
  const html = await readFile(BOT_HTML, 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const text = doc.documentElement.textContent;
  for (const s of C.BOT_PAGE_SENTENCES) assert.ok(text.includes(s), 'sentence: ' + s);
  assert.ok(/User-agent:\s*KinsuiSEOCheck\s*\n?\s*Disallow:\s*\//.test(text), 'User-agent: KinsuiSEOCheck / Disallow: / block');
  const pre = [...doc.querySelectorAll('pre, code')].find((el) => el.textContent.includes('User-agent: KinsuiSEOCheck'));
  assert.ok(pre, 'the robots.txt snippet is in a code block');
  assert.ok(pre.textContent.includes('Disallow: /'));
  assert.ok(text.includes(C.USER_AGENT), 'User-Agent string shown verbatim');
  for (const href of C.BOT_PAGE_LINKS) {
    const a = [...doc.querySelectorAll('a')].find((x) => x.getAttribute('href') === href);
    assert.ok(a, 'link ' + href);
  }
  assert.ok(/purpose/i.test(text), 'English summary mentions purpose');
  assert.ok(/limit/i.test(text), 'English summary mentions limits');
  assert.ok(/block/i.test(text), 'English summary mentions how to block');
  assert.ok(text.includes('金水智連科技'));
  assert.ok(text.includes('KinsuiSEOCheck'));
});

test('N11 public/index.html links to /bot.html in the footer', async () => {
  const html = await readFile(INDEX_HTML, 'utf8');
  assert.ok(html.includes('href="/bot.html"'), 'href="/bot.html"');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const a = [...doc.querySelectorAll('a')].find((x) => x.getAttribute('href') === '/bot.html');
  assert.ok(a, '<a href="/bot.html">');
  assert.equal(a.textContent.trim(), '爬蟲說明');
  let inFooter = false;
  for (let n = a; n; n = n.parentNode) if (String(n.tagName || '').toLowerCase() === 'footer') inFooter = true;
  assert.ok(inFooter, 'the link is inside <footer>');
});

test('N11 the report adds <p class="muted"><a href="/bot.html">…</a></p> after the 檢查範圍與限制 list (both modes, S01 and S02)', async () => {
  for (const [name, b] of [['s01', S.s01], ['s02', S.s02]]) {
    const r = await cached(name, b);
    for (const detail of [false, true]) {
      const { doc, out, text } = reportOf(r, { detail, contactUrl: CONTACT });
      const label = `${name} detail=${detail}`;
      const a = [...doc.querySelectorAll('a')].find((x) => x.getAttribute('href') === '/bot.html');
      assert.ok(a, label + ': link to /bot.html');
      assert.equal(a.textContent.trim(), C.REPORT_BOT_LINK_TEXT, label + ': link text verbatim');
      const p = a.parentNode;
      assert.equal(String(p.tagName).toLowerCase(), 'p', label + ': inside <p>');
      assert.ok(String(p.getAttribute('class') || '').split(/\s+/).includes('muted'), label + ': p.muted');
      for (const s of SCOPE_LIMITS) assert.ok(text.includes(s), label + ': scope limit kept: ' + s);
      const lastLimit = Math.max(...SCOPE_LIMITS.map((s) => out.indexOf(s)));
      assert.ok(out.indexOf(C.REPORT_BOT_LINK_TEXT) > lastLimit, label + ': link comes after the four limits');
    }
  }
});
