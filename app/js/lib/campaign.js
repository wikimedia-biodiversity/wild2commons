// Upload campaigns, read from Commons' Campaign: namespace. Uploads go through the API, so the
// tool applies each campaign's categories, wikitext and question answers itself.

export function parseCampaign(name, text) {
  let config;
  try { config = JSON.parse(text); } catch (e) { return null; }
  if (!config || typeof config !== 'object') return null;
  const fields = (Array.isArray(config.fields) ? config.fields : Object.values(config.fields || {}))
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      label: f.label || '',
      type: f.type || 'text',
      required: !!f.required,
      options: f.options || {},
      wikitext: f.wikitext || '',
    }));
  const autoAdd = config.autoAdd || {};
  return {
    name,
    title: String(config.title || name).replace(/\[\[[^\]]*\]\]/g, '').trim() || name,
    enabled: config.enabled !== false,
    start: config.start || '',
    end: config.end || '',
    defaultCategories: ((config.defaults || {}).categories) || [],
    autoCategories: autoAdd.categories || [],
    autoWikitext: autoAdd.wikitext || '',
    licenses: (((config.licensing || {}).ownWork || {}).licenses) || [],
    fields,
  };
}

/** Running today: switched on, and today within its start and end dates when they are given. */
export function isRunning(campaign, today = new Date().toISOString().slice(0, 10)) {
  if (!campaign || !campaign.enabled) return false;
  if (campaign.start && today < campaign.start) return false;
  if (campaign.end && today > campaign.end) return false;
  return true;
}

/** "running", "not started", "ended" or "switched off", with a short label for lists. */
export function campaignStatus(campaign, today = new Date().toISOString().slice(0, 10)) {
  if (!campaign.enabled) return { state: 'off', label: 'switched off' };
  if (campaign.start && today < campaign.start) return { state: 'future', label: `starts ${campaign.start}` };
  if (campaign.end && today > campaign.end) return { state: 'ended', label: `ended ${campaign.end}` };
  return { state: 'running', label: campaign.end ? `until ${campaign.end}` : 'running' };
}

/** Campaign names from typed text: one per line or comma, "Campaign:" and links accepted. */
export function campaignNames(text) {
  return [...new Set(String(text || '').split(/[\n,]+/)
    .map((s) => s.trim().replace(/^.*Campaign:/i, '').replace(/[?#].*$/, '').replace(/ /g, '_'))
    .filter(Boolean))];
}

export const fieldOptions = (field) => Object.keys(field.options || {}).filter((k) => k !== '');

export function defaultAnswer(field) {
  if (field.type !== 'select') return '';
  return fieldOptions(field).find((k) => /^others?(\s+birds?)?$/i.test(k)) || '';
}

const assamOption = (field) => fieldOptions(field).find((k) => /assam/i.test(k)) || '';

/** Answers per question for one item; the Assam option is used for items placed in Assam. */
export function answersFor(campaign, item, answers, { assamAuto = true } = {}) {
  return (campaign ? campaign.fields : []).map((field, i) => {
    let value = String((answers || [])[i] || '');
    if (field.type === 'select') {
      const assam = assamOption(field);
      if (assam && assamAuto && item.place && item.place.stateCode === 'IN-AS') value = assam;
      if (!fieldOptions(field).includes(value)) value = '';
    }
    return value;
  });
}

/** What a campaign adds to a file page for one item: categories and wikitext lines. */
export function campaignAdditions(campaign, item, answers, opts) {
  if (!campaign) return { categories: [], wikitext: [], missing: [] };
  const values = answersFor(campaign, item, answers, opts);
  const wikitext = [];
  if (campaign.autoWikitext) wikitext.push(campaign.autoWikitext);
  const missing = [];
  campaign.fields.forEach((field, i) => {
    if (!values[i]) { if (field.required) missing.push(field.label || `Question ${i + 1}`); return; }
    if (field.wikitext) wikitext.push(field.wikitext.split('$1').join(values[i]));
  });
  return {
    categories: [...campaign.defaultCategories, ...campaign.autoCategories],
    wikitext,
    missing,
    values,
  };
}

// Used when Commons cannot be reached.
export const FALLBACK_WLB_2026 = JSON.stringify({
  enabled: true,
  title: 'Wiki Loves Birds India 2026',
  start: '2026-11-01',
  end: '2027-01-15',
  defaults: { categories: ['Images from Wiki Loves Birds India 2026'] },
  autoAdd: { wikitext: '{{Wiki loves Birds India event|2026}}', categories: ['Images from Wiki Loves Birds India 2026 (maintenance)'] },
  licensing: { ownWorkDefault: 'own', ownWork: { licenses: ['cc-by-sa-4.0', 'cc-by-4.0', 'cc-zero'] } },
  fields: [{
    wikitext: '[[Category:Images from Wiki Loves Birds India 2026 ($1)]]',
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
