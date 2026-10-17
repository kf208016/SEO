export const OUR_TOKEN = 'kinsuiseocheck';

export const BOTS = Object.freeze([
  { token: 'Googlebot', company: 'Google', category: 'search_engine', purpose: 'Google 搜尋，包含 AI 摘要（AI Overviews）與 AI 模式', source: 'google-crawlers' },
  { token: 'Bingbot', company: 'Microsoft', category: 'search_engine', purpose: 'Bing 搜尋；Microsoft Copilot 的網頁答案也使用 Bing 的資料', source: 'bing-chat-controls' },
  { token: 'OAI-SearchBot', company: 'OpenAI', category: 'ai_search', purpose: 'ChatGPT 搜尋的索引；封鎖後不會出現在 ChatGPT 搜尋答案中', source: 'openai-bots' },
  { token: 'Claude-SearchBot', company: 'Anthropic', category: 'ai_search', purpose: '提升 Claude 搜尋結果；封鎖可能降低在 Claude 搜尋回答中的能見度', source: 'anthropic-bots' },
  { token: 'PerplexityBot', company: 'Perplexity', category: 'ai_search', purpose: '在 Perplexity 搜尋結果中顯示並連結網站', source: 'perplexity-bots' },
  { token: 'Applebot', company: 'Apple', category: 'ai_search', purpose: 'Spotlight、Siri、Safari 的搜尋功能', source: 'apple-bots' },
  { token: 'GPTBot', company: 'OpenAI', category: 'training', purpose: '可能用於訓練 OpenAI 模型；與 ChatGPT 搜尋無關', source: 'openai-bots' },
  { token: 'ClaudeBot', company: 'Anthropic', category: 'training', purpose: '可能用於訓練 Anthropic 模型', source: 'anthropic-bots' },
  { token: 'Google-Extended', company: 'Google', category: 'training', purpose: '控制 Gemini 模型訓練與部分 grounding；不影響 Google 搜尋收錄與排名', source: 'google-crawlers' },
  { token: 'Applebot-Extended', company: 'Apple', category: 'training', purpose: '控制 Apple 生成式模型訓練；不影響 Apple 搜尋', source: 'apple-bots' },
  { token: 'CCBot', company: 'Common Crawl', category: 'training', purpose: 'Common Crawl 公開網頁資料集，是許多 AI 模型的訓練資料來源之一', source: 'ccbot' },
  { token: 'ChatGPT-User', company: 'OpenAI', category: 'user_fetch', purpose: '使用者在 ChatGPT 要求讀取網頁時使用；官方表示 robots.txt 不一定適用', source: 'openai-bots' },
  { token: 'Claude-User', company: 'Anthropic', category: 'user_fetch', purpose: '使用者在 Claude 要求讀取網頁時使用；封鎖可能降低使用者導向搜尋的能見度', source: 'anthropic-bots' },
  { token: 'Perplexity-User', company: 'Perplexity', category: 'user_fetch', purpose: '使用者提問時即時讀取；官方表示通常不遵守 robots.txt', source: 'perplexity-bots' },
]);
