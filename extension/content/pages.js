/* Reads eBird and Macaulay Library pages only when the extension asks. */
(function () {
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const { parseNuxtJson, findAssets, findSessionUser, parseMyEbird } = globalThis.W2C;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const idOf = (record) => String(record.assetId || record.catalogId);

  /* Search results seen by the page, in order. */
  const search = {
    records: new Map(),
    template: '',
    lastCursor: '',
    pageSize: 0,
    exhausted: false,
    responses: 0,
    lastPath: '',
    waiters: [],
  };

  function takeRecords(url, assets) {
    let added = 0;
    assets.forEach((record) => {
      const id = idOf(record);
      if (!search.records.has(id)) added += 1;
      search.records.set(id, record);
    });
    let path = '';
    try { path = new URL(url, location.href).pathname; } catch (e) { path = url; }
    /* Only the search request decides paging; other requests with records are ignored here. */
    const isSearch = assets.length && /search|catalog/i.test(url) && (!search.lastPath || path === search.lastPath);
    if (isSearch) {
      search.responses += 1;
      search.template = url;
      search.lastPath = path;
      const last = assets[assets.length - 1];
      if (last.cursorMark) search.lastCursor = String(last.cursorMark);
      const asked = Number(new URL(url, location.href).searchParams.get('count')) || 0;
      search.pageSize = Math.max(search.pageSize, asked, assets.length);
      if (assets.length < (asked || search.pageSize)) search.exhausted = true;
    }
    return added;
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.source !== 'w2c-hook') return;
    if (data.kind === 'records') {
      const added = takeRecords(data.url, data.assets || []);
      search.waiters.splice(0).forEach((resolve) => resolve({ ...data, added }));
    } else if (data.kind === 'error') {
      search.waiters.splice(0).forEach((resolve) => resolve({ ...data, added: 0 }));
    }
  });

  /* Resolves on the next search response the page receives, or after `timeout`. */
  function nextResponse(timeout) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        search.waiters = search.waiters.filter((w) => w !== done);
        resolve(null);
      }, timeout);
      const done = (data) => { clearTimeout(timer); resolve(data); };
      search.waiters.push(done);
    });
  }

  const nuxt = () => parseNuxtJson((document.getElementById('__NUXT_DATA__') || {}).textContent);

  function catalogLinks() {
    const links = document.querySelectorAll('a[data-asset-id], a[href*="macaulaylibrary.org/asset/"]');
    const cards = new Map();
    links.forEach((link) => {
      const id = link.dataset.assetId || (/asset\/(\d+)/.exec(link.href) || [])[1];
      if (!id || cards.has(id)) return;
      const image = link.querySelector('img');
      cards.set(id, { assetId: id, alt: image ? image.alt : '' });
    });
    return [...cards.values()];
  }

  const moreButton = () => document.querySelector('.pagination button')
    || [...document.querySelectorAll('button')].find((b) => /^\s*more results\s*$/i.test(b.textContent) && !b.disabled);

  /* The list: photos shown on the page plus every search result the page received.
     The page's built-in data can hold a different result set, so it only adds details. */
  function readCatalog() {
    const data = nuxt();
    if (!data) return null;
    const list = new Map();
    catalogLinks().forEach((card) => list.set(card.assetId, card));
    search.records.forEach((record, id) => {
      if (!list.has(id)) list.set(id, { assetId: id, alt: record.commonName || (record.taxonomy || {}).comName || '' });
    });
    const details = new Map(findAssets(data).map((asset) => [idOf(asset), asset]));
    search.records.forEach((record, id) => details.set(id, record));
    const cards = [...list.values()];
    const shown = new Set(cards.map((card) => card.assetId));
    const canRepeat = !!(search.template && search.lastCursor);
    return {
      user: findSessionUser(data),
      assets: [...details.values()].filter((asset) => shown.has(idOf(asset))),
      cards,
      hasMore: !search.exhausted && (!!moreButton() || canRepeat),
      info: `${search.responses} search responses${search.lastPath ? ` from ${search.lastPath}` : ''}, `
        + `${search.records.size} results, cursor ${search.lastCursor ? 'yes' : 'no'}, button ${moreButton() ? 'yes' : 'no'}`,
    };
  }

  /* The page may still be starting up when first read: wait for its search results,
     or for its cards and "More results" button, before deciding what is there. */
  function readCatalogSettled(timeout = 15000) {
    return new Promise((resolve) => {
      let quiet = null;
      const finish = () => {
        observer.disconnect(); clearTimeout(limit); clearTimeout(quiet);
        search.waiters = search.waiters.filter((w) => w !== onResponse);
        resolve(readCatalog());
      };
      const check = () => {
        clearTimeout(quiet);
        if (search.responses) { quiet = setTimeout(finish, 600); return; }
        const cards = catalogLinks().length;
        if (cards && moreButton()) { quiet = setTimeout(finish, 1500); return; }
        const empty = /no results|no media/i.test((document.querySelector('main') || document.body).textContent);
        if (cards || empty) quiet = setTimeout(finish, 4000);
      };
      const onResponse = () => check();
      search.waiters.push(onResponse);
      const observer = new MutationObserver(check);
      observer.observe(document.body, { childList: true, subtree: true });
      const limit = setTimeout(finish, timeout);
      check();
    });
  }

  let requestCounter = 0;
  /* Repeats the page's own search request, starting after the last result. */
  async function repeatSearch(count) {
    const url = new URL(search.template, location.href);
    const cursorName = ['initialCursorMark', 'cursorMark', 'cursor'].find((name) => url.searchParams.has(name)) || 'initialCursorMark';
    url.searchParams.set(cursorName, search.lastCursor);
    if (url.searchParams.has('count') || count > 30) url.searchParams.set('count', String(Math.min(100, Math.max(30, count))));
    const requestId = `w2c-${Date.now()}-${requestCounter += 1}`;
    const waiting = nextResponse(60000);
    window.postMessage({ source: 'w2c-page', cmd: 'fetch', url: url.href, requestId }, location.origin);
    const reply = await waiting;
    if (!reply) throw new Error('Macaulay Library search did not answer within a minute.');
    if (reply.kind === 'error') throw new Error(`Macaulay Library search failed: ${reply.message}.`);
    if (!(reply.assets || []).length) search.exhausted = true;
    return reply.added;
  }

  async function clickMore() {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const button = moreButton();
    if (!button) return false;
    const before = search.records.size;
    const cardsBefore = catalogLinks().length;
    const waiting = nextResponse(60000);
    button.scrollIntoView({ block: 'center' });
    button.click();
    const reply = await waiting;
    await sleep(400);
    if (!reply && catalogLinks().length <= cardsBefore) {
      throw new Error('eBird did not return more photos within a minute. Try again.');
    }
    return search.records.size > before || catalogLinks().length > cardsBefore;
  }

  /* Loads at least `wanted` more photos. */
  async function loadMore(wanted = 30) {
    const size = () => (readCatalog() || { cards: [] }).cards.length;
    const target = size() + wanted;
    let repeatFailed = false;
    while (size() < target && !search.exhausted) {
      const before = size();
      if (search.template && search.lastCursor && !repeatFailed) {
        try {
          await repeatSearch(target - before);
          if (size() > before) continue;
        } catch (error) { /* fall back to the page's own button */ }
        repeatFailed = true;
      }
      if (!moreButton()) await readCatalogSettled(6000);
      if (!(await clickMore())) break;
    }
    const catalog = readCatalog();
    if (catalog && size() === target - wanted && catalog.hasMore) {
      throw new Error(`No new photos arrived (${catalog.info}).`);
    }
    return catalog;
  }

  /* Loads until at least `count` photos are listed, to restore the list after the
     helper tab was closed or reloaded. */
  async function restoreTo(count) {
    const catalog = readCatalog();
    if (!catalog || catalog.cards.length >= count || !catalog.hasMore) return catalog;
    return loadMore(count - catalog.cards.length);
  }

  function readAsset() {
    const data = nuxt();
    if (!data) return null;
    const id = (/asset\/(\d+)/.exec(location.pathname) || [])[1];
    const asset = findAssets(data).find((a) => String(a.assetId) === id);
    if (!asset) return null;
    return { asset, user: findSessionUser(data) };
  }

  function clickDownload() {
    const button = [...document.querySelectorAll('button')].find((b) => b.querySelector('.Icon--download'));
    if (!button) return false;
    button.click();
    return true;
  }

  async function blobToBase64Parts(url) {
    const blob = await (await fetch(url)).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    }
    return { type: blob.type, base64: btoa(binary) };
  }

  const handlers = {
    readMyEbird: async () => ({ account: parseMyEbird(document.documentElement.outerHTML) }),
    readCatalog: async () => ({ catalog: await readCatalogSettled() }),
    moreCatalog: async (message) => ({ catalog: await loadMore(message.count || 30) }),
    restoreCatalog: async (message) => ({ catalog: await restoreTo(message.count || 0) }),
    readAsset: async () => ({ page: readAsset() }),
    clickDownload: async () => { await sleep(1800); return { clicked: clickDownload() }; },
    fetchBlob: async (message) => ({ file: await blobToBase64Parts(message.url) }),
  };

  extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== extensionApi.runtime.id || !message || !handlers[message.e2c || message.w2c]) return false;
    handlers[message.e2c || message.w2c](message)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  });
})();
