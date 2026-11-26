// Shared helpers for the source adapters.
import * as bridge from '../lib/bridge.js';

/** Fetches a file straight from the source. If the site does not allow that, the user is asked
    to add the file from their computer instead ("Add file" on the item). */
export async function fetchFile(url, { what = 'the file' } = {}) {
  let response;
  try {
    response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  } catch (error) {
    if (bridge.extensionInfo() && !/birds\.cornell\.edu/.test(url)) {
      const file = await bridge.call('fetchFile', { url });
      return new Blob([file.buffer], { type: file.mime || 'application/octet-stream' });
    }
    throw new Error(`The browser was not allowed to fetch ${what}. Download it yourself and use "Add file" on the item, or install the Wild2Commons extension.`);
  }
  if (!response.ok) throw new Error(`Fetching ${what} failed (the server answered ${response.status}). Download it yourself and use "Add file" on the item.`);
  return response.blob();
}

export const extFromUrl = (url, fallback) => {
  const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(String(url || ''));
  const ext = m ? m[1].toLowerCase() : fallback;
  return ext === 'jpeg' ? 'jpg' : ext;
};

export const extFromMime = (mime, fallback) => ({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/tiff': 'tif', 'image/gif': 'gif',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/ogg': 'ogg',
}[String(mime || '').toLowerCase()] || fallback);

/** Extension of a file the user added: from its name, else its type. */
export const extFromFile = (file) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(file.name || '');
  const ext = m ? m[1].toLowerCase() : extFromMime(file.type, 'jpg');
  return ext === 'jpeg' ? 'jpg' : ext;
};

/** Spaces requests so a public API sees about one request per `ms`. */
export function pacer(ms) {
  let last = 0;
  return async () => {
    const wait = last + ms - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
  };
}
