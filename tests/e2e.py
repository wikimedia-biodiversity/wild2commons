"""End-to-end run of the website in Chromium (no extension) against a local mock of every site
involved: Toolforge, Macaulay Library CDN, iNaturalist, Commons and Wikidata.
Usage: node build.mjs && python3 tests/e2e.py"""
import io, json, re, ssl, subprocess, sys, tempfile, threading, zipfile, http.server, socketserver
from email.parser import BytesParser
from email.policy import default as email_policy
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'dist/toolforge/public_html'

def jpeg(color):
    b = io.BytesIO(); Image.new('RGB', (64, 48), color).save(b, 'JPEG'); return b.getvalue()
JPEG, JPEG_A, JPEG_B = jpeg((20, 90, 120)), jpeg((120, 20, 90)), jpeg((90, 120, 20))

CAMPAIGN = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
    f"import {{ FALLBACK_WLB_2026 }} from '{ROOT}/app/js/lib/campaign.js'; console.log(FALLBACK_WLB_2026)"]))
CAMPAIGN['fields'][0]['label'] = '{{Upload campaign header WLB subject}}'  # as on the live Campaign page

EBIRD_CSV = '\r\n'.join([
    'Submission ID,Common Name,Scientific Name,Taxonomic Order,Count,State/Province,County,Location ID,Location,Latitude,Longitude,Date,Time,Protocol,Duration (Min),All Obs Reported,Distance Traveled (km),Area Covered (ha),Number of Observers,Breeding Code,Observation Details,Checklist Comments,ML Catalog Numbers',
    'S409869220,Purple Heron,Ardea purpurea,1234,1,IN-KL,Kannur,L123,Kattampally,11.9341197,75.3815747,2026-01-12,07:30 AM,eBird - Traveling Count,60,1,2,,1,,"Flying, ""close""",,668752900 668752901',
    'S400000001,Asian Openbill,Anastomus oscitans,500,2,IN-KL,Kannur,L124,Pazhayangadi,12.0,75.3,2025-12-01,04:05 PM,eBird - Stationary Count,30,1,,,1,,,,555000111',
])

OBS = {'id': 5001, 'observed_on': '2026-10-02', 'place_guess': 'Kannur, Kerala, India', 'geojson': {'coordinates': [75.38, 11.93]},
       'positional_accuracy': 20, 'geoprivacy': None, 'taxon_geoprivacy': 'open', 'quality_grade': 'research',
       'taxon': {'id': 4954, 'name': 'Ardea purpurea', 'preferred_common_name': 'Purple Heron', 'rank': 'species'},
       'user': {'login': 'tester', 'name': 'Test User', 'id': 7},
       'photos': [{'id': 901, 'license_code': 'cc-by', 'url': 'https://inaturalist-open-data.s3.amazonaws.com/photos/901/square.jpg'},
                  {'id': 902, 'license_code': 'cc-by-nc', 'url': 'https://inaturalist-open-data.s3.amazonaws.com/photos/902/square.jpg'}]}

uploads, sdc_edits, seen_campaign_titles, oauth_seen, inat_urls = [], [], [], [], []
CAMPAIGNS = {
    'wlb_2026': CAMPAIGN,
    'wle-in_2026': {'enabled': True, 'title': 'Wiki Loves Earth India 2026', 'start': '2026-11-01', 'end': '2026-12-31', 'defaults': {'categories': ['Images from Wiki Loves Earth 2026 in India']}, 'fields': []},
    'wle-in_2020': {'enabled': True, 'title': 'Wiki Loves Earth India 2020', 'start': '2020-05-01', 'end': '2020-05-31', 'defaults': {'categories': ['Images from Wiki Loves Earth 2020 in India']}, 'fields': []},
}

def commons(q, body, ctype):
    if body and ctype.startswith('multipart/'):
        msg = BytesParser(policy=email_policy).parsebytes(b'Content-Type: ' + ctype.encode() + b'\r\n\r\n' + body)
        f = {p.get_param('name', header='content-disposition'): (p.get_content() if not p.get_filename() else p.get_payload(decode=True)) for p in msg.iter_parts()}
        uploads.append({k: (v if isinstance(v, str) else v) for k, v in f.items()})
        return {'upload': {'result': 'Success', 'filename': f['filename']}}
    if body: q = parse_qs(body.decode())
    a = q.get('action', [''])[0]
    if a == 'wbeditentity': sdc_edits.append(q); return {'success': 1}
    if a == 'expandtemplates': return {'expandtemplates': {'wikitext': "'''Subject of the photo''' <span>(choose one)</span>"}}
    if a == 'query':
        if q.get('meta') == ['userinfo']: return {'query': {'userinfo': {'id': 1, 'name': 'Tester', 'rights': ['upload', 'edit', 'createpage'], 'groups': []}}}
        if q.get('meta') == ['tokens']: return {'query': {'tokens': {'csrftoken': 'abc+\\'}}}
        if q.get('list') == ['allpages']:
            prefix = q.get('apprefix', [''])[0].lower()
            return {'query': {'allpages': [{'title': 'Campaign:' + n.replace('_', ' ')} for n in CAMPAIGNS if n.lower().startswith(prefix.replace(' ', '_'))]}}
        if q.get('list') == ['search']: return {'query': {'search': [{'title': 'Campaign:' + n} for n in CAMPAIGNS if q['srsearch'][0].lower() in json.dumps(CAMPAIGNS[n]).lower()]}}
        if q.get('list') == ['allimages']: return {'query': {'allimages': []}}
        if q.get('prop') == ['revisions']:
            seen_campaign_titles.extend(q['titles'][0].split('|'))
            # Commons answers with spaces in titles ("Campaign:wlb 2026"), like the live site
            return {'query': {'pages': [{'title': t.replace('_', ' '), 'revisions': [{'slots': {'main': {'content': json.dumps(CAMPAIGNS[t[9:]])}}}]} if t[9:] in CAMPAIGNS else {'title': t.replace('_', ' '), 'missing': True} for t in q['titles'][0].split('|')]}}
        if 'titles' in q: return {'query': {'pages': [{'title': t, 'pageid': 77} for t in q['titles'][0].split('|')]}}
    return {}

def wikidata(q):
    sr = (q.get('srsearch') or [''])[0]
    if q.get('list'):
        if 'P300=IN-KL' in sr: return {'query': {'search': [{'title': 'Q1186'}]}}
        return {'query': {'search': [{'title': 'Q18871'}] if ('Ardea purpurea' in sr) else []}}
    if q.get('ids') == ['Q1186']: return {'entities': {'Q1186': {'id': 'Q1186', 'labels': {'en': {'value': 'Kerala'}}, 'claims': {}}}}
    return {'entities': {'Q18871': {'id': 'Q18871', 'labels': {'en': {'value': 'Purple Heron'}}, 'claims': {
        'P225': [{'mainsnak': {'datavalue': {'value': 'Ardea purpurea'}}}], 'P3444': [{'mainsnak': {'datavalue': {'value': 'purher1'}}}],
        'P373': [{'mainsnak': {'datavalue': {'value': 'Ardea purpurea'}}}]}}}}

CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, api-user-agent, content-type', 'access-control-allow-methods': 'GET, POST'}

def handle(r):
    u = urlparse(r.url); q = parse_qs(u.query); host = u.netloc
    js = lambda o: r.send(200, 'application/json', json.dumps(o), CORS)
    if r.method == 'OPTIONS': return r.send(204, 'text/plain', '', CORS)
    if host == 'wild2commons.toolforge.org':
        path = SITE / (u.path.lstrip('/') or 'index.html')
        if path.is_dir(): path = path / 'index.html'
        if not path.is_file(): return r.send(404, 'text/plain', 'no')
        types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.zip': 'application/zip', '.json': 'application/json'}
        return r.send(200, types.get(path.suffix, 'application/octet-stream'), path.read_bytes())
    if host.endswith('birds.cornell.edu'): return r.send(200, 'image/jpeg', JPEG)  # thumbnails; no CORS, like the real CDN may be
    if host == 'api.inaturalist.org':
        inat_urls.append(r.url)
        if u.path.startswith('/v1/observations/'): return js({'results': [OBS]})
        if u.path == '/v1/observations': return js({'results': [] if 'id_below' in q else [OBS], 'total_results': 1})
        return js({'results': []})
    if host == 'inaturalist-open-data.s3.amazonaws.com': return r.send(200, 'image/jpeg', JPEG, CORS)
    if host == 'meta.wikimedia.org' and u.path == '/w/rest.php/oauth2/authorize':
        oauth_seen.append(q)
        loc = q['redirect_uri'][0] + '?code=test-code&state=' + q['state'][0]
        return r.send(302, 'text/plain', '', {'Location': loc})
    if host == 'meta.wikimedia.org' and u.path == '/w/rest.php/oauth2/access_token':
        body = parse_qs(r.body.decode()); oauth_seen.append(body)
        ok = body.get('code') == ['test-code'] and body.get('code_verifier') and body.get('client_id') == ['test-client']
        return js({'access_token': 'tok2', 'expires_in': 14400} if ok else {'error': 'invalid_grant'})
    if host == 'www.wikidata.org': return js(wikidata(q))
    if host == 'commons.wikimedia.org' and u.path == '/w/api.php': return js(commons(q, r.body, r.ctype))
    r.send(404, 'text/plain', '')

class Req:
    def __init__(self, h, body):
        self.h, self.body = h, body
        self.url = 'https://%s%s' % (h.headers['Host'], h.path); self.method = h.command; self.ctype = h.headers.get('Content-Type', '')
    def send(self, status, ctype, body, headers=None):
        data = body.encode() if isinstance(body, str) else body
        self.h.send_response(status); self.h.send_header('Content-Type', ctype); self.h.send_header('Content-Length', str(len(data)))
        for k, v in (headers or {}).items(): self.h.send_header(k, v)
        self.h.end_headers(); self.h.wfile.write(data)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def serve(self):
        n = int(self.headers.get('Content-Length') or 0)
        handle(Req(self, self.rfile.read(n) if n else b''))
    do_GET = do_POST = do_OPTIONS = serve
class S(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True
cert = tempfile.mkdtemp()
subprocess.check_call(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', cert + '/k.pem', '-out', cert + '/c.pem', '-days', '2', '-subj', '/CN=mock'], stderr=subprocess.DEVNULL)
server = S(('127.0.0.1', 0), H); sc = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); sc.load_cert_chain(cert + '/c.pem', cert + '/k.pem')
server.socket = sc.wrap_socket(server.socket, server_side=True); PORT = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()

APP = 'https://wild2commons.toolforge.org/'
TOKEN = "sessionStorage.setItem('w2c-oauth', JSON.stringify({accessToken:'tok', expiresAt: Date.now()+3600e3}));" \
        "if (!localStorage.getItem('w2c-settings')) localStorage.setItem('w2c-settings', JSON.stringify({uploadDelaySec:3, reviewFirst:false, oauthClientId:'test-client'}));"
shots = Path('/home/claude/shots'); shots.mkdir(exist_ok=True)
work = Path(tempfile.mkdtemp())
with zipfile.ZipFile(work / 'ebird.zip', 'w', zipfile.ZIP_DEFLATED) as z: z.writestr('MyEBirdData.csv', EBIRD_CSV)
(work / 'ML668752900.jpg').write_bytes(JPEG_A)
(work / 'DSC_0001.JPG').write_bytes(JPEG_B)

failures = []
def check(cond, label):
    print(('ok   ' if cond else 'FAIL ') + label)
    if not cond: failures.append(label)

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chromium', args=[f'--host-resolver-rules=MAP * 127.0.0.1:{PORT}', '--ignore-certificate-errors', '--no-proxy-server'])
    ctx = browser.new_context(ignore_https_errors=True, viewport={'width': 1360, 'height': 900})
    ctx.add_init_script(f"if (location.hostname === 'wild2commons.toolforge.org' && !sessionStorage.getItem('w2c-oauth')) {{ {TOKEN} }}")
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    def wait(expr, timeout=20000):
        try: page.wait_for_function(expr, timeout=timeout)
        except Exception:
            print('TIMEOUT', expr)
            print(page.evaluate("() => ['notice','accountStatus','loadStatus','galleryTitle','progress','warningBody'].map(i => i + ': ' + document.getElementById(i).textContent).join('\\n')"))
            page.screenshot(path=str(shots / 'w2c-timeout.png'), full_page=True); raise
    def upload_and_confirm():
        page.click('#uploadButton')
        try: page.wait_for_selector('#warningDialog[open]', timeout=3000); page.click('#warningGo')
        except Exception: pass

    # ---- iNaturalist, own photos (username typed) ----
    page.goto(APP)
    wait("document.getElementById('commonsUser').textContent.includes('Tester')")
    page.screenshot(path=str(shots / 'w2c-step1.png'), full_page=True)
    check(page.is_visible('.card[data-source=ebird] .promo'), 'eBird card highlights the extension download')
    for name in ('chrome', 'firefox'):
        st = page.evaluate(f"fetch('downloads/wild2commons-{name}.zip').then(r => r.status + ' ' + r.headers.get('content-length'))")
        check(st.startswith('200'), f'{name} extension downloadable from the site ({st})')
    page.click('.card[data-source=inat] button')
    page.fill('#loginInput', 'tester')
    page.click('#toStep2')
    check(page.eval_on_selector_all('#searchForm input[name=batch]', 'r => r.map(x => x.value)') == ['30', '50', '100'], 'batch choices 30 / 50 / 100')
    page.click('#searchForm .segmented label:nth-child(2)')
    page.click('#searchForm button[type=submit]')
    wait("document.querySelectorAll('.tile').length === 2")
    check(any('per_page=50' in u for u in inat_urls), 'batch of 50 requested from iNaturalist')
    page.locator('.tile').first.click()
    page.click('#toStep3')
    wait("document.querySelectorAll('#campaignSelect option').length > 1")
    opts = page.eval_on_selector_all('#campaignSelect option', 'os => os.map(o => o.value)')
    check(opts == ['', 'wlb_2026'], 'campaign list holds only Campaign:wlb_2026 by default: ' + str(opts))
    check(all(t == 'Campaign:wlb_2026' for t in seen_campaign_titles), 'only the listed campaign page is read')
    check(page.evaluate("document.getElementById('campaignSelect').value") == 'wlb_2026', 'wlb_2026 selected although Commons answers "wlb 2026"')
    label = page.inner_text('#campaignFields label')
    check('Subject of the photo' in label and '{{' not in label and '(choose one)' in label, 'campaign question shown as plain text: ' + label.split(chr(10))[0])
    check(page.is_visible('#campaignSearch'), 'campaign search box always visible')
    check('Campaign:wlb_2026' in page.get_attribute('#campaignNote a', 'href'), 'campaign page link uses the page name')
    page.fill('#campaignSearch', 'wle')
    page.click('#campaignSearchButton')
    page.wait_for_selector('#campaignResults .result', timeout=10000)
    results = page.inner_text('#campaignResults')
    page.locator('.settings-col').screenshot(path=str(shots / 'w2c-campaigns.png'))
    check('Wiki Loves Earth India 2026' in results and 'ended 2020-05-31' in results, 'campaign search finds running and ended campaigns')
    page.locator('#campaignResults .result', has_text='India 2026').locator('button').click()
    wait("document.getElementById('campaignSelect').value === 'wle-in_2026'")
    wait("document.getElementById('previewText').textContent.includes('Wiki Loves Earth 2026 in India')")
    check(True, 'added campaign is selected and applied')
    page.locator('#campaignResults .result', has_text='India 2020').locator('button').click()
    wait("document.querySelector('#campaignSelect option[value=\"wle-in_2020\"]') !== null")
    check(page.eval_on_selector('#campaignSelect option[value="wle-in_2020"]', 'o => o.disabled'), 'ended campaign is listed but cannot be chosen')
    page.click('#campaignRemove')
    wait("document.getElementById('campaignSelect').value === ''")
    page.select_option('#campaignSelect', 'wlb_2026')
    page.select_option('#campaignFields select', 'Bird portraits')
    wait("document.getElementById('previewText').textContent.includes('(Bird portraits)')")
    # log out, then Upload: login happens in a popup and the selection stays
    page.click('#logoutButton')
    wait("document.getElementById('commonsUser').textContent === ''")
    with page.expect_popup() as pop: page.click('#uploadButton')
    popup = pop.value
    wait("document.getElementById('commonsUser').textContent.includes('Tester')", 30000)
    check(len(oauth_seen) == 2 and oauth_seen[0]['redirect_uri'] == ['https://wild2commons.toolforge.org/index.html'], 'popup login with callback index.html and PKCE code exchange')
    popup.wait_for_event('close', timeout=10000) if not popup.is_closed() else None
    check(popup.is_closed(), 'login popup closes itself')
    check(page.evaluate("!document.getElementById('step3').hidden") and 'Upload 1' in page.inner_text('#uploadButton'), 'still on step 3 with the selection after logging in')
    upload_and_confirm()
    wait("document.querySelector('#progress li[data-state=done]')", 30000)
    check(len(uploads) == 1 and uploads[0]['filename'] == 'Purple Heron (Ardea purpurea)_iNat5001-901.jpg', 'iNaturalist upload, photo fetched from iNaturalist')
    check(uploads and uploads[0]['file'] == JPEG and uploads[0].get('ignorewarnings') is None, 'original bytes, no ignorewarnings')
    check(len(sdc_edits) == 1, 'structured data written')

    # ---- record link (bookmarklet), username remembered ----
    page.goto(APP + '?url=' + 'https%3A%2F%2Fwww.inaturalist.org%2Fobservations%2F5001')
    wait("!document.getElementById('step3').hidden", 30000)
    check(page.evaluate("document.querySelector('input[name=mode]:checked').value") == 'own', 'record link opens step 3 as own work (remembered username)')

    # ---- eBird: data file + files from the computer ----
    page.goto(APP)
    page.click('.card[data-source=ebird] button')
    page.fill('#authorName', 'Test Birder')
    page.fill('#ebirdUser', 'https://media.ebird.org/catalog?userId=USER506900')
    page.set_input_files('#ebirdData', str(work / 'ebird.zip'))
    wait("document.getElementById('accountStatus').textContent.includes('3 Macaulay Library items')")
    check(True, 'eBird data zip read in the browser')
    page.click('#toStep2')
    page.click('#searchForm button[type=submit]')
    wait("document.querySelectorAll('.tile').length === 3")
    page.set_input_files('#addFiles', [str(work / 'ML668752900.jpg'), str(work / 'DSC_0001.JPG')])
    wait("document.getElementById('loadStatus').textContent.includes('1 file added')")
    check('DSC_0001.JPG' in page.inner_text('#loadStatus'), 'unmatched file reported')
    page.locator('.tile-wrap', has=page.locator('button.tile[data-key=ML555000111]')).locator('input[type=file]').set_input_files(str(work / 'DSC_0001.JPG'))
    wait("document.getElementById('galleryTitle').textContent.includes('2 selected')")
    check(True, 'files attached by number and by "Add file", and selected')
    page.screenshot(path=str(shots / 'w2c-step2-ebird.png'))
    page.click('button.tile[data-key=ML668752901]')  # no file yet
    page.click('#toStep3')
    page.select_option('#campaignFields select', 'Others')
    page.click('#uploadButton')
    page.wait_for_selector('#warningDialog[open]', timeout=5000)
    check('no file yet' in page.inner_text('#warningBody') and page.is_hidden('#warningGo'), 'photo without a file blocks the upload')
    page.click('#warningDialog button[value=back]')
    page.click('.stepper button[data-goto="2"]')
    page.click('button.tile[data-key=ML668752901]')
    page.click('#toStep3')
    page.select_option('#previewSelect', 'ML668752900')
    wait("document.getElementById('previewText').textContent.includes('Kerala')")
    text = page.text_content('#previewText')
    check('ebird.org/species/purher1' in text and 'eBird checklist S409869220' in text, 'eBird species and checklist links')
    check('Kattampally, Kannur, Kerala, India' in text, 'place with state name from Wikidata')
    check('[https://media.ebird.org/catalog?userId=USER506900&mediaType=photo Test Birder]' in text, 'author name and profile link')
    page.screenshot(path=str(shots / 'w2c-step3.png'), full_page=True)
    before = len(uploads)
    upload_and_confirm()
    wait("document.querySelectorAll('#progress li[data-state=done]').length === 2", 60000)
    new = uploads[before:]
    names = sorted(u['filename'] for u in new)
    check(names == ['Asian Openbill (Anastomus oscitans)_ML555000111.jpg', 'Purple Heron (Ardea purpurea)_ML668752900.jpg'], 'eBird file names: ' + ', '.join(names))
    byname = {u['filename']: u for u in new}
    check(byname.get('Purple Heron (Ardea purpurea)_ML668752900.jpg', {}).get('file') == JPEG_A and byname.get('Asian Openbill (Anastomus oscitans)_ML555000111.jpg', {}).get('file') == JPEG_B, 'the added files were uploaded')
    check(not errors, 'no page errors: ' + '; '.join(errors[:5]))
    browser.close()

print('FAILED: ' + ', '.join(failures) if failures else 'ALL PASSED')
sys.exit(1 if failures else 0)
