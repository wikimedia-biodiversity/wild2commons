// iNaturalist through its public API (no login needed to read). The user types the username.
import { CONFIG } from '../config.js';
import { normaliseLicence } from '../lib/licence.js';
import { fetchFile, extFromUrl, pacer } from './common.js';

const HIDDEN = new Set(['obscured', 'private']);
const wait = pacer(1000);

async function api(path, params = {}) {
  await wait();
  const query = new URLSearchParams(params);
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${CONFIG.inatApi}${path}?${query}`, { headers: { Accept: 'application/json' } });
    if (response.ok) return response.json();
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`iNaturalist answered ${response.status}.`);
  }
}

/** "https://www.inaturalist.org/people/name" or "name" → "name". */
export function loginFrom(text) {
  const value = String(text || '').trim();
  const m = /inaturalist\.org\/(?:people|users|observations)\/([^/?#]+)/i.exec(value);
  return (m ? decodeURIComponent(m[1]) : value).replace(/^@/, '');
}

export function toItems(obs, account) {
  const taxon = obs.taxon || {};
  let lat = null;
  let lon = null;
  if (obs.geojson && Array.isArray(obs.geojson.coordinates)) [lon, lat] = obs.geojson.coordinates;
  else if (obs.location) [lat, lon] = String(obs.location).split(',').map(Number);
  const locationHidden = !!obs.obscured || HIDDEN.has(obs.geoprivacy) || HIDDEN.has(obs.taxon_geoprivacy) || lat == null;
  const user = obs.user || {};
  const owner = account && account.login ? String(user.login || '').toLowerCase() === account.login.toLowerCase() : undefined;
  return (obs.photos || []).map((photo, index) => ({
    source: 'inat',
    sourceName: 'iNaturalist',
    key: `iNat${obs.id}-${photo.id}`,
    kind: 'photo',
    comName: taxon.preferred_common_name ? taxon.preferred_common_name.replace(/^./, (c) => c.toUpperCase()) : '',
    sciName: taxon.name || '',
    rank: taxon.rank || '',
    ids: { inatTaxonId: taxon.id ? String(taxon.id) : '' },
    date: obs.observed_on || '',
    time: '',
    place: { name: obs.place_guess || '' },
    lat: locationHidden ? null : lat,
    lon: locationHidden ? null : lon,
    accuracy: obs.positional_accuracy || 0,
    locationHidden,
    author: { name: user.name || user.login || '', url: `https://www.inaturalist.org/people/${user.login || user.id}` },
    licence: normaliseLicence(photo.license_code),
    owner,
    recordUrl: `https://www.inaturalist.org/observations/${obs.id}`,
    recordLabel: `iNaturalist observation ${obs.id}`,
    photoUrl: `https://www.inaturalist.org/photos/${photo.id}`,
    photoId: photo.id,
    inatObsId: obs.id,
    position: index,
    speciesUrl: taxon.id ? `https://www.inaturalist.org/taxa/${taxon.id}` : '',
    thumbUrl: String(photo.url || '').replace('/square.', '/medium.'),
    fileUrl: String(photo.url || '').replace('/square.', '/original.'),
    ext: extFromUrl(photo.url, 'jpg'),
    quality: obs.quality_grade || '',
  }));
}

export async function findTaxonId(text) {
  const json = await api('/taxa/autocomplete', { q: text, per_page: '1' });
  return json.results && json.results[0] ? { id: String(json.results[0].id), name: json.results[0].name } : null;
}

export async function findPlaceId(text) {
  const json = await api('/places/autocomplete', { q: text, per_page: '1' });
  return json.results && json.results[0] ? { id: String(json.results[0].id), name: json.results[0].display_name || json.results[0].name } : null;
}

export function createInat() {
  let query = null;
  let cursor = 0;
  let done = false;
  let account = null;

  async function page(count) {
    const items = [];
    while (items.length < count && !done) {
      const params = { ...query, per_page: String(Math.min(200, Math.max(30, count - items.length))) };
      if (cursor) params.id_below = String(cursor);
      const json = await api('/observations', params);
      const results = json.results || [];
      if (!results.length) { done = true; break; }
      cursor = results[results.length - 1].id;
      results.forEach((obs) => items.push(...toItems(obs, account)));
      if (results.length < Number(params.per_page)) done = true;
    }
    return { items, hasMore: !done };
  }

  return {
    id: 'inat',
    async search({ login, mode, filters = {}, batch }) {
      account = mode === 'own' ? { login } : null;
      query = { user_login: login, photos: 'true', order_by: 'id', order: 'desc' };
      if (mode === 'others') query.photo_license = 'cc0,cc-by,cc-by-sa';
      if (filters.birdOnly) query.iconic_taxa = 'Aves';
      if (filters.species) {
        const taxon = await findTaxonId(filters.species);
        if (!taxon) throw new Error(`iNaturalist has no taxon called "${filters.species}".`);
        query.taxon_id = taxon.id;
      }
      if (filters.place) {
        const place = await findPlaceId(filters.place);
        if (!place) throw new Error(`iNaturalist has no place called "${filters.place}".`);
        query.place_id = place.id;
      }
      cursor = 0;
      done = false;
      return page(batch);
    },
    more(batch) { return page(batch); },
    async record(ref, { login } = {}) {
      const id = String(ref).replace(/\D/g, '');
      const json = await api(`/observations/${id}`);
      const obs = (json.results || [])[0];
      if (!obs) throw new Error(`iNaturalist observation ${id} was not found.`);
      return toItems(obs, login ? { login } : null);
    },
    async details(item) { return item; },
    file(item) { return fetchFile(item.fileUrl, { what: 'the photo from iNaturalist' }); },
  };
}
