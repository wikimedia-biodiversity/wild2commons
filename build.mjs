// Builds everything into dist/:
//   dist/toolforge/public_html   the website, ready to copy to the tool account
//   dist/*.zip                   packages for upload or release
// Usage: node build.mjs
import { cpSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const version = /version: '([^']+)'/.exec(readFileSync('app/js/config.js', 'utf8'))[1];

rmSync('dist', { recursive: true, force: true });
const zip = (dir, name) => execFileSync('zip', ['-qrX', name, '.'], { cwd: dir });

// Website
const site = 'dist/toolforge/public_html';
mkdirSync(site, { recursive: true });
cpSync('app', site, { recursive: true });
cpSync('toolforge/DEPLOY.md', 'dist/toolforge/DEPLOY.md');
zip('dist/toolforge', `../wild2commons-toolforge-${version}.zip`);


// Source
execFileSync('zip', ['-qrX', `dist/wild2commons-source-${version}.zip`, 'app', 'tests', 'toolforge', 'build.mjs', 'package.json', 'README.md', 'LICENSE', '.gitignore']);
console.log(`Built ${version}: toolforge, source`);
