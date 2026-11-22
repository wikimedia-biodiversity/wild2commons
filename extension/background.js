/* Wild2Commons helper extension, background part.
   It does only what the website cannot: read the user's sign-in on eBird, iNaturalist and
   Xeno-canto, list and read their eBird photos in background tabs, and fetch originals.
   It answers only the Wild2Commons website (see content/bridge.js). Nothing is stored
   except which website address to open, and no sign-in token is kept. */
if (typeof importScripts === 'function' && !globalThis.W2C) importScripts('lib/core.js');

const ext = globalThis.browser ?? globalThis.chrome;
const W2C = globalThis.W2C;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_APP = 'https://wild2commons.toolforge.org/';
const APP_ORIGINS = ['https://wild2commons.toolforge.org', 'http://localhost', 'http://127.0.0.1'];
const MY_EBIRD = 'https://ebird.org/myebird';
const IMAGE_BASE = 'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/';
/* fetchFile only fetches from these hosts (iNaturalist photos, Xeno-canto sounds). */
const FILE_HOSTS = [/(^|\.)inaturalist\.org$/, /^inaturalist-open-data\.s3\.amazonaws\.com$/, /^static\.inaturalist\.org$/, /(^|\.)xeno-canto\.org$/];

const appUrl = async () => ((await ext.storage.local.get('appUrl')).appUrl || DEFAULT_APP);
const isAppOrigin = (url) => { try { const u = new URL(url); return APP_ORIGINS.some((o) => `${u.protocol}//${u.hostname}` === o); } catch (e) { return false; } };

/* ---------- toolbar button ---------- */
ext.action.onClicked.addListener(async () => {
  const url = await appUrl();
  const [existing] = await ext.tabs.query({ url: `${url.replace(/\/?$/, '/')}*` }).catch(() => []);
  if (existing) {
    await ext.tabs.update(existing.id, { active: true });
    await ext.windows.update(existing.windowId, { focused: true });
  } else await ext.tabs.create({ url });
});

/* Opens the app for one record (from the button on a source page). */
ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== ext.runtime.id || !message || message.w2c !== 'openApp') return false;
  appUrl().then((base) => {
    const url = new URL(base);
    url.searchParams.set('source', message.source);
    url.searchParams.set('record', String(message.record));
    return ext.tabs.create({ url: url.href, index: sender.tab ? sender.tab.index + 1 : undefined });
  }).then(() => sendResponse({ ok: true }), (e) => sendResponse({ error: e.message }));
  return true;
});

/* ---------- tabs ---------- */
function waitForTabLoad(tabId, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('The page took too long to load.')); }, timeout);
    const cleanup = () => { clearTimeout(timer); ext.tabs.onUpdated.removeListener(listener); };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') { cleanup(); resolve(); } };
    ext.tabs.onUpdated.addListener(listener);
    ext.tabs.get(tabId).then((tab) => { if (tab.status === 'complete') { cleanup(); resolve(); } }).catch(() => {});
  });
}
const settleTab = (tabId, timeout = 20000) => waitForTabLoad(tabId, timeout).catch(() => {});
const closeTab = (id) => (id == null ? Promise.resolve() : ext.tabs.remove(id).catch(() => {}));

/* A new tab can ignore its first navigation while still finishing its blank page. */
async function openInTab(tabId, url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await ext.tabs.update(tabId, { url });
    for (let i = 0; i < 10; i += 1) {
      await sleep(200);
      const tab = await ext.tabs.get(tabId).catch(() => null);
      if (!tab) throw new Error('The helper tab was closed.');
      if ((tab.pendingUrl || tab.url || '').startsWith(url.split('#')[0])) return;
    }
  }
  throw new Error('The helper tab did not open the page.');
}

/* Repeats until the page answers: it may still be passing the site's browser check. */
async function askTab(tabId, message, accept, timeout = 40000) {
  const end = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < end) {
    try {
      const reply = await ext.tabs.sendMessage(tabId, message);
      if (reply && reply.error) throw new Error(reply.error);
      if (reply && accept(reply)) return reply;
    } catch (error) { lastError = error; }
    const tab = await ext.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('The helper tab was closed.');
    if (/secure\.birds\.cornell\.edu|\/login/.test(tab.url || '')) { const e = new Error('signed-out'); e.signedOut = true; throw e; }
    await sleep(500);
  }
  throw lastError && !/Receiving end|Could not establish/.test(lastError.message) ? lastError : new Error('The page did not provide its data.');
}

async function backgroundTab(url) {
  const tab = await ext.tabs.create({ url, active: false });
  try { await ext.tabs.update(tab.id, { autoDiscardable: false }); } catch (e) { /* not in Firefox */ }
  return tab;
}

/* ---------- state (kept in session storage so a restarted worker can carry on) ---------- */
const session = ext.storage.session || ext.storage.local;
const getState = async () => (await session.get('w2c')).w2c || {};
const setState = async (patch) => session.set({ w2c: { ...(await getState()), ...patch } });

/* ---------- eBird ---------- */
async function ebirdAccount() {
  try {
    const response = await fetch(MY_EBIRD, { credentials: 'include' });
    if (/secure\.birds\.cornell\.edu/.test(response.url)) return null;
    const account = W2C.parseMyEbird(await response.text());
    if (account) { await setState({ ebirdUser: account.userId }); return account; }
  } catch (e) { /* a real tab can pass the site's browser check */ }
  const tab = await backgroundTab(MY_EBIRD);
  try {
    await settleTab(tab.id);
    const { account } = await askTab(tab.id, { w2c: 'readMyEbird' }, (r) => r.account);
    await setState({ ebirdUser: account.userId });
    return account;
  } catch (e) {
    if (e.signedOut) return null;
    throw e;
  } finally { await closeTab(tab.id); }
}

function toAsset(raw) {
  const a = W2C.normalizeAsset(raw);
  return {
    assetId: a.assetId, userId: a.userId, userName: a.userName, comName: a.comName, sciName: a.sciName,
    speciesCode: a.speciesCode, obsDt: a.obsDt, checklistId: a.checklistId, restricted: a.restricted,
    mime: a.mime, mediaType: a.mediaType, location: a.location,
  };
}

/* New photos from a catalog reply, in list order, that were not sent before. */
function newAssets(catalog, sent) {
  const details = new Map((catalog.assets || []).map((raw) => [String(raw.assetId || raw.catalogId), raw]));
  const out = [];
  catalog.cards.forEach((card) => {
    if (sent.includes(card.assetId)) return;
    sent.push(card.assetId);
    const raw = details.get(card.assetId);
    out.push(raw ? toAsset(raw) : { assetId: card.assetId, comName: card.alt || '', partial: true, location: {} });
  });
  return out;
}

async function catalogTabUsable(id) {
  if (id == null) return false;
  const tab = await ext.tabs.get(id).catch(() => null);
  return !!tab && !tab.discarded && /^https:\/\/media\.ebird\.org\/catalog/.test(tab.url || tab.pendingUrl || '');
}

async function openCatalog(userId, filters) {
  const st = await getState();
  await closeTab(st.catalogTab);
  const tab = await backgroundTab(W2C.catalogUrl(userId, filters));
  await setState({ catalogTab: tab.id });
  await settleTab(tab.id);
  const { catalog } = await askTab(tab.id, { w2c: 'readCatalog' }, (r) => r.catalog);
  if (!catalog.user || catalog.user.userId !== userId) throw new Error('The photo list is signed in to a different eBird account.');
  return { tab: tab.id, catalog };
}

async function ebirdSearch({ filters = {}, count = 30 }, progress) {
  const userId = (await getState()).ebirdUser || (await ebirdAccount() || {}).userId;
  if (!userId) throw new Error('You are not signed in to eBird.');
  progress('Opening your photo list on eBird in a background tab');
  const { tab, catalog } = await openCatalog(userId, filters);
  const sent = [];
  let assets = newAssets(catalog, sent);
  let last = catalog;
  await setState({ filters, sent, userId });
  if (assets.length < count && catalog.hasMore) {
    const more = await ebirdMore({ count: count - assets.length }, progress, tab);
    assets = assets.concat(more.assets);
    last = more;
  } else await setState({ sent });
  if (!last.hasMore) { await closeTab(tab); await setState({ catalogTab: null }); }
  return { assets, hasMore: !!last.hasMore, info: '' };
}

async function ebirdMore({ count = 30 }, progress, knownTab) {
  const st = await getState();
  const sent = st.sent || [];
  let tab = knownTab ?? st.catalogTab;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      if (!(await catalogTabUsable(tab))) {
        progress(`Reopening your photo list (${sent.length} loaded so far)`);
        tab = (await openCatalog(st.userId, st.filters || {})).tab;
        if (sent.length) await askTab(tab, { w2c: 'restoreCatalog', count: sent.length }, (r) => r.catalog, 60000 + sent.length * 2000);
      }
      progress('Loading more photos from eBird');
      const { catalog } = await askTab(tab, { w2c: 'moreCatalog', count }, (r) => r.catalog, 30000 + Math.ceil(count / 30) * 60000);
      const assets = newAssets(catalog, sent);
      await setState({ sent, catalogTab: tab });
      if (!catalog.hasMore) { await closeTab(tab); await setState({ catalogTab: null }); }
      return { assets, hasMore: !!catalog.hasMore };
    } catch (e) {
      if (e.signedOut) throw new Error('eBird signed you out. Sign in to eBird and try again.');
      if (attempt === 2) throw e;
      await closeTab(tab);
      tab = null;
    }
  }
  return { assets: [], hasMore: false };
}

/* One helper tab for photo pages, reused across uploads. */
async function assetTab(assetId) {
  const st = await getState();
  const url = `https://macaulaylibrary.org/asset/${assetId}`;
  let tab = st.assetTab != null ? await ext.tabs.get(st.assetTab).catch(() => null) : null;
  if (!tab) { tab = await backgroundTab(url); await setState({ assetTab: tab.id }); } else if (!(tab.url || '').startsWith(url)) await openInTab(tab.id, url);
  await settleTab(tab.id);
  return tab.id;
}

async function ebirdAsset({ assetId }) {
  const id = String(assetId);
  const tab = await assetTab(id);
  const { page } = await askTab(tab, { w2c: 'readAsset' }, (r) => r.page && String(r.page.asset.assetId || r.page.asset.catalogId) === id, 60000);
  const asset = toAsset(page.asset);
  const account = (await getState()).ebirdUser;
  const owner = !!(page.user && page.user.userId && page.user.userId === asset.userId && (!account || account === asset.userId));
  if (!W2C.isPhoto(W2C.normalizeAsset(page.asset))) throw new Error('This item is not a photo.');
  return { asset, owner };
}

function captureDownload(tabId, assetId, progress) {
  return new Promise((resolve, reject) => {
    let handOff; let expiry;
    const cleanup = () => { clearTimeout(handOff); clearTimeout(expiry); ext.downloads.onCreated.removeListener(listener); };
    const listener = (download) => {
      const url = download.finalUrl || download.url || '';
      if (!(url.includes(assetId) || /macaulaylibrary\.org/.test(`${download.referrer || ''} ${url}`))) return;
      cleanup();
      ext.downloads.cancel(download.id).catch(() => {}).then(() => ext.downloads.erase({ id: download.id })).catch(() => {});
      resolve(url);
    };
    ext.downloads.onCreated.addListener(listener);
    handOff = setTimeout(() => {
      progress('Click "Download original" in the Macaulay Library tab');
      ext.tabs.update(tabId, { active: true }).catch(() => {});
    }, 15000);
    expiry = setTimeout(() => { cleanup(); reject(new Error('The original download did not start.')); }, 150000);
    ext.tabs.sendMessage(tabId, { w2c: 'clickDownload' }).catch(() => {});
  });
}

async function fetchBlob(url, credentials = 'include') {
  const response = await fetch(url, { credentials });
  if (!response.ok) throw new Error(`The file server answered ${response.status}.`);
  return response.blob();
}

async function ebirdOriginal({ assetId, allowResized }, progress) {
  const id = String(assetId);
  const { originalTemplate } = await ext.storage.local.get('originalTemplate');
  if (originalTemplate) {
    try { return await fetchBlob(originalTemplate.split('{id}').join(id)); } catch (e) { await ext.storage.local.remove('originalTemplate'); }
  }
  const tab = await assetTab(id);
  try {
    const url = await captureDownload(tab, id, progress);
    if (url.startsWith('blob:')) {
      const reply = await ext.tabs.sendMessage(tab, { w2c: 'fetchBlob', url });
      if (reply.error) throw new Error(reply.error);
      const bin = atob(reply.file.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: reply.file.type });
    }
    const blob = await fetchBlob(url);
    if (url.includes(id) && !/[?&](X-Amz|Signature|Expires|token)/i.test(url)) await ext.storage.local.set({ originalTemplate: url.split(id).join('{id}') });
    return blob;
  } catch (e) {
    if (!allowResized) throw e;
    progress('Original not available; using the 2400 px copy');
    return fetchBlob(`${IMAGE_BASE}${id}/2400`, 'omit');
  }
}

/* ---------- iNaturalist and Xeno-canto sign-in (read only, nothing kept) ---------- */
async function inatWhoami() {
  const tokenResponse = await fetch('https://www.inaturalist.org/users/api_token', { credentials: 'include', headers: { Accept: 'application/json' } });
  if (!tokenResponse.ok) return null;
  const { api_token: token } = await tokenResponse.json().catch(() => ({}));
  if (!token) return null;
  const me = await fetch('https://api.inaturalist.org/v1/users/me', { headers: { Authorization: token, Accept: 'application/json' } });
  if (!me.ok) return null;
  const user = ((await me.json()).results || [])[0];
  return user ? { login: user.login, name: user.name || user.login, id: String(user.id) } : null;
}

/* Best effort: Xeno-canto has no "who am I" API, so this reads the account page. */
async function xcWhoami() {
  const response = await fetch('https://xeno-canto.org/account', { credentials: 'include' });
  if (!response.ok || /\/auth\/login/.test(response.url)) return null;
  const html = await response.text();
  const m = /href="\/contributor\/([A-Z]{10})"[^>]*>\s*([^<]{2,80}?)\s*</.exec(html)
    || /<h1[^>]*>\s*(?:Account(?: of)?\s*)?([^<]{2,80}?)\s*<\/h1>/i.exec(html);
  if (!m) return null;
  const name = (m[2] || m[1]).trim();
  return { login: name, name, id: m[2] ? m[1] : '' };
}

async function fetchFile({ url }) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !FILE_HOSTS.some((re) => re.test(u.hostname))) throw new Error('The extension only fetches iNaturalist and Xeno-canto files.');
  return fetchBlob(url, 'omit');
}

const COMMANDS = {
  'ebird.account': ebirdAccount,
  'ebird.search': ebirdSearch,
  'ebird.more': (args, progress) => ebirdMore(args, progress),
  'ebird.asset': ebirdAsset,
  'ebird.original': ebirdOriginal,
  'inat.whoami': inatWhoami,
  'xc.whoami': xcWhoami,
  fetchFile,
};

/* ---------- the bridge port from content/bridge.js ---------- */
const CHUNK = 2 * 1024 * 1024;
async function sendBlob(port, id, blob) {
  port.postMessage({ id, type: 'fileStart', mime: blob.type, size: blob.size });
  for (let offset = 0; offset < blob.size; offset += CHUNK) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    port.postMessage({ id, type: 'fileChunk', base64: btoa(binary) });
  }
  port.postMessage({ id, type: 'result', ok: true, file: true });
}

ext.runtime.onConnect.addListener((port) => {
  if (port.name !== 'w2c-bridge') return;
  const sender = port.sender || {};
  if (sender.id !== ext.runtime.id || !isAppOrigin(sender.url || (sender.tab && sender.tab.url) || '')) { port.disconnect(); return; }
  port.onMessage.addListener(async (message) => {
    const { id, cmd, args } = message || {};
    const run = COMMANDS[cmd];
    if (!run) { port.postMessage({ id, type: 'result', ok: false, error: `Unknown command ${cmd}` }); return; }
    const progress = (text) => { try { port.postMessage({ id, type: 'progress', text }); } catch (e) { /* page went away */ } };
    try {
      const result = await run(args || {}, progress);
      if (result instanceof Blob) await sendBlob(port, id, result);
      else port.postMessage({ id, type: 'result', ok: true, result });
    } catch (e) {
      port.postMessage({ id, type: 'result', ok: false, error: e.message || String(e) });
    }
  });
});
