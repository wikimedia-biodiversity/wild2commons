# Deploying Wild2Commons

The website is plain static files (HTML, CSS and JavaScript modules) with no server code.
It runs at https://wild2commons.toolforge.org/ from the `app/` folder of the repository.

## 1. Create the tool (once)

1. Sign in to https://toolsadmin.wikimedia.org/ with a Wikimedia developer account that has
   Toolforge membership, and create a tool named `wild2commons`.
2. Add the other maintainers to the tool.
3. Mirror the source: GitHub https://github.com/wikimedia-biodiversity/wild2commons is the main
   repository; https://gitlab.wikimedia.org/toolforge-repos/wild2commons is created from
   Toolsadmin ("Git repositories") and can pull from GitHub, or be pushed to in the release step.

## 2. Register the OAuth client (once)

1. Open https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose/oauth2
2. Application name: `Wild2Commons`; description: what the tool does.
3. **Untick "This consumer is confidential"** (the website cannot keep a secret).
4. OAuth "callback" URL: `https://wild2commons.toolforge.org/`
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
`http://localhost:8000/` and paste its key into Settings (gear) in your browser instead of
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

## 5. Releasing the extension

1. Bump `version` in `app/js/config.js` and `package.json`.
2. `node build.mjs` creates `dist/wild2commons-chrome-<version>.zip`,
   `dist/wild2commons-firefox-<version>.zip` and the source zip.
3. Chrome Web Store: upload the Chrome zip. Explain the permissions: tabs and downloads read
   your eBird photo list and capture the "Download original" link; host access is limited to
   eBird, Macaulay Library, iNaturalist and Xeno-canto.
4. addons.mozilla.org: upload the Firefox zip and the source zip (the code is not minified, so
   reviewers can read it directly).
5. Tag the release on GitHub and attach the zips.

## What never goes in the repository

- OAuth client secrets (a non-confidential client has none to use).
- Anyone's Xeno-canto API key: each user enters their own in Settings, and it stays in their browser.
- API keys found in eBird, Macaulay Library or iNaturalist page source.
