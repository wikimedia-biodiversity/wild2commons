// Uploading one file: duplicate check, action=upload with each warning handled, then
// structured data. No DOM code, so it can be tested with fakes.
import { CommonsError } from './commons.js';
import { sleep, sha1Hex } from './util.js';

const AUTH = /^(assertuserfailed|assertnameduserfailed|notloggedin|mwoauth-|http-401)/;
const PERMISSION = /^(cantcreate|permissiondenied|badaccess|cantedit|noedit|protectedpage|cascadeprotected|readonly|http-403)/;

export const isAuthError = (e) => e instanceof CommonsError && AUTH.test(e.code);
export const isPermissionError = (e) => e instanceof CommonsError && PERMISSION.test(e.code);
export const isCaptcha = (e) => e instanceof CommonsError && /captcha/i.test(e.code);

/** Rights the OAuth login must carry, with the grant that gives each. */
export const REQUIRED_RIGHTS = {
  upload: 'Upload new files',
  createpage: 'Create, edit, and move pages',
  edit: 'Edit existing pages',
};
export const missingGrants = (rights = []) => Object.entries(REQUIRED_RIGHTS).filter(([r]) => !rights.includes(r)).map(([, g]) => g);

export function interpretUpload(upload) {
  if (upload && upload.captcha) return { kind: 'captcha' };
  if (upload && upload.result === 'Success') return { kind: 'success', filename: upload.filename };
  if (upload && upload.result === 'Warning') {
    const w = upload.warnings || {};
    const first = (v) => (Array.isArray(v) ? v[0] : v);
    if (w.duplicate) return { kind: 'duplicate', title: `File:${first(w.duplicate)}` };
    if (w['duplicate-archive']) return { kind: 'deleted-duplicate', title: `File:${first(w['duplicate-archive'])}` };
    if (w['was-deleted']) return { kind: 'was-deleted', title: `File:${first(w['was-deleted'])}` };
    const taken = w.exists || w['exists-normalized'] || w['page-exists'];
    if (taken) return { kind: 'name-taken', title: `File:${first(taken)}` };
    if (w.badfilename) return { kind: 'bad-filename', suggestion: first(w.badfilename) };
    return { kind: 'warning', warnings: w };
  }
  return { kind: 'unexpected', result: (upload && upload.result) || 'none' };
}

/** Retries when Commons is lagged, rate-limits, the edit token is stale, or the network drops. */
export async function withRetries(fn, { api, signal, onWait = () => {}, sleepFn = sleep, maxAttempts = 6 } = {}) {
  let refreshed = false;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      if (attempt >= maxAttempts) throw e;
      if (e instanceof CommonsError) {
        if (e.code === 'maxlag') {
          const s = Math.max(5, Math.ceil(e.retryAfter || e.lag || 5));
          onWait(`Commons servers are busy; waiting ${s} s`);
          await sleepFn(s * 1000, signal);
          continue;
        }
        if (e.code === 'ratelimited') {
          const s = Math.min(600, 60 * attempt);
          onWait(`Commons asked us to slow down; waiting ${s} s`);
          await sleepFn(s * 1000, signal);
          continue;
        }
        if (e.code === 'badtoken' && api && !refreshed) {
          refreshed = true;
          await api.csrfToken(true);
          continue;
        }
        throw e;
      }
      if (e instanceof TypeError) {
        const s = 15 * attempt;
        onWait(`Network problem; retrying in ${s} s`);
        await sleepFn(s * 1000, signal);
        continue;
      }
      throw e;
    }
  }
}

const failed = (error, extra = {}) => ({ state: 'failed', error, ...extra });

/**
 * plan: { filename, text, comment, sdc, summary }
 * getFile: async () => Blob (the original)
 * Returns { state: 'duplicate'|'uploaded'|'done'|'failed', title, error?, code?, sdcError? }
 */
export async function uploadOne({ plan, getFile, api, signal, onStep = () => {}, sleepFn = sleep }) {
  const retry = { api, signal, onWait: onStep, sleepFn };
  onStep('Fetching the original file');
  const blob = await getFile();
  const sha1 = await sha1Hex(await blob.arrayBuffer());
  onStep('Checking Commons for the same file');
  const same = await withRetries(() => api.findBySha1(sha1), retry);
  if (same.length) return { state: 'duplicate', title: same[0] };

  let name = plan.filename;
  let outcome;
  for (let attempt = 0; ; attempt += 1) {
    onStep(`Uploading ${name}`);
    try {
      outcome = interpretUpload((await withRetries(() => api.upload({ filename: name, text: plan.text, comment: plan.comment, blob }), retry)).upload);
    } catch (e) {
      if (isCaptcha(e)) outcome = { kind: 'captcha' };
      else throw e;
    }
    if (outcome.kind === 'bad-filename' && attempt === 0 && outcome.suggestion && outcome.suggestion !== name) {
      name = outcome.suggestion;
      continue;
    }
    break;
  }

  switch (outcome.kind) {
    case 'success': {
      const title = `File:${outcome.filename || name}`;
      if (!plan.sdc) return { state: 'done', title };
      try {
        onStep('Adding caption and structured data');
        let pageId = 0;
        for (let i = 0; i < 5 && !pageId; i += 1) {
          pageId = await withRetries(() => api.pageId(title), retry);
          if (!pageId) await sleepFn(2000, signal);
        }
        if (!pageId) throw new Error('The new file page was not found yet');
        await withRetries(() => api.editEntity({ id: `M${pageId}`, data: plan.sdc, summary: plan.summary }), retry);
        return { state: 'done', title };
      } catch (e) {
        if ((e && e.name === 'AbortError') || isAuthError(e)) throw e;
        return { state: 'uploaded', title, sdcError: (e && e.message) || String(e) };
      }
    }
    case 'duplicate':
      return { state: 'duplicate', title: outcome.title };
    case 'deleted-duplicate':
      return failed(`An identical file was deleted from Commons before (${outcome.title}), so it was not uploaded again.`);
    case 'was-deleted':
      return failed(`A file named ${outcome.title} was deleted from Commons before, so it was not uploaded again.`);
    case 'name-taken':
      return failed(`A different file already uses the name ${outcome.title}.`);
    case 'bad-filename':
      return failed('Commons did not accept the file name.');
    case 'captcha':
      return failed('Commons asked for a CAPTCHA, which it does for new accounts. Upload one file by hand on Commons, or wait until your account is 4 days old with 10 edits, then try again.', { code: 'captcha' });
    case 'warning':
      return failed(`Commons returned a warning: ${Object.keys(outcome.warnings).join(', ') || 'unknown'}.`);
    default:
      return failed(`Unexpected reply from Commons (${outcome.result}).`);
  }
}
