// Report helpers shared by the v1.9 blind tests: cached pipeline runs, DOM parsing and the S12 safety assertion.
import assert from 'node:assert/strict';
import { runPipeline, render, parseReport } from './pipeline.mjs';

export const CONTACT = 'https://line.me/R/ti/p/@kinsui-example';

export function attrNames(el) {
  if (typeof el.getAttributeNames === 'function') return [...el.getAttributeNames()];
  return [...(el.attributes || [])].map((a) => a.name);
}

export function textOf(doc) {
  return (doc.body || doc.documentElement).textContent;
}

// Same rules as tests/report.test.mjs assertSafeDom (SPEC-001 §8 安全, SPEC-002 §9).
export function assertSafeDom(doc, label) {
  assert.equal(doc.querySelectorAll('script').length, 0, `${label}: <script> element`);
  assert.equal(doc.querySelectorAll('style').length, 0, `${label}: <style> element`);
  for (const el of doc.querySelectorAll('*')) {
    for (const name of attrNames(el)) {
      const n = String(name).toLowerCase();
      assert.ok(!n.startsWith('on'), `${label}: event attribute ${name} on <${el.tagName}>`);
      assert.notEqual(n, 'style', `${label}: style attribute on <${el.tagName}>`);
      if (['href', 'src', 'action', 'formaction', 'xlink:href', 'data'].includes(n)) {
        const v = String(el.getAttribute(name) || '').replace(/[\u0000- ]/g, '').toLowerCase();
        assert.ok(!v.startsWith('javascript:'), `${label}: javascript: URL in ${name} on <${el.tagName}>`);
      }
    }
  }
  for (const a of doc.querySelectorAll('a')) {
    const href = a.getAttribute('href') || '';
    if (/^https?:/i.test(href)) {
      assert.equal(a.getAttribute('target'), '_blank', `${label}: target on ${href}`);
      const rel = String(a.getAttribute('rel') || '').toLowerCase().split(/\s+/);
      for (const t of ['noopener', 'noreferrer', 'nofollow']) assert.ok(rel.includes(t), `${label}: rel ${t} on ${href}`);
    }
  }
}

const cache = new Map();
// cached(key, builder) -> pipeline result + site + sc (builder() -> { site, start })
export function cached(key, builder) {
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        const sc = builder();
        const r = await runPipeline(sc.site, sc.start);
        return { ...r, site: sc.site, sc };
      })(),
    );
  }
  return cache.get(key);
}

export function reportOf(result, opts = {}) {
  const out = render(result, opts);
  assert.equal(typeof out, 'string');
  const doc = parseReport(out);
  return { out, doc, text: textOf(doc) };
}

// The home PageEntry of a snapshot (the entry whose finalUrl is `home`, else pages[0]).
export function homeEntry(snapshot) {
  return snapshot.pages.find((p) => p.finalUrl === snapshot.home) || snapshot.pages[0];
}

export const byText = (doc, selector, text) => [...doc.querySelectorAll(selector)].find((el) => el.textContent.trim() === text);
export const allByText = (doc, selector, text) => [...doc.querySelectorAll(selector)].filter((el) => el.textContent.trim() === text);
