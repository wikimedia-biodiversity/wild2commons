// Small helpers shared by the app modules. No DOM code here.

export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Stopped', 'AbortError')); return; }
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
});

export const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

export const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

export function formatCoord(value) {
  return Number(Number(value).toFixed(6)).toString();
}

/** Neutralises characters that would start templates, links, tables, signatures or formatting. */
export function escapeWikitext(value) {
  return String(value ?? '')
    .replace(/[|{}[\]<>~=]/g, (c) => `&#${c.charCodeAt(0)};`)
    .replace(/'{2,}/g, (m) => '&#39;'.repeat(m.length))
    .replace(/__/g, '_&#95;');
}

const encoder = new TextEncoder();
export const utf8Length = (s) => encoder.encode(s).length;

export async function sha1Hex(buffer) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', buffer));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Splits "a; b\nc | d" into ["a", "b", "c", "d"] and drops a leading "Category:". */
export function splitList(text) {
  return String(text || '').split(/[\n;|]+/).map((c) => clean(c).replace(/^category:/i, '')).filter(Boolean);
}

/** Same category regardless of first-letter case and underscores. */
export function categoryKey(name) {
  const n = clean(String(name).replace(/_/g, ' '));
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export function uniqueCategories(names) {
  const seen = new Set();
  return names.filter((n) => {
    const k = categoryKey(n);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const looksLikeCoords = (s) => /^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/.test(clean(s));

/** "Kattampally, Kannur, Kerala, India" from the parts, without repeats or bare coordinates. */
export function placeLabel(place = {}) {
  const parts = [];
  [place.name, place.district, place.state, place.country].forEach((value) => {
    const part = clean(value);
    if (!part || looksLikeCoords(part)) return;
    const lower = part.toLowerCase();
    if (parts.some((p) => p.toLowerCase().split(/\s*,\s*/).includes(lower))) return;
    parts.push(part);
  });
  return parts.join(', ');
}

export function speciesLabel(item) {
  const common = clean(item.comName);
  const sci = clean(item.sciName);
  if (common && sci && common.toLowerCase() !== sci.toLowerCase()) return `${common} (${sci})`;
  return common || sci || '';
}

export function readJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

export function writeJson(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage may be off */ }
}
