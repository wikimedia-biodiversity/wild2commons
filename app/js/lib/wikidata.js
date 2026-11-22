// Finds a taxon's Wikidata item and its Commons category.
// eBird taxon ID is P3444, iNaturalist taxon ID is P3151, the scientific name is P225.

export class Wikidata {
  constructor({ apiUrl, userAgent, fetchFn = (...a) => fetch(...a) }) {
    this.apiUrl = apiUrl;
    this.userAgent = userAgent;
    this.fetchFn = fetchFn;
    this.cache = new Map();
  }

  async get(params) {
    const query = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
    const response = await this.fetchFn(`${this.apiUrl}?${query}`, { headers: this.userAgent ? { 'Api-User-Agent': this.userAgent } : {} });
    if (!response.ok) throw new Error(`Wikidata answered ${response.status}`);
    return response.json();
  }

  async search(query, limit = 5) {
    const json = await this.get({ action: 'query', list: 'search', srsearch: query, srnamespace: '0', srlimit: String(limit), srprop: '' });
    return (json.query.search || []).map((h) => h.title);
  }

  async entities(ids) {
    if (!ids.length) return {};
    const json = await this.get({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims|sitelinks|labels', sitefilter: 'commonswiki', languages: 'en' });
    return json.entities || {};
  }

  static claim(entity, prop) {
    const c = ((entity.claims || {})[prop] || []).find((x) => x.mainsnak && x.mainsnak.datavalue);
    return c ? c.mainsnak.datavalue.value : '';
  }

  static describe(entity) {
    let category = Wikidata.claim(entity, 'P373');
    const link = ((entity.sitelinks || {}).commonswiki || {}).title || '';
    if (!category && /^Category:/.test(link)) category = link.replace(/^Category:/, '');
    return {
      qid: entity.id,
      category,
      sciName: Wikidata.claim(entity, 'P225'),
      ebirdCode: Wikidata.claim(entity, 'P3444'),
      inatId: String(Wikidata.claim(entity, 'P3151') || ''),
      label: ((entity.labels || {}).en || {}).value || '',
    };
  }

  /** The taxon item for an item, trying the source's own ID first, then the scientific name. */
  async taxon({ ebirdCode, inatTaxonId, sciName }) {
    const key = `${ebirdCode || ''}|${inatTaxonId || ''}|${sciName || ''}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const tries = [];
    if (ebirdCode) tries.push(`haswbstatement:P3444=${ebirdCode}`);
    if (inatTaxonId) tries.push(`haswbstatement:P3151=${inatTaxonId}`);
    if (sciName) tries.push(`haswbstatement:"P225=${sciName}"`);
    let result = null;
    for (const query of tries) {
      const ids = await this.search(query);
      if (!ids.length) continue;
      const list = Object.values(await this.entities(ids)).filter((e) => e && !e.missing).map(Wikidata.describe);
      result = list.find((t) => sciName && t.sciName === sciName) || list[0] || null;
      if (result) break;
    }
    this.cache.set(key, result);
    return result;
  }

  /** Species suggestions for typed text: [{qid, label, sciName, ebirdCode, inatId}]. */
  async suggest(text, prop = 'P225', limit = 8) {
    const value = String(text || '').trim();
    if (value.length < 3) return [];
    const ids = await this.search(`${value} haswbstatement:${prop}`, limit);
    const entities = await this.entities(ids);
    return ids.map((id) => entities[id]).filter(Boolean).map(Wikidata.describe).filter((t) => t.sciName);
  }
}
