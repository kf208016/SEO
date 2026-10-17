// SPEC-001 §8 / §9 fixed copy, verbatim.
export const COPY = {
  T02: {
    title: 'robots.txt 讀取時伺服器出錯',
    summary: '讀取 robots.txt 時伺服器回應 {status}。若 Google 也收到相同回應，依 Google 文件，前 12 小時 Google 會暫停爬取整個網站，之後才改用先前的快取版本。',
  },
  T03: {
    title: 'Google 被 robots.txt 擋在門外',
    summary: 'robots.txt 禁止 Googlebot 抓取首頁，Google 讀不到首頁內容。網址仍可能出現在搜尋結果，但不會有正常的標題與摘要，也不符合被 AI 摘要（AI Overviews）引用的條件（頁面必須能顯示摘要）。',
    fix: '刪除或修改 robots.txt 裡對 Googlebot 或 *（所有爬蟲）的 Disallow: / 規則。常見原因是網站開發期間的設定，上線後忘了移除。',
  },
  T04: {
    title: '首頁設定了 noindex（禁止收錄）',
    summary: '首頁要求搜尋引擎不要收錄。Google 重新抓取並處理後，首頁通常會從搜尋結果移除。',
    fix: '移除首頁的 <meta name="robots" content="noindex"> 或 X-Robots-Tag: noindex。WordPress 網站請檢查「設定 → 閱讀」裡的「阻止搜尋引擎索引這個網站」是否被勾選。',
  },
  T11: {
    title: '隨機網址也回應 200',
    summary: '本工具請求一個隨機產生、應該不存在的網址，伺服器回應 200（成功）。如果這個網址確實不存在，伺服器應該回應 404 或 410，否則搜尋引擎可能把錯誤頁當成一般網頁。',
  },
  T16: { fixEnd: '如果是刻意設定（例如內容聯播），可以忽略這一項。' },
  T19: { title: 'robots.txt 宣告的 sitemap 有問題' },
  T18: {
    title: '沒有在常見位置找到 sitemap',
    summary: '沒有在 robots.txt 宣告的位置或 /sitemap.xml 找到 sitemap。小型網站只要內部連結完整，沒有 sitemap 也能被找到；網頁多或經常更新時建議提供。本項不計分。',
  },
  T22: {
    title: '沒有 robots.txt',
    summary: '沒有 robots.txt 等於允許所有爬蟲讀取，這不是錯誤。',
  },
  G01: {
    title: 'robots.txt 封鎖了 AI 搜尋的爬蟲',
    summary: 'robots.txt 對 {tokens} 宣告封鎖。這些爬蟲負責 AI 搜尋的索引，如果它們遵守這個規則，網站就比較難出現在對應的 AI 搜尋答案中。如果是刻意的選擇，可以忽略這一項。',
  },
  G02: {
    title: 'robots.txt 封鎖了 Bingbot',
    summary: 'robots.txt 對 Bingbot 宣告封鎖。如果 Bingbot 遵守這個規則，網站就比較難出現在 Bing 搜尋，以及使用 Bing 資料的 Microsoft Copilot 答案中。如果是刻意的選擇，可以忽略這一項。',
  },
  G03: {
    title: 'robots.txt 封鎖了 AI 訓練用的爬蟲',
    summary: 'robots.txt 對 {tokens} 宣告封鎖。這些控制的是 AI 模型訓練，不會封鎖另外列出的搜尋用爬蟲（例如 Googlebot、OAI-SearchBot）；其他後續用途本工具無法判斷。這是經營者的選擇，不算問題。',
  },
  G04: {
    summary: 'robots.txt 對 {tokens} 宣告封鎖。這類爬蟲是在使用者要求時即時讀取網頁，官方表示不一定遵守 robots.txt，實際效果無法判斷。',
  },
  G05: {
    title: '頁面禁止顯示摘要（nosnippet）',
    summary: '設定 nosnippet 或 max-snippet:0 的頁面不能在搜尋結果顯示摘要；依 Google 說明，頁面必須能顯示摘要才符合出現在 AI 摘要與 AI 模式的條件。如果希望出現在 Google 的 AI 功能，才需要調整。',
  },
  G06: {
    title: '主要內容可能要執行 JavaScript 才看得到',
    summary: '原始 HTML 裡幾乎沒有文字。Google 會嘗試執行 JavaScript，但有條件也可能延遲；其他 AI 爬蟲是否執行 JavaScript 沒有官方保證。把主要內容放在原始 HTML 裡最保險。',
  },
  G07: {
    summary: 'Organization／LocalBusiness 標記可以幫搜尋引擎確認品牌名稱、網址、標誌與聯絡方式。Google 表示 AI 搜尋不需要特殊標記，所以這是建議，不是必要條件；只能填寫真實資訊。本項不計分。',
  },
  C11: { title: 'JSON-LD 語法無法解析' },
  C12: {
    title: '使用了 FAQ 結構化資料',
    summary: 'Google 自 2026-05-07 起不再顯示 FAQ 複合式搜尋結果（問答展開），2026 年 6 月移除相關文件。標記可以保留，但不會再有展開效果；問答內容本身對讀者仍有幫助。',
  },
};

export const LIGHTS = {
  green: '本次讀取的頁面沒有發現阻斷或高風險問題（不代表整站沒有問題）',
  yellow: '基礎可用，有需要修正的項目，或本次檢查不完整',
  red: '有阻斷級或重大問題',
  gray: '無法完成檢查，沒有評分',
};

export const CAN_PROVE = '本次檢查直接觀察到：本工具從 Cloudflare 讀取這些網頁時收到的回應，以及原始 HTML 和 robots.txt 裡的設定（收錄控制、網址與轉址、標題、結構化資料、爬蟲規則）。';
export const CANNOT_PROVE = '搜尋排名、是否已被收錄、會不會被 AI 引用、實際流量或業績。搜尋引擎與 AI 爬蟲實際收到的回應可能和本工具不同（例如防火牆對不同爬蟲有不同規則）。分數只反映本次樣本的技術狀況，不是排名分數。Google 表示 AI 搜尋沿用一般 SEO 的基礎，沒有保證被引用的特殊做法。';
export const SCOPE_LIMITS = [
  '線上簡易版最多讀取 15 頁，只看原始 HTML，沒有執行 JavaScript。',
  '沒有量測網頁速度（Core Web Vitals），也沒有讀取 Search Console 的實際成效資料。',
  '被防火牆、人機驗證或流量限制擋下的頁面列為「無法驗證」，不代表該頁有問題。',
  '本工具遵守 robots.txt 對本工具（KinsuiSEOCheck）的規則；被禁止的頁面不會讀取。',
];
export const LLMS_TXT = 'Google 表示 Google 搜尋不使用 llms.txt，有沒有都不影響 Google 排名與 AI 摘要；其他 AI 服務是否讀取各自不同。所以本工具不檢查、也不計分。';

export const REPORT_TITLE = '金水智連科技｜SEO／GEO 網站健檢（線上簡易版）';
export const FOOTER = '本報告由金水智連科技 SEO／GEO 線上健檢產生';
export const CTA_TITLE = '需要完整健檢、修正與上線後追蹤？';
export const CTA_BUTTON = '加入 LINE 官方帳號諮詢';
export const CAPPED_P0 = '因為有阻斷級問題，分數上限為 40 分';
export const CAPPED_P1 = '因為有高風險問題，分數上限為 79 分';
export const BOT_TABLE_TITLE = 'robots.txt 對各爬蟲的規則';
export const BOT_GROUPS = ['搜尋引擎', 'AI 搜尋', 'AI 訓練', '使用者即時讀取'];
export const BOT_STATUS = { declared_allowed: '✅ 規則允許', declared_disallowed: '⛔ 規則封鎖', unknown: '❔ 無法判斷' };
export const USER_FETCH_NOTE = '這類爬蟲實際是否遵守 robots.txt 由各服務決定';
export const SEVERITY_LABEL = { P0: '阻斷', P1: '高', P2: '中', P3: '低', INFO: '資訊' };
export const EVIDENCE_LABEL = { verified: '已驗證', inferred: '推論', unverifiable: '無法驗證' };

// Split a template with one {placeholder} into [prefix, suffix].
export function splitTemplate(t, name) {
  const i = t.indexOf('{' + name + '}');
  return [t.slice(0, i), t.slice(i + name.length + 2)];
}
