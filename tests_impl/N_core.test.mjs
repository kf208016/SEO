import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';

import { runChecks } from '../public/core/checks.js';
import { extractPage } from '../public/core/parse.js';
import { explain, parseRobots, rulesFor } from '../public/core/robots.js';
import { computeScore } from '../public/core/score.js';
import { SOURCES } from '../public/core/sources.js';

const parser = new DOMParser();
const parseHtml = (source) => parser.parseFromString(source, 'text/html');

function pageInfo(overrides = {}) {
  return {
    title: '正常頁面',
    titleCount: 1,
    metaDescription: '正常摘要',
    metaRobots: [],
    metaBingbot: [],
    canonicals: ['https://a.com/'],
    canonicalTagCount: 1,
    hreflangs: [],
    h1: '服務介紹',
    headings: [{ level: 1, text: '服務介紹' }],
    lang: 'zh-TW',
    hasViewport: true,
    og: { title: '正常頁面', description: '正常摘要', image: 'https://a.com/image.jpg', url: 'https://a.com/' },
    jsonld: [{ ok: true, types: ['Organization'], error: null }],
    links: [],
    images: [],
    insecureResources: [],
    textLength: 500,
    textHash: '00000000',
    textPreview: '正常頁面內容',
    mainTextLength: 80,
    mainImageCount: 4,
    mainAltChars: 4,
    mainHasMedia: false,
    scriptCount: 0,
    scriptSrcCount: 0,
    hasSpaRoot: false,
    spaRootTextLength: null,
    dataNosnippetCount: 0,
    metaRefresh: null,
    limitsHit: [],
    ...overrides,
  };
}

function pageEntry(url = 'https://a.com/', overrides = {}) {
  return {
    url,
    finalUrl: url,
    status: 200,
    chain: [],
    stop: null,
    headers: {},
    error: null,
    accessBlocked: false,
    truncated: false,
    truncatedHeaders: false,
    isHtml: true,
    page: pageInfo({ canonicals: [url] }),
    duplicateOf: null,
    depth: 0,
    ...overrides,
  };
}

function snapshotWith(pages, overrides = {}) {
  const home = pages[0]?.finalUrl || 'https://a.com/';
  return {
    siteHost: 'a.com',
    origin: 'https://a.com',
    home,
    homeAnalyzable: true,
    pages,
    robots: { url: 'https://a.com/robots.txt', status: 404, policy: 'allow_all', parsed: null },
    robotsInitial: null,
    sitemaps: [],
    sitemapUrls: [],
    probes: {},
    discovered: {},
    coverage: { status: 'complete', reasons: [], defects: false },
    ...overrides,
  };
}

test('N01 Content-Signal is captured without changing robots rules and emits G12', () => {
  const source = [
    'Content-Signal: ai-train=no',
    'User-agent: *',
    'Content-Signal: search=yes, ai-train=no',
    'Allow: /',
  ].join('\n');
  const parsed = parseRobots(source);
  const baseline = parseRobots('User-agent: *\nAllow: /');

  assert.deepEqual(parsed.groups[0].rules, [{ allow: true, path: '/' }]);
  assert.deepEqual(parsed.contentSignals, [{
    agents: ['*'], search: 'yes', aiInput: null, aiTrain: 'no', raw: 'search=yes, ai-train=no',
  }]);
  assert.deepEqual(rulesFor(parsed, 'googlebot'), rulesFor(baseline, 'googlebot'));
  assert.deepEqual(explain(parsed, 'googlebot', '/x'), explain(baseline, 'googlebot', '/x'));

  const unknown = parseRobots('User-agent: A\nContent-Signal: foo=bar\nUser-agent: B\nDisallow: /x');
  assert.deepEqual(unknown.contentSignals, [{
    agents: ['a', 'b'], search: null, aiInput: null, aiTrain: null, raw: 'foo=bar',
  }]);

  const robots = {
    url: 'https://a.com/robots.txt', status: 200, policy: 'parse', parsed,
  };
  const findings = runChecks(snapshotWith([], {
    homeAnalyzable: false,
    robots,
    coverage: { status: 'failed', reasons: ['home_not_analyzable'], defects: true },
  }));
  const g12 = findings.find((finding) => finding.id === 'G12');
  assert.equal(g12?.severity, 'INFO');
  assert.equal(g12?.evidence, 'verified');
  assert.equal(g12?.count, 1);
  assert.deepEqual(g12?.data.signals, parsed.contentSignals);
  assert.match(g12?.summary || '', /search=yes, ai-train=no（適用 \*）/u);
  assert.equal(runChecks(snapshotWith([], { homeAnalyzable: false })).some((finding) => finding.id === 'G12'), false);

  const trainingRobots = parseRobots('User-agent: GPTBot\nDisallow: /\nUser-agent: *\nAllow: /');
  const g03 = runChecks(snapshotWith([], {
    homeAnalyzable: false,
    robots: { url: 'https://a.com/robots.txt', status: 200, policy: 'parse', parsed: trainingRobots },
  })).find((finding) => finding.id === 'G03');
  assert.equal(g03?.summary, 'robots.txt 對 GPTBot 宣告封鎖。這些控制的是 AI 模型訓練，不會封鎖另外列出的搜尋用爬蟲（例如 Googlebot、OAI-SearchBot）；其他後續用途本工具無法判斷。封鎖後，這些模型的內建知識可能較少提到貴公司；要不要開放是經營上的決定，不算問題。');

  assert.deepEqual(Object.fromEntries([
    'cloudflare-ai-default', 'content-signals', 'cloudflare-robots', 'google-hreflang', 'line-url-scheme',
  ].map((id) => [id, SOURCES[id]?.url])), {
    'cloudflare-ai-default': 'https://blog.cloudflare.com/content-independence-day-no-ai-crawl-without-compensation/',
    'content-signals': 'https://contentsignals.org/',
    'cloudflare-robots': 'https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/',
    'google-hreflang': 'https://developers.google.com/search/docs/specialty/international/localized-versions',
    'line-url-scheme': 'https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/',
  });
});

test('N03 extractPage returns headings, text preview, main-content metrics and media state', () => {
  const eligibleImages = '<img alt="甲"><img alt="乙乙"><img><img alt=" 丙 ">';
  const html = `<html><body><header><h1>第一標題</h1><h2>第二標題</h2><h3>第三標題</h3>${'頭'.repeat(500)}</header><main>${'文'.repeat(40)}${eligibleImages}<img width="16" height="16" alt="不計入"></main><footer>${'尾'.repeat(500)}</footer></body></html>`;
  const page = extractPage(parseHtml(html), 'https://a.com/');

  assert.deepEqual(page.headings, [
    { level: 1, text: '第一標題' },
    { level: 2, text: '第二標題' },
    { level: 3, text: '第三標題' },
  ]);
  assert.ok(Array.from(page.textPreview).length <= 300);
  assert.equal(page.mainTextLength, 40);
  assert.equal(page.mainImageCount, 4);
  assert.equal(page.mainAltChars, 4);
  assert.equal(page.mainHasMedia, false);

  const withVideo = extractPage(parseHtml(html.replace('</main>', '<video></video></main>')), 'https://a.com/');
  assert.equal(withVideo.mainHasMedia, true);

  const bodyFallback = extractPage(parseHtml(`<html><body><header>${'頭'.repeat(20)}</header><nav>選單</nav><section>${'本'.repeat(7)}</section><aside>側欄</aside><footer>頁尾</footer></body></html>`), 'https://a.com/');
  assert.equal(bodyFallback.mainTextLength, 7);
  const mediaInChrome = extractPage(parseHtml(`<html><body><main>${'本'.repeat(7)}<footer><iframe></iframe></footer></main></body></html>`), 'https://a.com/');
  assert.equal(mediaInChrome.mainTextLength, 7);
  assert.equal(mediaInChrome.mainHasMedia, true);
});

test('N04 C14 reports likely image-only pages and honors every exclusion', () => {
  const base = pageEntry();
  let findings = runChecks(snapshotWith([base]));
  const c14 = findings.find((finding) => finding.id === 'C14');
  assert.equal(c14?.severity, 'P3');
  assert.equal(c14?.evidence, 'inferred');
  assert.equal(c14?.count, 1);
  assert.equal(c14?.fix, '把圖片裡的重點（品名、規格、價格、服務說明）改成網頁文字；圖片保留並補上說明文字（alt）。');

  const excludedTitle = structuredClone(base);
  excludedTitle.page.title = '作品集';
  assert.equal(runChecks(snapshotWith([excludedTitle])).some((finding) => finding.id === 'C14'), false);

  const media = structuredClone(base);
  media.page.mainHasMedia = true;
  assert.equal(runChecks(snapshotWith([media])).some((finding) => finding.id === 'C14'), false);

  const enoughText = structuredClone(base);
  enoughText.page.mainTextLength = 150;
  assert.equal(runChecks(snapshotWith([enoughText])).some((finding) => finding.id === 'C14'), false);

  const shell = structuredClone(base);
  Object.assign(shell.page, { textLength: 100, scriptSrcCount: 1, hasSpaRoot: true, spaRootTextLength: 0 });
  findings = runChecks(snapshotWith([shell]));
  assert.equal(findings.some((finding) => finding.id === 'G06'), true);
  assert.equal(findings.some((finding) => finding.id === 'C14'), false);

  const faq = structuredClone(base);
  faq.page.jsonld = [{ ok: true, types: ['FAQPage'], error: null }];
  const c12 = runChecks(snapshotWith([faq])).find((finding) => finding.id === 'C12');
  assert.equal(c12?.summary, 'Google 自 2023 年 8 月起只對少數政府與健康類網站顯示 FAQ 複合式搜尋結果，並於 2026-05-07 全面停止顯示，2026 年 6 月移除相關文件。標記可以保留，但不會再有展開效果；問答內容本身對讀者仍有幫助。');
});

test('N10 robots 503 produces inferred P1 T02 with exact copy and an unavailable score', () => {
  const snapshot = snapshotWith([], {
    homeAnalyzable: false,
    robots: {
      url: 'https://a.com/robots.txt', status: 503, policy: 'disallow_all',
      error: null, accessBlocked: false, parsed: null,
    },
    coverage: { status: 'failed', reasons: ['robots_disallow_all'], defects: true },
  });
  const findings = runChecks(snapshot);
  const t02 = findings.find((finding) => finding.id === 'T02');
  assert.equal(t02?.severity, 'P1');
  assert.equal(t02?.evidence, 'inferred');
  assert.equal(t02?.summary, '本工具讀取 robots.txt 時伺服器回應 503。這可能是伺服器出錯，也可能是對不知名爬蟲的流量限制。若 Google 也收到相同回應，依 Google 文件，前 12 小時 Google 會暫停爬取整個網站，之後才改用先前的快取版本；請網站管理者查看伺服器紀錄，確認 Googlebot 收到的回應。');
  assert.equal(findings.filter((finding) => finding.section === 'tech' && finding.scored).length, 1);
  assert.equal(computeScore(findings, snapshot.coverage).score, null);
});

test('N13 hreflang parsing and T40-T42 validation follow the specified boundaries', () => {
  const parsed = extractPage(parseHtml('<head><link rel="ALTERNATE" hreflang="zh-TW" href="/"><link rel="alternate stylesheet" hreflang="en" href="/en/"></head>'), 'https://a.com/');
  assert.deepEqual(parsed.hreflangs, [
    { lang: 'zh-TW', href: 'https://a.com/' },
    { lang: 'en', href: 'https://a.com/en/' },
  ]);

  const home = pageEntry();
  home.page.hreflangs = [{ lang: 'xx-123-yy', href: 'https://a.com/' }];
  assert.equal(runChecks(snapshotWith([home])).some((finding) => finding.id === 'T40'), true);

  const valid = structuredClone(home);
  valid.page.hreflangs = [
    { lang: 'eu', href: 'https://a.com/' },
    { lang: 'x-default', href: 'https://a.com/' },
  ];
  const validIds = new Set(runChecks(snapshotWith([valid])).map((finding) => finding.id));
  assert.equal(validIds.has('T40'), false);
  assert.equal(validIds.has('T41'), false);

  const invalidHref = structuredClone(home);
  invalidHref.page.hreflangs = [{ lang: 'en', href: null }];
  assert.equal(runChecks(snapshotWith([invalidHref])).some((finding) => finding.id === 'T40'), true);

  const noSelf = structuredClone(home);
  noSelf.page.hreflangs = [{ lang: 'en', href: 'https://a.com/en/' }];
  assert.equal(runChecks(snapshotWith([noSelf])).some((finding) => finding.id === 'T41'), true);

  for (const status of [404, 410]) {
    const targetUrl = `https://a.com/missing-${status}`;
    const missingTarget = pageEntry(targetUrl, { status, isHtml: false, page: null });
    const pointsToMissing = structuredClone(home);
    pointsToMissing.page.hreflangs = [{ lang: 'en', href: targetUrl }];
    assert.equal(runChecks(snapshotWith([pointsToMissing, missingTarget])).some((finding) => finding.id === 'T40'), true);
  }

  const languageLink = structuredClone(home);
  languageLink.page.hreflangs = [];
  languageLink.page.links = [{ url: 'https://a.com/en/', rel: '', text: 'English' }];
  const t42 = runChecks(snapshotWith([languageLink])).find((finding) => finding.id === 'T42');
  assert.equal(t42?.severity, 'P3');
  assert.equal(t42?.evidence, 'inferred');

  const singleLanguage = structuredClone(home);
  singleLanguage.page.hreflangs = [];
  singleLanguage.page.links = [{ url: 'https://a.com/about', rel: '', text: '關於我們' }];
  const ids = new Set(runChecks(snapshotWith([singleLanguage])).map((finding) => finding.id));
  assert.equal(['T40', 'T41', 'T42'].some((id) => ids.has(id)), false);
  assert.equal(SOURCES['google-hreflang'].url, 'https://developers.google.com/search/docs/specialty/international/localized-versions');
});
