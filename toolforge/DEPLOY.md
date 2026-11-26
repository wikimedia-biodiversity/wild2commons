# Deploying Wild2Commons

The website is plain static files (HTML, CSS and JavaScript modules) with no server code.
It runs at https://wild2commons.toolforge.org/ from the `app/` folder of the repository.

## Repositories

The same code lives in two places:

- GitHub (main, issues): https://github.com/wikimedia-biodiversity/wild2commons.git
- GitLab (Toolforge copy): https://gitlab.wikimedia.org/toolforge-repos/wild2commons.git

One-time setup in your local folder, so a single `git push` updates both:

```sh
git init -b main
git add .
git commit -m "Wild2Commons 0.2.0"
git remote add origin git@github.com:wikimedia-biodiversity/wild2commons.git
git remote set-url --add --push origin git@github.com:wikimedia-biodiversity/wild2commons.git
git remote set-url --add --push origin git@gitlab.wikimedia.org:toolforge-repos/wild2commons.git
git push -u origin main
```

Check with `git remote -v`: one fetch line (GitHub) and two push lines (GitHub and GitLab).
Both repositories must exist and be empty before the first push. Without SSH keys, use the
`https://` addresses and a personal access token as the password.

## 1. Create the tool (once)

1. Sign in to https://toolsadmin.wikimedia.org/ with a Wikimedia developer account that has
   Toolforge membership, and create a tool named `wild2commons`.
2. Add the other maintainers to the tool.
3. Mirror the source: GitHub https://github.com/wikimedia-biodiversity/wild2commons is the main
   repository; https://gitlab.wikimedia.org/toolforge-repos/wild2commons is created from
   Toolsadmin ("Git repositories") and can pull from GitHub, or be pushed to in the release step.

## 2. Register the OAuth client (once)

Full guide with troubleshooting: [docs/OAUTH.md](../docs/OAUTH.md). Short version:

1. Open https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose/oauth2
2. Application name: `Wild2Commons`; description: what the tool does.
3. Application type **Authorization code**, and **untick "Client is confidential"** (the website cannot keep a secret).
4. OAuth "callback" URL: `https://wild2commons.toolforge.org/index.html`
5. Applicable project: `commonswiki` (or all projects).
6. Grants, all four are needed:
   - Basic rights
   - Edit existing pages
   - Create, edit, and move pages
   - Upload new files
7. Submit. Copy the **client application key** (not the secret, which is not used) into
   `oauthClientId` in `app/js/config.js` and commit it. It is public by design.
   Until an OAuth admin approves the client, only the person who registered it can log in.

For testing on your own computer, register a second client with the callback
`http://localhost:8000/index.html` and paste its key into Settings (gear) in your browser instead of
config.js.

## 3. Put the site online

```sh
ssh login.toolforge.org
become wild2commons
git clone https://gitlab.wikimedia.org/toolforge-repos/wild2commons.git ~/src
mkdir -p ~/public_html
rsync -a --delete ~/src/app/ ~/public_html/
webservice php8.2 start      # lighttpd serving ~/public_html; see `webservice --help`
```

Open https://wild2commons.toolforge.org/ to check.

## 4. Updating

```sh
become wild2commons
cd ~/src && git pull --ff-only
rsync -a --delete ~/src/app/ ~/public_html/
```

No restart is needed for static files. If browsers keep an old script, bump `version` in
`app/js/config.js` (it is shown in the footer).

## 5. Releasing

1. Bump `version` in `app/js/config.js` and `package.json`.
2. Run `node build.mjs`. It packs the extension into `app/downloads/wild2commons-chrome.zip`
   and `app/downloads/wild2commons-firefox.zip` (the website offers these on `install.html`),
   and makes versioned packages in `dist/`.
3. Commit everything, **including `app/downloads/`**, push, and update Toolforge (section 4).
   The download buttons then serve the new extension.
4. Tag the release on GitHub and attach the zips from `dist/`.

### Firefox: signed add-on (recommended)
Release Firefox only keeps add-ons signed by Mozilla. Self-distributed signing is free:
1. Sign in at https://addons.mozilla.org/developers/ and choose **Submit a New Add-on →
   On your own** (unlisted, not shown in the store).
2. Upload `dist/wild2commons-firefox-<version>.zip` and the source zip when asked.
3. Download the signed `.xpi`, save it as `app/downloads/wild2commons-firefox.xpi`, commit and
   deploy. `install.html` then offers the one-click Firefox install automatically.
4. Repeat for each new version (the version number must go up).

### Chrome Web Store (optional)
Chrome installs from outside the store only through "Load unpacked" (developer mode). For a
one-click install, publish `dist/wild2commons-chrome-<version>.zip` on the Chrome Web Store
(one-time developer fee) and add its link to `install.html`.

## What never goes in the repository

- OAuth client secrets (a non-confidential client has none to use).
- Anyone's Xeno-canto API key: each user enters their own in Settings, and it stays in their browser.
- API keys found in eBird, Macaulay Library or iNaturalist page source.
