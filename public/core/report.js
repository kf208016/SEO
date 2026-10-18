import { html, safeHref } from './html.js';
import { qrMatrix, qrSvg } from './qr.js';
import { SOURCES } from './sources.js';
import { VERSION } from './version.js';

const GRADE_TEXT = Object.freeze({
  green: '本次讀取的頁面沒有發現阻斷或高風險問題（不代表整站沒有問題）',
  yellow: '基礎可用，有需要修正的項目，或本次檢查不完整',
  red: '有阻斷級或重大問題',
  gray: '無法完成檢查，沒有評分',
});
const SEVERITY = Object.freeze({ P0:'阻斷',P1:'高',P2:'中',P3:'低',INFO:'資訊' });
const EVIDENCE = Object.freeze({ verified:'已驗證',inferred:'推論',unverifiable:'無法驗證' });
const CATEGORIES = Object.freeze({ search_engine:'搜尋引擎',ai_search:'AI 搜尋',training:'AI 訓練',user_fetch:'使用者即時讀取' });
const SECTIONS = Object.freeze({ tech:'SEO 技術',content:'內容與結構',geo:'GEO' });
const PAGE_BUCKET_TEXT = Object.freeze({
  home: '首頁',
  start: '起始網址',
  product: '產品／服務',
  content: '內容／分類',
  trust: '關於／聯絡',
  other: '其他',
  excluded: '低價值',
});
const BLOCKED_BY_SITE_COPY = '這個網站的伺服器拒絕了本工具讀取（HTTP 401／403 或人機驗證）。很多網站只允許 Google 等知名爬蟲與一般瀏覽器，這不代表 Google 也被擋。本工具不會偽裝身分繞過，所以這次無法檢查；需要完整健檢，歡迎透過 LINE 官方帳號聯絡我們。';
const COVERAGE_REASON_TEXT = Object.freeze({
  blocked_by_site: BLOCKED_BY_SITE_COPY,
  robots_unknown: 'robots.txt 的規則無法可靠判斷',
  robots_disallow_all: 'robots.txt 的回應要求暫停讀取',
  robots_overflow: 'robots.txt 超過本工具可安全處理的規則上限',
  blocked_for_tool: 'robots.txt 宣告禁止本工具讀取首頁',
  home_not_analyzable: '首頁不是可分析的 HTML 回應',
  home_unavailable: '首頁暫時無法使用',
  offsite: '首頁轉址到其他網站，檢查已停止',
  robots_final_unknown: '轉址後網站的 robots.txt 規則無法可靠判斷',
  fetch_errors: '部分頁面讀取失敗',
  access_blocked: '部分頁面被防火牆或人機驗證阻擋',
  truncated: '部分回應超過讀取上限',
  timed_out: '檢查超過時間上限',
  page_unanalyzable: '部分頁面不是可分析的 HTML 回應',
  sitemap_unverifiable: 'sitemap 無法可靠驗證',
  parse_limit: '部分內容超過解析上限',
  budget_exhausted: '本次檢查額度已用完',
  page_limit: '符合條件的頁面多於本次取樣上限',
  robots_skipped: '部分頁面依 robots.txt 規則未讀取',
  sitemap_limit: 'sitemap 數量超過本次讀取上限',
});
const RESULT_TEXT = Object.freeze({
  timeout: '讀取逾時',
  network: '網路讀取失敗',
  stream_error: '回應內容讀取失敗',
  dns_error: 'DNS 查詢失敗',
  blocked_address: '目的位址不允許讀取',
  host_not_allowed: '目的主機不在允許範圍',
  budget_exhausted: '本次檢查額度已用完',
  too_fast: '請求間隔過短',
  robots_required: '尚未取得 robots.txt 規則',
  robots_disallowed: 'robots.txt 宣告禁止讀取',
  bad_token: '檢查權杖無效',
  bad_response: '服務回應格式錯誤',
  bad_redirect: '轉址目的地不符合規則',
  offsite: '轉址到其他網站',
  loop: '轉址形成循環',
  max_hops: '轉址次數超過上限',
  permit_denied: '伺服器拒絕這次讀取',
  location_too_long: '轉址網址超過長度上限',
  sitemap_limit: 'sitemap 讀取次數超過上限',
});
const SITEMAP_KIND_TEXT = Object.freeze({
  urlset: '網址清單',
  index: 'sitemap 索引',
  invalid: '格式無效',
  html: 'HTML 頁面',
  missing: '未找到',
  gzip: '壓縮檔，無法驗證',
  error: '讀取失敗',
  robots_disallowed: 'robots.txt 宣告禁止讀取',
});
const LIMIT_TEXT = [
  '線上簡易版最多讀取 15 頁，只看原始 HTML，沒有執行 JavaScript。',
  '沒有量測網頁速度（Core Web Vitals），也沒有讀取 Search Console 的實際成效資料。',
  '被防火牆、人機驗證或流量限制擋下的頁面列為「無法驗證」，不代表該頁有問題。',
  '本工具遵守 robots.txt 對本工具（KinsuiSEOCheck）的規則；被禁止的頁面不會讀取。',
];
const CAN_PROVE = '本次檢查直接觀察到：本工具從 Cloudflare 讀取這些網頁時收到的回應，以及原始 HTML 和 robots.txt 裡的設定（收錄控制、網址與轉址、標題、結構化資料、爬蟲規則）。';
const CANNOT_PROVE = '搜尋排名、是否已被收錄、會不會被 AI 引用、實際流量或業績。搜尋引擎與 AI 爬蟲實際收到的回應可能和本工具不同（例如防火牆對不同爬蟲有不同規則）。分數只反映本次樣本的技術狀況，不是排名分數。Google 表示 AI 搜尋沿用一般 SEO 的基礎，沒有保證被引用的特殊做法。';
const LLMS = 'Google 表示 Google 搜尋不使用 llms.txt，有沒有都不影響 Google 排名與 AI 摘要；其他 AI 服務是否讀取各自不同。所以本工具不檢查、也不計分。';
const BOT_TABLE_EXPLANATION = '這張表只反映 robots.txt 的宣告，不代表爬蟲實際進得來。網站的防火牆或 CDN 可能另外阻擋特定爬蟲：Cloudflare 自 2025 年 7 月起，新加入的網域預設封鎖已知的 AI 爬蟲；其他防火牆也可能有類似規則。本工具不偽裝身分，無法驗證各家爬蟲實際是否被擋，請網站管理者查看防火牆或 Cloudflare 的紀錄確認。';
const TEXT_PREVIEW_EXPLANATION = '以下是首頁原始 HTML 裡的標題與前 300 字可見文字。Google 會另外執行 JavaScript，其他 AI 爬蟲沒有保證；如果這裡幾乎沒有文字，或看不到產品與服務的說明，不執行 JavaScript 的爬蟲就讀不到。';
const SCORE_NOTE = '只代表本次讀到的頁面在技術上讓搜尋引擎讀得到、讀得懂；不是排名分數，也不代表會被 AI 引用。';
const UNCHECKED_INTRO = '這些項目決定實際排名與 AI 引用，需要 Search Console 權限或人工檢查：';
const UNCHECKED_ITEMS = Object.freeze([
  '關鍵字與買家搜尋需求是否對應',
  '外部連結與品牌被提及的情況',
  '網頁速度（Core Web Vitals）',
  '防火牆或 CDN 對各家爬蟲的實際放行',
  'Search Console 的收錄與成效資料',
]);
const LINE_ID_PATTERN = /^@[A-Za-z0-9_.-]{1,40}$/;
const FINDING_SEVERITY_ORDER = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3, INFO: 4 });

function clip(value, length = 300) {
  const chars = Array.from(String(value ?? ''));
  return chars.length > length ? `${chars.slice(0,length).join('')}…` : chars.join('');
}
function link(url, label = null) {
  const href = safeHref(url);
  return href ? html`<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${clip(label ?? href)}</a>` : clip(label ?? url);
}
function list(items, className = '') {
  return html`<ul class="${className}">${items.map(item=>html`<li>${item}</li>`)}</ul>`;
}
function sourceLinks(ids = []) {
  const links = ids.map(id=>SOURCES?.[id]).filter(Boolean).map(s=>link(s.url,s.title));
  return links.length ? list(links,'source-list') : '';
}
function resultText(value) {
  if (!value) return null;
  const normalized = String(value).replace(/^proxy_/, '');
  return RESULT_TEXT[normalized] || '無法判斷';
}
function card(finding, detail) {
  const shown = (finding.urls || []).slice(0, detail ? 50 : 5);
  const omitted = Math.max(0, (finding.count || 0) - shown.length);
  return html`<article class="finding-card severity-${finding.severity.toLowerCase()}">
    <div class="finding-meta"><span class="badge">${SEVERITY[finding.severity]}</span><span class="badge evidence">${EVIDENCE[finding.evidence]}</span><span class="case-id">${finding.id}</span></div>
    <h3>${finding.title}</h3><p>${finding.summary}</p>
    ${finding.why ? html`<h4>為什麼重要</h4><p>${finding.why}</p>` : ''}
    ${finding.fix ? html`<h4>建議修正</h4><p>${finding.fix}</p>` : ''}
    ${shown.length ? html`<h4>受影響網址</h4>${list(shown.map(u=>link(u)))}` : ''}
    ${omitted ? html`<p class="muted">另有 ${omitted} 筆</p>` : ''}
    ${finding.sources?.length ? html`<h4>依據</h4>${sourceLinks(finding.sources)}` : ''}
  </article>`;
}
function botTable(rows) {
  const groups = Object.keys(CATEGORIES).map(category => {
    const body = rows.filter(r=>r.category===category).map(r=>html`<tr><td>${r.token}</td><td>${r.company}</td><td>${r.status==='declared_allowed'?'robots.txt 未禁止':r.status==='declared_disallowed'?'⛔ robots.txt 禁止':'❔ 無法判斷'}</td><td>${r.blockedUrls?.length || 0}</td><td>${r.purpose}</td></tr>`);
    if (!body.length) return '';
    const note = category==='user_fetch' ? html`<p class="muted">${'這類爬蟲實際是否遵守 robots.txt 由各服務決定'}</p>` : '';
    return html`<section class="bot-group"><h3>${CATEGORIES[category]}</h3>${note}<div class="table-wrap"><table class="bot-table"><thead><tr><th>爬蟲</th><th>公司</th><th>首頁的 robots.txt 宣告</th><th>已檢查頁面被封鎖數</th><th>用途</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
  });
  return groups;
}
function detailedAppendix(snapshot) {
  const pageRows=(snapshot.pages||[]).map(p=>html`<tr><td>${link(p.finalUrl||p.url)}</td><td>${PAGE_BUCKET_TEXT[p.bucket] || '—'}</td><td>${p.status ?? '—'}</td><td>${resultText(p.error) || resultText(p.stop) || (p.isHtml?'HTML':'非 HTML')}</td><td>${clip(p.page?.title || '—')}</td></tr>`);
  const robotLines=String(snapshot.robots?.text||'').split(/\r\n|\n|\r/).slice(0,200).map(line=>clip(line,300)).join('\n');
  const mapRows=(snapshot.sitemaps||[]).map(s=>html`<tr><td>${link(s.url)}</td><td>${s.status ?? '—'}</td><td>${SITEMAP_KIND_TEXT[s.kind] || '無法判斷'}</td><td>${s.urlCount ?? 0}</td></tr>`);
  const uncrawled=Object.entries(snapshot.discovered||{}).filter(([,v])=>!v.crawled).map(([u])=>link(u));
  return html`<section><h2>已檢查頁面</h2><div class="table-wrap"><table><thead><tr><th>網址</th><th>類型</th><th>狀態</th><th>結果</th><th>標題</th></tr></thead><tbody>${pageRows}</tbody></table></div></section>
  <section><h2>robots.txt 原文</h2><pre>${robotLines}</pre></section>
  <section><h2>sitemap 摘要</h2><div class="table-wrap"><table><thead><tr><th>網址</th><th>狀態</th><th>類型</th><th>網址數</th></tr></thead><tbody>${mapRows}</tbody></table></div></section>
  <section><h2>未抓取清單</h2>${uncrawled.length?list(uncrawled):html`<p>${'沒有未抓取項目。'}</p>`}</section>`;
}

function homepageTextPreview(snapshot, detail) {
  if (!snapshot?.homeAnalyzable) return '';
  const pages = Array.isArray(snapshot.pages) ? snapshot.pages : [];
  const entry = pages.find(page => page?.page && (page.finalUrl === snapshot.home || page.url === snapshot.home))
    || (pages[0]?.page ? pages[0] : null);
  if (!entry?.page) return '';
  const headingLimit = detail ? 30 : 10;
  const headings = (Array.isArray(entry.page.headings) ? entry.page.headings : [])
    .filter(item => [1, 2, 3].includes(Number(item?.level)) && String(item?.text ?? ''))
    .slice(0, headingLimit);
  const outline = headings.length
    ? html`<ol class="heading-outline">${headings.map(item=>html`<li class="level-${Number(item.level)}">H${Number(item.level)}　${clip(item.text,200)}</li>`)}</ol>`
    : html`<p class="muted">（原始 HTML 裡沒有 H1–H3 標題）</p>`;
  const preview = String(entry.page.textPreview ?? '');
  const previewText = preview ? `${preview}${Number(entry.page.textLength) > 300 ? '…' : ''}` : '（原始 HTML 裡沒有可見文字）';
  return html`<section class="text-evidence"><div class="section-heading"><h2>爬蟲在首頁讀到的文字（未執行 JavaScript）</h2><span class="badge evidence">已驗證・不計分</span></div><p>${TEXT_PREVIEW_EXPLANATION}</p><h3>標題大綱</h3>${outline}<h3>前 300 字可見文字</h3><p class="text-preview">${previewText}</p></section>`;
}

function normalizedLineId(value) {
  const lineId = String(value ?? '').trim();
  return LINE_ID_PATTERN.test(lineId) ? lineId : null;
}

export function buildLineSummary(snapshot, findings, scoreObj) {
  const host = snapshot?.siteHost || '';
  let scorePart;
  let issuePart;
  if (scoreObj?.scoreStatus === 'unavailable') {
    scorePart = '無法評分';
    issuePart = ` 原因:${snapshot?.coverage?.reasons?.[0] || 'unknown'}`;
  } else {
    const suffix = scoreObj?.scoreStatus === 'sample_only' ? '(樣本)' : '';
    scorePart = `技術健康分數${scoreObj?.score ?? ''}${suffix}`;
    const ids = (Array.isArray(findings) ? findings : [])
      .filter(finding => finding?.scored === true)
      .slice()
      .sort((a,b) => (FINDING_SEVERITY_ORDER[a.severity] ?? 99) - (FINDING_SEVERITY_ORDER[b.severity] ?? 99)
        || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0))
      .slice(0,3)
      .map(finding => finding.id);
    issuePart = ids.length ? ` 待處理:${ids.join(',')}` : ' 無計分問題';
  }
  return Array.from(`SEO健檢 ${host} ${scorePart}${issuePart}`).slice(0,120).join('');
}

export function lineMessageUrl(lineId, summary) {
  return `https://line.me/R/oaMessage/${encodeURIComponent(String(lineId ?? ''))}/?${encodeURIComponent(String(summary ?? ''))}`;
}

function scoreCards(scoreObj, severityCounts, unavailableReasons) {
  const scoreStatus = scoreObj.scoreStatus;
  const status = scoreStatus === 'sample_only'
    ? html`<p class="score-status">樣本分數：本次只檢查部分頁面</p>`
    : scoreStatus === 'unavailable'
      ? html`<p class="score-status">無法評分</p><p class="muted">${unavailableReasons}</p>`
      : '';
  return html`<div class="score-row">
    <section class="score-panel"><div class="score-value"><p class="score-title">技術健康分數</p><strong>${scoreObj.score ?? '—'}</strong>${status}</div><div><h2>${GRADE_TEXT[scoreObj.grade]}</h2>${scoreObj.capped?html`<p>${scoreObj.counts.P0?'因為有阻斷級問題，分數上限為 40 分':'因為有高風險問題，分數上限為 79 分'}</p>`:''}${severityCounts}</div><p class="score-note">${SCORE_NOTE}</p></section>
    <section class="unchecked-card"><h2>本工具沒有檢查的項目</h2><p>${UNCHECKED_INTRO}</p>${list(UNCHECKED_ITEMS)}</section>
  </div>`;
}

function contactSection(snapshot, findings, scoreObj, contact, lineId, mobile) {
  if (!contact && !lineId) return '';
  if (!lineId) {
    return html`<section class="cta"><h2>需要完整健檢、修正與上線後追蹤？</h2><a class="button" href="${contact}" target="_blank" rel="noopener noreferrer nofollow">加入 LINE 官方帳號諮詢</a></section>`;
  }
  const summary = buildLineSummary(snapshot, findings, scoreObj);
  const messageUrl = lineMessageUrl(lineId, summary);
  if (mobile === true) {
    return html`<section class="cta"><h2>需要完整健檢、修正與上線後追蹤？</h2><a class="button" href="${messageUrl}" target="_blank" rel="noopener noreferrer nofollow">加入 LINE 官方帳號諮詢（自動帶入檢查摘要）</a><p class="muted">送出後我們會收到：${summary}</p>${contact?html`<p><a href="${contact}" target="_blank" rel="noopener noreferrer nofollow">或直接加入 LINE 官方帳號</a></p>`:''}</section>`;
  }
  let qr = '';
  try {
    qr = html`<div class="qr">${qrSvg(qrMatrix(messageUrl))}</div><p>用手機掃描，LINE 會自動帶入這份檢查摘要</p>`;
  } catch (error) {
    if (error?.message !== 'qr_too_long') throw error;
  }
  return html`<section class="cta"><h2>需要完整健檢、修正與上線後追蹤？</h2>${qr}<pre class="line-summary">${summary}</pre><button type="button" class="copy-summary no-print" data-copy="summary">複製摘要</button>${contact?html`<p><a class="button" href="${contact}" target="_blank" rel="noopener noreferrer nofollow">加入 LINE 官方帳號諮詢</a></p><p>加入後把上面的摘要貼給我們，就能直接討論這份報告。</p>`:''}</section>`;
}

export function renderReport(snapshot, findings, scoreObj, botRows, { detail=false, contactUrl=null, lineId='', mobile=false }={}) {
  const time = String(snapshot?.scannedAt || '').replace('T',' ').slice(0,16);
  const sectionSummary = Object.keys(SECTIONS).map(key=>{
    const count=findings.filter(f=>f.section===key&&f.scored).length;
    const label=scoreObj.scoreStatus==='unavailable'&&count===0?'未檢查':`${count} 個計分問題`;
    return html`<div class="summary-tile"><strong>${SECTIONS[key]}</strong><span>${label}</span></div>`;
  });
  const hideSeverityCounts=scoreObj.scoreStatus==='unavailable'&&['P0','P1','P2','P3'].every(key=>scoreObj.counts[key]===0);
  const severityCounts=hideSeverityCounts?'':html`<p>P0 ${scoreObj.counts.P0}　P1 ${scoreObj.counts.P1}　P2 ${scoreObj.counts.P2}　P3 ${scoreObj.counts.P3}</p>`;
  const priorities=findings.filter(f=>['P0','P1','P2'].includes(f.severity));
  const small=findings.filter(f=>f.severity==='P3');
  const info=findings.filter(f=>f.severity==='INFO');
  const normalizedContact = safeHref(contactUrl);
  const contact = normalizedContact?.startsWith('https:') ? normalizedContact : null;
  const validLineId = normalizedLineId(lineId);
  const coverageReasons = snapshot.coverage?.reasons || [];
  const reasonMessages = coverageReasons.includes('blocked_by_site')
    ? [BLOCKED_BY_SITE_COPY]
    : [...new Set(coverageReasons.map((reason) => COVERAGE_REASON_TEXT[reason] || '本次有無法完整判斷的項目'))];
  const unavailableReasons = reasonMessages.join('；') || '首頁或 robots.txt 無法可靠讀取';
  return String(html`<div class="report grade-${scoreObj.grade}">
    <header class="report-header"><h1>${'金水智連科技｜SEO／GEO 網站健檢（線上簡易版）'}</h1><dl><div><dt>網站</dt><dd>${link(snapshot.home||snapshot.startUrl)}</dd></div><div><dt>檢查時間</dt><dd>${time}</dd></div><div><dt>檢查頁數</dt><dd>${snapshot.limits?.crawled ?? snapshot.pages?.length ?? 0}／15</dd></div></dl></header>
    ${scoreCards(scoreObj,severityCounts,unavailableReasons)}
    <section><h2>三區塊摘要</h2><div class="summary-grid">${sectionSummary}</div></section>
    ${homepageTextPreview(snapshot,detail)}
    <section><h2>robots.txt 對各爬蟲的宣告（不代表防火牆的實際放行）</h2><p>${BOT_TABLE_EXPLANATION}</p>${sourceLinks(['cloudflare-ai-default'])}${botTable(botRows||[])}</section>
    <section><h2>優先處理</h2>${priorities.length?priorities.map(f=>card(f,detail)):html`<p class="empty-state">${'本次樣本沒有發現 P0–P2 問題。'}</p>`}</section>
    <section><h2>小建議</h2>${small.length?(detail?small.map(f=>card(f,true)):list(small.map(f=>`${f.title}（${f.count}）`))):html`<p>${'沒有低風險建議。'}</p>`}</section>
    <section><h2>資訊</h2>${detail?info.map(f=>card(f,true)):html`<p>${info.length} 項資訊</p>`}</section>
    ${detail?detailedAppendix(snapshot):''}
    <section class="notice"><h2>關於 llms.txt</h2><p>${LLMS}</p></section>
    <section><h2>能證明／不能證明</h2><h3>能證明</h3><p>${CAN_PROVE}</p><h3>不能證明</h3><p>${CANNOT_PROVE}</p></section>
    <section><h2>檢查範圍與限制</h2>${list(LIMIT_TEXT)}<p class="muted"><a href="/bot.html">本工具爬蟲（KinsuiSEOCheck）的說明與封鎖方式</a></p></section>
    ${contactSection(snapshot,findings,scoreObj,contact,validLineId,mobile)}
    <footer>本報告由金水智連科技 SEO／GEO 線上健檢產生　${time}　v${VERSION}</footer>
  </div>`);
}
