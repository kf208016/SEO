export const OUR_RULES_MAX = 1000;
const MAX_RULES = 10_000;
const MAX_RULE_LENGTH = 2_000;
const encoder = new TextEncoder();

export function normalizePath(value) {
  const text = String(value ?? '');
  if (!text.includes('%') && /^[\x00-\x7F]*$/.test(text)) return text;
  let output = '';
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '%' && i + 2 < text.length && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
      const hex = text.slice(i + 1, i + 3).toUpperCase();
      const code = Number.parseInt(hex, 16);
      const decoded = String.fromCharCode(code);
      output += /[A-Za-z0-9._~-]/.test(decoded) ? decoded : `%${hex}`;
      i += 3;
      continue;
    }
    const codePoint = text.codePointAt(i);
    const current = String.fromCodePoint(codePoint);
    i += current.length;
    if (codePoint <= 0x7f) {
      output += current;
    } else {
      for (const byte of encoder.encode(current)) output += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return output;
}

export function parseRobots(text, { truncated = false } = {}) {
  let source = String(text ?? '').replace(/^\uFEFF/, '');
  const lines = source.split(/\r\n|\n|\r/);
  if (truncated && lines.length) lines.pop();
  const groups = [];
  const sitemaps = [];
  let group = null;
  let count = 0;
  let overflow = false;
  for (const raw of lines) {
    const line = raw.split('#', 1)[0];
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      const lowered = value.toLowerCase();
      const match = lowered === '*' ? ['*'] : lowered.match(/^[a-z0-9_-]+/);
      if (!match) continue;
      if (!group || group.hasRules) {
        group = { agents: [], rules: [], hasRules: false };
        groups.push(group);
      }
      group.agents.push(match[0]);
      continue;
    }
    if ((field !== 'allow' && field !== 'disallow') || !group) continue;
    group.hasRules = true;
    if (!value) continue;
    if (value.length > MAX_RULE_LENGTH || count >= MAX_RULES) {
      overflow = true;
      continue;
    }
    group.rules.push({ allow: field === 'allow', path: normalizePath(value) });
    count += 1;
  }
  return {
    groups: groups.map(({ agents, rules }) => ({ agents, rules })),
    sitemaps,
    overflow,
  };
}

export function matchRule(pattern, path) {
  let rule = String(pattern);
  const target = String(path);
  const anchored = rule.endsWith('$');
  if (anchored) rule = rule.slice(0, -1);
  const hasStar = rule.includes('*');
  if (!hasStar) return anchored ? target === rule : target.startsWith(rule);
  const leadingStar = rule.startsWith('*');
  const trailingStar = rule.endsWith('*');
  const parts = rule.split('*').filter(Boolean);
  if (parts.length === 0) return true;
  let position = 0;
  let index = 0;
  if (!leadingStar) {
    if (!target.startsWith(parts[0])) return false;
    position = parts[0].length;
    index = 1;
  }
  const lastIndex = parts.length - 1;
  for (; index < parts.length; index += 1) {
    const part = parts[index];
    if (anchored && !trailingStar && index === lastIndex) {
      const start = target.length - part.length;
      return start >= position && target.startsWith(part, start);
    }
    const found = target.indexOf(part, position);
    if (found < 0) return false;
    position = found + part.length;
  }
  if (anchored && !trailingStar && !leadingStar && parts.length === 1) return position === target.length;
  return !anchored || trailingStar || position === target.length;
}

export function rulesFor(robots, token) {
  if (!robots?.groups) return { agent: null, rules: [] };
  const wanted = String(token ?? '').toLowerCase();
  const collect = (agent) => robots.groups.filter((g) => g.agents.includes(agent));
  let agent = wanted;
  let selected = collect(agent);
  if (!selected.length && ['googlebot-image', 'googlebot-news', 'googlebot-video'].includes(wanted)) {
    agent = 'googlebot';
    selected = collect(agent);
  }
  if (!selected.length) {
    agent = '*';
    selected = collect(agent);
  }
  if (!selected.length) return { agent: null, rules: [] };
  return { agent, rules: selected.flatMap((group) => group.rules) };
}

export function explain(robots, token, path) {
  if (!robots || path === '/robots.txt') return { allowed: true, agent: null, rule: null };
  const selected = rulesFor(robots, token);
  const normalized = normalizePath(path);
  let winner = null;
  for (const rule of selected.rules) {
    if (!matchRule(rule.path, normalized)) continue;
    if (!winner || rule.path.length > winner.path.length || (rule.path.length === winner.path.length && rule.allow && !winner.allow)) {
      winner = rule;
    }
  }
  return { allowed: winner ? winner.allow : true, agent: selected.agent, rule: winner };
}

export function isAllowedByRules(rules, path) {
  const normalized = normalizePath(path);
  let winner = null;
  for (const rule of rules ?? []) {
    if (!matchRule(rule.path, normalized)) continue;
    if (!winner || rule.path.length > winner.path.length || (rule.path.length === winner.path.length && rule.allow && !winner.allow)) winner = rule;
  }
  return winner ? winner.allow : true;
}

export function isAllowed(robots, token, path) {
  return explain(robots, token, path).allowed;
}

export function robotsPolicyForStatus(status) {
  if (Number.isInteger(status) && status >= 200 && status < 300) return 'parse';
  if (Number.isInteger(status) && status >= 400 && status < 500 && status !== 429) return 'allow_all';
  return 'disallow_all';
}

export function robotsPolicyFor(result) {
  const meta = result?.meta ?? result ?? {};
  if (meta.error != null || meta.accessBlocked || meta.stop != null || (meta.status >= 300 && meta.status < 400)) return 'unknown';
  if (meta.status >= 200 && meta.status < 300 && result?.bytes == null) return 'unknown';
  return robotsPolicyForStatus(meta.status);
}
