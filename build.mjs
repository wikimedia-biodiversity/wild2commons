// Builds everything into dist/:
//   dist/toolforge/public_html   the website, ready to copy to the tool account
//   dist/chrome, dist/firefox    the helper extension
//   dist/*.zip                   packages for upload or release
// Usage: node build.mjs
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const version = /version: '([^']+)'/.exec(readFileSync('app/js/config.js', 'utf8'))[1];

const hosts = [
  'https://ebird.org/*',
  'https://media.ebird.org/*',
  'https://macaulaylibrary.org/*',
  'https://www.macaulaylibrary.org/*',
  'https://*.birds.cornell.edu/*',
  'https://www.inaturalist.org/*',
  'https://api.inaturalist.org/*',
  'https://inaturalist-open-data.s3.amazonaws.com/*',
  'https://static.inaturalist.org/*',
  'https://xeno-canto.org/*',
  'https://*.xeno-canto.org/*',
];
const appMatches = ['https://wild2commons.toolforge.org/*', 'http://localhost/*', 'http://127.0.0.1/*'];

const base = {
  manifest_version: 3,
  name: 'Wild2Commons',
  short_name: 'Wild2Commons',
  version,
  description: 'Helper for Wild2Commons, the biodiversity media uploader by the Wikimedia Biodiversity Taskforce: eBird, iNaturalist and Xeno-canto to Wikimedia Commons.',
  homepage_url: 'https://wild2commons.toolforge.org/',
  icons: { 16: 'icons/icon-16.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  action: { default_title: 'Open Wild2Commons', default_icon: { 16: 'icons/icon-16.png', 48: 'icons/icon-48.png' } },
  permissions: ['storage', 'tabs', 'downloads'],
  host_permissions: hosts,
  content_scripts: [
    { matches: appMatches, js: ['content/bridge.js'], run_at: 'document_start' },
    {
      matches: ['https://macaulaylibrary.org/asset/*', 'https://www.inaturalist.org/observations/*', 'https://xeno-canto.org/*'],
      js: ['content/button.js'],
      run_at: 'document_idle',
    },
    { matches: ['https://media.ebird.org/catalog*'], js: ['content/hook.js'], run_at: 'document_start', world: 'MAIN' },
    {
      matches: ['https://ebird.org/myebird*', 'https://media.ebird.org/catalog*', 'https://macaulaylibrary.org/asset/*'],
      js: ['lib/core.js', 'content/pages.js'],
      run_at: 'document_idle',
    },
  ],
};
const targets = {
  chrome: { ...base, minimum_chrome_version: '111', background: { service_worker: 'background.js' } },
  firefox: {
    ...base,
    background: { scripts: ['lib/core.js', 'background.js'] },
    browser_specific_settings: {
      gecko: {
        id: 'wild2commons@biodiversity.toolforge.org',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
};

rmSync('dist', { recursive: true, force: true });
const zip = (dir, name) => execFileSync('zip', ['-qrX', name, '.'], { cwd: dir });

// Website
const site = 'dist/toolforge/public_html';
mkdirSync(site, { recursive: true });
cpSync('app', site, { recursive: true });
cpSync('toolforge/DEPLOY.md', 'dist/toolforge/DEPLOY.md');
zip('dist/toolforge', `../wild2commons-toolforge-${version}.zip`);

// Extension
for (const [name, manifest] of Object.entries(targets)) {
  const out = `dist/${name}`;
  mkdirSync(out, { recursive: true });
  cpSync('extension', out, { recursive: true });
  writeFileSync(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  zip(out, `../wild2commons-${name}-${version}.zip`);
}

// Source
execFileSync('zip', ['-qrX', `dist/wild2commons-source-${version}.zip`, 'app', 'extension', 'tests', 'toolforge', 'build.mjs', 'package.json', 'README.md', 'LICENSE']);
console.log(`Built ${version}: toolforge, chrome, firefox, source`);
