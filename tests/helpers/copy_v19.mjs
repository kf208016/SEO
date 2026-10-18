// SPEC-002 (v1.9) fixed copy, verbatim. Kept apart from copy.mjs so the v1.8 file only changes where §10 says so.

// §1.1 GEO table
export const GEO_TABLE_TITLE = 'robots.txt 對各爬蟲的宣告（不代表防火牆的實際放行）';
export const GEO_TABLE_NOTE =
  '這張表只反映 robots.txt 的宣告，不代表爬蟲實際進得來。網站的防火牆或 CDN 可能另外阻擋特定爬蟲：Cloudflare 自 2025 年 7 月起，新加入的網域預設封鎖已知的 AI 爬蟲；其他防火牆也可能有類似規則。本工具不偽裝身分，無法驗證各家爬蟲實際是否被擋，請網站管理者查看防火牆或 Cloudflare 的紀錄確認。';
export const GEO_STATUS = { declared_allowed: 'robots.txt 未禁止', declared_disallowed: '⛔ robots.txt 禁止', unknown: '❔ 無法判斷' };
export const GEO_HOME_HEADER = '首頁的 robots.txt 宣告';
export const OLD_GEO_TABLE_TITLE = 'robots.txt 對各爬蟲的規則';
export const OLD_GEO_HOME_HEADER = '首頁規則';

// §1.2 G12
export const G12 = {
  title: 'robots.txt 宣告了 Content Signals',
  // {list}: items like `search=yes, ai-input=no, ai-train=no（適用 *）` joined by 「、」
  summary:
    'robots.txt 以 Content-Signal 宣告：{list}。這是 Cloudflare 推動的偏好宣告（search＝搜尋索引、ai-input＝AI 即時引用、ai-train＝AI 訓練），不是技術上的封鎖；各家爬蟲是否遵守由其自行決定。本項不計分。',
};

// §1.3 new sources
export const NEW_SOURCES = {
  'cloudflare-ai-default': ['Cloudflare：新網域預設封鎖 AI 爬蟲（2025-07）', 'https://blog.cloudflare.com/content-independence-day-no-ai-crawl-without-compensation/'],
  'content-signals': ['Content Signals Policy', 'https://contentsignals.org/'],
  'cloudflare-robots': ['Cloudflare：代管 robots.txt', 'https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/'],
  'google-hreflang': ['Google：告訴 Google 網頁的本地化版本', 'https://developers.google.com/search/docs/specialty/international/localized-versions'],
  'line-url-scheme': ['LINE：LINE URL scheme', 'https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/'],
};

// §2.2 text preview block
export const PREVIEW_TITLE = '爬蟲在首頁讀到的文字（未執行 JavaScript）';
export const PREVIEW_BADGE = '已驗證・不計分';
export const PREVIEW_NOTE =
  '以下是首頁原始 HTML 裡的標題與前 300 字可見文字。Google 會另外執行 JavaScript，其他 AI 爬蟲沒有保證；如果這裡幾乎沒有文字，或看不到產品與服務的說明，不執行 JavaScript 的爬蟲就讀不到。';
export const PREVIEW_NO_HEADINGS = '（原始 HTML 裡沒有 H1–H3 標題）';
export const PREVIEW_NO_TEXT = '（原始 HTML 裡沒有可見文字）';

// §2.3 C14
export const C14 = {
  title: '頁面的主要內容可能只有圖片',
  summary: '這些頁面主要區域的原始 HTML 文字不到 120 字，卻有 3 張以上圖片。人看得到圖片裡的文字，搜尋引擎與 AI 爬蟲讀不到；請確認產品名稱、規格與說明有用文字寫在頁面上。',
  fix: '把圖片裡的重點（品名、規格、價格、服務說明）改成網頁文字；圖片保留並補上說明文字（alt）。',
};

// §3 score card and the "not checked" card
export const SCORE_TITLE = '技術健康分數';
export const SCORE_SAMPLE_ONLY = '樣本分數：本次只檢查部分頁面';
export const SCORE_UNAVAILABLE = '無法評分';
export const SCORE_NOTE = '只代表本次讀到的頁面在技術上讓搜尋引擎讀得到、讀得懂；不是排名分數，也不代表會被 AI 引用。';
export const NOT_CHECKED_TITLE = '本工具沒有檢查的項目';
export const NOT_CHECKED_SUBTITLE = '這些項目決定實際排名與 AI 引用，需要 Search Console 權限或人工檢查：';
export const NOT_CHECKED_ITEMS = [
  '關鍵字與買家搜尋需求是否對應',
  '外部連結與品牌被提及的情況',
  '網頁速度（Core Web Vitals）',
  '防火牆或 CDN 對各家爬蟲的實際放行',
  'Search Console 的收錄與成效資料',
];

// §4.3 CTA
export const CTA_TITLE = '需要完整健檢、修正與上線後追蹤？';
export const CTA_MOBILE_BUTTON = '加入 LINE 官方帳號諮詢（自動帶入檢查摘要）';
export const CTA_MOBILE_NOTE_PREFIX = '送出後我們會收到：';
export const CTA_MOBILE_SECONDARY = '或直接加入 LINE 官方帳號';
export const CTA_QR_NOTE = '用手機掃描，LINE 會自動帶入這份檢查摘要';
export const CTA_COPY_BUTTON = '複製摘要';
export const CTA_DESKTOP_BUTTON = '加入 LINE 官方帳號諮詢';
export const CTA_DESKTOP_NOTE = '加入後把上面的摘要貼給我們，就能直接討論這份報告。';

// §5 small fixes
export const T02_SUMMARY =
  '本工具讀取 robots.txt 時伺服器回應 {status}。這可能是伺服器出錯，也可能是對不知名爬蟲的流量限制。若 Google 也收到相同回應，依 Google 文件，前 12 小時 Google 會暫停爬取整個網站，之後才改用先前的快取版本；請網站管理者查看伺服器紀錄，確認 Googlebot 收到的回應。';
export const C12_SUMMARY =
  'Google 自 2023 年 8 月起只對少數政府與健康類網站顯示 FAQ 複合式搜尋結果，並於 2026-05-07 全面停止顯示，2026 年 6 月移除相關文件。標記可以保留，但不會再有展開效果；問答內容本身對讀者仍有幫助。';
export const G03_SUMMARY =
  'robots.txt 對 {tokens} 宣告封鎖。這些控制的是 AI 模型訓練，不會封鎖另外列出的搜尋用爬蟲（例如 Googlebot、OAI-SearchBot）；其他後續用途本工具無法判斷。封鎖後，這些模型的內建知識可能較少提到貴公司；要不要開放是經營上的決定，不算問題。';
export const USER_AGENT = 'Mozilla/5.0 (compatible; KinsuiSEOCheck/1.0; +https://seo-geo-check.fanyuchieh.workers.dev/bot.html)';
export const BOT_PAGE_TITLE = 'KinsuiSEOCheck 爬蟲說明｜金水智連科技';
export const BOT_PAGE_SENTENCES = [
  'KinsuiSEOCheck 是金水智連科技「SEO／GEO 網站健檢（線上簡易版）」使用的讀取程式。',
  '只有在真人於本站輸入網址並通過人機驗證後，才會讀取該網站；不會定期掃描任何網站。',
  '每次檢查最多讀取：robots.txt 8 次、sitemap 4 次、網頁 15 頁（含轉址最多 30 次請求）、探測 2 次；兩次請求至少間隔 200 毫秒；單次回應最多讀取 2 MB。',
  '本程式遵守 robots.txt；不希望被讀取時，請加入：',
  '本程式從 Cloudflare Workers 發出請求，沒有固定 IP 位址。',
];
export const BOT_PAGE_LINKS = ['https://lin.ee/8xXGMUU', 'https://goldwatersmartlink.com.tw/'];
export const REPORT_BOT_LINK_TEXT = '本工具爬蟲（KinsuiSEOCheck）的說明與封鎖方式';

// §6.4 bucket labels in the detail-mode page table
export const BUCKET_LABEL = { home: '首頁', start: '起始網址', product: '產品／服務', content: '內容／分類', trust: '關於／聯絡', other: '其他', excluded: '低價值' };

// §7.2 hreflang
export const T40 = { title: 'hreflang 標記有誤', summary: '頁面的 hreflang 使用了無效的語言／地區代碼、無效網址，或指向不存在的頁面。' };
export const T41 = { title: 'hreflang 沒有列出頁面自己', summary: '依 Google 文件，每個語言版本都要列出自己與所有其他版本，否則整組標記可能被忽略。' };
export const T42 = { title: '網站似乎有多語言版本，但沒有 hreflang', summary: '首頁有語系切換連結，卻沒有 hreflang 標記。hreflang 可以幫 Google 在不同語言或地區的搜尋結果中選對版本；單一語言的網站不需要。' };

// §4.1
export const LINE_ID = '@760zrres';
export const LINE_ID_RE = /^@[A-Za-z0-9_.-]{1,40}$/;
