// Xeno-canto through API v3. Each user enters their own API key in Settings (members with a
// verified email have one on their Xeno-canto account page). The key is never stored on a server.
import { CONFIG } from '../config.js';
import { normaliseLicence } from '../lib/licence.js';
import { fetchFile, extFromUrl, pacer } from './common.js';
import * as bridge from '../lib/bridge.js';

const wait = pacer(1000);
const quote = (s) => `"${String(s).replace(/"/g, '')}"`;

async function api(query, key, page = 1, perPage = 100) {
  if (!key) throw new Error('Add your Xeno-canto API key in Settings (the gear button). You find it on your Xeno-canto account page.');
  await wait();
  const params = new URLSearchParams({ query, key, page: String(page), per_page: String(Math.min(500, Math.max(50, perPage))) });
  const response = await fetch(`${CONFIG.xcApi}?${params}`, { headers: { Accept: 'application/json' } });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error) throw new Error(`Xeno-canto: ${(json.error && (json.error.message || json.error)) || json.message || `answered ${response.status}`}`);
  return json;
}

const https = (url) => (String(url || '').startsWith('//') ? `https:${url}` : String(url || ''));

export function toItem(r, account) {
  const sci = [r.gen, r.sp].filter(Boolean).join(' ');
  const lat = r.lat === '' || r.lat == null ? null : Number(r.lat);
  const lonRaw = r.lon ?? r.lng;
  const lon = lonRaw === '' || lonRaw == null ? null : Number(lonRaw);
  const details = [];
  if (r.type) details.push(`Sound type: ${r.type}`);
  if (r.sex) details.push(`sex: ${r.sex}`);
  if (r.stage) details.push(`life stage: ${r.stage}`);
  if (r.method) details.push(`method: ${r.method}`);
  const owner = account && account.name ? String(r.rec || '').trim().toLowerCase() === account.name.trim().toLowerCase() : undefined;
  return {
    source: 'xc',
    sourceName: 'Xeno-canto',
    key: `XC${r.id}`,
    kind: 'sound',
    comName: r.en || '',
    sciName: sci,
    rank: r.ssp ? 'subspecies' : 'species',
    ids: {},
    date: /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : '',
    time: r.time && r.time !== '?' ? r.time : '',
    place: { name: r.loc || '', country: r.cnt || '' },
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    accuracy: 0,
    locationHidden: !Number.isFinite(lat) || !Number.isFinite(lon),
    author: { name: r.rec || '', url: `https://xeno-canto.org/explore?query=${encodeURIComponent(`rec:${quote(r.rec || '')}`)}` },
    licence: normaliseLicence(r.lic),
    owner,
    recordUrl: `https://xeno-canto.org/${r.id}`,
    recordLabel: `XC${r.id}`,
    speciesUrl: r.gen && r.sp ? `https://xeno-canto.org/species/${r.gen}-${r.sp}` : '',
    thumbUrl: https((r.sono && (r.sono.med || r.sono.small)) || ''),
    fileUrl: https(r.file),
    ext: extFromUrl(r['file-name'], 'mp3'),
    details,
  };
}

export function buildQuery({ recordist, filters = {} }) {
  const parts = [];
  if (recordist) parts.push(`rec:${quote(recordist)}`);
  const species = String(filters.species || '').trim();
  if (species) {
    const words = species.split(/\s+/);
    if (words.length === 2 && /^[A-Z][a-z]+$/.test(words[0]) && /^[a-z-]+$/.test(words[1])) parts.push(`gen:${words[0]} sp:${words[1]}`);
    else parts.push(`en:${quote(species)}`);
  }
  if (filters.place) parts.push(`cnt:${quote(filters.place)}`);
  if (filters.birdOnly) parts.push('grp:birds');
  return parts.join(' ');
}

export function createXc(getKey) {
  let query = '';
  let page = 0;
  let pages = 1;
  let account = null;

  async function next(count) {
    const items = [];
    while (items.length < count && page < pages) {
      page += 1;
      const json = await api(query, getKey(), page, count);
      pages = Number(json.numPages) || page;
      (json.recordings || []).forEach((r) => items.push(toItem(r, account)));
    }
    return { items, hasMore: page < pages };
  }

  return {
    id: 'xc',
    /** With the extension: who is signed in on the site, or null. */
    async identify() {
      if (!bridge.extensionInfo()) return null;
      try { return await bridge.call('xc.whoami', {}, { timeout: 30000 }); } catch (e) { return null; }
    },
    async search({ login, mode, filters = {}, batch }) {
      account = mode === 'own' ? { name: login } : null;
      query = buildQuery({ recordist: login, filters });
      if (!query) throw new Error('Enter a recordist name.');
      page = 0;
      pages = 1;
      return next(batch);
    },
    more(batch) { return next(batch); },
    async record(ref, { login } = {}) {
      const id = String(ref).replace(/\D/g, '');
      const json = await api(`nr:${id}`, getKey(), 1, 50);
      const r = (json.recordings || [])[0];
      if (!r) throw new Error(`Xeno-canto recording XC${id} was not found.`);
      return [toItem(r, login ? { name: login } : null)];
    },
    async details(item) { return item; },
    file(item) { return fetchFile(item.fileUrl, { what: 'the recording from Xeno-canto' }); },
  };
}
