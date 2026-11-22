// eBird and Macaulay Library through the Wild2Commons extension: a website cannot read the
// user's eBird sign-in or fetch their originals. Only the signed-in user's own photos are offered.
import * as bridge from '../lib/bridge.js';
import { extFromMime } from './common.js';

export function toItem(a, extra = {}) {
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
    author: { name: a.userName || '', url: a.userId ? `https://media.ebird.org/catalog?userId=${a.userId}&mediaType=photo` : '' },
    licence: '',
    owner: extra.owner,
    restricted: !!a.restricted,
    recordUrl: `https://macaulaylibrary.org/asset/${id}`,
    recordLabel: `ML${id}`,
    checklist: a.checklistId ? { id: a.checklistId, url: `https://ebird.org/checklist/${a.checklistId}` } : null,
    speciesUrl: a.speciesCode ? `https://ebird.org/species/${a.speciesCode}` : '',
    thumbUrl: `https://cdn.download.ams.birds.cornell.edu/api/v2/asset/${id}/480`,
    ext: extFromMime(a.mime, 'jpg'),
    partial: !!a.partial,
  };
}

export function createEbird(settings) {
  return {
    id: 'ebird',
    async identify() {
      const account = await bridge.call('ebird.account', {}, { timeout: 90000 });
      return account ? { login: account.userId, name: account.displayName, handle: account.username, id: account.userId } : null;
    },
    async search({ filters = {}, batch }, onProgress) {
      const result = await bridge.call('ebird.search', { filters, count: batch }, { onProgress });
      return { items: result.assets.map((a) => toItem(a, { owner: true })), hasMore: result.hasMore, info: result.info };
    },
    async more(batch, onProgress) {
      const result = await bridge.call('ebird.more', { count: batch }, { onProgress });
      return { items: result.assets.map((a) => toItem(a, { owner: true })), hasMore: result.hasMore, info: result.info };
    },
    async record(ref) {
      const assetId = String(ref).replace(/\D/g, '');
      const page = await bridge.call('ebird.asset', { assetId }, { timeout: 120000 });
      return [toItem(page.asset, { owner: page.owner })];
    },
    /** Re-reads the photo page: full details and the ownership check, just before upload. */
    async details(item) {
      const page = await bridge.call('ebird.asset', { assetId: item.assetId }, { timeout: 120000 });
      return toItem(page.asset, { owner: page.owner });
    },
    async file(item, onProgress) {
      const file = await bridge.call('ebird.original', { assetId: item.assetId, allowResized: !!settings().allowResized }, { onProgress, timeout: 5 * 60 * 1000 });
      return new Blob([file.buffer], { type: file.mime || 'image/jpeg' });
    },
  };
}
