import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';

import { runAudit } from '../public/core/crawl.js';
import { extractPage, stripInlineStyles } from '../public/core/parse.js';

const encoder = new TextEncoder();

function result(url, {
  status = 200,
  body = null,
  type = 'text/html; charset=utf-8',
  ourPolicy = null,
} = {}) {
  return {
    status,
    finalUrl: url,
    location: null,
    chain: [],
    stop: null,
    error: null,
    skipped: null,
    truncated: false,
    accessBlocked: false,
    truncatedHeaders: false,
    headers: { 'content-type': type },
    ourPolicy,
    bytes: body == null ? null : encoder.encode(body),
  };
}

test('B1 stripInlineStyles removes style blocks non-greedily, case-insensitively and across lines', () => {
  const html = '<head><STYLE media="screen">\n.a { color: red; }\n</StYlE><meta name="x"><style>.b{}</style></head>';
  assert.equal(stripInlineStyles(html), '<head><meta name="x"></head>');
});

test('B1 stripInlineStyles removes an unterminated style block through the end', () => {
  assert.equal(stripInlineStyles('<main>keep</main><style>.a{}\n<p>drop</p>'), '<main>keep</main>');
});

test('B1 stripInlineStyles removes only style attributes in start tags with any quoting', () => {
  const html = '<p STYLE="color:red" id="a" style=display:block data-style="keep" title="keep style=x">A style=x</p>'
    + "<input class='x' style='width: 1px' disabled>";
  const expected = '<p id="a" data-style="keep" title="keep style=x">A style=x</p><input class=\'x\' disabled>';
  assert.equal(stripInlineStyles(html), expected);
});

test('B1 stripInlineStyles respects quoted greater-than signs while scanning a start tag', () => {
  const html = `<div title="1 > 0" style="content:'>'" data-note='x > y'>style=x</div>`;
  const expected = `<div title="1 > 0" data-note='x > y'>style=x</div>`;
  assert.equal(stripInlineStyles(html), expected);
});

test('B1 stripInlineStyles preserves a separator for an adjacent attribute after style', () => {
  const html = '<div style="x"class="y">z</div><input id=a style=\'x\'disabled>';
  const expected = '<div class="y">z</div><input id=a disabled>';
  assert.equal(stripInlineStyles(html), expected);
});

test('B1 stripInlineStyles leaves style-looking text in comments and raw-text elements unchanged', () => {
  const html = '<!-- <style>.comment{}</style> --><script>const x = "<style>.script{}</style>";</script>';
  assert.equal(stripInlineStyles(html), html);
});

test('B1 runAudit strips styles before parseHtml without changing page analysis', async () => {
  const styled = '<!doctype html><html lang="zh-TW"><head><title>Home</title><style>\n.hidden { display:none }\n</style></head>'
    + '<body style="color:red"><h1 STYLE=font-weight:bold>Visible</h1><a style=display:block href="/next">Next</a></body></html>';
  const clean = '<!doctype html><html lang="zh-TW"><head><title>Home</title></head>'
    + '<body><h1>Visible</h1><a href="/next">Next</a></body></html>';
  const parsedInputs = [];
  const parseHtml = (html) => {
    parsedInputs.push(html);
    return new DOMParser().parseFromString(html, 'text/html');
  };

  const snapshot = await runAudit('http://a.test/', {
    fetchFn: async (url, kind) => {
      if (kind === 'robots') return result(url, {
        status: 404,
        type: 'text/plain',
        ourPolicy: { policy: 'allow_all', rulesCount: 0 },
      });
      if (url === 'http://a.test/') return result(url, { body: styled });
      return result(url, { status: 404, type: kind === 'sitemap' ? 'application/xml' : 'text/html' });
    },
    parseHtml,
    maxPages: 1,
    delayMs: 0,
    sleep: async () => {},
    now: () => new Date('2026-10-17T00:00:00Z'),
    random: () => 0.5,
  });

  assert.deepEqual(parsedInputs, [clean]);
  const expected = extractPage(new DOMParser().parseFromString(clean, 'text/html'), 'http://a.test/');
  assert.deepEqual(snapshot.pages[0].page, expected);
  assert.equal(snapshot.pages[0].page.textHash, expected.textHash);
  assert.deepEqual(snapshot.pages[0].page.links, expected.links);
});
