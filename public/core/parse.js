import { cleanUrl } from './url.js';

export const PARSE_LIMITS = Object.freeze({
  links: 2000,
  images: 1000,
  jsonldBlocks: 50,
  jsonldChars: 100000,
  jsonDepth: 32,
  jsonNodes: 10000,
  textChars: 200000,
});

const UTF8 = new TextEncoder();
const SKIP_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'CANVAS', 'OBJECT']);
const SPA_IDS = ['root', 'app', '__next', '__nuxt', 'svelte', '___gatsby'];

export function normText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function nonempty(value) {
  const result = String(value ?? '').trim();
  return result === '' ? null : result;
}

function attribute(node, name) {
  if (!node) return null;
  const direct = node.getAttribute(name);
  if (direct != null) return direct;
  const wanted = name.toLowerCase();
  for (const item of Array.from(node.attributes || [])) {
    if (String(item.name).toLowerCase() === wanted) return item.value;
  }
  return null;
}

function hasAttributeCI(node, name) {
  return attribute(node, name) != null;
}

function charsetFromContentType(contentType) {
  const match = String(contentType ?? '').match(/(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/iu);
  return match ? (match[1] || match[2] || match[3]).trim() : null;
}

function attrsFromTag(tag) {
  const attrs = new Map();
  const body = tag.replace(/^<meta\b|\/?\s*>$/giu, '');
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  let match;
  while ((match = re.exec(body))) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function charsetFromMeta(bytes) {
  const prefix = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  const tags = prefix.match(/<meta\b[^>]*>/giu) || [];
  for (const tag of tags) {
    const attrs = attrsFromTag(tag);
    if (attrs.has('charset')) return attrs.get('charset');
    if ((attrs.get('http-equiv') || '').trim().toLowerCase() === 'content-type') {
      const charset = charsetFromContentType(attrs.get('content'));
      if (charset) return charset;
    }
  }
  return null;
}

function supportedDecoder(label) {
  try {
    return new TextDecoder(label, { fatal: false });
  } catch {
    return new TextDecoder('utf-8', { fatal: false });
  }
}

export function decodeBody(input, contentType) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  let charset = null;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) charset = 'utf-8';
  else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) charset = 'utf-16le';
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) charset = 'utf-16be';
  charset ||= charsetFromContentType(contentType);
  charset ||= charsetFromMeta(bytes);
  charset ||= 'utf-8';
  return supportedDecoder(charset).decode(bytes);
}

export function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const byte of UTF8.encode(String(value ?? ''))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function visibleText(root, maxChars = Infinity) {
  if (!root) return { text: '', overflow: false };
  const parts = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (node.nodeType === 3) {
      const value = node.nodeValue || '';
      if (value) parts.push(value);
      continue;
    }
    if (node.nodeType === 1 && SKIP_TEXT.has(String(node.tagName).toUpperCase())) continue;
    const children = node.childNodes || [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  const normalized = normText(parts.join(' '));
  const chars = Array.from(normalized);
  return { text: chars.slice(0, maxChars).join(''), overflow: chars.length > maxChars };
}

function directiveList(nodes) {
  const values = [];
  const seen = new Set();
  for (const node of nodes) {
    for (const raw of String(attribute(node, 'content') ?? '').split(',')) {
      const value = raw.trim().toLowerCase();
      if (value && !seen.has(value)) {
        seen.add(value);
        values.push(value);
      }
    }
  }
  return values;
}

function collectJsonTypes(value, limitsHit) {
  const types = [];
  const seenTypes = new Set();
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > PARSE_LIMITS.jsonNodes) {
      limitsHit.add('jsonNodes');
      break;
    }
    if (current.depth > PARSE_LIMITS.jsonDepth) {
      limitsHit.add('jsonDepth');
      continue;
    }
    const item = current.value;
    if (!item || typeof item !== 'object') continue;
    if (!Array.isArray(item) && Object.hasOwn(item, '@type')) {
      const rawTypes = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
      for (const raw of rawTypes) {
        const type = nonempty(raw);
        if (type && !seenTypes.has(type)) {
          seenTypes.add(type);
          types.push(type);
        }
      }
    }
    const children = Array.isArray(item) ? item : Object.values(item);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      if (children[i] && typeof children[i] === 'object') stack.push({ value: children[i], depth: current.depth + 1 });
    }
  }
  return types;
}

function metaElements(doc, attributeName, values) {
  const wanted = new Set(values.map((value) => value.toLowerCase()));
  return Array.from(doc.querySelectorAll('meta, META')).filter((node) =>
    wanted.has(String(attribute(node, attributeName) || '').trim().toLowerCase()));
}

function firstNamedMeta(doc, values, attributes = ['name']) {
  for (const node of doc.querySelectorAll('meta, META')) {
    const matched = attributes.some((name) => values.includes(String(attribute(node, name) || '').trim().toLowerCase()));
    if (matched) return nonempty(attribute(node, 'content'));
  }
  return null;
}

function positiveDimension(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export function extractPage(doc, pageUrl) {
  const limitsHit = new Set();
  const titles = Array.from(doc.querySelectorAll('title, TITLE'));
  const title = nonempty(titles[0]?.textContent);
  const metaDescription = firstNamedMeta(doc, ['description']);
  const metaRobots = directiveList(metaElements(doc, 'name', ['robots', 'googlebot']));
  const metaBingbot = directiveList(metaElements(doc, 'name', ['bingbot']));

  let baseUrl = pageUrl;
  const baseNode = Array.from(doc.querySelectorAll('base, BASE')).find((node) => hasAttributeCI(node, 'href'));
  const baseHref = nonempty(attribute(baseNode, 'href'));
  if (baseHref) baseUrl = cleanUrl(baseHref, pageUrl) || pageUrl;

  const canonicalNodes = Array.from(doc.querySelectorAll('link, LINK')).filter((node) =>
    String(attribute(node, 'rel') || '').split(/\s+/u).some((part) => part.toLowerCase() === 'canonical'));
  const canonicals = [];
  const canonicalSeen = new Set();
  for (const node of canonicalNodes) {
    const href = nonempty(attribute(node, 'href'));
    const url = href ? cleanUrl(href, baseUrl) : null;
    if (url && !canonicalSeen.has(url)) {
      canonicalSeen.add(url);
      canonicals.push(url);
    }
  }

  const jsonld = [];
  const jsonNodes = Array.from(doc.querySelectorAll('script, SCRIPT')).filter((node) =>
    String(attribute(node, 'type') || '').trim().toLowerCase() === 'application/ld+json');
  if (jsonNodes.length > PARSE_LIMITS.jsonldBlocks) limitsHit.add('jsonldBlocks');
  for (const node of jsonNodes.slice(0, PARSE_LIMITS.jsonldBlocks)) {
    const source = String(node.textContent || '').trim();
    if (Array.from(source).length > PARSE_LIMITS.jsonldChars) {
      limitsHit.add('jsonldChars');
      jsonld.push({ ok: false, types: [], error: 'too_large' });
      continue;
    }
    try {
      const value = JSON.parse(source);
      jsonld.push({ ok: true, types: collectJsonTypes(value, limitsHit), error: null });
    } catch {
      jsonld.push({ ok: false, types: [], error: 'invalid_json' });
    }
  }

  const linkNodes = Array.from(doc.querySelectorAll('a, A, area, AREA')).filter((node) => hasAttributeCI(node, 'href'));
  if (linkNodes.length > PARSE_LIMITS.links) limitsHit.add('links');
  const links = [];
  for (const node of linkNodes) {
    const url = cleanUrl(attribute(node, 'href'), baseUrl);
    if (!url) continue;
    if (links.length >= PARSE_LIMITS.links) {
      limitsHit.add('links');
      break;
    }
    links.push({
      url,
      rel: String(attribute(node, 'rel') || '').trim().toLowerCase(),
      text: normText(node.textContent || ''),
    });
  }

  const imageNodes = Array.from(doc.querySelectorAll('img, IMG'));
  if (imageNodes.length > PARSE_LIMITS.images) limitsHit.add('images');
  const images = imageNodes.slice(0, PARSE_LIMITS.images).map((node) => ({
    src: nonempty(attribute(node, 'src')) ? cleanUrl(attribute(node, 'src'), baseUrl) : null,
    hasAlt: hasAttributeCI(node, 'alt'),
    alt: hasAttributeCI(node, 'alt') ? String(attribute(node, 'alt') ?? '').trim() : null,
    width: positiveDimension(attribute(node, 'width')),
    height: positiveDimension(attribute(node, 'height')),
  }));

  const insecureResources = [];
  for (const node of doc.querySelectorAll('script, SCRIPT, iframe, IFRAME')) {
    if (!hasAttributeCI(node, 'src')) continue;
    const url = cleanUrl(attribute(node, 'src'), baseUrl);
    if (url?.startsWith('http://')) insecureResources.push({ tag: node.tagName.toLowerCase(), url });
  }
  for (const node of doc.querySelectorAll('link, LINK')) {
    if (!hasAttributeCI(node, 'href')) continue;
    const rels = String(attribute(node, 'rel') || '').toLowerCase().split(/\s+/u);
    if (!rels.includes('stylesheet')) continue;
    const url = cleanUrl(attribute(node, 'href'), baseUrl);
    if (url?.startsWith('http://')) insecureResources.push({ tag: 'stylesheet', url });
  }

  const textResult = visibleText(doc.body || doc.documentElement || doc, PARSE_LIMITS.textChars);
  if (textResult.overflow) limitsHit.add('textChars');
  let spaRoot = null;
  for (const id of SPA_IDS) {
    spaRoot = doc.getElementById(id);
    if (spaRoot) break;
  }
  const spaText = spaRoot ? visibleText(spaRoot, PARSE_LIMITS.textChars).text : null;

  let metaRefresh = null;
  for (const node of doc.querySelectorAll('meta, META')) {
    if (String(attribute(node, 'http-equiv')).trim().toLowerCase() !== 'refresh') continue;
    const content = String(attribute(node, 'content') || '');
    const match = content.match(/^\s*(\d+(?:\.\d+)?)\s*;\s*url\s*=\s*(.*?)\s*$/iu);
    if (!match) continue;
    const url = cleanUrl(match[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, '$1$2'), baseUrl);
    if (url) metaRefresh = { delay: Number(match[1]), url };
    break;
  }

  const scripts = Array.from(doc.querySelectorAll('script, SCRIPT')).filter((node) =>
    String(attribute(node, 'type') || '').trim().toLowerCase() !== 'application/ld+json');

  return {
    url: pageUrl,
    title,
    titleCount: titles.length,
    metaDescription,
    metaRobots,
    metaBingbot,
    canonicals,
    canonicalTagCount: canonicalNodes.length,
    h1: nonempty(doc.querySelector('h1, H1')?.textContent),
    lang: nonempty(attribute(doc.documentElement, 'lang')),
    hasViewport: metaElements(doc, 'name', ['viewport']).length > 0,
    og: {
      title: firstNamedMeta(doc, ['og:title'], ['property', 'name']),
      description: firstNamedMeta(doc, ['og:description'], ['property', 'name']),
      image: firstNamedMeta(doc, ['og:image'], ['property', 'name']),
      url: firstNamedMeta(doc, ['og:url'], ['property', 'name']),
    },
    jsonld,
    links,
    images,
    insecureResources,
    textLength: Array.from(textResult.text).length,
    textHash: fnv1a(textResult.text),
    scriptCount: scripts.length,
    scriptSrcCount: scripts.filter((node) => hasAttributeCI(node, 'src')).length,
    hasSpaRoot: Boolean(spaRoot),
    spaRootTextLength: spaText === null ? null : Array.from(spaText).length,
    dataNosnippetCount: Array.from(doc.querySelectorAll('*')).filter((node) => hasAttributeCI(node, 'data-nosnippet')).length,
    metaRefresh,
    limitsHit: Array.from(limitsHit),
  };
}
