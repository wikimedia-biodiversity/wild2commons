/* Runs on the Wild2Commons website only. Passes the page's requests to the extension's
   background part and the answers back, reassembling files sent in pieces. */
(function () {
  const ext = globalThis.browser ?? globalThis.chrome;
  const version = ext.runtime.getManifest().version;
  const hello = () => window.postMessage({ w2c: 'from-extension', type: 'hello', version }, location.origin);
  let port = null;
  const files = new Map();

  function connect() {
    if (port) return port;
    port = ext.runtime.connect({ name: 'w2c-bridge' });
    port.onDisconnect.addListener(() => { port = null; });
    port.onMessage.addListener((m) => {
      if (m.type === 'progress') { window.postMessage({ w2c: 'from-extension', type: 'progress', id: m.id, text: m.text }, location.origin); return; }
      if (m.type === 'fileStart') { files.set(m.id, { mime: m.mime, parts: [] }); return; }
      if (m.type === 'fileChunk') {
        const bin = atob(m.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        files.get(m.id).parts.push(bytes);
        return;
      }
      if (m.type === 'result') {
        let result = m.result;
        if (m.ok && m.file) {
          const f = files.get(m.id);
          files.delete(m.id);
          const buffer = new Blob(f.parts).arrayBuffer();
          buffer.then((b) => window.postMessage({ w2c: 'from-extension', type: 'result', id: m.id, ok: true, result: { buffer: b, mime: f.mime } }, location.origin, [b]));
          return;
        }
        window.postMessage({ w2c: 'from-extension', type: 'result', id: m.id, ok: m.ok, result, error: m.error }, location.origin);
      }
    });
    return port;
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || !data || data.w2c !== 'to-extension') return;
    if (data.type === 'ping') { hello(); return; }
    if (data.type === 'request') {
      try { connect().postMessage({ id: data.id, cmd: data.cmd, args: data.args }); } catch (e) {
        window.postMessage({ w2c: 'from-extension', type: 'result', id: data.id, ok: false, error: 'The extension was updated or reloaded. Reload this page.' }, location.origin);
      }
    }
  });
  hello();
})();
