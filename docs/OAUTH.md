# Wikimedia OAuth client ID: guide for maintainers

Wild2Commons uploads to Wikimedia Commons **as the person using it**, with their own Wikimedia
account. It does this with **OAuth 2.0**: the person clicks *Log in to Commons*, Wikimedia asks
them to allow Wild2Commons, and the browser gets a short-lived access token. The tool never
sees their password.

To do this, the tool needs a **client ID** (Wikimedia calls it the *client application key*):
a public identifier that tells Wikimedia which application is asking. It is registered once on
Meta-Wiki and written into `app/js/config.js`.

This page covers registering it, putting it in the tool, testing on your own computer, and
fixing login problems. For everyday users, the Help page has a short version
(`help.html#oauth`).

---

## 1. How the login works

```
Wild2Commons page ──(1) Log in to Commons──▶ meta.wikimedia.org: "Allow Wild2Commons to…?"
        ▲                                                   │
        │ (3) access token (kept in this browser tab only)  │ (2) Allow → back to the tool
        └──────────────── code exchanged ◀──────────────────┘
(4) uploads and edits go to commons.wikimedia.org with that token
```

- Flow: OAuth 2.0 *authorization code* with **PKCE** (S256). PKCE replaces a client secret, so
  the tool can run entirely in the browser with no server.
- Endpoints: `https://meta.wikimedia.org/w/rest.php/oauth2/authorize` and
  `https://meta.wikimedia.org/w/rest.php/oauth2/access_token` (set by `oauthRest` in `config.js`).
- The token is stored in the tab's `sessionStorage` (`w2c-oauth`). It is gone when the tab
  closes and expires after a few hours; the user then logs in again.
- After login the tool calls `meta=userinfo` and checks that the token carries the rights
  `upload`, `createpage` and `edit`. If one is missing it says which grant to allow.
- Code: `app/js/lib/oauth.js` (login), `app/js/lib/commons.js` (API calls with the token).

## 2. The client ID and the secret

| | Client ID (client application key) | Client secret |
|---|---|---|
| What it is | Public name of the application | Password of the application |
| Used by Wild2Commons | Yes | **No, never** |
| Where it goes | `app/js/config.js` → `oauthClientId` (committed, public) | Nowhere. Do not commit it, do not paste it in Settings |

The client ID is visible to every visitor, which is normal for browser apps. Wild2Commons is
registered as a **non-confidential** client, so Wikimedia does not expect a secret; PKCE
protects the login instead. If a secret is shown after registration, you can ignore it.

## 3. Register the production client (once)

1. Sign in to Meta-Wiki with the account that should own the client (ideally an account the
   Taskforce maintainers can reach, as only the owner can change it later).
2. Open <https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose/oauth2>.
3. Fill in:

   | Field | Value |
   |---|---|
   | Application name | `Wild2Commons` |
   | Consumer version | the tool version, e.g. `0.3.0` (a new registration is needed to change grants or the callback later; use a new version number then) |
   | Application description | see section 7 |
   | Application type | **Authorization code** (not "Client credentials", not "Owner-only"; those cannot log other people in and cause "Client authentication failed") |
   | This consumer is for use only by *you* (older form) | **leave unticked** (that makes a personal, owner-only client) |
   | Client is confidential | **untick** |
   | OAuth "callback" URL | `https://wild2commons.toolforge.org/index.html` (exactly; Meta-Wiki matches it character by character) |
   | Allow consumer to specify a callback… | leave unticked |
   | Contact email | an address the maintainers read |
   | Applicable project | `commonswiki` (or all projects) |
   | Types of grants | "Request authorization for specific permissions" |
   | Grants | **Basic rights**, **Edit existing pages**, **Create, edit, and move pages**, **Upload new files** |
   | Allowed IP ranges, public RSA key | leave as they are |

4. Accept the terms and submit.
5. Copy the **client application key**. You can see it again later under
   <https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/list>.

### Why these grants

| Grant | Needed for |
|---|---|
| Basic rights | Reading the account name and its rights after login |
| Upload new files | `action=upload` |
| Create, edit, and move pages | Creating the file description page that comes with each upload |
| Edit existing pages | Adding the caption and structured data (`wbeditentity`) after upload |

Do not ask for more: OAuth admins review the request, and users see every grant on the
"Allow" screen.

## 4. Put the client ID in the tool

1. Open `app/js/config.js` and set:

   ```js
   oauthClientId: 'paste-the-client-application-key-here',
   ```

2. Commit and push, then update Toolforge:

   ```sh
   git commit -am "Set the Wikimedia OAuth client ID" && git push
   # on Toolforge:
   become wild2commons
   cd ~/src && git pull --ff-only && rsync -a --delete ~/src/app/ ~/public_html/
   ```

3. Open <https://wild2commons.toolforge.org/>, press **Log in to Commons**, allow, and check
   that your username appears at the top right.

## 5. Approval

New clients start as **proposed**. Until an OAuth administrator approves it:

- the **owner** can already log in and test with it;
- everyone else gets an error saying the application is not approved.

Approval usually takes a few days. Check the status in
<https://meta.wikimedia.org/wiki/Special:OAuthListConsumers>. If it waits for more than a week,
ask on Meta-Wiki (for example at *Steward requests/Miscellaneous*) with a link to the client.

Grants and the callback URL cannot be changed once approved. To change them, propose a new
version of the client and replace the key in `config.js` after it is approved.

## 6. Testing on your own computer, and copies of the tool

The tool always uses its own `index.html` as the callback (`app/js/lib/oauth.js`,
`redirectUriFor`), whether it was opened as `…/` or `…/index.html`. The production client
therefore works only at `https://wild2commons.toolforge.org/`. For anywhere else, register a
separate client:

| Where the tool runs | Callback URL to register |
|---|---|
| `npm run serve` on your computer | `http://localhost:8000/index.html` |
| A copy on another Toolforge tool | `https://<tool-name>.toolforge.org/index.html` |
| A copy in a sub-folder | the folder address followed by `index.html` |

Register it as in section 3 (you can call it `Wild2Commons (local test)`), then, instead of
editing `config.js`, open **Settings** (gear) in the tool and paste the key into
**Wikimedia OAuth client ID**. Settings shows the exact callback address under that field.
A key in Settings is stored only in that browser and overrides the one in `config.js`;
empty the field to go back to it. The owner can test an unapproved client right away.

## 7. Application description (for the registration form)

> Wild2Commons is a biodiversity media uploader by the Wikimedia Biodiversity Taskforce, hosted
> on Toolforge at https://wild2commons.toolforge.org/ (source:
> https://github.com/wikimedia-biodiversity/wild2commons). It uploads nature photos and sound
> recordings from eBird/Macaulay Library, iNaturalist and Xeno-canto to Wikimedia Commons, with
> species, date, place, author, licence, links to the original record, structured data and
> categories, including upload campaigns such as Wiki Loves Birds India. Users upload their own
> media, or other people's media only under CC0, CC BY or CC BY-SA, with a licence review
> template. Each file is checked against Commons by SHA-1 first, upload warnings are never
> ignored, and edits use maxlag and run one at a time. The tool runs entirely in the user's
> browser as a non-confidential OAuth 2.0 client with PKCE; nothing is stored on a server.

## 8. Troubleshooting login

| What you see | Cause | Fix |
|---|---|---|
| "No OAuth client ID" in the tool | `oauthClientId` is empty and nothing is in Settings | Section 4, or Settings for a test client |
| Meta-Wiki says the redirect/callback URI does not match | The tool runs at a different address than the registered callback (e.g. `www.`, `http`, a sub-folder, a port) | Open the tool at exactly the registered address, or register a client for this address (section 6) |
| Meta-Wiki shows "Application connection error: Client authentication failed (e.g., unknown client…)" | Wrong key (often the secret was pasted, or a space), a key in Settings overriding `config.js`, an OAuth 1.0a key, or a client registered as *Client credentials*, *Owner-only* or confidential | Copy the *client application key* again from your client list and empty Settings. If the application type or confidential setting is wrong, register a new client (section 3); these cannot be changed afterwards |
| Meta-Wiki says the application is not approved | Client still proposed, and you are not the owner | Wait for approval (section 5) |
| "The login reply did not match this browser tab" | Login started in another tab, or the tab was reloaded mid-login | Press *Log in to Commons* again in the same tab |
| "Your Commons login is missing these permissions: …" | A grant was not ticked at registration, or the user unticked it | Users: log out and log in again, allowing everything. Maintainers: register a new version with all four grants |
| Login worked earlier, now uploads fail with a login error | The token expired (a few hours) or the tab was closed | Log in again; finished files are skipped |
| Uploads ask for a CAPTCHA | New Commons accounts (under 4 days / 10 edits) | Upload one file by hand on Commons first, or wait |

## 9. For users: what they allow, and how to take it back

- Wild2Commons can then upload files and edit pages on Commons **in their name**, only while
  the tab is open and the token is valid. It cannot see their password or email.
- To withdraw the permission at any time:
  <https://meta.wikimedia.org/wiki/Special:OAuthManageMyGrants>.

## 10. Rules

- Never put the client **secret**, a password or any personal token in `config.js`, in Settings,
  in an issue or in a commit.
- Keep the owner account reachable by the Taskforce; record who owns the client in the tool's
  Toolsadmin page or in the repository's README.
- If the key ever needs replacing, register a new version, update `config.js`, deploy, then
  disable the old client in your client list.
