// runAudit -> runChecks -> computeScore -> botAccess (-> renderReport) with deterministic options.
import { DOMParser } from 'linkedom';
import { runAudit } from '../../public/core/crawl.js';
import { runChecks, botAccess } from '../../public/core/checks.js';
import { computeScore } from '../../public/core/score.js';
import { renderReport } from '../../public/core/report.js';
import { seededRandom } from './fakesite.mjs';

// 2026-10-17 02:03:04 UTC == 2026-10-17 10:03:04 Taipei
export const FIXED_NOW_MS = Date.UTC(2026, 9, 17, 2, 3, 4);

export function parseHtml(text) {
  return new DOMParser().parseFromString(String(text), 'text/html');
}

export async function runPipeline(site, startUrl, { maxPages = 15, timeBudgetMs = 90000, parseHtml: parse = parseHtml } = {}) {
  const snapshot = await runAudit(startUrl, {
    fetchFn: site.fetchFn,
    parseHtml: parse,
    maxPages,
    delayMs: 0,
    timeBudgetMs,
    onProgress: () => {},
    now: () => new Date(FIXED_NOW_MS),
    random: seededRandom(42),
    sleep: async () => {},
  });
  const findings = runChecks(snapshot);
  const score = computeScore(findings, snapshot.coverage);
  const bots = botAccess(snapshot);
  const byId = {};
  for (const f of findings) byId[f.id] = f;
  return { snapshot, findings, score, bots, byId, ids: findings.map((f) => f.id) };
}

export function render(result, opts = {}) {
  return String(renderReport(result.snapshot, result.findings, result.score, result.bots, opts));
}

// Parse a report HTML string (fragment or full document) into a linkedom document.
export function parseReport(htmlString) {
  const s = String(htmlString);
  const isDoc = /^\s*(<!doctype|<html)/i.test(s);
  return new DOMParser().parseFromString(
    isDoc ? s : `<!doctype html><html><head></head><body>${s}</body></html>`,
    'text/html',
  );
}

// Collect every string found anywhere inside a value (object keys included).
export function allStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) allStrings(x, out);
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      allStrings(x, out);
    }
  }
  return out;
}
