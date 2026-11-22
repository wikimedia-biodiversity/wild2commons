// What each upload looks like on Commons: file name, caption, description page and
// structured data. All three sources pass a common "item" record (see sources/*.js).
import { escapeWikitext, formatCoord, isIsoDate, placeLabel, speciesLabel, uniqueCategories, utf8Length, clean } from './util.js';
import { freeLicence, OWN_LICENSES } from './licence.js';

const ILLEGAL = /[#<>[\]|{}:/\\]/g;
const MAX_BYTES = 240;

export function titlePart(value) {
  return clean(String(value ?? '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ')
    .replace(ILLEGAL, '-')
    .replace(/%/g, '-')
    .replace(/~{3,}/g, '-')
    .replace(/_/g, ' '))
    .replace(/-{2,}/g, '-')
    .replace(/^[\s.-]+|[\s.-]+$/g, '');
}

/** "Purple Heron (Ardea purpurea)_ML668752900.jpg" */
export function fileName(item) {
  const ext = (item.ext || (item.kind === 'sound' ? 'mp3' : 'jpg')).toLowerCase();
  const suffix = `_${titlePart(item.key)}.${ext}`;
  let base = titlePart(speciesLabel(item)) || 'Unidentified organism';
  while (base.length > 1 && utf8Length(base + suffix) > MAX_BYTES) base = [...base].slice(0, -1).join('').trimEnd();
  const name = base + suffix;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function caption(item) {
  const place = item.locationHidden ? item.place && item.place.country : placeLabel(item.place);
  return `${speciesLabel(item) || 'Unidentified organism'}${place ? ` from ${place}` : ''}`.slice(0, 250);
}

const link = (url, text) => `[${url} ${escapeWikitext(text)}]`;

function authorWikitext(item, ctx) {
  const name = item.author && item.author.name ? item.author.name : (ctx.commonsUser || 'Unknown');
  const base = item.author && item.author.url ? link(item.author.url, name) : escapeWikitext(name);
  return ctx.mode === 'own' && ctx.commonsUser ? `${base} ([[User:${ctx.commonsUser}|${ctx.commonsUser}]])` : base;
}

function recordLinks(item) {
  const links = [link(item.recordUrl, item.recordLabel)];
  if (item.photoUrl) links.push(link(item.photoUrl, `photo ${item.photoId}`));
  if (item.checklist) links.push(link(item.checklist.url, `eBird checklist ${item.checklist.id}`));
  return links;
}

export function description(item) {
  const name = speciesLabel(item) || 'Unidentified organism';
  let text = item.speciesUrl ? link(item.speciesUrl, name) : escapeWikitext(name);
  const place = item.locationHidden ? (item.place && item.place.country) : placeLabel(item.place);
  if (place) text += ` from ${escapeWikitext(place)}`;
  text += ` ${recordLinks(item).join(' & ')}`;
  if (item.details && item.details.length) text += `. ${escapeWikitext(item.details.join('; '))}`;
  return text;
}

/**
 * The description page.
 * ctx: { mode: 'own'|'others', commonsUser, ownLicense, categories: [], extraWikitext: [], licenseReviewOwn }
 */
export function wikitext(item, ctx) {
  const own = ctx.mode === 'own';
  const author = authorWikitext(item, ctx);
  const links = recordLinks(item).join(', ');
  const source = own ? `{{own}}<br />First published on ${item.sourceName}: ${links}` : links;
  let date = '';
  if (isIsoDate(item.date)) date = item.kind === 'photo' ? `{{Taken on|${item.date}}}` : `${item.date}${item.time ? ` ${escapeWikitext(item.time)}` : ''}`;

  const lines = [
    '=={{int:filedesc}}==',
    '{{Information',
    ` |description={{en|1=${description(item)}}}`,
    ` |date=${date}`,
    ` |source=${source}`,
    ` |author=${author}`,
    ' |permission=',
    ' |other versions=',
    '}}',
  ];
  if (!item.locationHidden && item.lat != null && item.lon != null) {
    const prec = item.accuracy ? `|prec=${Math.max(1, Math.round(item.accuracy))}` : '';
    lines.push(`{{Location|${formatCoord(item.lat)}|${formatCoord(item.lon)}${prec}}}`);
  }
  if (item.source === 'inat' && item.inatObsId) lines.push(`{{iNaturalist|${item.inatObsId}}}`);

  lines.push('', '=={{int:license-header}}==');
  if (own) {
    const lic = OWN_LICENSES[ctx.ownLicense] || OWN_LICENSES['cc-by-sa-4.0'];
    lines.push(`{{self|${lic.self}|author=${author}}}`);
  } else {
    const lic = freeLicence(item.licence);
    if (!lic) throw new Error('This item has no licence Commons accepts.');
    lines.push(lic.zero ? `{{${lic.template}}}` : `{{${lic.template}|1=${author}}}`);
  }
  if (item.source === 'inat' && (!own || ctx.licenseReviewOwn !== false)) lines.push('{{iNaturalistreview}}');
  if (item.source === 'xc' && !own) lines.push('{{LicenseReview}}');

  const extra = (ctx.extraWikitext || []).map((l) => String(l).trim()).filter(Boolean);
  if (extra.length) lines.push('', ...extra);
  lines.push('');
  uniqueCategories(ctx.categories || []).forEach((c) => lines.push(`[[Category:${c}]]`));
  return `${lines.join('\n')}\n`;
}

/** Category layers for one item, in order: tool, platform, species, global, campaign. */
export function categoryLayers({ toolCategory, platformCategory, taxon, globalCategories = [], campaignCategories = [] }) {
  return [
    { layer: 'Tool', names: toolCategory ? [toolCategory] : [] },
    { layer: 'Platform', names: platformCategory ? [platformCategory] : [] },
    { layer: 'Species', names: taxon && taxon.category ? [taxon.category] : ['Media needing categories'] },
    { layer: 'Global', names: globalCategories },
    { layer: 'Campaign', names: campaignCategories },
  ];
}

// Structured data (MediaInfo) for wbeditentity.
const QIDS = {
  copyrighted: 'Q50423863',
  dedicatedPublicDomain: 'Q88088423',
  originalCreationByUploader: 'Q66458942',
  fileAvailableOnInternet: 'Q74228490',
  iNaturalist: 'Q16958215',
};
const GREGORIAN = 'http://www.wikidata.org/entity/Q1985727';
const EARTH = 'http://www.wikidata.org/entity/Q2';
const itemValue = (qid) => ({ value: { 'entity-type': 'item', 'numeric-id': Number(qid.slice(1)), id: qid }, type: 'wikibase-entityid' });
const stringValue = (s) => ({ value: String(s), type: 'string' });
const snak = (property, datavalue) => ({ snaktype: 'value', property, datavalue });
function statement(mainsnak, qualifiers) {
  const s = { mainsnak, type: 'statement', rank: 'normal' };
  if (qualifiers && Object.keys(qualifiers).length) { s.qualifiers = qualifiers; s['qualifiers-order'] = Object.keys(qualifiers); }
  return s;
}

export function coordPrecision(metres) {
  if (!metres || metres <= 0) return 0.0001;
  const p = 10 ** Math.floor(Math.log10(metres / 111320));
  return Math.min(1, Math.max(0.000001, p));
}

export function structuredData(item, ctx) {
  const own = ctx.mode === 'own';
  const claims = [];
  if (ctx.taxon && ctx.taxon.qid) claims.push(statement(snak('P180', itemValue(ctx.taxon.qid))));

  const creator = {};
  const authorName = (item.author && item.author.name) || ctx.commonsUser;
  if (authorName) creator.P2093 = [snak('P2093', stringValue(authorName))];
  if (own && ctx.commonsUser) {
    creator.P4174 = [snak('P4174', stringValue(ctx.commonsUser))];
    creator.P2699 = [snak('P2699', stringValue(`https://commons.wikimedia.org/wiki/User:${encodeURIComponent(ctx.commonsUser.replace(/ /g, '_'))}`))];
  } else if (item.author && item.author.url) {
    creator.P2699 = [snak('P2699', stringValue(item.author.url))];
  }
  claims.push(statement({ snaktype: 'somevalue', property: 'P170' }, creator));

  const lic = own ? OWN_LICENSES[ctx.ownLicense] : freeLicence(item.licence);
  if (lic && lic.qid) claims.push(statement(snak('P275', itemValue(lic.qid))));
  claims.push(statement(snak('P6216', itemValue(lic && lic.zero ? QIDS.dedicatedPublicDomain : QIDS.copyrighted))));

  if (own) {
    claims.push(statement(snak('P7482', itemValue(QIDS.originalCreationByUploader))));
  } else {
    const q = { P973: [snak('P973', stringValue(item.photoUrl || item.recordUrl))] };
    if (item.source === 'inat') q.P137 = [snak('P137', itemValue(QIDS.iNaturalist))];
    claims.push(statement(snak('P7482', itemValue(QIDS.fileAvailableOnInternet)), q));
  }
  if (isIsoDate(item.date)) {
    claims.push(statement(snak('P571', {
      value: { time: `+${item.date}T00:00:00Z`, timezone: 0, before: 0, after: 0, precision: 11, calendarmodel: GREGORIAN },
      type: 'time',
    })));
  }
  if (!item.locationHidden && item.lat != null && item.lon != null) {
    claims.push(statement(snak('P1259', {
      value: { latitude: item.lat, longitude: item.lon, altitude: null, precision: coordPrecision(item.accuracy), globe: EARTH },
      type: 'globecoordinate',
    })));
  }
  return { labels: { en: { language: 'en', value: caption(item) } }, claims };
}
