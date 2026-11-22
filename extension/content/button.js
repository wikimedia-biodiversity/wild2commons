/* Adds an "Upload to Commons" button to Macaulay Library photo pages, iNaturalist
   observations and Xeno-canto recordings. The button opens Wild2Commons with that record
   ready to upload. */
(function () {
  const ext = globalThis.browser ?? globalThis.chrome;

  function current() {
    const { hostname, pathname } = location;
    let m;
    if (/macaulaylibrary\.org$/.test(hostname) && (m = /^\/asset\/(\d+)/.exec(pathname))) return { source: 'ebird', record: m[1] };
    if (/inaturalist\.org$/.test(hostname) && (m = /^\/observations\/(\d+)/.exec(pathname))) return { source: 'inat', record: m[1] };
    if (/xeno-canto\.org$/.test(hostname) && (m = /^\/(\d+)\/?$/.exec(pathname))) return { source: 'xc', record: m[1] };
    return null;
  }

  function render() {
    const target = current();
    let button = document.getElementById('w2c-upload-button');
    if (!target) { if (button) button.remove(); return; }
    if (!button) {
      button = document.createElement('button');
      button.id = 'w2c-upload-button';
      button.type = 'button';
      button.textContent = 'Upload to Commons';
      button.title = 'Open this record in Wild2Commons, ready to upload to Wikimedia Commons';
      Object.assign(button.style, {
        position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647', padding: '10px 16px',
        font: '600 14px/1.2 system-ui, sans-serif', color: '#fff', background: '#06739a',
        border: '0', borderRadius: '6px', boxShadow: '0 2px 8px rgba(0,0,0,.25)', cursor: 'pointer',
      });
      button.addEventListener('click', () => {
        const t = current();
        if (!t) return;
        button.disabled = true;
        button.textContent = 'Opening Wild2Commons…';
        ext.runtime.sendMessage({ w2c: 'openApp', ...t }).finally(() => {
          setTimeout(() => { button.disabled = false; button.textContent = 'Upload to Commons'; }, 1500);
        });
      });
      document.documentElement.append(button);
    }
    button.dataset.record = `${target.source}:${target.record}`;
  }

  render();
  // These sites change pages without reloading.
  let last = location.href;
  setInterval(() => { if (location.href !== last) { last = location.href; render(); } }, 800);
})();
