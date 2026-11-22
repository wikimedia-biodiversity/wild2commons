// Shared helpers for the source adapters.
import * as bridge from '../lib/bridge.js';

/** Fetches a file directly; if the site blocks that, asks the extension to fetch it. */
export async function fetchFile(url, { allowExtension = true } = {}) {
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw new Error(`The file server answered ${response.status}.`);
    return await response.blob();
  } catch (error) {
    if (!allowExtension || !bridge.extensionInfo()) {
      throw new Error(`The file could not be fetched (${error.message}). Installing the Wild2Commons extension may help.`);
    }
    const file = await bridge.call('fetchFile', { url });
    return new Blob([file.buffer], { type: file.mime || 'application/octet-stream' });
  }
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

/** Spaces requests so a public API sees about one request per `ms`. */
export function pacer(ms) {
  let last = 0;
  return async () => {
    const wait = last + ms - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
  };
}
