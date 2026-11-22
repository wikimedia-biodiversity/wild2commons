# Wild2Commons

A biodiversity media uploader by the Wikimedia Biodiversity Taskforce.
Uploads photos and sound recordings from **eBird / Macaulay Library**, **iNaturalist** and
**Xeno-canto** to **Wikimedia Commons**, with species, date, place, licence, structured data,
categories and links back to the original record.

- Website: https://wild2commons.toolforge.org/
- Source: https://github.com/wikimedia-biodiversity/wild2commons (mirror: https://gitlab.wikimedia.org/toolforge-repos/wild2commons)

## Parts

| Folder | What it is |
| --- | --- |
| `app/` | The website: static HTML, CSS and JavaScript modules, no build step. Uploads with the Commons API after an OAuth 2 login (PKCE, no secret). |
| `extension/` | The helper extension for Chrome and Firefox. Reads sign-ins on the source sites, lists and reads eBird photos in background tabs, fetches originals, and adds an "Upload to Commons" button on record pages. It is not a second app. |
| `toolforge/DEPLOY.md` | Toolforge setup, OAuth registration and release steps. |
| `tests/` | Unit tests (`node --test tests/*.test.js`). |

## Run it on your computer

```sh
npm run serve              # http://localhost:8000/
npm test
node build.mjs             # dist/: toolforge bundle, Chrome and Firefox zips
```

For logging in locally, register an OAuth 2 client with the callback `http://localhost:8000/`
(see DEPLOY.md) and paste its key into Settings. Load `dist/chrome` with "Load unpacked" on
`chrome://extensions`, or `dist/firefox/manifest.json` from `about:debugging` in Firefox.

## Rules the tool follows

- Other people's eBird photos are never offered (Macaulay Library media is not openly licensed).
- Someone else's iNaturalist or Xeno-canto media only under CC0, CC BY or CC BY-SA, with a licence review template.
- Hidden or obscured locations are never published.
- Every file is checked by SHA-1 against Commons before upload; warnings are never ignored.
- Writes use `maxlag=5` and `assert=user`, one file at a time with a pause between files.

## Licence

MIT. See LICENSE.
