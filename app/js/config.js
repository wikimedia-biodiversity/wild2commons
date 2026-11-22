// Wild2Commons configuration. Everything here is public: it is sent to every visitor's browser.
// Never put a password or OAuth client SECRET here. The OAuth client ID is not secret.

export const CONFIG = {
  name: 'Wild2Commons',
  tagline: 'A biodiversity media uploader by the Wikimedia Biodiversity Taskforce',
  version: '0.2.0',
  repoUrl: 'https://github.com/wikimedia-biodiversity/wild2commons',
  issuesUrl: 'https://github.com/wikimedia-biodiversity/wild2commons/issues',
  // Sent to Wikimedia as Api-User-Agent so Wikimedia can tell which tool is calling.
  userAgent: 'Wild2Commons/0.2.0 (https://wild2commons.toolforge.org/; https://github.com/wikimedia-biodiversity/wild2commons)',

  // Wikimedia OAuth 2.0 client ("client application key"), registered on Meta-Wiki as a
  // NON-confidential client with the grants listed in toolforge/DEPLOY.md.
  // Settings (gear) can override it; leave it empty there to use this one.
  oauthClientId: '',
  oauthRest: 'https://meta.wikimedia.org/w/rest.php',
  commonsApi: 'https://commons.wikimedia.org/w/api.php',
  commonsWiki: 'https://commons.wikimedia.org/wiki/',
  wikidataApi: 'https://www.wikidata.org/w/api.php',

  inatApi: 'https://api.inaturalist.org/v1',
  xcApi: 'https://xeno-canto.org/api/3/recordings',

  // Category added to every upload (hidden tracking category).
  toolCategory: 'Uploaded with Wild2Commons',
  // The source's own category; editable in Settings.
  platformCategories: {
    ebird: 'eBird images',
    inat: 'Media from iNaturalist',
    xc: 'Xeno-canto',
  },
  // Campaigns shown first in the campaign list when they are running.
  pinnedCampaigns: ['wlb_2026'],

  // Defaults for the Settings window. Each visitor can change these in their browser.
  defaults: {
    oauthClientId: '',
    xcApiKey: '',
    ownLicense: 'cc-by-sa-4.0',
    globalCategories: '',
    platformCategories: null, // null = use the ones above
    campaign: 'wlb_2026',
    batchSize: 30,
    reviewFirst: true,
    uploadDelaySec: 8,
    allowResized: false,
    language: 'en',
    licenseReviewOwn: true,
  },
};

export const SOURCES = {
  ebird: {
    id: 'ebird',
    name: 'eBird',
    wikipedia: 'https://en.wikipedia.org/wiki/EBird',
    blurb: 'Online database of bird observations, launched in 2002 by the Cornell Lab of Ornithology and the National Audubon Society. Photos come from its Macaulay Library.',
    kind: 'photo',
    needsExtension: true,
    othersAllowed: false,
    signInUrl: 'https://ebird.org/myebird',
  },
  inat: {
    id: 'inat',
    name: 'iNaturalist',
    wikipedia: 'https://en.wikipedia.org/wiki/INaturalist',
    blurb: 'Nonprofit social network, launched in 2008, where people map and share biodiversity observations and help each other identify organisms.',
    kind: 'photo',
    needsExtension: false,
    othersAllowed: true,
    signInUrl: 'https://www.inaturalist.org/login',
  },
  xc: {
    id: 'xc',
    name: 'Xeno-canto',
    wikipedia: 'https://en.wikipedia.org/wiki/Xeno-canto',
    blurb: 'Citizen science archive, launched in 2005, where volunteers share and annotate recordings of birds, grasshoppers, bats, frogs and land mammals.',
    kind: 'sound',
    needsExtension: false,
    othersAllowed: true,
    signInUrl: 'https://xeno-canto.org/auth/login',
  },
};
