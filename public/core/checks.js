import { BOTS } from './bots.js';
import { explain, isAllowed } from './robots.js';
import { normText } from './parse.js';
import { cleanUrl, pathAndQuery, stripWww } from './url.js';

const BAD_STATUSES = new Set([404, 410, 500, 501, 502, 504]);
const REDIRECT_RELATED_STOPS = new Set(['offsite', 'bad_redirect', 'loop', 'max_hops', 'location_too_long']);
const SEVERITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3, INFO: 4 };
const HREFLANG_PATTERN = /^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?$/u;
const LANGUAGE_LINK_TEXT = new Set([
  'en', 'english', '日本語', '简体', '簡體', '简体中文', '繁體', '繁體中文', '中文', '한국어',
  'tiếng việt', 'ภาษาไทย', 'bahasa indonesia', 'español', 'deutsch', 'français', 'русский', 'العربية',
  '日文', '英文', '韓文', '越南文', '泰文',
]);
const LANGUAGE_PATH_SEGMENTS = new Set([
  'en', 'en-us', 'en-gb', 'jp', 'ja', 'cn', 'zh-cn', 'zh-hans', 'zh-hant', 'zh-tw', 'zh-hk',
  'kr', 'ko', 'th', 'vi', 'de', 'fr', 'es', 'ru', 'id', 'ms',
]);
const IMAGE_ONLY_EXCLUSION = /gallery|portfolio|album|photos?|works|作品|相簿|實績|型錄|圖庫|案例|照片|花絮/iu;
const BLOCKED_BY_SITE_COPY = '這個網站的伺服器拒絕了本工具讀取（HTTP 401／403 或人機驗證）。很多網站只允許 Google 等知名爬蟲與一般瀏覽器，這不代表 Google 也被擋。本工具不會偽裝身分繞過，所以這次無法檢查；需要完整健檢，歡迎透過 LINE 官方帳號聯絡我們。';
const GENERIC = Object.freeze({
  T01: ['首頁無法正常讀取', '首頁回應錯誤或陷入轉址循環。'],
  T05: ['多個頁面設定 noindex', '本次樣本中有一半以上的內頁禁止收錄。'],
  T06: ['部分頁面設定 noindex', '本次樣本中有內頁禁止收錄。'],
  T07: ['noindex 頁面同時被 robots.txt 封鎖', '搜尋引擎可能無法讀取頁面的 noindex 設定。'],
  T08: ['網站未使用 HTTPS', '首頁仍以未加密的 HTTP 提供。'],
  T09: ['HTTP 網址沒有轉向 HTTPS', 'HTTP 版本仍回應成功頁面。'],
  T12: ['站內連結指向錯誤頁面', '本次抓取的站內連結中有失效網址。'],
  T13: ['部分頁面無法驗證', '部分頁面讀取失敗、被阻擋或暫時無法存取。'],
  T14: ['轉址鏈過長或異常', '部分內頁經過多次轉址或陷入轉址異常。'],
  T15: ['同一頁有多個 canonical', '頁面宣告了多個不同的 canonical 網址。'],
  T16: ['canonical 指向其他網站', '頁面的 canonical 指向不同網域。'],
  T17: ['canonical 指向異常頁面', 'canonical 指向本次檢查中不可正常收錄的頁面。'],
  T19: ['robots.txt 宣告的 sitemap 有問題', 'robots.txt 宣告的 sitemap 不是有效的 sitemap。'],
  T20: ['sitemap 包含異常網址', 'sitemap 中部分已抽查網址不適合收錄（僅限本次已抓的樣本）。'],
  T21: ['sitemap 含其他網站網址', 'sitemap 中出現非本站網址，未進一步讀取。'],
  T23: ['缺少行動裝置 viewport', '頁面沒有 viewport 設定。'],
  T24: ['缺少網頁語言', '頁面沒有宣告 lang。'],
  T28: ['首頁轉向其他網站', '首頁轉址到不同網域，本次停止檢查。'],
  T29: ['首頁狀態無法驗證', '本次無法完成首頁檢查。'],
  T30: ['缺少 canonical', '頁面沒有 canonical 標記。'],
  T31: ['canonical 使用 HTTP', 'HTTPS 頁面的 canonical 指向 HTTP。'],
  T33: ['頁面使用 meta refresh', '頁面以 meta refresh 重新導向。'],
  T34: ['HTTPS 頁面載入不安全資源', '頁面包含 HTTP script、stylesheet 或 iframe。'],
  T35: ['頁面要求搜尋引擎不要追蹤連結', '頁面設定了 nofollow。'],
  T36: ['頁面有多個 title', '同一頁出現多個 title 標籤。'],
  T37: ['sitemap 無法驗證', 'sitemap 未能可靠讀取或解析。'],
  T38: ['canonical 網址無效', '頁面有 canonical 標籤，但網址無法解析。'],
  T39: ['robots.txt 內容被截斷', 'robots.txt 超過 500 KiB；Google 也只讀前 500 KiB。'],
  T40: ['hreflang 標記有誤', '頁面的 hreflang 使用了無效的語言／地區代碼、無效網址，或指向不存在的頁面。'],
  T41: ['hreflang 沒有列出頁面自己', '依 Google 文件，每個語言版本都要列出自己與所有其他版本，否則整組標記可能被忽略。'],
  T42: ['網站似乎有多語言版本，但沒有 hreflang', '首頁有語系切換連結，卻沒有 hreflang 標記。hreflang 可以幫 Google 在不同語言或地區的搜尋結果中選對版本；單一語言的網站不需要。'],
  C01: ['頁面缺少標題', '可收錄頁面沒有 title。'],
  C02: ['多個頁面使用相同標題', '不同 canonical 的頁面使用相同 title。'],
  C03: ['頁面標題過於籠統', '頁面使用常見預設標題。'],
  C04: ['頁面缺少摘要', '可收錄頁面沒有 meta description。'],
  C05: ['多個頁面使用相同摘要', '不同 canonical 的頁面使用相同 meta description。'],
  C06: ['頁面缺少 H1', '可收錄頁面沒有 H1。'],
  C09: ['圖片缺少替代文字', '部分圖片沒有 alt 屬性。'],
  C10: ['Open Graph 資訊不完整', '頁面缺少 og:title 或 og:image。'],
  C11: ['JSON-LD 語法無法解析', '頁面包含無法解析的 JSON-LD。'],
  C12: ['使用了 FAQ 結構化資料', 'Google 自 2023 年 8 月起只對少數政府與健康類網站顯示 FAQ 複合式搜尋結果，並於 2026-05-07 全面停止顯示，2026 年 6 月移除相關文件。標記可以保留，但不會再有展開效果；問答內容本身對讀者仍有幫助。'],
  C14: ['頁面的主要內容可能只有圖片', '這些頁面主要區域的原始 HTML 文字不到 120 字，卻有 3 張以上圖片。人看得到圖片裡的文字，搜尋引擎與 AI 爬蟲讀不到；請確認產品名稱、規格與說明有用文字寫在頁面上。'],
  G04: ['robots.txt 封鎖了使用者即時讀取爬蟲', 'robots.txt 對 {tokens} 宣告封鎖。這類爬蟲是在使用者要求時即時讀取網頁，官方表示不一定遵守 robots.txt，實際效果無法判斷。'],
  G10: ['Bing 摘要或快取受到限制', '頁面要求 Bing 不提供摘要或快取。'],
  G11: ['Googlebot 只被部分路徑封鎖', '首頁規則允許 Googlebot，但部分已檢查頁面被封鎖。'],
});

const SOURCES = Object.freeze({
  T01:['google-http-errors'],T02:['google-robots'],T03:['google-robots'],T04:['google-noindex'],T05:['google-noindex'],T06:['google-noindex'],T07:['google-noindex'],
  T08:['google-starter'],T09:['google-starter'],T11:['google-http-errors'],T12:['google-http-errors'],T13:['google-http-errors'],T14:['google-starter'],
  T15:['google-canonical'],T16:['google-canonical'],T17:['google-canonical'],T18:['google-sitemaps'],T19:['google-sitemaps'],T20:['google-sitemaps'],T21:['google-sitemaps'],T22:['google-robots'],T23:['google-mobile'],T24:['google-starter'],T28:['google-starter'],T29:['google-starter'],T30:['google-canonical'],T31:['google-canonical'],T33:['google-starter'],T34:['google-starter'],T35:['google-noindex'],T36:['google-title'],T37:['google-sitemaps'],T38:['google-canonical'],T39:['google-robots'],T40:['google-hreflang'],T41:['google-hreflang'],T42:['google-hreflang'],
  C01:['google-title'],C02:['google-title'],C03:['google-title'],C04:['google-snippet'],C05:['google-snippet'],C06:['google-starter'],C09:['google-starter'],C10:['google-starter'],C11:['google-sd-policies'],C12:['google-sd-policies','google-updates'],C14:['google-starter','google-helpful'],
  G01:['openai-bots','anthropic-bots','perplexity-bots','apple-bots'],G02:['bing-chat-controls'],G03:['openai-bots','anthropic-bots','google-crawlers','apple-bots','ccbot'],G04:['openai-bots','anthropic-bots','perplexity-bots'],G05:['google-snippet','google-ai-features'],G06:['google-js-seo'],G07:['google-sd-policies'],G10:['bing-chat-controls'],G11:['google-robots'],G12:['content-signals'],
});

const FIXED = Object.freeze({
  T02: ['robots.txt 讀取時伺服器出錯', status => `本工具讀取 robots.txt 時伺服器回應 ${status}。這可能是伺服器出錯，也可能是對不知名爬蟲的流量限制。若 Google 也收到相同回應，依 Google 文件，前 12 小時 Google 會暫停爬取整個網站，之後才改用先前的快取版本；請網站管理者查看伺服器紀錄，確認 Googlebot 收到的回應。`],
  T03: ['Google 被 robots.txt 擋在門外', 'robots.txt 禁止 Googlebot 抓取首頁，Google 讀不到首頁內容。網址仍可能出現在搜尋結果，但不會有正常的標題與摘要，也不符合被 AI 摘要（AI Overviews）引用的條件（頁面必須能顯示摘要）。'],
  T04: ['首頁設定了 noindex（禁止收錄）', '首頁要求搜尋引擎不要收錄。Google 重新抓取並處理後，首頁通常會從搜尋結果移除。'],
  T11: ['隨機網址也回應 200', '本工具請求一個隨機產生、應該不存在的網址，伺服器回應 200（成功）。如果這個網址確實不存在，伺服器應該回應 404 或 410，否則搜尋引擎可能把錯誤頁當成一般網頁。'],
  T18: ['沒有在常見位置找到 sitemap', '沒有在 robots.txt 宣告的位置或 /sitemap.xml 找到 sitemap。小型網站只要內部連結完整，沒有 sitemap 也能被找到；網頁多或經常更新時建議提供。本項不計分。'],
  T22: ['沒有 robots.txt', '沒有 robots.txt 等於允許所有爬蟲讀取，這不是錯誤。'],
  G01: ['robots.txt 封鎖了 AI 搜尋的爬蟲', tokens => `robots.txt 對 ${tokens} 宣告封鎖。這些爬蟲負責 AI 搜尋的索引，如果它們遵守這個規則，網站就比較難出現在對應的 AI 搜尋答案中。如果是刻意的選擇，可以忽略這一項。`],
  G02: ['robots.txt 封鎖了 Bingbot', 'robots.txt 對 Bingbot 宣告封鎖。如果 Bingbot 遵守這個規則，網站就比較難出現在 Bing 搜尋，以及使用 Bing 資料的 Microsoft Copilot 答案中。如果是刻意的選擇，可以忽略這一項。'],
  G03: ['robots.txt 封鎖了 AI 訓練用的爬蟲', tokens => `robots.txt 對 ${tokens} 宣告封鎖。這些控制的是 AI 模型訓練，不會封鎖另外列出的搜尋用爬蟲（例如 Googlebot、OAI-SearchBot）；其他後續用途本工具無法判斷。封鎖後，這些模型的內建知識可能較少提到貴公司；要不要開放是經營上的決定，不算問題。`],
  G05: ['頁面禁止顯示摘要（nosnippet）', '設定 nosnippet 或 max-snippet:0 的頁面不能在搜尋結果顯示摘要；依 Google 說明，頁面必須能顯示摘要才符合出現在 AI 摘要與 AI 模式的條件。如果希望出現在 Google 的 AI 功能，才需要調整。'],
  G06: ['主要內容可能要執行 JavaScript 才看得到', '原始 HTML 裡幾乎沒有文字。Google 會嘗試執行 JavaScript，但有條件也可能延遲；其他 AI 爬蟲是否執行 JavaScript 沒有官方保證。把主要內容放在原始 HTML 裡最保險。'],
  G07: ['缺少組織結構化資料', 'Organization／LocalBusiness 標記可以幫搜尋引擎確認品牌名稱、網址、標誌與聯絡方式。Google 表示 AI 搜尋不需要特殊標記，所以這是建議，不是必要條件；只能填寫真實資訊。本項不計分。'],
});

function unique(values) { return [...new Set(values.filter(Boolean))]; }
function pageUrl(entry) { return entry?.finalUrl || entry?.url || null; }
function homeEntry(snapshot) {
  return snapshot?.pages?.find(p => pageUrl(p) === snapshot.home || p.url === snapshot.home) || snapshot?.pages?.[0] || null;
}
function directivesForEntry(entry, ua = 'googlebot') {
  const meta = ua === 'bingbot' ? (entry.page?.metaBingbot || []) : (entry.page?.metaRobots || []);
  const common = entry.page?.metaRobots || [];
  return unique([...common, ...meta, ...headerDirectives(entry.headers?.['x-robots-tag'], ua)]);
}
function metaDirectivesForEntry(entry, ua = 'googlebot') {
  const specific = ua === 'bingbot' ? (entry.page?.metaBingbot || []) : [];
  return unique([...(entry.page?.metaRobots || []), ...specific]).map(value=>String(value).toLowerCase().replace(/\s+/g,''));
}
function reliesOnTruncatedHeader(entry, ua, predicate) {
  if (!entry?.truncatedHeaders) return false;
  const header = headerDirectives(entry.headers?.['x-robots-tag'], ua);
  return header.some(predicate) && !metaDirectivesForEntry(entry, ua).some(predicate);
}
function canonicalKey(entry) { return entry.page?.canonicals?.length === 1 ? entry.page.canonicals[0] : pageUrl(entry); }
function robotsBlocks(snapshot, token, url) {
  const robots = snapshot?.robots;
  return robots?.policy === 'parse' && !robots.parsed?.overflow && robots.parsed
    ? !isAllowed(robots.parsed, token, pathAndQuery(url)) : false;
}

function contentSignalLabel(signal) {
  const parts = [];
  if (signal?.search != null) parts.push(`search=${signal.search}`);
  if (signal?.aiInput != null) parts.push(`ai-input=${signal.aiInput}`);
  if (signal?.aiTrain != null) parts.push(`ai-train=${signal.aiTrain}`);
  return `${parts.join(', ')}（適用 ${(signal?.agents || []).join(', ')}）`;
}

function hasLanguageSwitchLink(link) {
  if (LANGUAGE_LINK_TEXT.has(normText(link?.text || '').toLowerCase())) return true;
  try {
    const segment = new URL(link.url).pathname.split('/').filter(Boolean)[0] || '';
    return LANGUAGE_PATH_SEGMENTS.has(segment.toLowerCase());
  } catch {
    return false;
  }
}

function imageOnlyExcluded(entry) {
  let pathname = '';
  try {
    pathname = new URL(pageUrl(entry)).pathname;
    try { pathname = decodeURIComponent(pathname); } catch { /* use the original pathname */ }
  } catch { /* invalid page URLs are handled elsewhere */ }
  return [pathname, entry?.page?.title, entry?.page?.h1]
    .some((value) => IMAGE_ONLY_EXCLUSION.test(String(value ?? '')));
}

export function headerDirectives(value, ua = 'googlebot') {
  if (value == null) return [];
  const wanted = String(ua).toLowerCase();
  const result = [];
  let scope = '*';
  const parameterized = new Set(['max-snippet', 'max-image-preview', 'max-video-preview', 'unavailable_after']);
  for (const rawPart of String(value).split(',')) {
    let part = rawPart.trim().toLowerCase();
    if (!part) continue;
    const colon = part.indexOf(':');
    if (colon > 0) {
      const prefix = part.slice(0, colon).trim();
      if (!parameterized.has(prefix)) {
        scope = prefix;
        part = part.slice(colon + 1).trim();
        if (!part) continue;
      }
    }
    if (scope === '*' || scope === wanted) result.push(part.replace(/\s+/g, ''));
  }
  return unique(result);
}

export function analyzable(entry) {
  return Boolean(entry && entry.status === 200 && entry.isHtml && entry.page && !entry.error && !entry.accessBlocked);
}

export function isNoindex(entry) {
  if (!analyzable(entry)) return false;
  return directivesForEntry(entry).some(d => d === 'noindex' || d === 'none');
}

export function isIndexable(entry) {
  return analyzable(entry) && !isNoindex(entry) && !entry.duplicateOf;
}

export function botAccess(snapshot) {
  const robots = snapshot?.robots;
  const home = snapshot?.home || (snapshot?.origin ? `${snapshot.origin}/` : '/');
  return BOTS.map(bot => {
    let status = 'unknown', agent = null, rule = null;
    if (robots?.policy === 'allow_all') status = 'declared_allowed';
    else if (robots?.policy === 'parse' && robots.parsed && !robots.parsed.overflow) {
      const result = explain(robots.parsed, bot.token, pathAndQuery(home));
      status = result.allowed ? 'declared_allowed' : 'declared_disallowed';
      agent = result.agent;
      rule = result.rule;
    }
    const blockedUrls = robots?.policy === 'parse' && robots.parsed && !robots.parsed.overflow
      ? unique((snapshot.pages || []).filter(analyzable).map(pageUrl).filter(url => !isAllowed(robots.parsed, bot.token, pathAndQuery(url))))
      : [];
    return { ...bot, status, blockedUrls, agent, rule };
  });
}

export function runChecks(snapshot) {
  const findings = [];
  const pages = snapshot?.pages || [];
  const analyzablePages = pages.filter(analyzable);
  const indexablePages = pages.filter(isIndexable);
  const home = homeEntry(snapshot);
  const homeUrl = snapshot?.home || pageUrl(home) || (snapshot?.origin ? `${snapshot.origin}/` : null);
  const bots = botAccess(snapshot || {});
  const add = (id, code, section, severity, evidence, urls = [], data = {}, count = null, text = null, fix = '', why = '') => {
    const base = text || FIXED[id] || GENERIC[id] || [id, code];
    const title = base[0];
    const summary = typeof base[1] === 'function' ? base[1](data.status ?? data.tokens ?? '') : String(base[1] || '');
    findings.push({ id, code, section, severity, evidence, title, summary, why, fix, urls: unique(urls).slice(0, 50), count: count ?? unique(urls).length, data, sources: SOURCES[id] || [], scored: severity !== 'INFO' });
  };

  function lookupTarget(rawUrl) {
    const url = cleanUrl(rawUrl);
    if (!url) return null;
    const classify = (entry) => {
      let issue = null;
      if (!entry.error && !entry.accessBlocked) {
        if ([404, 410].includes(entry.status)) issue = 'not_found';
        else if (analyzable(entry) && isNoindex(entry)) issue = 'noindex';
      }
      return { entry, issue };
    };
    const requested = pages.find((entry) => entry?.url === url);
    if (requested) {
      if ((requested.chain?.length || 0) > 0 || REDIRECT_RELATED_STOPS.has(requested.stop)) {
        return { entry: requested, issue: 'redirect' };
      }
      return classify(requested);
    }
    const final = pages.find((entry) => entry?.finalUrl === url);
    return final ? classify(final) : null;
  }

  if (home && ((!home.accessBlocked && BAD_STATUSES.has(home.status)) || ['loop','max_hops'].includes(home.stop))) add('T01','home_unreachable','tech','P0','verified',[pageUrl(home)]);
  const badRobots = [snapshot?.robots, snapshot?.robotsInitial].filter(r => r && !r.error && !r.accessBlocked && (r.status === 429 || (r.status >= 500 && r.status <= 599)));
  if (badRobots.length) add('T02','robots_server_error','tech','P1','inferred',badRobots.map(r=>r.url),{ status:badRobots[0].status },1);
  const robots = snapshot?.robots;
  if (robots?.policy === 'parse' && robots.parsed && !robots.parsed.overflow && homeUrl && !isAllowed(robots.parsed,'googlebot',pathAndQuery(homeUrl))) {
    add('T03','googlebot_blocked_home','tech','P0','verified',[homeUrl],{},1,FIXED.T03,'刪除或修改 robots.txt 裡對 Googlebot 或 *（所有爬蟲）的 Disallow: / 規則。常見原因是網站開發期間的設定，上線後忘了移除。');
  }
  if (robots && [404,410].includes(robots.status)) add('T22','robots_missing','tech','INFO','verified',[robots.url],{},1);
  if (snapshot?.stoppedOffsite) add('T28','home_redirect_offsite','tech','INFO','verified',[homeUrl],{},1);
  if (snapshot?.coverage?.status === 'failed' && !findings.some(f => ['T01','T28'].includes(f.id))) {
    const coverageReasons = snapshot.coverage.reasons || [];
    const text = coverageReasons.includes('blocked_by_site')
      ? [GENERIC.T29[0], BLOCKED_BY_SITE_COPY]
      : null;
    add('T29','home_unverifiable','tech','INFO','unverifiable',[homeUrl],{reasons:coverageReasons},1,text);
  }
  if (robots?.truncated) add('T39','robots_truncated','tech','INFO','verified',[robots.url],{},1);

  const blockedByCategory = category => bots.filter(b => b.category === category && b.status === 'declared_disallowed');
  const addBot = (id, code, severity, rows) => { if (rows.length) { const tokens = rows.map(r=>r.token).join('、'); add(id,code,'geo',severity,'verified',[],{tokens:rows.map(r=>r.token)},rows.length,id==='G04'?[GENERIC.G04[0],GENERIC.G04[1].replace('{tokens}',tokens)]:[FIXED[id][0],typeof FIXED[id][1]==='function'?FIXED[id][1](tokens):FIXED[id][1]]); } };
  addBot('G01','ai_search_blocked','P2',blockedByCategory('ai_search'));
  const bing = bots.filter(b => b.token.toLowerCase()==='bingbot' && b.status==='declared_disallowed');
  addBot('G02','bingbot_blocked','P1',bing);
  addBot('G03','training_blocked','INFO',blockedByCategory('training'));
  addBot('G04','user_fetch_blocked','INFO',blockedByCategory('user_fetch'));
  const contentSignals = robots?.policy === 'parse' && Array.isArray(robots.parsed?.contentSignals)
    ? robots.parsed.contentSignals : [];
  if (contentSignals.length) {
    const list = contentSignals.map(contentSignalLabel).join('、');
    add('G12','content_signal','geo','INFO','verified',[robots.url],{signals:contentSignals},contentSignals.length,[
      'robots.txt 宣告了 Content Signals',
      `robots.txt 以 Content-Signal 宣告：${list}。這是 Cloudflare 推動的偏好宣告（search＝搜尋索引、ai-input＝AI 即時引用、ai-train＝AI 訓練），不是技術上的封鎖；各家爬蟲是否遵守由其自行決定。本項不計分。`,
    ]);
  }

  if (!snapshot?.homeAnalyzable) return findings.sort((a,b)=>SEVERITY_ORDER[a.severity]-SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id));

  const noindexDirective = d => d === 'noindex' || d === 'none';
  if (home && isNoindex(home)) add('T04','home_noindex','tech','P0',reliesOnTruncatedHeader(home,'googlebot',noindexDirective)?'inferred':'verified',[pageUrl(home)],{},1,FIXED.T04,'移除首頁的 <meta name="robots" content="noindex"> 或 X-Robots-Tag: noindex。WordPress 網站請檢查「設定 → 閱讀」裡的「阻止搜尋引擎索引這個網站」是否被勾選。');
  const inner = analyzablePages.filter(p => p !== home);
  const noindexInner = inner.filter(isNoindex);
  if (inner.length >= 5 && noindexInner.length / inner.length >= .5) add('T05','many_noindex','tech','P2','inferred',noindexInner.map(pageUrl));
  else if (noindexInner.length) add('T06','noindex_pages','tech','INFO',noindexInner.some(p=>reliesOnTruncatedHeader(p,'googlebot',noindexDirective))?'inferred':'verified',noindexInner.map(pageUrl));
  const noindexBlocked = analyzablePages.filter(p => isNoindex(p) && robotsBlocks(snapshot,'googlebot',pageUrl(p)));
  if (noindexBlocked.length) add('T07','noindex_blocked_by_robots','tech','P2',noindexBlocked.some(p=>reliesOnTruncatedHeader(p,'googlebot',noindexDirective))?'inferred':'verified',noindexBlocked.map(pageUrl));
  if (homeUrl && new URL(homeUrl).protocol === 'http:') add('T08','no_https','tech','P1','verified',[homeUrl],{},1);
  if (snapshot?.origin?.startsWith('https:') && snapshot.probes?.http && !snapshot.probes.http.accessBlocked && snapshot.probes.http.status >= 200 && snapshot.probes.http.status < 300) add('T09','http_not_redirected','tech','P2','verified',[snapshot.probes.http.url],{},1);
  if (snapshot?.probes?.soft404 && !snapshot.probes.soft404.accessBlocked && snapshot.probes.soft404.status >= 200 && snapshot.probes.soft404.status < 300) add('T11','random_path_2xx','tech','P3','inferred',[snapshot.probes.soft404.url],{},1,FIXED.T11);

  const linked = pages.filter(p => (snapshot.discovered?.[p.url]?.inlinks || snapshot.discovered?.[pageUrl(p)]?.inlinks || []).length && !p.error && !p.accessBlocked);
  const broken = linked.filter(p => BAD_STATUSES.has(p.status));
  if (broken.length) {
    const refs = Object.fromEntries(broken.map(p => [pageUrl(p), snapshot.discovered?.[p.url]?.inlinks || snapshot.discovered?.[pageUrl(p)]?.inlinks || []]));
    add('T12','broken_internal','tech',broken.length>=5 && broken.length/linked.length>=.1?'P1':'P2','verified',broken.map(pageUrl),{referrers:refs});
  }
  const fetchErrors = pages.filter(p => p.error || p.accessBlocked || [429,503].includes(p.status));
  if (fetchErrors.length) add('T13','fetch_errors','tech','INFO','unverifiable',fetchErrors.map(pageUrl));
  const redirectProblems = pages.filter(p => p!==home && ((p.chain?.length||0)>=2 || ['loop','max_hops'].includes(p.stop)));
  if (redirectProblems.length) add('T14','redirect_chain','tech',redirectProblems.some(p=>['loop','max_hops'].includes(p.stop))?'P2':'P3','verified',redirectProblems.map(pageUrl));
  const multipleCanon = indexablePages.filter(p => new Set(p.page.canonicals || []).size >= 2);
  if (multipleCanon.length) add('T15','canonical_multiple','tech','P1','verified',multipleCanon.map(pageUrl));
  const crossCanon = indexablePages.filter(p => p.page.canonicals?.length===1 && (()=>{try{return stripWww(new URL(p.page.canonicals[0]).hostname)!==snapshot.siteHost}catch{return false}})());
  if (crossCanon.length) add('T16','canonical_cross_domain','tech',crossCanon.includes(home)?'P1':'P2','verified',crossCanon.map(pageUrl),{},null,null,'將 canonical 改為本站的主要網址。如果是刻意設定（例如內容聯播），可以忽略這一項。');
  const canonBad = indexablePages.filter(p=>p.page.canonicals?.length===1 && lookupTarget(p.page.canonicals[0])?.issue);
  if (canonBad.length) add('T17','canonical_to_bad','tech','P2','verified',canonBad.map(pageUrl));

  const sitemaps = snapshot.sitemaps || [];
  const declaredMaps = sitemaps.filter(s=>s.fallback===false);
  const fallbackConclusive = sitemaps.filter(s=>s.fallback===true && !s.error && !s.accessBlocked && (s.kind==='missing'||(!s.truncated&&s.status===200&&['html','invalid'].includes(s.kind))));
  if (!declaredMaps.length && fallbackConclusive.length) add('T18','sitemap_missing','tech','INFO','verified',fallbackConclusive.map(s=>s.url),{},fallbackConclusive.length,FIXED.T18);
  const invalidMaps = declaredMaps.filter(s=>['invalid','html','missing'].includes(s.kind));
  if (invalidMaps.length) add('T19','sitemap_invalid','tech','P2','verified',invalidMaps.map(s=>s.url),{sitemaps:invalidMaps.map(s=>({url:s.url,kind:s.kind}))},invalidMaps.length);
  const badMapUrls = unique((snapshot.sitemapUrls || []).map((url) => cleanUrl(url))).filter((url) => {
    const target = lookupTarget(url);
    if (target?.issue || robotsBlocks(snapshot, 'googlebot', url)) return true;
    const entry = target?.entry;
    return Boolean(entry && analyzable(entry) && entry.page.canonicals?.length === 1
      && cleanUrl(entry.page.canonicals[0]) !== url);
  });
  if (badMapUrls.length) add('T20','sitemap_bad_urls','tech','P2','verified',badMapUrls);
  const foreign = (snapshot.sitemapUrls||[]).filter(u=>{try{return stripWww(new URL(u).hostname)!==snapshot.siteHost}catch{return false}});
  if (foreign.length) add('T21','sitemap_foreign_host','tech','P3','unverifiable',foreign,{},foreign.length);
  const unverifiableMaps=sitemaps.filter(s=>s.kind!=='missing'&&(['gzip','error','robots_disallowed'].includes(s.kind)||s.truncated||s.accessBlocked));
  if (unverifiableMaps.length) add('T37','sitemap_unverifiable','tech','INFO','unverifiable',unverifiableMaps.map(s=>s.url),{},unverifiableMaps.length);

  const noViewport=indexablePages.filter(p=>!p.page.hasViewport); if(noViewport.length)add('T23','viewport_missing','tech','P2','verified',noViewport.map(pageUrl));
  const noLang=indexablePages.filter(p=>!p.page.lang); if(noLang.length)add('T24','lang_missing','tech','INFO','verified',noLang.map(pageUrl));
  const noCanon=indexablePages.filter(p=>p.page.canonicalTagCount===0); if(noCanon.length)add('T30','canonical_missing','tech','INFO','verified',noCanon.map(pageUrl));
  const httpCanon=indexablePages.filter(p=>pageUrl(p)?.startsWith('https:')&&p.page.canonicals?.length===1&&p.page.canonicals[0].startsWith('http:')); if(httpCanon.length)add('T31','canonical_http','tech','P2','verified',httpCanon.map(pageUrl));
  const refresh=analyzablePages.filter(p=>p.page.metaRefresh); if(refresh.length)add('T33','meta_refresh','tech','P3','verified',refresh.map(pageUrl));
  const mixed=analyzablePages.filter(p=>pageUrl(p)?.startsWith('https:')&&p.page.insecureResources?.length); if(mixed.length)add('T34','mixed_content','tech','P2','verified',mixed.map(pageUrl));
  const nofollow=indexablePages.filter(p=>directivesForEntry(p).includes('nofollow')); if(nofollow.length)add('T35','page_nofollow','tech','P3',nofollow.some(p=>reliesOnTruncatedHeader(p,'googlebot',d=>d==='nofollow'))?'inferred':'verified',nofollow.map(pageUrl));
  const multiTitle=analyzablePages.filter(p=>p.page.titleCount>=2); if(multiTitle.length)add('T36','multiple_title','tech','P3','verified',multiTitle.map(pageUrl));
  const invalidCanon=indexablePages.filter(p=>p.page.canonicalTagCount>0&&!(p.page.canonicals?.length)); if(invalidCanon.length)add('T38','canonical_invalid','tech','P2','verified',invalidCanon.map(pageUrl));
  const invalidHreflang=indexablePages.filter((p)=>(p.page.hreflangs||[]).some((item)=>{
    const lang=String(item.lang||'').toLowerCase();
    return item.href==null||(lang!=='x-default'&&!HREFLANG_PATTERN.test(lang))||lookupTarget(item.href)?.issue==='not_found';
  }));
  if(invalidHreflang.length)add('T40','hreflang_invalid','tech','P3','verified',invalidHreflang.map(pageUrl));
  const hreflangWithoutSelf=indexablePages.filter((p)=>{
    const hreflangs=p.page.hreflangs||[];
    if(!hreflangs.length||hreflangs.some((item)=>item.href==null))return false;
    const selfUrls=unique([
      cleanUrl(p.finalUrl||p.url),
      p.page.canonicals?.length===1?cleanUrl(p.page.canonicals[0]):null,
    ]);
    return !hreflangs.some((item)=>selfUrls.includes(cleanUrl(item.href)));
  });
  if(hreflangWithoutSelf.length)add('T41','hreflang_no_self','tech','P3','verified',hreflangWithoutSelf.map(pageUrl));
  if(home&&isIndexable(home)&&!(home.page.hreflangs||[]).length&&(home.page.links||[]).some(hasLanguageSwitchLink)) {
    add('T42','hreflang_missing','tech','P3','inferred',[pageUrl(home)],{},1);
  }

  const shells=analyzablePages.filter(p=>p.page.textLength<200&&p.page.scriptSrcCount>=1&&p.page.hasSpaRoot&&p.page.spaRootTextLength<20);
  const missingTitle=indexablePages.filter(p=>!p.page.title); if(missingTitle.length)add('C01','title_missing','content','P1','verified',missingTitle.map(pageUrl));
  const duplicates = (field) => { const groups=new Map(); for(const p of indexablePages){const v=normText(p.page[field]||'');if(!v)continue;const list=groups.get(v)||[];list.push(p);groups.set(v,list);} return [...groups.entries()].filter(([,ps])=>new Set(ps.map(canonicalKey)).size>=2); };
  const titleGroups=duplicates('title'); if(titleGroups.length){const urls=unique(titleGroups.flatMap(([,ps])=>ps.map(pageUrl)));add('C02','title_duplicate','content','P2','verified',urls,{groups:titleGroups.map(([value,ps])=>({value,urls:ps.map(pageUrl)}))},urls.length);}
  const genericSet=new Set('首頁 home homepage index untitled 無標題 新網頁 document welcome 歡迎'.split(' '));
  const generic=indexablePages.filter(p=>{const t=normText(p.page.title||'').toLowerCase();return genericSet.has(t)||t===String(snapshot.siteHost||'').toLowerCase();}); if(generic.length)add('C03','title_generic','content','P3','inferred',generic.map(pageUrl));
  const missingDesc=indexablePages.filter(p=>!p.page.metaDescription); if(missingDesc.length)add('C04','meta_description_missing','content','P3','verified',missingDesc.map(pageUrl));
  const descGroups=duplicates('metaDescription'); if(descGroups.length){const urls=unique(descGroups.flatMap(([,ps])=>ps.map(pageUrl)));add('C05','meta_description_duplicate','content','P3','verified',urls,{groups:descGroups.map(([value,ps])=>({value,urls:ps.map(pageUrl)}))},urls.length);}
  const missingH1=indexablePages.filter(p=>!p.page.h1); if(missingH1.length)add('C06','h1_missing','content','P3','verified',missingH1.map(pageUrl));
  const alt=indexablePages.filter(p=>p.page.images?.some(i=>!i.hasAlt)); if(alt.length)add('C09','img_alt_missing','content','P3','verified',alt.map(pageUrl),{images:alt.flatMap(p=>p.page.images.filter(i=>!i.hasAlt).map(i=>({page:pageUrl(p),src:i.src}))).slice(0,50)});
  const og=indexablePages.filter(p=>!p.page.og?.title||!p.page.og?.image); if(og.length)add('C10','og_missing','content','INFO','verified',og.map(pageUrl));
  const badJson= indexablePages.filter(p=>p.page.jsonld?.some(j=>!j.ok)); if(badJson.length)add('C11','jsonld_invalid','content','P3','verified',badJson.map(pageUrl));
  const faq=indexablePages.filter(p=>p.page.jsonld?.some(j=>j.types?.some(t=>String(t).toLowerCase()==='faqpage'))); if(faq.length)add('C12','faq_schema','content','INFO','verified',faq.map(pageUrl));
  const imageOnly=indexablePages.filter(p=>!shells.includes(p)&&p.page.mainImageCount>=3&&p.page.mainTextLength<120&&p.page.mainAltChars<50&&!p.page.mainHasMedia&&!imageOnlyExcluded(p));
  if(imageOnly.length)add('C14','image_only_content','content','P3','inferred',imageOnly.map(pageUrl),{},null,null,'把圖片裡的重點（品名、規格、價格、服務說明）改成網頁文字；圖片保留並補上說明文字（alt）。');

  const snippetDirective=d=>d==='nosnippet'||d.replace(/\s/g,'')==='max-snippet:0';
  const nosnip=indexablePages.filter(p=>directivesForEntry(p).some(snippetDirective)); if(nosnip.length)add('G05','nosnippet','geo','P2',nosnip.some(p=>reliesOnTruncatedHeader(p,'googlebot',snippetDirective))?'inferred':'verified',nosnip.map(pageUrl),{},null,FIXED.G05);
  if(shells.length)add('G06','js_shell','geo','P3','inferred',shells.map(pageUrl),{},null,FIXED.G06);
  const orgTypes=new Set([
    'organization','corporation','localbusiness','onlinestore','onlinebusiness','store','restaurant',
    'professionalservice','medicalorganization','educationalorganization','ngo','governmentorganization',
    'newsmediaorganization',
  ]);
  if(home&&isIndexable(home)){const types=home.page.jsonld?.flatMap(j=>j.types||[])||[];if(!types.some(t=>orgTypes.has(String(t).toLowerCase())||/(store|business)$/i.test(String(t))))add('G07','org_schema_missing','geo','INFO','inferred',[pageUrl(home)],{},1,FIXED.G07);}
  const bingDirective=d=>d==='noarchive'||d==='nocache';
  const bingBlocked=indexablePages.filter(p=>directivesForEntry(p,'bingbot').some(bingDirective));if(bingBlocked.length)add('G10','bing_noarchive','geo','INFO',bingBlocked.some(p=>reliesOnTruncatedHeader(p,'bingbot',bingDirective))?'inferred':'verified',bingBlocked.map(pageUrl));
  const googleRow=bots.find(b=>b.token.toLowerCase()==='googlebot');if(googleRow?.status==='declared_allowed'&&googleRow.blockedUrls.length)add('G11','partial_block','geo','INFO','verified',googleRow.blockedUrls);

  return findings.sort((a,b)=>SEVERITY_ORDER[a.severity]-SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id));
}
