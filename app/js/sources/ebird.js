// eBird, two ways:
// 1. With the optional Wild2Commons extension: the signed-in eBird account is detected and the
//    user's Macaulay Library photos and originals load automatically (through the extension).
// 2. Without it: the user gives Wild2Commons the file from eBird's
// "Download my data" page (the zip, or MyEBirdData.csv inside it). Its "ML Catalog Numbers"
// column links each sighting to its Macaulay Library media, which gives species, date, time,
// place, coordinates and checklist for every photo. The photo files themselves are added from
// the user's computer (originals downloaded from Macaulay Library, or their own files), or, if
// the user allows it in Settings, the 2400 px copy is fetched from Macaulay Library.
import { csvObjects } from '../lib/csv.js';
import { zipText } from '../lib/zip.js';
import { fetchFile, extFromMime } from './common.js';
import * as bridge from '../lib/bridge.js';

export const DOWNLOAD_MY_DATA = 'https://ebird.org/downloadMyData';
const CDN = 'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/';

const pick = (row, ...names) => {
  for (const name of names) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === name.toLowerCase());
    if (key && row[key] !== '') return row[key];
  }
  return '';
};

/** "07:30 AM" → "07:30" */
export function time24(text) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?$/i.exec(String(text || '').trim());
  if (!m) return '';
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

const countryName = (code) => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch (e) { return code; }
};

/** Normalises a typed user ID or profile link: "USER506900". */
export const userIdFrom = (text) => ((/USER\d+/i.exec(String(text || '')) || [''])[0]).toUpperCase();

/** One item per Macaulay Library number in the data file. */
export function itemsFromData(text, { authorName = '', userId = '' } = {}) {
  const rows = csvObjects(text);
  if (!rows.length || !rows.some((r) => 'ML Catalog Numbers' in r || Object.keys(r).some((k) => /ml catalog/i.test(k)))) {
    throw new Error('This file has no "ML Catalog Numbers" column. Choose the file from eBird\'s "Download my data" page.');
  }
  const items = [];
  const seen = new Set();
  rows.forEach((row) => {
    const numbers = (pick(row, 'ML Catalog Numbers').match(/\d{5,}/g) || []);
    if (!numbers.length) return;
    const region = pick(row, 'State/Province', 'State');
    const countryCode = /^[A-Z]{2}/.test(region) ? region.slice(0, 2) : '';
    const lat = Number(pick(row, 'Latitude'));
    const lon = Number(pick(row, 'Longitude'));
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lon) && pick(row, 'Latitude') !== '';
    const checklistId = pick(row, 'Submission ID');
    const date = pick(row, 'Date');
    numbers.forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      items.push({
        source: 'ebird',
        sourceName: 'eBird',
        key: `ML${id}`,
        assetId: id,
        kind: 'photo',
        comName: pick(row, 'Common Name'),
        sciName: pick(row, 'Scientific Name'),
        rank: 'species',
        ids: {},
        taxonOrder: Number(pick(row, 'Taxonomic Order')) || 0,
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
        time: time24(pick(row, 'Time')),
        place: { name: pick(row, 'Location'), district: pick(row, 'County'), state: '', stateCode: region, country: countryCode ? countryName(countryCode) : '' },
        lat: hasCoords ? lat : null,
        lon: hasCoords ? lon : null,
        accuracy: 0,
        locationHidden: !hasCoords,
        author: { name: authorName, url: userId ? `https://media.ebird.org/catalog?userId=${userId}&mediaType=photo` : '' },
        licence: '',
        owner: true,
        recordUrl: `https://macaulaylibrary.org/asset/${id}`,
        recordLabel: `ML${id}`,
        checklist: checklistId ? { id: checklistId, url: `https://ebird.org/checklist/${checklistId}` } : null,
        speciesUrl: '',
        thumbUrl: `${CDN}${id}/480`,
        ext: 'jpg',
        needsFile: true,
      });
    });
  });
  // Newest first, like the Macaulay Library list.
  return items.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`) || Number(b.assetId) - Number(a.assetId));
}

/** Reads the chosen file: the zip from eBird, or the .csv inside it. */
export async function readDataFile(file) {
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const text = await zipText(buffer, (name) => /\.csv$/i.test(name));
    if (text == null) throw new Error('The zip has no .csv file in it.');
    return text;
  }
  return new TextDecoder('utf-8').decode(buffer);
}

/** An item from a Macaulay Library record read by the extension. */
export function itemFromAsset(a, extra = {}) {
  const id = String(a.assetId);
  const loc = a.location || {};
  const hasCoords = loc.lat != null && loc.lon != null;
  return {
    source: 'ebird',
    sourceName: 'eBird',
    key: `ML${id}`,
    assetId: id,
    kind: 'photo',
    comName: a.comName || '',
    sciName: a.sciName || '',
    rank: 'species',
    ids: { ebirdCode: a.speciesCode || '' },
    date: /^\d{4}-\d{2}-\d{2}/.test(a.obsDt || '') ? a.obsDt.slice(0, 10) : '',
    time: '',
    place: { name: loc.name || '', district: loc.district || '', state: loc.state || '', country: loc.country || '', stateCode: loc.stateCode || '' },
    lat: hasCoords ? loc.lat : null,
    lon: hasCoords ? loc.lon : null,
    accuracy: 0,
    locationHidden: !hasCoords,
    author: { name: extra.authorName || a.userName || '', url: a.userId ? `https://media.ebird.org/catalog?userId=${a.userId}&mediaType=photo` : '' },
    licence: '',
    owner: extra.owner,
    restricted: !!a.restricted,
    recordUrl: `https://macaulaylibrary.org/asset/${id}`,
    recordLabel: `ML${id}`,
    checklist: a.checklistId ? { id: a.checklistId, url: `https://ebird.org/checklist/${a.checklistId}` } : null,
    speciesUrl: a.speciesCode ? `https://ebird.org/species/${a.speciesCode}` : '',
    thumbUrl: `${CDN}${id}/480`,
    ext: extFromMime(a.mime, 'jpg'),
    viaExtension: true,
    partial: !!a.partial,
  };
}

const matches = (item, text, fields) => {
  const t = text.toLowerCase();
  return fields.some((f) => String(f || '').toLowerCase().includes(t));
};

export function createEbird(settings) {
  let all = [];
  let list = [];
  let shown = 0;
  let viaExtension = false;
  const author = () => ({ authorName: settings().authorName || '' });

  const next = (count) => {
    const items = list.slice(shown, shown + count);
    shown += items.length;
    return { items, hasMore: shown < list.length, info: `${list.length} Macaulay Library items in your eBird data match.` };
  };

  return {
    id: 'ebird',
    /** True when the extension loads photos automatically. */
    get viaExtension() { return viaExtension; },
    useExtension(on) { viaExtension = !!on; },
    /** With the extension: the signed-in eBird account, or null when signed out. */
    async identify() {
      const account = await bridge.call('ebird.account', {}, { timeout: 90000 });
      return account ? { login: account.userId, name: account.displayName, handle: account.username, id: account.userId } : null;
    },
    /** Without the extension: loads the eBird data file chosen in step 1. Returns how many media items it lists. */
    async loadData(file, { authorName, userId }) {
      all = itemsFromData(await readDataFile(file), { authorName, userId });
      return all.length;
    },
    get loaded() { return all.length; },
    async search({ filters = {}, batch }, onProgress) {
      if (viaExtension) {
        const f = { ...filters };
        const result = await bridge.call('ebird.search', { filters: f, count: batch }, { onProgress });
        return { items: result.assets.map((a) => itemFromAsset(a, { owner: true, ...author() })), hasMore: result.hasMore, info: result.info };
      }
      if (!all.length) throw new Error('Choose your eBird data file in step 1 first.');
      const species = String(filters.species || '').trim();
      const place = String(filters.place || '').trim();
      list = all.filter((i) => (!species || matches(i, species, [i.comName, i.sciName]))
        && (!place || matches(i, place, [i.place.name, i.place.district, i.place.stateCode, i.place.country])));
      shown = 0;
      return next(batch);
    },
    async more(batch, onProgress) {
      if (viaExtension) {
        const result = await bridge.call('ebird.more', { count: batch }, { onProgress });
        return { items: result.assets.map((a) => itemFromAsset(a, { owner: true, ...author() })), hasMore: result.hasMore, info: result.info };
      }
      return next(batch);
    },
    async record(ref) {
      const id = String(ref).replace(/\D/g, '');
      if (viaExtension) {
        const page = await bridge.call('ebird.asset', { assetId: id }, { timeout: 120000 });
        return [itemFromAsset(page.asset, { owner: page.owner, ...author() })];
      }
      const found = all.filter((i) => i.assetId === id);
      if (!found.length) throw new Error(`ML${id} is not in the eBird data file you chose.`);
      return found;
    },
    /** With the extension, re-reads the photo page just before upload: full details and the ownership check. */
    async details(item) {
      if (!item.viaExtension) return item;
      const page = await bridge.call('ebird.asset', { assetId: item.assetId }, { timeout: 120000 });
      return itemFromAsset(page.asset, { owner: page.owner, ...author() });
    },
    async file(item, onProgress) {
      if (item.viaExtension) {
        const file = await bridge.call('ebird.original', { assetId: item.assetId, allowResized: !!settings().allowResized }, { onProgress, timeout: 5 * 60 * 1000 });
        return new Blob([file.buffer], { type: file.mime || 'image/jpeg' });
      }
      if (!settings().allowResized) {
        throw new Error('Add the photo file first: use "Add file" on the photo, or drop the files on the page. Or install the Wild2Commons extension to load originals automatically.');
      }
      return fetchFile(`${CDN}${item.assetId}/2400`, { what: 'the 2400 px copy from Macaulay Library' });
    },
  };
}
