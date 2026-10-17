const MAX_URLS = 5000;

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (whole, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const point = Number.parseInt(lower.slice(2), 16);
      try { return String.fromCodePoint(point); } catch { return whole; }
    }
    if (lower.startsWith('#')) {
      const point = Number.parseInt(lower.slice(1), 10);
      try { return String.fromCodePoint(point); } catch { return whole; }
    }
    return named[lower] ?? whole;
  });
}

function locValue(raw) {
  const source = String(raw);
  const cdata = source.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/u);
  return cdata ? cdata[1].trim() : decodeEntities(source).trim();
}

function firstElementName(text) {
  let offset = 0;
  while (offset < text.length) {
    const start = text.indexOf('<', offset);
    if (start < 0) return null;
    if (text.startsWith('<!--', start)) {
      const end = text.indexOf('-->', start + 4);
      if (end < 0) return null;
      offset = end + 3;
      continue;
    }
    if (text.startsWith('<?', start)) {
      const end = text.indexOf('?>', start + 2);
      if (end < 0) return null;
      offset = end + 2;
      continue;
    }
    if (text.startsWith('<![CDATA[', start)) {
      const end = text.indexOf(']]>', start + 9);
      if (end < 0) return null;
      offset = end + 3;
      continue;
    }
    if (text.startsWith('<!', start)) {
      let quote = null;
      let subsetDepth = 0;
      let end = start + 2;
      for (; end < text.length; end += 1) {
        const char = text[end];
        if (quote) {
          if (char === quote) quote = null;
        } else if (char === '"' || char === "'") quote = char;
        else if (char === '[') subsetDepth += 1;
        else if (char === ']') subsetDepth = Math.max(0, subsetDepth - 1);
        else if (char === '>' && subsetDepth === 0) break;
      }
      if (end >= text.length) return null;
      offset = end + 1;
      continue;
    }
    const match = text.slice(start).match(/^<(?:(?:[A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)\b/u);
    if (match) return match[1].toLowerCase();
    offset = start + 1;
  }
  return null;
}

export function parseSitemap(input) {
  const text = String(input ?? '').replace(/^\uFEFF/u, '');
  const root = firstElementName(text);
  const kind = root === 'urlset' ? 'urlset' : root === 'sitemapindex' ? 'index' : 'invalid';
  if (kind === 'invalid') return { kind, urls: [], error: 'invalid_root' };
  const urls = [];
  const re = /<(?:[A-Za-z_][\w.-]*:)?loc\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?loc\s*>/giu;
  let match;
  while (urls.length < MAX_URLS && (match = re.exec(text))) {
    const value = locValue(match[1]);
    if (value) urls.push(value);
  }
  return { kind, urls, error: null };
}

export function looksLikeHtml(input, contentType) {
  if (/text\/html/iu.test(String(contentType ?? ''))) return true;
  const prefix = String(input ?? '').trimStart().slice(0, 1024);
  return /<!doctype\s+html\b|<html\b/iu.test(prefix);
}
