// Licences: what Commons accepts, how each is written on a file page and in structured data,
// and which items can be uploaded in which mode.

// Source licences that Commons accepts, by normalised code "cc-by-4.0" etc.
const FREE = {
  'cc0-1.0': { template: 'Cc-zero', qid: 'Q6938433', label: 'CC0 1.0', zero: true },
  'cc-by-4.0': { template: 'Cc-by-4.0', qid: 'Q20007257', label: 'CC BY 4.0' },
  'cc-by-sa-4.0': { template: 'Cc-by-sa-4.0', qid: 'Q18199165', label: 'CC BY-SA 4.0' },
  'cc-by-3.0': { template: 'Cc-by-3.0', qid: 'Q14947546', label: 'CC BY 3.0' },
  'cc-by-sa-3.0': { template: 'Cc-by-sa-3.0', qid: 'Q14946043', label: 'CC BY-SA 3.0' },
  'cc-by-2.5': { template: 'Cc-by-2.5', qid: '', label: 'CC BY 2.5' },
  'cc-by-sa-2.5': { template: 'Cc-by-sa-2.5', qid: '', label: 'CC BY-SA 2.5' },
};

// Licences a user can choose for their own work (Upload Wizard names).
export const OWN_LICENSES = {
  'cc-by-sa-4.0': { self: 'cc-by-sa-4.0', qid: 'Q18199165', label: 'CC BY-SA 4.0' },
  'cc-by-4.0': { self: 'cc-by-4.0', qid: 'Q20007257', label: 'CC BY 4.0' },
  'cc-zero': { self: 'cc-zero', qid: 'Q6938433', label: 'CC0', zero: true },
};

/**
 * Normalises a source licence: iNaturalist codes ("cc-by-nc"), Xeno-canto links
 * ("//creativecommons.org/licenses/by-nc-sa/4.0/") or plain names. Returns e.g. "cc-by-sa-4.0",
 * "cc-by-nc-4.0", "cc0-1.0", or "" for none (all rights reserved).
 */
export function normaliseLicence(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  if (/publicdomain\/zero|^cc0|^cc-?zero/.test(v)) return 'cc0-1.0';
  const link = /licenses\/([a-z-]+)\/(\d\.\d)/.exec(v);
  if (link) return `cc-${link[1]}-${link[2]}`;
  const code = /^cc[- ]?((?:by)(?:[- ](?:nc|nd|sa))*)(?:[- ](\d\.\d))?$/.exec(v.replace(/_/g, '-'));
  if (code) return `cc-${code[1].replace(/ /g, '-')}-${code[2] || '4.0'}`;
  return v;
}

export function freeLicence(code) {
  return FREE[code] || null;
}

export function licenceLabel(code) {
  if (!code) return 'All rights reserved';
  if (FREE[code]) return FREE[code].label;
  const m = /^cc-([a-z-]+)-(\d\.\d)$/.exec(code);
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : code;
}

/**
 * Can this item be uploaded in this mode? Returns { ok, reason, warnings[] }.
 * mode "own": the user made it; "others": someone else's openly licensed item.
 */
export function checkItem(item, mode) {
  const warnings = [];
  if (item.restricted) return { ok: false, reason: 'Restricted on eBird', warnings };
  if (!item.sciName && !item.comName) return { ok: false, reason: 'No species identified', warnings };
  if (mode === 'own') {
    if (item.owner === false) return { ok: false, reason: 'Not your record', warnings };
    if (item.source !== 'ebird' && !freeLicence(item.licence)) {
      warnings.push({
        code: 'own-nonfree',
        text: `${item.sourceName || 'The source'} shows this as ${licenceLabel(item.licence)}. Commons reviewers may ask about it; consider changing its licence there first.`,
      });
    }
    if (item.source === 'ebird') {
      warnings.push({ code: 'ebird-copyright', text: 'Macaulay Library shows your photos as "©". Commons may ask you to confirm the licence once through VRT.' });
    }
    return { ok: true, reason: '', warnings };
  }
  if (item.source === 'ebird') return { ok: false, reason: 'Other people\'s eBird photos cannot be uploaded', warnings };
  if (!freeLicence(item.licence)) return { ok: false, reason: `${licenceLabel(item.licence)} is not accepted on Commons`, warnings };
  return { ok: true, reason: '', warnings };
}
