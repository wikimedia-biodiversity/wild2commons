# Wild2Commons

A biodiversity media uploader by the Wikimedia Biodiversity Taskforce.
Uploads photos and sound recordings from **eBird / Macaulay Library**, **iNaturalist** and
**Xeno-canto** to **Wikimedia Commons**, with species, date, place, licence, structured data,
categories and links back to the original record.

- Website: https://wild2commons.toolforge.org/
- Source: https://github.com/wikimedia-biodiversity/wild2commons.git
- Toolforge copy: https://gitlab.wikimedia.org/toolforge-repos/wild2commons.git

## Parts

| Folder | What it is |
| --- | --- |
| `app/` | The website: static HTML, CSS and JavaScript modules, no build step, no browser extension needed. Uploads with the Commons API after an OAuth 2 login (PKCE, no secret). eBird media come from the user's "Download my data" file plus the photo files they add; iNaturalist and Xeno-canto from their public APIs. |
| `extension/` | Optional helper extension for Chrome and Firefox: loads the user's eBird photos and originals automatically, fills in iNaturalist/Xeno-canto usernames, adds "Upload to Commons" on record pages. `build.mjs` packs it into `app/downloads/` so the website offers it for download (`install.html`). |
| `toolforge/DEPLOY.md` | Toolforge setup, OAuth registration and release steps. |
| `docs/OAUTH.md` | Wikimedia OAuth client ID: how login works, registering the client, testing locally, troubleshooting. |
| `tests/` | Unit tests (`node --test tests/*.test.js`). |

## Run it on your computer

```sh
npm run serve              # http://localhost:8000/
npm test
node build.mjs             # extension zips into app/downloads/, plus dist/ packages
```

For logging in locally, register an OAuth 2 client with the callback `http://localhost:8000/index.html`
(see DEPLOY.md) and paste its key into Settings.

## Rules the tool follows

- Other people's eBird photos are never offered (Macaulay Library media is not openly licensed).
- Someone else's iNaturalist or Xeno-canto media only under CC0, CC BY or CC BY-SA, with a licence review template.
- Hidden or obscured locations are never published.
- Every file is checked by SHA-1 against Commons before upload; warnings are never ignored.
- Writes use `maxlag=5` and `assert=user`, one file at a time with a pause between files.

## Licence

MIT. See LICENSE.
