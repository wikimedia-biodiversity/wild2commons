// Wikimedia OAuth 2.0 for a browser (non-confidential) client: authorization code with PKCE.
// No client secret is used. The access token lives in sessionStorage and is never logged.

function base64url(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** RFC 7636 "S256" challenge for a verifier. */
export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** The callback address to register on Meta-Wiki: the app's address without query, hash or index.html. */
export function redirectUriFor(loc) {
  return loc.origin + loc.pathname.replace(/index\.html$/, '');
}

export function authorizeUrl({ restBase, clientId, redirectUri, state, challenge }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${restBase}/oauth2/authorize?${params}`;
}

export async function exchangeCode({ restBase, clientId, code, redirectUri, verifier, fetchFn = fetch, now = Date.now }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const response = await fetchFn(`${restBase}/oauth2/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw new Error(`Wikimedia login failed: ${json.error_description || json.message || json.error || `HTTP ${response.status}`}`);
  }
  return { accessToken: json.access_token, expiresAt: now() + (Number(json.expires_in) || 4 * 3600) * 1000 };
}

const KEY = 'w2c-oauth';
const PENDING = 'w2c-oauth-pending';

export class Login {
  constructor({ restBase, clientId, storage = sessionStorage, location: loc = location }) {
    this.restBase = restBase;
    this.clientId = clientId;
    this.storage = storage;
    this.loc = loc;
  }

  get token() {
    try {
      const saved = JSON.parse(this.storage.getItem(KEY) || 'null');
      if (saved && saved.expiresAt > Date.now() + 60000) return saved.accessToken;
    } catch (e) { /* ignore */ }
    return '';
  }

  get expiresAt() {
    try { return (JSON.parse(this.storage.getItem(KEY) || 'null') || {}).expiresAt || 0; } catch (e) { return 0; }
  }

  async start() {
    if (!this.clientId) throw new Error('No OAuth client ID. Add one in config.js or in Settings.');
    const verifier = randomString(48);
    const state = randomString(16);
    this.storage.setItem(PENDING, JSON.stringify({ verifier, state, back: this.loc.search + this.loc.hash }));
    this.loc.assign(authorizeUrl({
      restBase: this.restBase,
      clientId: this.clientId,
      redirectUri: redirectUriFor(this.loc),
      state,
      challenge: await pkceChallenge(verifier),
    }));
  }

  /** Completes a login when the page is the OAuth callback. Returns true if it handled one. */
  async finish() {
    const params = new URLSearchParams(this.loc.search);
    const code = params.get('code');
    if (!code && !params.get('error')) return false;
    const pending = JSON.parse(this.storage.getItem(PENDING) || 'null');
    this.storage.removeItem(PENDING);
    const back = pending && pending.back && !/[?&]code=/.test(pending.back) ? pending.back : '';
    history.replaceState(null, '', redirectUriFor(this.loc) + back);
    if (params.get('error')) throw new Error(`Wikimedia login was not completed (${params.get('error')}).`);
    if (!pending || pending.state !== params.get('state')) throw new Error('The login reply did not match this browser tab. Try logging in again.');
    const token = await exchangeCode({
      restBase: this.restBase, clientId: this.clientId, code,
      redirectUri: redirectUriFor(this.loc), verifier: pending.verifier,
    });
    this.storage.setItem(KEY, JSON.stringify(token));
    return true;
  }

  logout() {
    this.storage.removeItem(KEY);
  }
}
