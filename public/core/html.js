const SAFE_HTML = Symbol('SafeHtml');

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function raw(value) {
  return Object.freeze({ [SAFE_HTML]: true, value: String(value) });
}

function renderValue(value) {
  if (Array.isArray(value)) return value.map(renderValue).join('');
  if (value && value[SAFE_HTML] === true) return value.value;
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let result = strings[0] ?? '';
  for (let i = 0; i < values.length; i += 1) {
    result += renderValue(values[i]) + (strings[i + 1] ?? '');
  }
  return result;
}

export function safeHref(value) {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
