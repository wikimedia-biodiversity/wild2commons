// Wild2Commons web app: three steps (source → media → settings and upload).
import { CONFIG, SOURCES } from './config.js';
import { Login, redirectUriFor } from './lib/oauth.js';
import { Commons } from './lib/commons.js';
import { Wikidata } from './lib/wikidata.js';
import { checkItem, licenceLabel, OWN_LICENSES } from './lib/licence.js';
import { parseCampaign, isRunning, fieldOptions, defaultAnswer, campaignAdditions, FALLBACK_WLB_2026 } from './lib/campaign.js';
import { fileName, caption, wikitext, categoryLayers, structuredData } from './lib/filepage.js';
import { uploadOne, isAuthError, isPermissionError, missingGrants } from './lib/uploader.js';
import { sleep, splitList, uniqueCategories, readJson, writeJson, speciesLabel, placeLabel } from './lib/util.js';
import * as bridge from './lib/bridge.js';
import { createEbird } from './sources/ebird.js';
import { createInat } from './sources/inat.js';
import { createXc } from './sources/xc.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  children.flat().forEach((c) => c != null && node.append(c));
  return node;
};

// ---------- settings ----------
const SETTINGS_KEY = 'w2c-settings';
let settings = { ...CONFIG.defaults, ...readJson(localStorage, SETTINGS_KEY, {}) };
const platformCategory = (id) => ((settings.platformCategories || {})[id] ?? CONFIG.platformCategories[id]) || '';
const clampBatch = (n) => Math.min(500, Math.max(30, Math.round(Number(n) || 30)));

// ---------- services ----------
const login = new Login({ restBase: CONFIG.oauthRest, clientId: settings.oauthClientId || CONFIG.oauthClientId });
const api = new Commons({ apiUrl: CONFIG.commonsApi, userAgent: CONFIG.userAgent, token: () => login.token });
const wikidata = new Wikidata({ apiUrl: CONFIG.wikidataApi, userAgent: CONFIG.userAgent });
const sources = {
  ebird: createEbird(() => settings),
  inat: createInat(),
  xc: createXc(() => settings.xcApiKey),
};

// ---------- state ----------
const state = {
  step: 1,
  sourceId: '',
  mode: 'own',
  account: null,
  login: '',
  items: new Map(),
  order: [],
  selected: new Set(),
  done: new Map(),
  hasMore: false,
  campaigns: [],
  campaign: null,
  answers: [],
  extraCategories: [],
  commonsUser: '',
  rights: [],
  running: null,
};

function notify(text) {
  const n = $('notice');
  n.textContent = text || '';
  n.hidden = !text;
}

// ---------- Commons account ----------
async function refreshCommonsUser() {
  state.commonsUser = '';
  state.rights = [];
  if (login.token) {
    try {
      const info = await api.userInfo();
      state.commonsUser = info.name;
      state.rights = info.rights;
      const missing = missingGrants(info.rights);
      if (info.name && missing.length) notify(`Your Commons login is missing these permissions: ${missing.join(', ')}. Log out and log in again, and allow all of them.`);
    } catch (e) {
      notify(`Could not check your Commons login: ${e.message}`);
    }
  }
  $('commonsUser').textContent = state.commonsUser ? `Commons: ${state.commonsUser}` : '';
  $('loginButton').hidden = !!state.commonsUser;
  $('logoutButton').hidden = !state.commonsUser;
  if (state.step === 3) renderPreview();
}

$('loginButton').addEventListener('click', async () => {
  try { await login.start(); } catch (e) { notify(`${e.message} Open Settings (the gear) to add one.`); }
});
$('logoutButton').addEventListener('click', () => { login.logout(); refreshCommonsUser(); });

// ---------- stepper ----------
function go(step) {
  state.step = step;
  [1, 2, 3].forEach((n) => { $(`step${n}`).hidden = n !== step; });
  document.querySelectorAll('.stepper button').forEach((b) => {
    const n = Number(b.dataset.goto);
    if (n === step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    b.classList.toggle('done', n < step);
    b.disabled = n > maxStep();
  });
  if (step === 3) enterStep3();
  window.scrollTo({ top: 0 });
}
const maxStep = () => (!state.login ? 1 : state.selected.size ? 3 : 2);
document.querySelectorAll('.stepper button').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.goto))));

// ---------- step 1: source ----------
const ICONS = {
  ebird: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M6 24c4-9 12-13 21-12l7-4-2 7c1 7-4 14-13 15-5 0-9-2-13-6Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="27" cy="16" r="1.8" fill="currentColor"/><path d="M14 30l-2 6M19 31l-1 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  inat: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 35V17M20 22c-7 0-11-5-11-12 7 0 11 5 11 12ZM20 19c0-6 4-10 11-10 0 6-4 10-11 10Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  xc: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M4 20h4M10 14v12M15 9v22M20 15v10M25 6v28M30 12v16M35 18v4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
};

function renderCards() {
  const box = $('sourceCards');
  box.setAttribute('role', 'radiogroup');
  box.setAttribute('aria-label', 'Source');
  box.replaceChildren(...Object.values(SOURCES).map((s) => {
    const card = el('div', { className: 'card' });
    card.dataset.source = s.id;
    card.setAttribute('aria-checked', String(state.sourceId === s.id));
    const icon = el('div');
    icon.innerHTML = ICONS[s.id];
    const title = el('h3', {}, el('a', { href: s.wikipedia, target: '_blank', rel: 'noopener', textContent: s.name, title: `${s.name} on Wikipedia` }));
    const tag = el('p', { className: 'tag', textContent: s.needsExtension ? 'Needs the Wild2Commons extension. Your own photos only.' : (s.kind === 'sound' ? 'Sound recordings. Needs your Xeno-canto API key.' : 'Your photos, or other people\'s openly licensed ones.') });
    const pick = el('button', { type: 'button', className: state.sourceId === s.id ? 'primary' : '', textContent: state.sourceId === s.id ? 'Selected' : `Use ${s.name}` });
    pick.addEventListener('click', () => chooseSource(s.id));
    card.append(icon, title, el('p', { textContent: s.blurb }), tag, pick);
    return card;
  }));
}

async function chooseSource(id, { quiet = false } = {}) {
  if (state.running) return;
  if (state.sourceId !== id) resetMedia();
  state.sourceId = id;
  state.account = null;
  const s = SOURCES[id];
  renderCards();
  $('accountPanel').hidden = false;
  $('accountTitle').textContent = `${s.name} account`;
  const others = document.querySelector('input[name=mode][value=others]');
  others.disabled = !s.othersAllowed;
  if (!s.othersAllowed) { document.querySelector('input[name=mode][value=own]').checked = true; state.mode = 'own'; }
  $('modeNote').textContent = s.othersAllowed
    ? 'For someone else\'s media, only files under CC0, CC BY or CC BY-SA can be uploaded, and each gets a licence review template.'
    : 'Macaulay Library photos belong to the people who took them, so only your own can be uploaded.';
  $('loginField').hidden = id === 'ebird';
  $('loginInput').value = '';
  if (!quiet) $('accountPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  await identify();
}

async function identify() {
  const id = state.sourceId;
  const s = SOURCES[id];
  const status = $('accountStatus');
  $('sourceSignIn').hidden = true;
  $('sourceRecheck').hidden = true;
  status.textContent = 'Checking…';
  const ext = await bridge.detectExtension();
  if (id === 'ebird') {
    if (!ext) {
      status.innerHTML = '';
      status.append('eBird photos need the Wild2Commons extension for Chrome or Firefox, because a website cannot read your eBird sign-in. ', el('a', { href: 'help.html#extension', textContent: 'Install the extension' }), ', then reload this page.');
      updateContinue();
      return;
    }
    try {
      status.textContent = 'Asking eBird who is signed in (this opens eBird in a background tab)…';
      const account = await sources.ebird.identify();
      if (!account) throw new Error('signed-out');
      state.account = account;
      state.login = account.login;
      status.textContent = `Signed in to eBird as ${account.name || account.handle || account.login} (${account.login}).`;
    } catch (e) {
      state.login = '';
      status.textContent = e.message === 'signed-out' ? 'You are not signed in to eBird in this browser.' : `Could not check eBird: ${e.message}`;
      $('sourceSignIn').hidden = false;
      $('sourceRecheck').hidden = false;
    }
    updateContinue();
    return;
  }
  // iNaturalist and Xeno-canto: the extension can fill in the username; otherwise it is typed.
  let found = null;
  if (ext) found = await sources[id].identify();
  if (found && found.login) {
    state.account = found;
    if (state.mode === 'own') $('loginInput').value = id === 'xc' ? (found.name || found.login) : found.login;
    status.textContent = `Signed in to ${s.name} as ${found.name || found.login}.`;
  } else {
    status.textContent = ext ? `You don't seem to be signed in to ${s.name} in this browser. Type the username instead, or sign in and check again.` : `Type the ${s.name} username. With the extension installed, it is filled in for you.`;
    $('sourceSignIn').hidden = false;
    $('sourceRecheck').hidden = !ext;
  }
  if (id === 'xc' && !settings.xcApiKey) status.textContent += ' Add your Xeno-canto API key in Settings first.';
  updateLoginHint();
  updateContinue();
}

function updateLoginHint() {
  const id = state.sourceId;
  const others = state.mode === 'others';
  $('loginHint').textContent = id === 'xc'
    ? (others ? 'The recordist name exactly as Xeno-canto shows it.' : 'Your recordist name exactly as Xeno-canto shows it.')
    : (others ? 'Their iNaturalist username, or a link to their profile.' : 'Your iNaturalist username, or a link to your profile.');
}

function updateContinue() {
  if (state.sourceId !== 'ebird') state.login = state.sourceId === 'inat' ? sourcesInatLogin($('loginInput').value) : $('loginInput').value.trim();
  $('toStep2').disabled = !state.login || (state.sourceId === 'xc' && !settings.xcApiKey);
  go(state.step);
}
const sourcesInatLogin = (v) => String(v || '').trim().replace(/^.*inaturalist\.org\/(?:people|users)\/([^/?#]+).*$/i, '$1').replace(/^@/, '');

$('sourceSignIn').addEventListener('click', () => window.open(SOURCES[state.sourceId].signInUrl, '_blank', 'noopener'));
$('sourceRecheck').addEventListener('click', () => identify());
$('loginInput').addEventListener('input', () => { resetMedia(); updateContinue(); });
document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => {
  state.mode = document.querySelector('input[name=mode]:checked').value;
  resetMedia();
  if (state.mode === 'own' && state.account) $('loginInput').value = state.sourceId === 'xc' ? (state.account.name || state.account.login) : state.account.login;
  else if (state.mode === 'others') $('loginInput').value = '';
  updateLoginHint();
  updateContinue();
}));
$('toStep2').addEventListener('click', () => { prepareStep2(); go(2); });

// ---------- step 2: media ----------
function resetMedia() {
  state.items.clear();
  state.order = [];
  state.selected.clear();
  state.hasMore = false;
  $('gallery').replaceChildren();
  $('loadMore').hidden = true;
  $('loadStatus').textContent = '';
  updateGalleryTitle();
}

function prepareStep2() {
  const id = state.sourceId;
  const form = $('searchForm');
  $('step2Title').textContent = `Load ${SOURCES[id].kind === 'sound' ? 'recordings' : 'photos'} from ${SOURCES[id].name}`;
  $('placeLabel').textContent = id === 'ebird' ? 'Region code (IN, IN-KL, IN-KL-KN)' : id === 'xc' ? 'Country' : 'Place';
  form.elements.batch.value = clampBatch(settings.batchSize);
}

let suggestTimer = 0;
$('searchForm').elements.species.addEventListener('input', (e) => {
  clearTimeout(suggestTimer);
  const text = e.target.value;
  suggestTimer = setTimeout(async () => {
    try {
      const list = await wikidata.suggest(text, state.sourceId === 'ebird' ? 'P3444' : 'P225');
      $('speciesList').replaceChildren(...list.map((t) => el('option', { value: t.sciName, label: t.label ? `${t.label} (${t.sciName})` : t.sciName })));
    } catch (err) { /* suggestions are optional */ }
  }, 350);
});

async function filtersFromForm() {
  const f = $('searchForm').elements;
  const filters = { species: f.species.value.trim(), place: f.place.value.trim(), birdOnly: f.birdOnly.checked };
  if (state.sourceId === 'ebird' && filters.species) {
    // eBird needs its species code: accept a code or link, otherwise look the name up on Wikidata.
    const m = /(?:species\/|taxonCode=)([a-z0-9]{4,12})/i.exec(filters.species);
    if (m) filters.taxonCode = m[1];
    else if (/^[a-z]{4,8}\d?$/.test(filters.species)) filters.taxonCode = filters.species;
    else {
      const taxon = await wikidata.taxon({ sciName: filters.species }) || (await wikidata.suggest(filters.species, 'P3444', 1))[0];
      if (!taxon || !taxon.ebirdCode) throw new Error(`No eBird species code found for "${filters.species}". Paste the species link from eBird instead.`);
      filters.taxonCode = taxon.ebirdCode;
    }
  }
  if (state.sourceId === 'ebird' && filters.place) filters.regionCode = filters.place.toUpperCase().replace(/^.*REGIONCODE=([A-Z0-9-]+).*$/, '$1');
  return filters;
}

async function load(more) {
  const s = sources[state.sourceId];
  const batch = clampBatch($('searchForm').elements.batch.value);
  const status = $('loadStatus');
  const progress = (text) => { status.textContent = text; };
  const buttons = [...$('searchForm').querySelectorAll('button'), $('loadMore')];
  buttons.forEach((b) => { b.disabled = true; });
  status.textContent = 'Loading…';
  try {
    let result;
    if (more) result = await s.more(batch, progress);
    else {
      resetMedia();
      result = await s.search({ login: state.login, mode: state.mode, filters: await filtersFromForm(), batch }, progress);
    }
    addItems(result.items);
    state.hasMore = !!result.hasMore;
    $('loadMore').hidden = !state.hasMore;
    status.textContent = result.items.length ? (result.info || '') : (more ? 'No more items.' : 'Nothing found. Try other filters.');
  } catch (e) {
    status.textContent = e.message;
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}
$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); load(false); });
$('loadMore').addEventListener('click', () => load(true));

function addItems(items) {
  const fresh = [];
  items.forEach((item) => {
    if (state.items.has(item.key)) return;
    item.check = checkItem(item, state.mode);
    state.items.set(item.key, item);
    state.order.push(item.key);
    fresh.push(item);
  });
  // Append only, so the scroll position stays where it is.
  $('gallery').append(...fresh.map(tile));
  updateGalleryTitle();
}

function tile(item) {
  const t = el('button', { type: 'button', className: 'tile' });
  t.dataset.key = item.key;
  const blocked = !item.check.ok;
  if (blocked) t.classList.add('blocked');
  t.setAttribute('aria-pressed', 'false');
  const media = item.kind === 'sound'
    ? (item.thumbUrl ? el('img', { src: item.thumbUrl, alt: '', loading: 'lazy' }) : el('div', { className: 'sound', innerHTML: ICONS.xc }))
    : el('img', { src: item.thumbUrl, alt: '', loading: 'lazy' });
  const where = item.locationHidden ? (item.place.country || 'Location hidden') : placeLabel(item.place);
  t.append(el('span', { className: 'badge', textContent: '✓' }), media, el('span', { className: 'meta' },
    el('strong', { textContent: speciesLabel(item) || 'Unidentified' }),
    el('span', { textContent: [item.date, where].filter(Boolean).join(', ') }),
    el('span', { textContent: `${item.key}${item.source !== 'ebird' ? `, ${licenceLabel(item.licence)}` : ''}` }),
    blocked ? el('span', { className: 'reason', textContent: item.check.reason }) : null));
  t.title = blocked ? item.check.reason : 'Select';
  t.addEventListener('click', () => toggle(item.key));
  return t;
}

function paintTile(key) {
  const t = $('gallery').querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (!t) return;
  t.setAttribute('aria-pressed', String(state.selected.has(key)));
  const done = state.done.get(key);
  t.classList.toggle('done', !!done);
  if (done) t.querySelector('.badge').textContent = done.state === 'duplicate' ? 'On Commons' : 'Uploaded';
}

function toggle(key) {
  const item = state.items.get(key);
  if (!item || !item.check.ok || state.running) return;
  if (state.selected.has(key)) state.selected.delete(key); else state.selected.add(key);
  paintTile(key);
  updateGalleryTitle();
}

function updateGalleryTitle() {
  const n = state.order.length;
  const s = state.selected.size;
  $('galleryTitle').textContent = n ? `${n} loaded, ${s} selected` : 'No media loaded';
  document.querySelectorAll('.stepper button').forEach((b) => { b.disabled = Number(b.dataset.goto) > maxStep(); });
  let next = $('toStep3');
  if (!next) {
    next = el('button', { id: 'toStep3', type: 'button', className: 'primary' });
    next.addEventListener('click', () => go(3));
    $('step2').querySelector('.toolbar').append(next);
  }
  next.textContent = s ? `Continue with ${s}` : 'Continue';
  next.disabled = !s;
}

$('selectShown').addEventListener('click', () => {
  state.order.forEach((k) => { const i = state.items.get(k); if (i.check.ok && !state.done.has(k)) state.selected.add(k); paintTile(k); });
  updateGalleryTitle();
});
$('clearSelection').addEventListener('click', () => {
  const keys = [...state.selected];
  state.selected.clear();
  keys.forEach(paintTile);
  updateGalleryTitle();
});

// ---------- step 3: settings and upload ----------
async function loadCampaigns() {
  if (state.campaigns.length) return;
  let list = [];
  try {
    list = (await api.campaignPages()).map((p) => parseCampaign(p.name, p.text)).filter(Boolean).filter((c) => isRunning(c));
  } catch (e) {
    const fallback = parseCampaign('wlb_2026', FALLBACK_WLB_2026);
    if (isRunning(fallback)) list = [fallback];
  }
  const pinned = CONFIG.pinnedCampaigns;
  list.sort((a, b) => {
    const pa = pinned.indexOf(a.name); const pb = pinned.indexOf(b.name);
    if (pa !== pb) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
    return a.title.localeCompare(b.title);
  });
  state.campaigns = list;
}

async function enterStep3() {
  const own = state.mode === 'own';
  $('licenceField').hidden = !own;
  $('othersLicenceNote').hidden = own;
  const lic = $('licenceSelect');
  if (!lic.options.length) Object.entries(OWN_LICENSES).forEach(([k, v]) => lic.append(el('option', { value: k, textContent: v.label })));
  if (!lic.dataset.touched) lic.value = settings.ownLicense;

  const sel = $('previewSelect');
  sel.replaceChildren(...[...state.selected].map((k) => el('option', { value: k, textContent: `${speciesLabel(state.items.get(k))} – ${k}` })));

  await loadCampaigns();
  const cs = $('campaignSelect');
  const current = state.campaign ? state.campaign.name : (cs.dataset.touched ? '' : settings.campaign);
  cs.replaceChildren(el('option', { value: '', textContent: 'No campaign' }),
    ...state.campaigns.map((c) => el('option', { value: c.name, textContent: `${c.title}${c.end ? ` (until ${c.end})` : ''}` })));
  cs.value = state.campaigns.some((c) => c.name === current) ? current : '';
  setCampaign(cs.value);
}

function setCampaign(name) {
  const c = state.campaigns.find((x) => x.name === name) || null;
  if (c !== state.campaign) state.answers = c ? c.fields.map(defaultAnswer) : [];
  state.campaign = c;
  $('campaignNote').innerHTML = '';
  if (c) {
    $('campaignNote').append('Adds the campaign\'s template and categories. ', el('a', { href: `${CONFIG.commonsWiki}Campaign:${c.name}`, target: '_blank', rel: 'noopener', textContent: 'Campaign page' }), ' · ',
      el('a', { href: `${CONFIG.commonsWiki}Special:UploadWizard?campaign=${encodeURIComponent(c.name)}`, target: '_blank', rel: 'noopener', textContent: 'Upload Wizard' }));
  }
  const box = $('campaignFields');
  box.replaceChildren();
  let assam = '';
  (c ? c.fields : []).forEach((field, i) => {
    let input;
    if (field.type === 'select') {
      input = el('select', {}, el('option', { value: '', textContent: 'Choose…' }), ...fieldOptions(field).map((k) => el('option', { value: k, textContent: field.options[k] || k })));
      assam = assam || fieldOptions(field).find((k) => /assam/i.test(k)) || '';
    } else input = el('input', { spellcheck: false });
    input.value = state.answers[i] || '';
    input.addEventListener('change', () => { state.answers[i] = input.value; renderPreview(); });
    box.append(el('label', {}, `${field.label || `Question ${i + 1}`}${field.required ? ' (required)' : ''}`, input));
  });
  $('assamChoice').hidden = !assam;
  $('assamLabel').textContent = `Use "${assam}" for items recorded in Assam`;
  renderPreview();
}
$('campaignSelect').addEventListener('change', (e) => { e.target.dataset.touched = '1'; setCampaign(e.target.value); });
$('licenceSelect').addEventListener('change', (e) => { e.target.dataset.touched = '1'; renderPreview(); });
$('assamAuto').addEventListener('change', () => renderPreview());
$('previewSelect').addEventListener('change', () => renderPreview());
function addExtraCategory() {
  const names = splitList($('addCategory').value);
  if (!names.length) return;
  state.extraCategories = uniqueCategories([...state.extraCategories, ...names]);
  $('addCategory').value = '';
  renderPreview();
}
$('addCategoryButton').addEventListener('click', addExtraCategory);
$('addCategory').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addExtraCategory(); } });

/** Everything needed to upload one item. Looks up the taxon on Wikidata. */
async function planFor(item) {
  const taxon = await wikidata.taxon({ ebirdCode: item.ids.ebirdCode, inatTaxonId: item.ids.inatTaxonId, sciName: item.sciName }).catch(() => null);
  const additions = campaignAdditions(state.campaign, item, state.answers, { assamAuto: $('assamAuto').checked });
  // Campaign lines that are only a category link are shown and added as categories.
  const CAT_LINE = /^\[\[Category:([^\]|]+)\]\]$/;
  const answerCategories = additions.wikitext.filter((l) => CAT_LINE.test(l.trim())).map((l) => CAT_LINE.exec(l.trim())[1]);
  additions.wikitext = additions.wikitext.filter((l) => !CAT_LINE.test(l.trim()));
  additions.categories = [...additions.categories, ...answerCategories];
  const layers = categoryLayers({
    toolCategory: CONFIG.toolCategory,
    platformCategory: platformCategory(item.source),
    taxon,
    globalCategories: uniqueCategories([...splitList(settings.globalCategories), ...state.extraCategories]),
    campaignCategories: additions.categories,
  });
  const ctx = {
    mode: state.mode,
    commonsUser: state.commonsUser,
    ownLicense: $('licenceSelect').value || settings.ownLicense,
    categories: layers.flatMap((l) => l.names),
    extraWikitext: additions.wikitext,
    licenseReviewOwn: settings.licenseReviewOwn,
    taxon,
  };
  return {
    item, taxon, layers, missing: additions.missing,
    filename: fileName(item),
    caption: caption(item),
    text: wikitext(item, ctx),
    sdc: structuredData(item, ctx),
    comment: `Uploaded from ${item.sourceName} (${item.recordUrl}) with [[:toollabs:wild2commons|Wild2Commons]] ${CONFIG.version}`,
    summary: 'Caption and structured data from Wild2Commons',
  };
}

let previewToken = 0;
async function renderPreview() {
  if (state.step !== 3) return;
  const key = $('previewSelect').value;
  const item = state.items.get(key);
  const meta = $('previewMeta');
  if (!item) { meta.replaceChildren(); $('previewText').textContent = ''; return; }
  const token = ++previewToken;
  let plan;
  try { plan = await planFor(item); } catch (e) { $('previewText').textContent = e.message; return; }
  if (token !== previewToken) return;
  const row = (k, v) => [el('dt', { textContent: k }), el('dd', {}, v)];
  meta.replaceChildren(
    ...row('File name', plan.filename),
    ...row('Caption', plan.caption),
    ...row('Depicts', plan.taxon ? el('a', { href: `https://www.wikidata.org/wiki/${plan.taxon.qid}`, target: '_blank', rel: 'noopener', textContent: `${plan.taxon.label || plan.taxon.sciName} (${plan.taxon.qid})` }) : el('span', { className: 'warn', textContent: 'Not found on Wikidata' })),
    ...row('Licence', state.mode === 'own' ? OWN_LICENSES[$('licenceSelect').value].label : licenceLabel(item.licence)),
    ...row('Location', item.locationHidden ? 'Hidden on the source, not added' : `${item.lat}, ${item.lon}`),
    ...(plan.missing.length ? row('Missing', el('span', { className: 'warn', textContent: `Answer: ${plan.missing.join(', ')}` })) : []),
  );
  $('categoryLayers').replaceChildren(...plan.layers.map((l) => el('div', { className: 'layer' }, el('span', { textContent: l.layer }),
    el('div', { className: 'chips' }, ...(l.names.length ? l.names : ['none']).map((n) => {
      const extra = l.layer === 'Global' && state.extraCategories.includes(n);
      const chip = el('span', { className: `chip${extra ? '' : ' fixed'}` }, n);
      if (extra) {
        const x = el('button', { type: 'button', textContent: '×', title: `Remove ${n}` });
        x.addEventListener('click', () => { state.extraCategories = state.extraCategories.filter((c) => c !== n); renderPreview(); });
        chip.append(x);
      }
      return chip;
    })))));
  $('previewText').textContent = plan.text;
  $('uploadButton').textContent = state.commonsUser ? `Upload ${state.selected.size} to Commons` : 'Log in to Commons to upload';
}

// Warnings shown before uploading; resolves true to go ahead.
function confirmWarnings(sections, { canGo = true } = {}) {
  const body = $('warningBody');
  body.replaceChildren(...sections.map((s) => el('div', {}, el('strong', { textContent: s.title }), el('ul', {}, ...s.lines.map((l) => el('li', { textContent: l }))))));
  $('warningGo').hidden = !canGo;
  const dialog = $('warningDialog');
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'go'), { once: true }));
}

$('uploadButton').addEventListener('click', async () => {
  if (!state.commonsUser) { try { await login.start(); } catch (e) { notify(e.message); } return; }
  const missing = missingGrants(state.rights);
  if (missing.length) { notify(`Your Commons login cannot upload yet. Missing: ${missing.join(', ')}.`); return; }
  const keys = [...state.selected].filter((k) => !state.done.has(k));
  if (!keys.length) return;

  // Check everything first, then ask once.
  const blocking = [];
  const notes = new Map();
  const unanswered = state.campaign ? campaignAdditions(state.campaign, {}, state.answers, { assamAuto: false }).missing : [];
  if (unanswered.length) blocking.push(`Answer the campaign question: ${unanswered.join(', ')}.`);
  keys.forEach((k) => {
    const item = state.items.get(k);
    item.check.warnings.forEach((w) => notes.set(w.code, w.text));
    if (item.locationHidden && item.source !== 'xc') notes.set('hidden', 'Some items have hidden or obscured locations on the source, so no coordinates will be added for them.');
  });
  if (state.mode === 'others') notes.set('others', 'You are uploading someone else\'s work. Each file keeps its source licence and gets a licence review template; a reviewer will compare it with the source.');
  if (state.campaign && state.campaign.licenses.length && state.mode === 'own' && !state.campaign.licenses.includes($('licenceSelect').value)) {
    blocking.push(`${state.campaign.title} does not accept ${OWN_LICENSES[$('licenceSelect').value].label}. Choose another licence.`);
  }
  const sections = [];
  if (blocking.length) sections.push({ title: 'Fix these first', lines: blocking });
  if (notes.size) sections.push({ title: 'Licence and data notes', lines: [...notes.values()] });
  if (blocking.length) { await confirmWarnings(sections, { canGo: false }); return; }
  if ((notes.size || settings.reviewFirst)) {
    sections.push({ title: 'About to upload', lines: [`${keys.length} file${keys.length === 1 ? '' : 's'} to Commons as ${state.commonsUser}, one every ${settings.uploadDelaySec} seconds or so.`] });
    if (!(await confirmWarnings(sections))) return;
  }
  runUploads(keys);
});

async function runUploads(keys) {
  const controller = new AbortController();
  state.running = controller;
  let stopAfter = false;
  $('stopButton').hidden = false;
  $('stopButton').onclick = () => { stopAfter = true; $('stopButton').textContent = 'Stopping after this file…'; };
  $('uploadButton').disabled = true;
  const list = $('progress');
  list.replaceChildren();
  let failures = 0;
  const s = sources[state.sourceId];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    let item = state.items.get(key);
    const line = el('li', {}, el('strong', { textContent: `${speciesLabel(item)} (${key})` }), el('span', { textContent: 'Waiting' }));
    line.dataset.state = 'active';
    list.append(line);
    const say = (t) => { line.lastChild.textContent = t; };
    try {
      say('Reading the record');
      item = { ...item, ...(await s.details(item)) };
      item.check = checkItem(item, state.mode);
      if (!item.check.ok) throw new Error(item.check.reason);
      const plan = await planFor(item);
      const result = await uploadOne({ plan, getFile: () => s.file(item, say), api, signal: controller.signal, onStep: say });
      if (result.state === 'failed') throw Object.assign(new Error(result.error), { code: result.code });
      state.done.set(key, result);
      state.selected.delete(key);
      line.dataset.state = 'done';
      const link = el('a', { href: `${CONFIG.commonsWiki}${encodeURIComponent(result.title.replace(/ /g, '_'))}`, target: '_blank', rel: 'noopener', textContent: result.title });
      line.lastChild.replaceChildren(result.state === 'duplicate' ? 'Already on Commons: ' : 'Uploaded: ', link, result.sdcError ? ` (structured data not added: ${result.sdcError})` : '');
      paintTile(key);
    } catch (e) {
      line.dataset.state = 'failed';
      say(e.message || String(e));
      if (e.name === 'AbortError') break;
      if (isAuthError(e)) { say('Your Commons login has expired. Log in again and upload the rest.'); login.logout(); refreshCommonsUser(); break; }
      if (isPermissionError(e) || e.code === 'captcha') break;
      failures += 1;
      if (failures >= 3) { list.append(el('li', { textContent: 'Stopped after 3 failures in a row. Check the messages above.' })); break; }
      continue;
    }
    failures = 0;
    if (stopAfter) break;
    if (i < keys.length - 1) {
      try { await sleep(Math.max(3, Number(settings.uploadDelaySec) || 8) * 1000, controller.signal); } catch (e) { break; }
    }
  }
  state.running = null;
  $('stopButton').hidden = true;
  $('stopButton').textContent = 'Stop after this file';
  $('uploadButton').disabled = false;
  updateGalleryTitle();
  enterStep3();
}

// ---------- settings dialog ----------
function fillSettings() {
  const f = $('settingsForm').elements;
  f.oauthClientId.value = settings.oauthClientId || '';
  f.xcApiKey.value = settings.xcApiKey || '';
  f.ownLicense.value = settings.ownLicense;
  f.globalCategories.value = splitList(settings.globalCategories).join('\n');
  ['ebird', 'inat', 'xc'].forEach((id) => { f[`platform_${id}`].value = platformCategory(id); });
  f.campaign.value = settings.campaign || '';
  f.batchSize.value = clampBatch(settings.batchSize);
  f.uploadDelaySec.value = settings.uploadDelaySec;
  f.reviewFirst.checked = !!settings.reviewFirst;
  f.licenseReviewOwn.checked = !!settings.licenseReviewOwn;
  f.allowResized.checked = !!settings.allowResized;
  $('callbackUrl').textContent = redirectUriFor(location);
}
function saveSettings() {
  const f = $('settingsForm').elements;
  const before = settings.oauthClientId;
  settings = {
    ...settings,
    oauthClientId: f.oauthClientId.value.trim(),
    xcApiKey: f.xcApiKey.value.trim(),
    ownLicense: f.ownLicense.value,
    globalCategories: splitList(f.globalCategories.value).join('\n'),
    platformCategories: { ebird: f.platform_ebird.value.trim(), inat: f.platform_inat.value.trim(), xc: f.platform_xc.value.trim() },
    campaign: f.campaign.value.trim(),
    batchSize: clampBatch(f.batchSize.value),
    uploadDelaySec: Math.min(120, Math.max(3, Number(f.uploadDelaySec.value) || 8)),
    reviewFirst: f.reviewFirst.checked,
    licenseReviewOwn: f.licenseReviewOwn.checked,
    allowResized: f.allowResized.checked,
  };
  writeJson(localStorage, SETTINGS_KEY, settings);
  login.clientId = settings.oauthClientId || CONFIG.oauthClientId;
  if (before !== settings.oauthClientId) { login.logout(); refreshCommonsUser(); }
  if (state.sourceId === 'xc') updateContinue();
  renderPreview();
}
$('settingsButton').addEventListener('click', () => { fillSettings(); $('settingsDialog').showModal(); });
$('settingsDialog').addEventListener('close', () => { if ($('settingsDialog').returnValue === 'save') saveSettings(); });
$('exportSettings').addEventListener('click', () => {
  const { xcApiKey, ...shareable } = settings;
  const blob = new Blob([JSON.stringify(shareable, null, 2)], { type: 'application/json' });
  el('a', { href: URL.createObjectURL(blob), download: 'wild2commons-settings.json' }).click();
});
$('importSettings').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const allowed = Object.keys(CONFIG.defaults).filter((k) => k !== 'xcApiKey');
    allowed.forEach((k) => { if (k in data) settings[k] = data[k]; });
    fillSettings();
  } catch (err) { notify('That file is not a Wild2Commons settings file.'); }
  e.target.value = '';
});
$('resetSettings').addEventListener('click', () => {
  localStorage.removeItem(SETTINGS_KEY);
  settings = { ...CONFIG.defaults };
  fillSettings();
});

// ---------- deep link from the extension's "Upload to Commons" button ----------
async function openFromLink(params) {
  const id = params.get('source');
  const ref = params.get('record');
  if (!SOURCES[id] || !ref) return;
  history.replaceState(null, '', location.pathname);
  await chooseSource(id, { quiet: true });
  const s = sources[id];
  try {
    notify('');
    const items = await s.record(ref, { login: state.mode === 'own' ? state.login : '' });
    if (!state.login && items[0]) {
      // Not signed in on the source: treat the record as someone else's.
      const own = state.account && items[0].owner;
      if (!own && SOURCES[id].othersAllowed) {
        document.querySelector('input[name=mode][value=others]').checked = true;
        state.mode = 'others';
      }
      state.login = (items[0].author && items[0].author.name) || 'record';
    }
    if (id !== 'ebird' && state.account && items[0] && items[0].owner === false && SOURCES[id].othersAllowed) {
      document.querySelector('input[name=mode][value=others]').checked = true;
      state.mode = 'others';
    }
    prepareStep2();
    addItems(items);
    items.forEach((it) => { if (state.items.get(it.key).check.ok) state.selected.add(it.key); paintTile(it.key); });
    updateGalleryTitle();
    go(state.selected.size ? 3 : 2);
    if (!state.selected.size) $('loadStatus').textContent = items[0] ? state.items.get(items[0].key).check.reason : 'Nothing to upload from this record.';
  } catch (e) {
    notify(e.message);
  }
}

// ---------- start ----------
async function start() {
  $('versionLabel').textContent = `Version ${CONFIG.version}`;
  $('sourceLink').href = CONFIG.repoUrl;
  $('issuesLink').href = CONFIG.issuesUrl;
  renderCards();
  try { await login.finish(); } catch (e) { notify(e.message); }
  await refreshCommonsUser();
  const params = new URLSearchParams(location.search);
  if (params.get('source')) await openFromLink(params);
  else go(1);
}
start();
