/* Pure helpers shared by the app, the content scripts and the tests. */
(function (root) {
  'use strict';

  const REVIVERS = new Set(['ShallowReactive', 'Reactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef']);

  /** Decode the flattened (devalue) array stored in Nuxt's __NUXT_DATA__ script. */
  function unflattenNuxt(table) {
    const seen = new Map();
    const read = (index) => {
      if (typeof index !== 'number') return index;
      if (index < 0) return index === -1 ? undefined : null;
      if (seen.has(index)) return seen.get(index);
      const raw = table[index];
      if (raw === null || typeof raw !== 'object') {
        seen.set(index, raw);
        return raw;
      }
      if (Array.isArray(raw)) {
        if (typeof raw[0] === 'string') {
          if (REVIVERS.has(raw[0])) {
            const value = read(raw[1]);
            seen.set(index, value);
            return value;
          }
          if (raw[0] === 'Set') {
            const value = raw.slice(1).map(read);
            seen.set(index, value);
            return value;
          }
          if (raw[0] === 'Map' || raw[0] === 'null') {
            const value = {};
            seen.set(index, value);
            const start = raw[0] === 'null' ? 1 : 1;
            for (let i = start; i + 1 < raw.length; i += 2) value[String(read(raw[i]))] = read(raw[i + 1]);
            return value;
          }
          if (raw[0] === 'Date') {
            seen.set(index, raw[1]);
            return raw[1];
          }
        }
        const value = [];
        seen.set(index, value);
        raw.forEach((item) => value.push(read(item)));
        return value;
      }
      const value = {};
      seen.set(index, value);
      Object.keys(raw).forEach((key) => { value[key] = read(raw[key]); });
      return value;
    };
    return read(0);
  }

  function parseNuxtJson(text) {
    if (!text) return null;
    try { return unflattenNuxt(JSON.parse(text)); } catch (e) { return null; }
  }

  function nuxtFromHtml(html) {
    const match = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html || '');
    return match ? parseNuxtJson(match[1]) : null;
  }

  function walk(value, visit, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    visit(value);
    (Array.isArray(value) ? value : Object.values(value)).forEach((v) => walk(v, visit, seen));
  }

  function findAssets(data) {
    const found = new Map();
    walk(data, (o) => {
      if (!Array.isArray(o) && o.assetId && o.userId && o.taxonomy) found.set(String(o.assetId), o);
    });
    return [...found.values()];
  }

  function findSessionUser(data) {
    let user = null;
    walk(data, (o) => {
      if (!user && !Array.isArray(o) && 'anonymous' in o && 'userId' in o && 'username' in o) user = o;
    });
    if (!user || user.anonymous || !/^USER\d+$/.test(user.userId || '')) return null;
    return { userId: user.userId, username: user.username, displayName: user.fullName || user.username };
  }

  function decodeEntities(text) {
    return String(text || '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
  }

  /** Read the signed-in account from the HTML of ebird.org/myebird. */
  function parseMyEbird(html) {
    if (!html) return null;
    const own = /media\/catalog\?[^"]*?userId=(USER\d+)[^"]*"[^>]*>\s*Media\s*</.exec(html)
      || /StatsToolbar-stat[\s\S]{0,200}?media\/catalog\?[^"]*?userId=(USER\d+)/.exec(html);
    if (!own) return null;
    const head = /Header-item"?[^>]*>\s*(?:<bdo[^>]*>)?\s*([^<]+?)\s*\(([^()<]+)\)\s*(?:<\/bdo>)?\s*</.exec(html);
    return {
      userId: own[1],
      displayName: head ? decodeEntities(head[1]) : own[1],
      username: head ? decodeEntities(head[2]) : '',
    };
  }

  function normalizeAsset(raw) {
    const loc = raw.location && typeof raw.location === 'object' ? raw.location : {
      name: raw.locName || raw.locationLine1 || '', subnational2Name: raw.subnational2Name || '',
      subnational1Name: raw.subnational1Name || '', subnational1Code: raw.subnational1Code || '',
      countryName: raw.countryName || '', countryCode: raw.countryCode || '',
      latitude: raw.latitude, longitude: raw.longitude,
    };
    const tax = raw.taxonomy || {
      comName: raw.commonName || raw.comName || '', sciName: raw.sciName || '', speciesCode: raw.speciesCode || '',
    };
    const lat = Number(loc.latitude);
    const lon = Number(loc.longitude);
    const hasCoords = loc.latitude != null && loc.longitude != null && Number.isFinite(lat) && Number.isFinite(lon);
    const exif = Array.isArray(raw.exif) ? raw.exif : [];
    const exifValue = (code) => (exif.find((e) => e && e.exifTagCode === code) || {}).description || '';
    const px = (v) => parseInt(v, 10) || 0;
    return {
      assetId: String(raw.assetId || raw.catalogId),
      userId: raw.userId,
      userName: raw.userDisplayName || '',
      comName: tax.comName || tax.primaryComName || '',
      sciName: tax.sciName || '',
      speciesCode: tax.speciesCode || tax.reportAs || '',
      taxonCategory: tax.category || '',
      obsDt: raw.obsDt || '',
      obsDisplay: raw.obsDtDisplay || '',
      checklistId: raw.ebirdChecklistId || raw.EBirdChecklistId || '',
      rating: raw.rating || 0,
      restricted: raw.restricted === true,
      state: raw.assetState || raw.state || '',
      mediaType: raw.mediaType || '',
      fileName: raw.mediaFileName || '',
      fileSize: raw.mediaFileSize || 0,
      mime: raw.mimeType || exifValue('mime_type') || '',
      width: px(raw.width) || px(exifValue('width')),
      height: px(raw.height) || px(exifValue('height')),
      location: {
        name: loc.name || '',
        district: loc.subnational2Name || '',
        state: loc.subnational1Name || '',
        stateCode: loc.subnational1Code || '',
        districtCode: loc.subnational2Code || '',
        country: loc.countryName || '',
        countryCode: loc.countryCode || '',
        lat: hasCoords ? lat : null,
        lon: hasCoords ? lon : null,
      },
    };
  }

  function isPhoto(photo) {
    const type = String(photo.mediaType || '').toLowerCase();
    return type === 'p' || type === 'photo';
  }

  const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();

  function placeLabel(location) {
    const parts = [];
    const looksLikeCoords = /^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/;
    [location.name, location.district, location.state, location.country].forEach((value) => {
      const part = clean(value);
      if (!part || looksLikeCoords.test(part)) return;
      const lower = part.toLowerCase();
      if (parts.some((p) => p.toLowerCase().split(/\s*,\s*/).includes(lower))) return;
      parts.push(part);
    });
    return parts.join(', ');
  }

  function speciesLabel(photo) {
    const common = clean(photo.comName);
    const scientific = clean(photo.sciName);
    if (common && scientific && common !== scientific) return `${common} (${scientific})`;
    return common || scientific || 'Unidentified bird';
  }

  const wikitextSafe = (text) => clean(text).replace(/[\[\]{}|<>]/g, ' ').replace(/\s+/g, ' ').trim();

  function titleSafe(text) {
    return clean(String(text).replace(/[#<>\[\]|{}:\/\\?*"~^]/g, '-').replace(/_/g, ' ')).replace(/-{2,}/g, '-');
  }

  function fileExtension(photo, mimeType) {
    const mime = (mimeType || photo.mime || '').toLowerCase();
    const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/tiff': 'tif', 'image/gif': 'gif' };
    if (map[mime]) return map[mime];
    const match = /\.([a-z0-9]{2,5})$/i.exec(photo.fileName || '');
    if (match) {
      const ext = match[1].toLowerCase();
      return ext === 'jpeg' ? 'jpg' : ext;
    }
    return 'jpg';
  }

  const DEFAULT_SETTINGS = Object.freeze({
    campaign: 'wlb_2026',
    origin: 'own',
    license: 'cc-by-sa-4.0',
    fieldValues: [],
    assamOption: true,
    extraCategories: 'eBird images',
    publishMode: 'review',
    allowResized: false,
    batchSize: 30,
  });

  /** Built-in copy of Campaign:wlb_2026, used only when Commons can't be reached. */
  const FALLBACK_CAMPAIGN = Object.freeze({
    defaults: { categories: ['Images from Wiki Loves Birds India 2026'] },
    licensing: { ownWorkDefault: 'own', ownWork: { licenses: ['cc-by-sa-4.0', 'cc-by-4.0', 'cc-zero'] } },
    fields: [{
      label: 'Subject of the photo',
      type: 'select',
      required: true,
      options: {
        '': 'Select',
        'Wiki Loves Birds - Assam': 'Wiki Loves Birds - Assam',
        'Bird portraits': 'Bird portraits',
        'Birds in flight': 'Birds in flight',
        'Habitat and environment': 'Habitat and environment',
        'Behavior and action': 'Behavior and action',
        'Conservation and human impact': 'Conservation and human impact',
        'Rare or Endangered or Special sightings': 'Rare or Endangered or Special sightings',
        Others: 'Others',
      },
    }],
  });

  const fieldOptions = (field) => Object.keys((field && field.options) || {}).filter((key) => key !== '');
  const assamOptionOf = (field) => fieldOptions(field).find((key) => /assam/i.test(key)) || '';

  /** Starting answer for a campaign question: "Others" or similar when offered. */
  function defaultFieldValue(field) {
    if (!field || field.type !== 'select') return '';
    return fieldOptions(field).find((key) => /^others?(\s+birds?)?$/i.test(key)) || '';
  }

  /** Answers for the campaign questions, in the campaign's order. */
  function fieldAnswers(photo, settings, fields) {
    return (fields || []).map((field, index) => {
      let value = String((settings.fieldValues || [])[index] || '');
      if (field.type === 'select') {
        const assam = assamOptionOf(field);
        if (assam && settings.assamOption !== false && photo.location.stateCode === 'IN-AS') value = assam;
        if (!fieldOptions(field).includes(value)) value = '';
      }
      return value;
    });
  }

  /** Reads the JSON text of a Campaign: page, tolerating older formats. */
  function parseCampaign(text) {
    let config;
    try { config = JSON.parse(text); } catch (e) { return null; }
    if (!config || typeof config !== 'object') return null;
    const fields = Array.isArray(config.fields) ? config.fields : Object.values(config.fields || {});
    return {
      enabled: config.enabled !== false,
      title: config.title || '',
      start: config.start || '',
      end: config.end || '',
      categories: ((config.defaults || {}).categories) || [],
      licenses: (((config.licensing || {}).ownWork || {}).licenses) || [],
      ownWorkDefault: (config.licensing || {}).ownWorkDefault || 'own',
      fields: fields.filter((f) => f && typeof f === 'object').map((f) => ({
        label: f.label || '',
        type: f.type || 'text',
        required: !!f.required,
        options: f.options || {},
      })),
    };
  }

  function splitCategories(text) {
    return String(text || '').split(/[\n|,]+/).map((c) => clean(c).replace(/^category:/i, '').trim()).filter(Boolean);
  }

  function uniqueCategories(list) {
    const seen = new Set();
    return list.filter((name) => {
      const key = name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Everything the Upload Wizard needs for one photo. */
  function buildMetadata(photo, settingsIn, species, mimeType, campaign) {
    const settings = Object.assign({}, DEFAULT_SETTINGS, settingsIn || {});
    const ml = `ML${photo.assetId}`;
    const label = speciesLabel(photo);
    const place = placeLabel(photo.location);
    const from = place ? ` from ${place}` : '';
    const extension = fileExtension(photo, mimeType);
    const stem = titleSafe(`${label} ${ml}`).slice(0, 220);
    const caption = `${label}${from}`.slice(0, 250).trim();

    const speciesText = wikitextSafe(label);
    const speciesLink = photo.speciesCode
      ? `[https://ebird.org/species/${encodeURIComponent(photo.speciesCode)} ${speciesText}]`
      : speciesText;
    const links = [`[https://macaulaylibrary.org/asset/${photo.assetId} ${ml}]`];
    if (photo.checklistId) {
      links.push(`[https://ebird.org/checklist/${encodeURIComponent(photo.checklistId)} eBird checklist ${photo.checklistId}]`);
    }
    const description = `${speciesLink}${wikitextSafe(from) ? ` ${wikitextSafe(from)}` : ''} ${links.join(' & ')}`;

    const categories = uniqueCategories([
      ...(species && species.category ? [species.category] : []),
      ...splitCategories(settings.extraCategories),
    ]);

    return {
      assetId: photo.assetId,
      stem,
      extension,
      fileName: `${stem}.${extension}`,
      caption,
      description,
      date: /^\d{4}-\d{2}-\d{2}/.test(photo.obsDt) ? photo.obsDt.slice(0, 10) : '',
      lat: photo.location.lat,
      lon: photo.location.lon,
      categories,
      qid: species ? species.qid : '',
      fields: fieldAnswers(photo, settings, campaign ? campaign.fields : []),
      missing: (campaign ? campaign.fields : []).map((field, index) => ({ field, index }))
        .filter(({ field, index }) => field.required && !fieldAnswers(photo, settings, campaign.fields)[index])
        .map(({ field }) => field.label || 'Campaign question'),
      origin: settings.origin,
      license: settings.license,
      autoPublish: settings.publishMode === 'auto',
    };
  }

  function wizardUrl(meta, settingsIn) {
    const settings = Object.assign({}, DEFAULT_SETTINGS, settingsIn || {});
    const params = new URLSearchParams();
    params.set('campaign', settings.campaign);
    params.set('skiptutorial', '1');
    params.set('captionlang', 'en');
    params.set('caption', meta.caption);
    params.set('descriptionlang', 'en');
    params.set('description', meta.description);
    if (meta.lat != null && meta.lon != null) {
      params.set('lat', String(meta.lat));
      params.set('lon', String(meta.lon));
    }
    if (meta.categories.length) params.set('categories', meta.categories.join('|'));
    meta.fields.forEach((value) => params.append('fields[]', value));
    return `https://commons.wikimedia.org/w/index.php?title=Special:UploadWizard&${params.toString()}`;
  }

  const BATCH_MIN = 30;
  const BATCH_MAX = 500;
  const clampBatch = (value) => Math.min(BATCH_MAX, Math.max(BATCH_MIN, Math.round(Number(value) || BATCH_MIN)));

  /** Address of the user's Macaulay Library photo list, with optional species and region filters. */
  function catalogUrl(userId, filters) {
    const f = filters || {};
    const params = new URLSearchParams();
    if (f.birdOnly !== false) params.set('birdOnly', 'true');
    params.set('userId', userId);
    if (f.regionCode) params.set('regionCode', f.regionCode);
    params.set('mediaType', 'photo');
    if (f.taxonCode) params.set('taxonCode', f.taxonCode);
    params.set('sort', f.sort || 'rating_rank_desc');
    return `https://media.ebird.org/catalog?${params.toString()}#w2c`;
  }

  /** Reads an eBird species code from typed text such as "Purple Heron (Ardea purpurea) [purher1]". */
  function taxonCodeFrom(text) {
    const value = String(text || '').trim();
    const bracket = /\[([a-z0-9]{3,12})\]\s*$/i.exec(value);
    if (bracket) return bracket[1].toLowerCase();
    return /^[a-z]{3,8}[0-9]{0,2}$/.test(value) && !/\s/.test(value) && /[0-9]$|^[a-z]{6}$/.test(value) ? value : '';
  }

  /** Reads an eBird region code such as IN, IN-KL or IN-KL-KN from typed text. */
  function regionCodeFrom(text) {
    const value = String(text || '').trim();
    const bracket = /\[([A-Z]{2}(?:-[A-Z0-9]{1,3}){0,2})\]\s*$/i.exec(value);
    if (bracket) return bracket[1].toUpperCase();
    return /^[A-Z]{2}(-[A-Z0-9]{1,3}){0,2}$/i.test(value) ? value.toUpperCase() : '';
  }

  /** Regions (country, state, district) seen in loaded photos, for the location suggestions. */
  function regionsOf(photos) {
    const found = new Map();
    photos.forEach((p) => {
      const l = p.location || {};
      if (l.countryCode) found.set(l.countryCode, l.country || l.countryCode);
      if (l.stateCode) found.set(l.stateCode, [l.state, l.country].filter(Boolean).join(', '));
      if (l.districtCode) found.set(l.districtCode, [l.district, l.state, l.country].filter(Boolean).join(', '));
    });
    return [...found.entries()].map(([code, name]) => ({ code, name })).sort((x, y) => x.name.localeCompare(y.name));
  }

  /** Choose the Wikidata item for a taxon and read its Commons category. */
  function pickSpecies(entities, sciName) {
    const list = Object.values(entities || {}).filter((e) => e && e.id && !e.missing);
    if (!list.length) return null;
    const value = (e, prop) => {
      const claim = ((e.claims || {})[prop] || []).find((c) => c.mainsnak && c.mainsnak.datavalue);
      return claim ? claim.mainsnak.datavalue.value : '';
    };
    const entity = list.find((e) => value(e, 'P225') === sciName) || list[0];
    let category = value(entity, 'P373');
    if (!category) {
      const link = ((entity.sitelinks || {}).commonswiki || {}).title || '';
      if (/^Category:/.test(link)) category = link.replace(/^Category:/, '');
    }
    return { qid: entity.id, category: category || '', taxonName: value(entity, 'P225') };
  }

  const api = {
    DEFAULT_SETTINGS, unflattenNuxt, parseNuxtJson, nuxtFromHtml, findAssets, findSessionUser,
    parseMyEbird, normalizeAsset, isPhoto, placeLabel, speciesLabel, titleSafe, splitCategories,
    buildMetadata, wizardUrl, pickSpecies, fieldAnswers, defaultFieldValue, fieldOptions, assamOptionOf,
    parseCampaign, FALLBACK_CAMPAIGN, catalogUrl, taxonCodeFrom, regionCodeFrom, regionsOf, clampBatch, BATCH_MIN, BATCH_MAX,
  };
  root.W2C = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
