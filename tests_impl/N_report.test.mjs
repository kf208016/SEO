import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

import { buildLineSummary, lineMessageUrl, renderReport } from '../public/core/report.js';

const ZERO_COUNTS = Object.freeze({ P0: 0, P1: 0, P2: 0, P3: 0, INFO: 0 });

function score(scoreStatus = 'valid') {
  return {
    score: scoreStatus === 'unavailable' ? null : 95,
    raw: 95,
    grade: scoreStatus === 'unavailable' ? 'gray' : 'green',
    capped: false,
    scoreStatus,
    counts: ZERO_COUNTS,
  };
}

function homePage(overrides = {}) {
  return {
    url: 'https://a.com/',
    finalUrl: 'https://a.com/',
    status: 200,
    isHtml: true,
    error: null,
    stop: null,
    bucket: 'home',
    page: {
      title: '首頁',
      headings: [
        { level: 1, text: '主要標題' },
        ...Array.from({ length: 34 }, (_, index) => ({ level: index % 2 ? 2 : 3, text: `標題 ${index + 2}` })),
      ],
      textPreview: '首頁產品與服務說明',
      textLength: 301,
      ...overrides,
    },
  };
}

function snapshot(overrides = {}) {
  const home = homePage();
  return {
    siteHost: 'a.com',
    startUrl: 'https://a.com/',
    home: 'https://a.com/',
    scannedAt: '2026-10-18T12:00:00+08:00',
    homeAnalyzable: true,
    pages: [home],
    limits: { crawled: 1 },
    coverage: { status: 'complete', reasons: [], defects: false },
    discovered: {},
    sitemaps: [],
    ...overrides,
  };
}

function documentFor(markup) {
  return parseHTML(`<!doctype html><html><body>${markup}</body></html>`).document;
}

test('N02 GEO 表使用宣告邊界、Cloudflare 說明與無綠勾狀態文案', () => {
  const markup = renderReport(snapshot(), [], score(), [
    { category: 'search_engine', token: 'Googlebot', company: 'Google', status: 'declared_allowed', blockedUrls: [], purpose: '搜尋' },
    { category: 'ai_search', token: 'OAI-SearchBot', company: 'OpenAI', status: 'declared_disallowed', blockedUrls: ['/'], purpose: 'AI 搜尋' },
  ]);
  assert.match(markup, /robots\.txt 對各爬蟲的宣告（不代表防火牆的實際放行）/u);
  assert.match(markup, /這張表只反映 robots\.txt 的宣告，不代表爬蟲實際進得來。/u);
  assert.match(markup, /Cloudflare 自 2025 年 7 月起，新加入的網域預設封鎖已知的 AI 爬蟲/u);
  assert.match(markup, /首頁的 robots\.txt 宣告/u);
  assert.match(markup, /robots\.txt 未禁止/u);
  assert.match(markup, /⛔ robots\.txt 禁止/u);
  assert.match(markup, /content-independence-day-no-ai-crawl-without-compensation/u);
  assert.doesNotMatch(markup, /✅|規則允許|robots\.txt 對各爬蟲的規則/u);
});

test('N05 文字預覽只在首頁可分析時出現，簡易與完整模式分別限制 10／30 筆標題', () => {
  const simple = documentFor(renderReport(snapshot(), [], score(), []));
  assert.match(simple.body.textContent, /爬蟲在首頁讀到的文字（未執行 JavaScript）/u);
  assert.match(simple.body.textContent, /已驗證・不計分/u);
  assert.match(simple.body.textContent, /以下是首頁原始 HTML 裡的標題與前 300 字可見文字。/u);
  assert.equal(simple.querySelectorAll('.heading-outline li').length, 10);
  assert.equal(simple.querySelector('.text-preview').textContent, '首頁產品與服務說明…');

  const detailed = documentFor(renderReport(snapshot(), [], score(), [], { detail: true }));
  assert.equal(detailed.querySelectorAll('.heading-outline li').length, 30);

  const empty = documentFor(renderReport(snapshot({ pages: [homePage({ headings: [], textPreview: '', textLength: 0 })] }), [], score(), []));
  assert.match(empty.body.textContent, /（原始 HTML 裡沒有 H1–H3 標題）/u);
  assert.match(empty.body.textContent, /（原始 HTML 裡沒有可見文字）/u);

  const unavailable = renderReport(snapshot({ homeAnalyzable: false }), [], score('unavailable'), []);
  assert.doesNotMatch(unavailable, /爬蟲在首頁讀到的文字/u);
});

test('N06 三種評分狀態都顯示技術健康分數與五項未檢查清單', () => {
  const expected = [
    '關鍵字與買家搜尋需求是否對應',
    '外部連結與品牌被提及的情況',
    '網頁速度（Core Web Vitals）',
    '防火牆或 CDN 對各家爬蟲的實際放行',
    'Search Console 的收錄與成效資料',
  ];
  for (const status of ['valid', 'sample_only', 'unavailable']) {
    const doc = documentFor(renderReport(snapshot({ coverage: status === 'unavailable'
      ? { status: 'failed', reasons: ['home_unavailable'], defects: true }
      : snapshot().coverage }), [], score(status), []));
    assert.match(doc.body.textContent, /技術健康分數/u);
    assert.match(doc.body.textContent, /本工具沒有檢查的項目/u);
    assert.match(doc.body.textContent, /只代表本次讀到的頁面在技術上讓搜尋引擎讀得到、讀得懂；不是排名分數，也不代表會被 AI 引用。/u);
    assert.deepEqual([...doc.querySelectorAll('.unchecked-card li')].map(node => node.textContent.trim()), expected);
    assert.doesNotMatch(doc.body.textContent, /0\/5|0 分/u);
    if (status === 'valid') assert.doesNotMatch(doc.body.textContent, /樣本分數/u);
    if (status === 'sample_only') assert.match(doc.body.textContent, /樣本分數：本次只檢查部分頁面/u);
    if (status === 'unavailable') assert.match(doc.body.textContent, /無法評分.*首頁暫時無法使用/su);
  }
});

test('N06 分數與證據區樣式提供雙欄、手機堆疊、文字預覽與列印規則', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.score-row\{display:grid;grid-template-columns:1fr 1fr;gap:24px\}/u);
  assert.match(css, /@media\(max-width:700px\)\{[^}]*[\s\S]*?\.score-row\{grid-template-columns:1fr\}/u);
  assert.match(css, /\.text-preview\{[^}]*background:var\(--wash\)/u);
  assert.match(css, /\.qr svg\{max-width:220px;height:auto\}/u);
  assert.match(css, /\.line-summary\{[^}]*white-space:pre-wrap/u);
  assert.match(css, /@media print\{[^]*\.copy-summary[^]*display:none!important/u);
});

test('N07 buildLineSummary 與 lineMessageUrl 依狀態、嚴重度及 120 字上限輸出', () => {
  const findings = [
    { id: 'C02', severity: 'P2', scored: true },
    { id: 'C04', severity: 'P3', scored: true },
    { id: 'G05', severity: 'P2', scored: true },
    { id: 'C10', severity: 'INFO', scored: false },
  ];
  assert.equal(buildLineSummary(snapshot(), findings, score()), 'SEO健檢 a.com 技術健康分數95 待處理:C02,G05,C04');
  assert.equal(buildLineSummary(snapshot(), findings, score('sample_only')), 'SEO健檢 a.com 技術健康分數95(樣本) 待處理:C02,G05,C04');
  assert.equal(buildLineSummary(snapshot(), [], score()), 'SEO健檢 a.com 技術健康分數95 無計分問題');
  assert.equal(buildLineSummary(snapshot({ coverage: { status: 'failed', reasons: ['blocked_by_site'], defects: true } }), findings, score('unavailable')), 'SEO健檢 a.com 無法評分 原因:blocked_by_site');
  assert.ok(Array.from(buildLineSummary(snapshot({ siteHost: '長'.repeat(200) }), findings, score())).length <= 120);
  assert.equal(lineMessageUrl('@760zrres', 'x y'), 'https://line.me/R/oaMessage/%40760zrres/?x%20y');
  assert.equal(lineMessageUrl(' @id ', ''), 'https://line.me/R/oaMessage/%20%40id%20/?');
});

test('N09 LINE CTA 依行動裝置、桌面、設定有效性與 contact 狀態切換', async () => {
  const contactUrl = 'https://lin.ee/8xXGMUU';
  const mobileMarkup = renderReport(snapshot(), [], score(), [], { lineId: '@760zrres', mobile: true, contactUrl });
  assert.match(mobileMarkup, /href="https:\/\/line\.me\/R\/oaMessage\/%40760zrres\/\?[^"\r\n]+"/);
  assert.match(mobileMarkup, /加入 LINE 官方帳號諮詢（自動帶入檢查摘要）/u);
  assert.match(mobileMarkup, /送出後我們會收到：/u);
  assert.doesNotMatch(mobileMarkup, /<svg/u);

  const desktopMarkup = renderReport(snapshot(), [], score(), [], { lineId: '@760zrres', mobile: false, contactUrl });
  assert.match(desktopMarkup, /<svg/u);
  assert.match(desktopMarkup, /<pre class="line-summary">/u);
  assert.match(desktopMarkup, /data-copy="summary"/u);
  assert.match(desktopMarkup, /複製摘要/u);
  assert.match(desktopMarkup, /加入 LINE 官方帳號諮詢/u);

  for (const lineId of ['', 'javascript:x', '760zrres']) {
    const invalid = renderReport(snapshot(), [], score(), [], { lineId, mobile: false, contactUrl });
    assert.doesNotMatch(invalid, /oaMessage|<svg/u);
    assert.match(invalid, /加入 LINE 官方帳號諮詢/u);
  }
  const lineOnlyDesktop = renderReport(snapshot(), [], score(), [], { lineId: '@760zrres', mobile: false });
  assert.match(lineOnlyDesktop, /<svg|class="line-summary"/u);
  assert.doesNotMatch(lineOnlyDesktop, new RegExp(contactUrl.replaceAll('/', '\\/'), 'u'));
  const lineOnlyMobile = renderReport(snapshot(), [], score(), [], { lineId: '@760zrres', mobile: true });
  assert.match(lineOnlyMobile, /oaMessage/u);
  const none = documentFor(renderReport(snapshot(), [], score(), [], { lineId: '', contactUrl: null }));
  assert.equal(none.querySelector('.cta'), null);
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /output\.addEventListener\('click'/u);
  assert.match(appSource, /navigator\.clipboard\.writeText\(summary\)/u);
  assert.match(appSource, /button\.textContent='已複製'/u);
  assert.match(appSource, /無法複製，請手動選取文字/u);
  assert.match(appSource, /setTimeout\([^]*2000\)/u);
});

test('N11 bot 靜態頁、首頁與報告都有爬蟲說明連結及逐字揭露', async () => {
  const [botPage, indexPage] = await Promise.all([
    readFile(new URL('../public/bot.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  ]);
  const required = [
    'KinsuiSEOCheck 是金水智連科技「SEO／GEO 網站健檢（線上簡易版）」使用的讀取程式。',
    '只有在真人於本站輸入網址並通過人機驗證後，才會讀取該網站；不會定期掃描任何網站。',
    '每次檢查最多讀取：robots.txt 8 次、sitemap 4 次、網頁 15 頁（含轉址最多 30 次請求）、探測 2 次；兩次請求至少間隔 200 毫秒；單次回應最多讀取 2 MB。',
    '本程式遵守 robots.txt；不希望被讀取時，請加入：',
    '本程式從 Cloudflare Workers 發出請求，沒有固定 IP 位址。',
    'Mozilla/5.0 (compatible; KinsuiSEOCheck/1.0; +https://seo-geo-check.fanyuchieh.workers.dev/bot.html)',
    'https://lin.ee/8xXGMUU',
    'https://goldwatersmartlink.com.tw/',
  ];
  for (const copy of required) assert.ok(botPage.includes(copy), copy);
  assert.match(botPage, /User-agent: KinsuiSEOCheck\s+Disallow: \//u);
  assert.doesNotMatch(botPage, /<script/iu);
  assert.match(indexPage, /href="\/bot\.html"/u);
  assert.match(renderReport(snapshot(), [], score(), []), /href="\/bot\.html"/u);
});

test('N12 完整報告的已檢查頁面表顯示類型欄與 bucket 中文標籤', () => {
  const pages = [
    homePage(),
    { ...homePage(), url: 'https://a.com/start', finalUrl: 'https://a.com/start', bucket: 'start' },
    { ...homePage(), url: 'https://a.com/product', finalUrl: 'https://a.com/product', bucket: 'product' },
    { ...homePage(), url: 'https://a.com/blog', finalUrl: 'https://a.com/blog', bucket: 'content' },
    { ...homePage(), url: 'https://a.com/about', finalUrl: 'https://a.com/about', bucket: 'trust' },
    { ...homePage(), url: 'https://a.com/other', finalUrl: 'https://a.com/other', bucket: 'other' },
    { ...homePage(), url: 'https://a.com/privacy', finalUrl: 'https://a.com/privacy', bucket: 'excluded' },
  ];
  const markup = renderReport(snapshot({ pages, limits: { crawled: pages.length } }), [], score(), [], { detail: true });
  assert.match(markup, /<th>類型<\/th>/u);
  for (const label of ['首頁', '起始網址', '產品／服務', '內容／分類', '關於／聯絡', '其他', '低價值']) assert.match(markup, new RegExp(label, 'u'));
});

test('N15 LINE 摘要與 QR 在惡意 siteHost 下維持文字跳脫與安全屬性', () => {
  const malicious = '\"><svg onload=alert(1)>';
  const markup = renderReport(snapshot({ siteHost: malicious }), [], score(), [], { lineId: '@760zrres', mobile: false });
  const document = documentFor(markup);
  assert.equal(document.querySelectorAll('script,style').length, 0);
  assert.equal([...document.querySelectorAll('*')].some(element => [...element.attributes].some(attribute => /^on/i.test(attribute.name))), false);
  assert.equal([...document.querySelectorAll('[href]')].some(element => /^javascript:/i.test(element.getAttribute('href'))), false);
  assert.match(document.querySelector('.line-summary').textContent, /<svg onload=alert\(1\)>/u);
  const pathData = document.querySelector('.qr path')?.getAttribute('d') || '';
  assert.match(pathData, /^[MmHhVvZz0-9 .-]+$/u);
});
