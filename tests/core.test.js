import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileName, caption, wikitext, structuredData, categoryLayers, titlePart, coordPrecision } from '../app/js/lib/filepage.js';
import { normaliseLicence, checkItem, freeLicence } from '../app/js/lib/licence.js';
import { parseCampaign, isRunning, campaignAdditions, answersFor, FALLBACK_WLB_2026 } from '../app/js/lib/campaign.js';
import { interpretUpload, uploadOne, withRetries, missingGrants } from '../app/js/lib/uploader.js';
import { CommonsError } from '../app/js/lib/commons.js';
import { escapeWikitext, placeLabel, splitList, uniqueCategories } from '../app/js/lib/util.js';
import { pkceChallenge, redirectUriFor, authorizeUrl } from '../app/js/lib/oauth.js';
import { toItems, loginFrom } from '../app/js/sources/inat.js';
import { toItem as xcItem, buildQuery } from '../app/js/sources/xc.js';
import { toItem as ebirdItem } from '../app/js/sources/ebird.js';

const heron = ebirdItem({
  assetId: '668752900', comName: 'Purple Heron', sciName: 'Ardea purpurea', speciesCode: 'purher1',
  obsDt: '2026-01-12T07:30', checklistId: 'S409869220', userName: 'Test Birder', userId: 'USER506900', mime: 'image/jpeg',
  location: { name: 'Kattampally', district: 'Kannur', state: 'Kerala', country: 'India', stateCode: 'IN-KL', lat: 11.9341197, lon: 75.3815747 },
}, { owner: true });

test('file name: species + record number', () => {
  assert.equal(fileName(heron), 'Purple Heron (Ardea purpurea)_ML668752900.jpg');
  assert.equal(titlePart('A|B[c]{d}:e/f#g'), 'A-B-c-d-e-f-g');
  const long = { ...heron, comName: 'x'.repeat(400) };
  assert.ok(Buffer.byteLength(fileName(long)) <= 240);
  assert.ok(fileName(long).endsWith('_ML668752900.jpg'));
});

test('caption and own-work file page', () => {
  assert.equal(caption(heron), 'Purple Heron (Ardea purpurea) from Kattampally, Kannur, Kerala, India');
  const text = wikitext(heron, { mode: 'own', commonsUser: 'Example', ownLicense: 'cc-by-sa-4.0', categories: ['Uploaded with Wild2Commons', 'Ardea purpurea'], extraWikitext: ['{{Wiki loves Birds India event|2026}}'] });
  assert.match(text, /\{\{Taken on\|2026-01-12\}\}/);
  assert.match(text, /\{\{own\}\}<br \/>First published on eBird: \[https:\/\/macaulaylibrary\.org\/asset\/668752900 ML668752900\]/);
  assert.match(text, /eBird checklist S409869220/);
  assert.match(text, /\{\{Location\|11\.93412\|75\.381575\}\}|\{\{Location\|11\.93412\d*\|75\.38157\d*\}\}/);
  assert.match(text, /\{\{self\|cc-by-sa-4\.0\|author=/);
  assert.match(text, /\[\[Category:Ardea purpurea\]\]/);
  assert.match(text, /Wiki loves Birds India event/);
});

test('hidden locations are never published', () => {
  const hidden = { ...heron, locationHidden: true, lat: null, lon: null };
  const text = wikitext(hidden, { mode: 'own', commonsUser: 'Example', ownLicense: 'cc-zero', categories: [] });
  assert.doesNotMatch(text, /\{\{Location/);
  assert.ok(!structuredData(hidden, { mode: 'own', commonsUser: 'Example', ownLicense: 'cc-zero' }).claims.some((c) => c.mainsnak.property === 'P1259'));
});

test('licences', () => {
  assert.equal(normaliseLicence('cc-by-nc'), 'cc-by-nc-4.0');
  assert.equal(normaliseLicence('CC-BY-SA'), 'cc-by-sa-4.0');
  assert.equal(normaliseLicence('cc0'), 'cc0-1.0');
  assert.equal(normaliseLicence('//creativecommons.org/licenses/by-nc-sa/4.0/'), 'cc-by-nc-sa-4.0');
  assert.equal(normaliseLicence('//creativecommons.org/licenses/by/4.0/'), 'cc-by-4.0');
  assert.equal(normaliseLicence(null), '');
  assert.ok(freeLicence('cc-by-4.0'));
  assert.equal(freeLicence('cc-by-nc-4.0'), null);
  assert.equal(checkItem({ ...heron, source: 'ebird' }, 'others').ok, false);
  assert.equal(checkItem({ ...heron, owner: false }, 'own').ok, false);
  assert.equal(checkItem({ ...heron, restricted: true }, 'own').ok, false);
  assert.ok(checkItem(heron, 'own').warnings.some((w) => w.code === 'ebird-copyright'));
});

const inatObs = {
  id: 123, observed_on: '2025-03-01', place_guess: 'Kannur, Kerala, India', geojson: { coordinates: [75.38, 11.93] },
  positional_accuracy: 25, geoprivacy: null, taxon_geoprivacy: 'open', quality_grade: 'research',
  taxon: { id: 4954, name: 'Ardea purpurea', preferred_common_name: 'purple heron', rank: 'species' },
  user: { login: 'birder', name: 'A Birder' },
  photos: [{ id: 9, license_code: 'cc-by', url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/9/square.jpg' }, { id: 10, license_code: 'cc-by-nc', url: 'https://x/photos/10/square.jpeg' }],
};

test('iNaturalist items', () => {
  const items = toItems(inatObs, { login: 'Birder' });
  assert.equal(items.length, 2);
  assert.equal(items[0].key, 'iNat123-9');
  assert.equal(items[0].comName, 'Purple heron');
  assert.equal(items[0].fileUrl, 'https://inaturalist-open-data.s3.amazonaws.com/photos/9/original.jpg');
  assert.equal(items[0].owner, true);
  assert.equal(items[0].lat, 11.93);
  assert.equal(fileName(items[0]), 'Purple heron (Ardea purpurea)_iNat123-9.jpg');
  assert.equal(checkItem(items[1], 'others').ok, false);
  assert.equal(checkItem(items[0], 'others').ok, true);
  const text = wikitext(items[0], { mode: 'others', categories: [] });
  assert.match(text, /\{\{iNaturalistreview\}\}/);
  assert.match(text, /\{\{iNaturalist\|123\}\}/);
  assert.match(text, /\{\{Cc-by-4\.0\|1=\[https:\/\/www\.inaturalist\.org\/people\/birder A Birder\]\}\}/);
  const obscured = toItems({ ...inatObs, obscured: true }, null)[0];
  assert.equal(obscured.locationHidden, true);
  assert.equal(obscured.lat, null);
  assert.equal(loginFrom('https://www.inaturalist.org/people/some_one?x=1'), 'some_one');
});

test('Xeno-canto items and queries', () => {
  const item = xcItem({
    id: '1188782', gen: 'Pycnonotus', sp: 'jocosus', en: 'Red-whiskered Bulbul', rec: 'A Recordist', cnt: 'India', loc: 'Kannur',
    lat: '11.9', lon: '75.3', type: 'song', date: '2025-05-02', time: '06:10', lic: '//creativecommons.org/licenses/by-sa/4.0/',
    file: '//xeno-canto.org/1188782/download', 'file-name': 'XC1188782-bulbul.mp3', sono: { med: '//xeno-canto.org/sounds/x.png' },
  }, { name: 'a recordist' });
  assert.equal(item.key, 'XC1188782');
  assert.equal(item.licence, 'cc-by-sa-4.0');
  assert.equal(item.owner, true);
  assert.equal(item.fileUrl, 'https://xeno-canto.org/1188782/download');
  assert.equal(fileName(item), 'Red-whiskered Bulbul (Pycnonotus jocosus)_XC1188782.mp3');
  assert.match(wikitext(item, { mode: 'others', categories: [] }), /\{\{LicenseReview\}\}/);
  assert.equal(buildQuery({ recordist: 'A Recordist', filters: { species: 'Pycnonotus jocosus', place: 'India' } }), 'rec:"A Recordist" gen:Pycnonotus sp:jocosus cnt:"India"');
  assert.equal(buildQuery({ recordist: 'X', filters: { species: 'Purple Heron' } }), 'rec:"X" en:"Purple Heron"');
});

test('structured data', () => {
  const sdc = structuredData(heron, { mode: 'own', commonsUser: 'Example', ownLicense: 'cc-by-sa-4.0', taxon: { qid: 'Q18871' } });
  const props = sdc.claims.map((c) => c.mainsnak.property);
  assert.deepEqual(props, ['P180', 'P170', 'P275', 'P6216', 'P7482', 'P571', 'P1259']);
  assert.equal(sdc.labels.en.value, caption(heron));
  assert.equal(sdc.claims[1].qualifiers.P4174[0].datavalue.value, 'Example');
  assert.ok(coordPrecision(25) < 0.001);
});

test('campaign', () => {
  const c = parseCampaign('wlb_2026', FALLBACK_WLB_2026);
  assert.equal(isRunning(c, '2026-11-22'), true);
  assert.equal(isRunning(c, '2027-02-01'), false);
  const add = campaignAdditions(c, heron, ['Bird portraits']);
  assert.deepEqual(add.missing, []);
  assert.ok(add.wikitext.includes('[[Category:Images from Wiki Loves Birds India 2026 (Bird portraits)]]'));
  assert.ok(add.categories.includes('Images from Wiki Loves Birds India 2026'));
  assert.deepEqual(campaignAdditions(c, heron, ['']).missing, ['Subject of the photo']);
  const assam = { ...heron, place: { ...heron.place, stateCode: 'IN-AS' } };
  assert.deepEqual(answersFor(c, assam, ['Others']), ['Wiki Loves Birds - Assam']);
  assert.deepEqual(answersFor(c, assam, ['Others'], { assamAuto: false }), ['Others']);
});

test('category layers', () => {
  const layers = categoryLayers({ toolCategory: 'T', platformCategory: 'P', taxon: null, globalCategories: ['G'], campaignCategories: ['C'] });
  assert.deepEqual(layers.map((l) => l.names[0]), ['T', 'P', 'Media needing categories', 'G', 'C']);
  assert.deepEqual(uniqueCategories(splitList('Category:a_b; A b\nc')), ['a_b', 'c']);
});

test('util', () => {
  assert.equal(escapeWikitext('a|b{{c}}'), 'a&#124;b&#123;&#123;c&#125;&#125;');
  assert.equal(placeLabel({ name: 'Kannur', district: 'Kannur', state: 'Kerala', country: 'India' }), 'Kannur, Kerala, India');
  assert.equal(placeLabel({ name: '11.9, 75.3', country: 'India' }), 'India');
});

test('upload warnings', () => {
  assert.deepEqual(interpretUpload({ result: 'Success', filename: 'A.jpg' }), { kind: 'success', filename: 'A.jpg' });
  assert.equal(interpretUpload({ result: 'Warning', warnings: { duplicate: ['B.jpg'] } }).title, 'File:B.jpg');
  assert.equal(interpretUpload({ result: 'Warning', warnings: { exists: 'A.jpg' } }).kind, 'name-taken');
  assert.equal(interpretUpload({ result: 'Warning', warnings: { 'was-deleted': 'A.jpg' } }).kind, 'was-deleted');
  assert.deepEqual(missingGrants(['upload', 'edit']), ['Create, edit, and move pages']);
});

function fakeApi(overrides = {}) {
  const calls = [];
  return {
    calls,
    findBySha1: async () => [],
    upload: async (a) => { calls.push(['upload', a.filename]); return { upload: { result: 'Success', filename: a.filename } }; },
    pageId: async () => 42,
    editEntity: async (a) => { calls.push(['sdc', a.id]); return {}; },
    csrfToken: async () => 't',
    ...overrides,
  };
}
const plan = { filename: 'A_ML1.jpg', text: 'x', comment: 'c', sdc: { claims: [] }, summary: 's' };
const getFile = async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
const noSleep = async () => {};

test('uploadOne: success with structured data', async () => {
  const api = fakeApi();
  const r = await uploadOne({ plan, getFile, api, sleepFn: noSleep });
  assert.deepEqual(r, { state: 'done', title: 'File:A_ML1.jpg' });
  assert.deepEqual(api.calls, [['upload', 'A_ML1.jpg'], ['sdc', 'M42']]);
});

test('uploadOne: same file already on Commons', async () => {
  const api = fakeApi({ findBySha1: async () => ['File:Old.jpg'] });
  assert.deepEqual(await uploadOne({ plan, getFile, api, sleepFn: noSleep }), { state: 'duplicate', title: 'File:Old.jpg' });
  assert.deepEqual(api.calls, []);
});

test('uploadOne: name taken and captcha fail clearly', async () => {
  let r = await uploadOne({ plan, getFile, api: fakeApi({ upload: async () => ({ upload: { result: 'Warning', warnings: { exists: 'A_ML1.jpg' } } }) }), sleepFn: noSleep });
  assert.equal(r.state, 'failed');
  r = await uploadOne({ plan, getFile, api: fakeApi({ upload: async () => { throw new CommonsError('captcha', 'x'); } }), sleepFn: noSleep });
  assert.equal(r.code, 'captcha');
});

test('uploadOne: structured data failure keeps the upload', async () => {
  const r = await uploadOne({ plan, getFile, api: fakeApi({ editEntity: async () => { throw new Error('nope'); } }), sleepFn: noSleep });
  assert.equal(r.state, 'uploaded');
  assert.equal(r.sdcError, 'nope');
});

test('withRetries: maxlag, badtoken, then gives up on other errors', async () => {
  let n = 0;
  let refreshed = false;
  const api = { csrfToken: async (r) => { refreshed = r; } };
  const value = await withRetries(async () => {
    n += 1;
    if (n === 1) throw new CommonsError('maxlag', 'lag', { lag: 3 });
    if (n === 2) throw new CommonsError('badtoken', 'bad');
    return 'ok';
  }, { api, sleepFn: noSleep });
  assert.equal(value, 'ok');
  assert.equal(refreshed, true);
  await assert.rejects(withRetries(async () => { throw new CommonsError('permissiondenied', 'no'); }, { sleepFn: noSleep }), /no/);
});

test('oauth helpers', async () => {
  // RFC 7636 appendix B example
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(redirectUriFor({ origin: 'https://wild2commons.toolforge.org', pathname: '/index.html' }), 'https://wild2commons.toolforge.org/');
  const url = new URL(authorizeUrl({ restBase: 'https://meta.wikimedia.org/w/rest.php', clientId: 'abc', redirectUri: 'https://x/', state: 's', challenge: 'c' }));
  assert.equal(url.pathname, '/w/rest.php/oauth2/authorize');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});
