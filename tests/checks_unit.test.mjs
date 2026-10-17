// SPEC-001 §5.5 bots.js, §5.6 sources.js, §6 checks.js helpers, §3 url.js, version.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { headerDirectives, isNoindex, analyzable, isIndexable } from '../public/core/checks.js';
import { extractPage } from '../public/core/parse.js';
import { BOTS, OUR_TOKEN } from '../public/core/bots.js';
import { SOURCES } from '../public/core/sources.js';
import { VERSION } from '../public/core/version.js';
import { normalizeInputUrl, stripWww, cleanUrl, pathAndQuery, isSameSite, stripQuery, REDIRECT_STATUSES } from '../public/core/url.js';

const norm = (arr) => (arr || []).map((d) => String(d).replace(/\s+/g, '').toLowerCase());

function entry({ html = '<!doctype html><html><head><title>t</title></head><body>x</body></html>', url = 'https://a.com/p', status = 200, xrt = null, ct = 'text/html; charset=utf-8', error = null, accessBlocked = false, duplicateOf = null, isHtml = true, page } = {}) {
  const pageInfo = page === undefined ? extractPage(new DOMParser().parseFromString(html, 'text/html'), url) : page;
  return {
    url,
    finalUrl: url,
    status,
    chain: [],
    stop: null,
    headers: { 'content-type': ct, 'x-robots-tag': xrt, 'content-length': null, 'cf-mitigated': null },
    error,
    accessBlocked,
    truncated: false,
    truncatedHeaders: false,
    isHtml,
    page: pageInfo,
    duplicateOf,
    depth: 1,
  };
}

// ------------------------------------------------------------------ headerDirectives
test('headerDirectives: unprefixed directives apply to every crawler', () => {
  const d = norm(headerDirectives('noindex, nofollow', 'googlebot'));
  assert.ok(d.includes('noindex'));
  assert.ok(d.includes('nofollow'));
});

test('headerDirectives: "ua:" prefix switches the crawler for following directives', () => {
  const g = norm(headerDirectives('googlebot: noindex, nofollow', 'googlebot'));
  assert.ok(g.includes('noindex'));
  assert.ok(g.includes('nofollow'));
  const other = norm(headerDirectives('bingbot: noindex, nofollow', 'googlebot'));
  assert.ok(!other.includes('noindex'));
  assert.ok(!other.includes('nofollow'));
  const mixed = norm(headerDirectives('nosnippet, bingbot: noindex', 'googlebot'));
  assert.ok(mixed.includes('nosnippet'));
  assert.ok(!mixed.includes('noindex'));
  const back = norm(headerDirectives('bingbot: noindex, googlebot: nofollow', 'bingbot'));
  assert.ok(back.includes('noindex'));
  assert.ok(!back.includes('nofollow'));
});

test('headerDirectives: max-snippet / max-image-preview / max-video-preview / unavailable_after are not crawler prefixes', () => {
  assert.ok(norm(headerDirectives('max-snippet: 0', 'googlebot')).includes('max-snippet:0'));
  assert.ok(norm(headerDirectives('max-image-preview: none', 'googlebot')).includes('max-image-preview:none'));
  assert.ok(norm(headerDirectives('max-video-preview: -1', 'googlebot')).includes('max-video-preview:-1'));
  assert.ok(norm(headerDirectives('unavailable_after: 2026-12-31', 'googlebot')).some((x) => x.startsWith('unavailable_after:')));
  // a prefix of another crawler still hides it
  assert.ok(!norm(headerDirectives('bingbot: max-snippet: 0', 'googlebot')).includes('max-snippet:0'));
});

// ------------------------------------------------------------------ isNoindex / analyzable / isIndexable
test('isNoindex: meta robots / googlebot noindex or none; X-Robots-Tag for * or googlebot', () => {
  assert.equal(isNoindex(entry()), false);
  assert.equal(isNoindex(entry({ html: '<!doctype html><html><head><meta name="robots" content="noindex"></head><body></body></html>' })), true);
  assert.equal(isNoindex(entry({ html: '<!doctype html><html><head><meta name="googlebot" content="none"></head><body></body></html>' })), true);
  assert.equal(isNoindex(entry({ xrt: 'noindex' })), true);
  assert.equal(isNoindex(entry({ xrt: 'none' })), true);
  assert.equal(isNoindex(entry({ xrt: 'googlebot: noindex' })), true);
  assert.equal(isNoindex(entry({ xrt: 'bingbot: noindex' })), false);
  assert.equal(isNoindex(entry({ xrt: 'nofollow' })), false);
});

test('analyzable = status 200 && isHtml && page && !error && !accessBlocked', () => {
  assert.equal(analyzable(entry()), true);
  assert.equal(analyzable(entry({ status: 404 })), false);
  assert.equal(analyzable(entry({ isHtml: false })), false);
  assert.equal(analyzable(entry({ page: null })), false);
  assert.equal(analyzable(entry({ error: 'timeout' })), false);
  assert.equal(analyzable(entry({ accessBlocked: true })), false);
});

test('isIndexable = analyzable && !isNoindex && !duplicateOf', () => {
  assert.equal(isIndexable(entry()), true);
  assert.equal(isIndexable(entry({ xrt: 'noindex' })), false);
  assert.equal(isIndexable(entry({ duplicateOf: 'https://a.com/' })), false);
  assert.equal(isIndexable(entry({ status: 503 })), false);
});

// ------------------------------------------------------------------ bots.js
const EXPECTED_BOTS = [
  ['Googlebot', 'Google', 'search_engine', 'Google 搜尋，包含 AI 摘要（AI Overviews）與 AI 模式', 'google-crawlers'],
  ['Bingbot', 'Microsoft', 'search_engine', 'Bing 搜尋；Microsoft Copilot 的網頁答案也使用 Bing 的資料', 'bing-chat-controls'],
  ['OAI-SearchBot', 'OpenAI', 'ai_search', 'ChatGPT 搜尋的索引；封鎖後不會出現在 ChatGPT 搜尋答案中', 'openai-bots'],
  ['Claude-SearchBot', 'Anthropic', 'ai_search', '提升 Claude 搜尋結果；封鎖可能降低在 Claude 搜尋回答中的能見度', 'anthropic-bots'],
  ['PerplexityBot', 'Perplexity', 'ai_search', '在 Perplexity 搜尋結果中顯示並連結網站', 'perplexity-bots'],
  ['Applebot', 'Apple', 'ai_search', 'Spotlight、Siri、Safari 的搜尋功能', 'apple-bots'],
  ['GPTBot', 'OpenAI', 'training', '可能用於訓練 OpenAI 模型；與 ChatGPT 搜尋無關', 'openai-bots'],
  ['ClaudeBot', 'Anthropic', 'training', '可能用於訓練 Anthropic 模型', 'anthropic-bots'],
  ['Google-Extended', 'Google', 'training', '控制 Gemini 模型訓練與部分 grounding；不影響 Google 搜尋收錄與排名', 'google-crawlers'],
  ['Applebot-Extended', 'Apple', 'training', '控制 Apple 生成式模型訓練；不影響 Apple 搜尋', 'apple-bots'],
  ['CCBot', 'Common Crawl', 'training', 'Common Crawl 公開網頁資料集，是許多 AI 模型的訓練資料來源之一', 'ccbot'],
  ['ChatGPT-User', 'OpenAI', 'user_fetch', '使用者在 ChatGPT 要求讀取網頁時使用；官方表示 robots.txt 不一定適用', 'openai-bots'],
  ['Claude-User', 'Anthropic', 'user_fetch', '使用者在 Claude 要求讀取網頁時使用；封鎖可能降低使用者導向搜尋的能見度', 'anthropic-bots'],
  ['Perplexity-User', 'Perplexity', 'user_fetch', '使用者提問時即時讀取；官方表示通常不遵守 robots.txt', 'perplexity-bots'],
];

test('BOTS table: order and every field verbatim; OUR_TOKEN', () => {
  assert.equal(OUR_TOKEN, 'kinsuiseocheck');
  assert.equal(BOTS.length, EXPECTED_BOTS.length);
  BOTS.forEach((b, i) => {
    const [token, company, category, purpose, source] = EXPECTED_BOTS[i];
    assert.deepEqual({ token: b.token, company: b.company, category: b.category, purpose: b.purpose, source: b.source }, { token, company, category, purpose, source });
  });
});

// ------------------------------------------------------------------ sources.js
const EXPECTED_SOURCES = {
  'google-robots': ['Google：robots.txt 的解讀方式', 'https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt'],
  rfc9309: ['RFC 9309 Robots Exclusion Protocol', 'https://www.rfc-editor.org/rfc/rfc9309'],
  'google-noindex': ['Google：使用 noindex 封鎖索引', 'https://developers.google.com/search/docs/crawling-indexing/block-indexing'],
  'google-canonical': ['Google：整合重複網址', 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls'],
  'google-title': ['Google：搜尋結果標題連結', 'https://developers.google.com/search/docs/appearance/title-link'],
  'google-snippet': ['Google：搜尋結果摘要', 'https://developers.google.com/search/docs/appearance/snippet'],
  'google-ai-features': ['Google：AI 功能與你的網站', 'https://developers.google.com/search/docs/appearance/ai-features'],
  'google-ai-guide': ['Google：為生成式 AI 搜尋最佳化網站', 'https://developers.google.com/search/docs/fundamentals/ai-optimization-guide'],
  'google-crawlers': ['Google：常見爬蟲與 Google-Extended', 'https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers'],
  'google-sitemaps': ['Google：建立 sitemap', 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap'],
  'google-js-seo': ['Google：JavaScript SEO 基礎', 'https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics'],
  'google-http-errors': ['Google：HTTP 狀態碼與軟 404', 'https://developers.google.com/search/docs/crawling-indexing/http-network-errors'],
  'google-sd-policies': ['Google：結構化資料一般規範', 'https://developers.google.com/search/docs/appearance/structured-data/sd-policies'],
  'google-updates': ['Google Search Central 文件更新紀錄', 'https://developers.google.com/search/updates'],
  'google-mobile': ['Google：行動版優先索引', 'https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing'],
  'google-starter': ['Google：SEO 入門指南', 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide'],
  'google-helpful': ['Google：建立實用、可信、以人為本的內容', 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content'],
  'openai-bots': ['OpenAI：爬蟲說明', 'https://developers.openai.com/api/docs/bots'],
  'anthropic-bots': ['Anthropic：Claude 的網路爬蟲', 'https://support.claude.com/en/articles/8896518'],
  'perplexity-bots': ['Perplexity：爬蟲說明', 'https://docs.perplexity.ai/guides/bots'],
  'apple-bots': ['Apple：關於 Applebot', 'https://support.apple.com/en-us/119829'],
  ccbot: ['Common Crawl：CCBot', 'https://commoncrawl.org/ccbot'],
  'bing-chat-controls': ['Bing：網站管理員控制 Bing Chat 使用內容的選項', 'https://blogs.bing.com/webmaster/september-2023/Announcing-new-options-for-webmasters-to-control-usage-of-their-content-in-Bing-Chat'],
};

test('SOURCES: every id with exact title and url', () => {
  assert.deepEqual(Object.keys(SOURCES).sort(), Object.keys(EXPECTED_SOURCES).sort());
  for (const [id, [title, url]] of Object.entries(EXPECTED_SOURCES)) {
    assert.equal(SOURCES[id].title, title, id);
    assert.equal(SOURCES[id].url, url, id);
  }
  for (const b of BOTS) assert.ok(SOURCES[b.source], 'BOTS source exists: ' + b.source);
});

test('VERSION is 1.8.0', () => {
  assert.equal(VERSION, '1.8.0');
});

// ------------------------------------------------------------------ url.js
test('url.js: normalizeInputUrl', () => {
  assert.equal(normalizeInputUrl('  example.com '), 'https://example.com/');
  assert.equal(normalizeInputUrl('http://a.com/x#y'), 'http://a.com/x');
  assert.equal(normalizeInputUrl('https://a.com./p?q=1'), 'https://a.com/p?q=1');
  assert.equal(normalizeInputUrl('ftp://a.com/'), null);
  assert.equal(normalizeInputUrl('https://'), null);
  assert.equal(normalizeInputUrl('a.com/path/'), 'https://a.com/path/');
});

test('url.js: stripWww, cleanUrl, pathAndQuery, isSameSite, stripQuery, REDIRECT_STATUSES', () => {
  assert.equal(stripWww('WWW.A.com'), 'a.com');
  assert.equal(stripWww('a.com'), 'a.com');
  assert.equal(stripWww('wwwa.com'), 'wwwa.com');
  assert.equal(cleanUrl('/x?y=1#frag', 'https://a.com/dir/'), 'https://a.com/x?y=1');
  assert.equal(cleanUrl('rel', 'https://a.com/dir/'), 'https://a.com/dir/rel');
  assert.equal(cleanUrl('mailto:a@b.com', 'https://a.com/'), null);
  assert.equal(cleanUrl('javascript:alert(1)', 'https://a.com/'), null);
  assert.equal(cleanUrl('http://[bad', 'https://a.com/'), null);
  assert.equal(pathAndQuery('https://a.com/p/q?x=1'), '/p/q?x=1');
  assert.equal(isSameSite('https://www.a.com/x', 'a.com'), true);
  assert.equal(isSameSite('https://b.a.com/x', 'a.com'), false);
  assert.equal(stripQuery('https://a.com/p?q=1#h'), 'https://a.com/p');
  assert.deepEqual(REDIRECT_STATUSES, [301, 302, 303, 307, 308]);
});

// ------------------------------------------------------------------ v1.5 A4: %hh upper-cased (not decoded)
test('A4 cleanUrl / normalizeInputUrl upper-case %hh in pathname and search without decoding', () => {
  assert.equal(cleanUrl('/%e6%9c%8d?q=%e6%9c%8d&x=%2f#%ab', 'https://a.com/'), 'https://a.com/%E6%9C%8D?q=%E6%9C%8D&x=%2F');
  assert.equal(cleanUrl('https://a.com/%e6%9c%8d', 'https://a.com/'), cleanUrl('https://a.com/%E6%9C%8D', 'https://a.com/'));
  assert.equal(cleanUrl('https://a.com/%7e%41%2a', 'https://a.com/'), 'https://a.com/%7E%41%2A');
  assert.equal(normalizeInputUrl('a.com/%e6%9c%8d?x=%ab#%cd'), 'https://a.com/%E6%9C%8D?x=%AB');
  assert.equal(normalizeInputUrl('https://a.com/%7e'), 'https://a.com/%7E');
  // text outside %hh keeps its case
  assert.equal(cleanUrl('/Path/abc?Q=v', 'https://a.com/'), 'https://a.com/Path/abc?Q=v');
});
