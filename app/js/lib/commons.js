// Commons Action API client. Anonymous reads use origin=*; logged-in calls send the OAuth
// bearer token with crossorigin= (MediaWiki accepts that from any origin for OAuth).
// Every write sends maxlag=5 and assert=user and never ignorewarnings.

/** "Campaign:wlb 2026" or "wlb_2026" → "wlb_2026" (page names with underscores). */
export const campaignKey = (title) => String(title || '').replace(/^Campaign:/i, '').trim().replace(/ /g, '_');

/** Rough plain text of expanded wikitext: drops bold/italic marks, HTML tags and link brackets. */
export function wikiToPlain(text) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s([^\]]+)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export class CommonsError extends Error {
  constructor(code, info, extra = {}) {
    super(info || code);
    this.code = code;
    Object.assign(this, extra);
  }
}

export class Commons {
  constructor({ apiUrl, userAgent, token = () => '', fetchFn = (...a) => fetch(...a) }) {
    this.apiUrl = apiUrl;
    this.userAgent = userAgent;
    this.getToken = token;
    this.fetchFn = fetchFn;
    this.csrf = '';
  }

  headers(auth) {
    const h = {};
    if (this.userAgent) h['Api-User-Agent'] = this.userAgent;
    if (auth && this.getToken()) h.Authorization = `Bearer ${this.getToken()}`;
    return h;
  }

  static check(json, response) {
    if (json && json.error) {
      const retryAfter = Number(response?.headers?.get?.('retry-after')) || undefined;
      throw new CommonsError(json.error.code, json.error.info, { lag: json.error.lag, retryAfter });
    }
    return json;
  }

  async get(params, { auth = false } = {}) {
    const query = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
    if (auth && this.getToken()) query.set('crossorigin', ''); else query.set('origin', '*');
    const response = await this.fetchFn(`${this.apiUrl}?${query}`, { headers: this.headers(auth) });
    if (!response.ok) throw new CommonsError(`http-${response.status}`, `Commons answered ${response.status}`);
    return Commons.check(await response.json(), response);
  }

  async post(fields, file) {
    const all = { format: 'json', formatversion: '2', ...fields };
    let body;
    if (file) {
      body = new FormData();
      Object.entries(all).forEach(([k, v]) => { if (k !== 'token') body.append(k, v); });
      body.append('file', file.blob, file.name);
      body.append('token', all.token);
    } else {
      body = new URLSearchParams(all);
    }
    const response = await this.fetchFn(`${this.apiUrl}?crossorigin=`, { method: 'POST', headers: this.headers(true), body });
    if (!response.ok) throw new CommonsError(`http-${response.status}`, `Commons answered ${response.status}`);
    return Commons.check(await response.json(), response);
  }

  async userInfo() {
    const info = (await this.get({ action: 'query', meta: 'userinfo', uiprop: 'rights|groups' }, { auth: true })).query.userinfo;
    return { name: info.anon ? '' : info.name, rights: info.rights || [], groups: info.groups || [] };
  }

  async csrfToken(refresh = false) {
    if (!this.csrf || refresh) {
      this.csrf = (await this.get({ action: 'query', meta: 'tokens', type: 'csrf' }, { auth: true })).query.tokens.csrftoken;
    }
    return this.csrf;
  }

  /** Titles of files with these exact bytes. */
  async findBySha1(sha1) {
    const json = await this.get({ action: 'query', list: 'allimages', aisha1: sha1, ailimit: '5' });
    return (json.query.allimages || []).map((i) => i.title);
  }

  /** Which of these titles exist. Returns a Map title -> pageid (0 when missing). */
  async pages(titles) {
    const out = new Map();
    for (let i = 0; i < titles.length; i += 50) {
      const json = await this.get({ action: 'query', titles: titles.slice(i, i + 50).join('|') });
      (json.query.normalized || []).forEach((n) => out.set(n.from, null));
      (json.query.pages || []).forEach((p) => out.set(p.title, p.missing ? 0 : p.pageid));
      (json.query.normalized || []).forEach((n) => out.set(n.from, out.get(n.to)));
    }
    return out;
  }

  async pageId(title) {
    return (await this.pages([title])).get(title) || 0;
  }

  upload({ filename, text, comment, blob }) {
    return this.csrfToken().then((token) => this.post({
      action: 'upload', filename, text, comment, maxlag: '5', assert: 'user', token,
    }, { blob, name: filename }));
  }

  editEntity({ id, data, summary }) {
    return this.csrfToken().then((token) => this.post({
      action: 'wbeditentity', id, data: JSON.stringify(data), summary, maxlag: '5', assert: 'user', token,
    }));
  }

  /** Every page in the Campaign: namespace (460), with its JSON text. */
  /** Plain text for a campaign question label that uses a template, e.g. "{{Upload campaign header WLB subject}}". */
  async plainLabel(text) {
    const value = String(text || '');
    if (!/[{<[']/.test(value)) return value;
    const key = `label|${value}`;
    this.labelCache = this.labelCache || new Map();
    if (this.labelCache.has(key)) return this.labelCache.get(key);
    let plain = value;
    try { plain = wikiToPlain(await this.expand(value)) || value; } catch (e) { plain = wikiToPlain(value) || value; }
    this.labelCache.set(key, plain);
    return plain;
  }

  /** Campaign pages by name ("wlb_2026"): [{ name, text }]. Missing pages are left out. */
  async campaignPages(names) {
    const pages = [];
    const titles = [...new Set(names.map((n) => `Campaign:${campaignKey(n)}`).filter((t) => t !== 'Campaign:'))];
    for (let i = 0; i < titles.length; i += 50) {
      const json = await this.get({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: titles.slice(i, i + 50).join('|') });
      (json.query.pages || []).forEach((p) => {
        const text = p.revisions && p.revisions[0] && p.revisions[0].slots.main.content;
        if (text) pages.push({ name: campaignKey(p.title), text });
      });
    }
    return pages;
  }

  /** Campaign names matching typed text: by name prefix and by full-text search. */
  async searchCampaigns(text, limit = 20) {
    const query = String(text || '').trim().replace(/^Campaign:/i, '');
    if (!query) return [];
    const names = new Set();
    const variants = [...new Set([query, query.charAt(0).toUpperCase() + query.slice(1), query.toLowerCase()])];
    for (const prefix of variants) {
      const json = await this.get({ action: 'query', list: 'allpages', apnamespace: '460', apprefix: prefix, aplimit: String(limit) });
      ((json.query || {}).allpages || []).forEach((p) => names.add(campaignKey(p.title)));
    }
    if (names.size < limit) {
      try {
        const json = await this.get({ action: 'query', list: 'search', srnamespace: '460', srsearch: query, srlimit: String(limit), srprop: '' });
        ((json.query || {}).search || []).forEach((p) => names.add(campaignKey(p.title)));
      } catch (e) { /* prefix results are enough */ }
    }
    return [...names].slice(0, limit);
  }

  /** Plain text of wikitext such as a template call. */
  async expand(text) {
    const json = await this.get({ action: 'expandtemplates', text, prop: 'wikitext', title: 'Special:UploadWizard' });
    return json.expandtemplates.wikitext;
  }
}
