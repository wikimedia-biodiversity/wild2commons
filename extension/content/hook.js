/* Runs in the catalog page itself, only when the extension opened the tab (#w2c).
   Passes the photo records the page receives from Macaulay Library search to pages.js,
   and can repeat the page's own search request for the next page of results. */
(function () {
  if (!location.hash.includes('w2c')) return;
  const originalFetch = window.fetch;
  const post = (data) => window.postMessage({ source: 'w2c-hook', ...data }, location.origin);

  /* Photo records in a response, in order. Search results are either a bare list
     or wrapped (for example results.content). */
  function recordsIn(value) {
    const found = [];
    const seen = new Set();
    const visit = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return;
      seen.add(node);
      if (!Array.isArray(node) && (node.assetId || node.catalogId)
        && (node.userId || node.taxonomy || node.commonName || node.speciesCode)) {
        found.push(node);
        return;
      }
      (Array.isArray(node) ? node : Object.values(node)).forEach((child) => visit(child, depth + 1));
    };
    visit(value, 0);
    return found;
  }

  function relay(url, value, requestId) {
    const assets = recordsIn(value);
    if (assets.length || requestId) post({ kind: 'records', url: String(url || ''), assets, requestId: requestId || null });
  }

  const urlOf = (input) => (typeof input === 'string' ? input : (input && input.url) || '');

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      if ((response.headers.get('content-type') || '').includes('json')) {
        const url = response.url || urlOf(args[0]);
        response.clone().json().then((data) => relay(url, data)).catch(() => {});
      }
    } catch (e) { /* the page's own request is unaffected */ }
    return response;
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.addEventListener('load', () => {
      try {
        if ((this.getResponseHeader('content-type') || '').includes('json')) relay(this.responseURL || url, JSON.parse(this.responseText));
      } catch (e) { /* not JSON */ }
    });
    return open.call(this, method, url, ...rest);
  };

  /* pages.js asks for another page of the same search. */
  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.source !== 'w2c-page' || data.cmd !== 'fetch') return;
    try {
      const response = await originalFetch(data.url, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`search answered ${response.status}`);
      if (!(response.headers.get('content-type') || '').includes('json')) throw new Error('search did not return data');
      relay(response.url || data.url, await response.json(), data.requestId);
    } catch (error) {
      post({ kind: 'error', requestId: data.requestId, message: error.message });
    }
  });
})();
