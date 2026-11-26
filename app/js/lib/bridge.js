// Talks to the optional Wild2Commons helper extension. With it installed, eBird photos load
// automatically (the extension reads the user's eBird sign-in and fetches originals), and
// iNaturalist / Xeno-canto usernames are filled in. Everything else works without it.

let counter = 0;
const pending = new Map();
let info = null;
const listeners = new Set();

if (typeof window !== 'undefined') window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.w2c !== 'from-extension') return;
  const data = event.data;
  if (data.type === 'hello') {
    info = { version: data.version };
    listeners.forEach((fn) => fn(info));
    return;
  }
  const waiting = pending.get(data.id);
  if (!waiting) return;
  if (data.type === 'progress') { waiting.onProgress(data.text); return; }
  pending.delete(data.id);
  if (data.ok) waiting.resolve(data.result); else waiting.reject(new Error(data.error || 'The extension did not complete the request.'));
});

export const extensionInfo = () => info;

/** Resolves with the extension's info, or null if it does not answer within `ms`. */
export function detectExtension(ms = 1200) {
  if (info) return Promise.resolve(info);
  return new Promise((resolve) => {
    const done = (value) => { listeners.delete(done); clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => done(null), ms);
    listeners.add(done);
    window.postMessage({ w2c: 'to-extension', type: 'ping' }, location.origin);
  });
}

export function call(cmd, args = {}, { onProgress = () => {}, timeout = 10 * 60 * 1000 } = {}) {
  if (!info) return Promise.reject(new Error('The Wild2Commons extension is not installed or not enabled on this site.'));
  counter += 1;
  const id = `r${Date.now()}-${counter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The extension did not answer in time.')); }, timeout);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
      onProgress,
    });
    window.postMessage({ w2c: 'to-extension', type: 'request', id, cmd, args }, location.origin);
  });
}
