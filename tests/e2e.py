"""End-to-end run of the website with the helper extension in Chromium, against a local mock
of every site involved (Toolforge, eBird, Macaulay Library, iNaturalist, Commons, Wikidata).
Usage: node build.mjs && python3 tests/e2e.py"""
import glob, io, json, re, ssl, subprocess, sys, tempfile, threading, http.server, socketserver
from email.parser import BytesParser
from email.policy import default as email_policy
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from PIL import Image
from playwright.sync_api import sync_playwright

UP = '/mnt/user-data/uploads/'
ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'dist/toolforge/public_html'
EXT = ROOT / 'dist/chrome'
read = lambda pat: open(glob.glob(UP + pat)[0], encoding='utf8', errors='replace').read()
strip = lambda h: re.sub(r'<script(?![^>]*__NUXT_DATA__)[^>]*>.*?</script>|<link[^>]*>|<img[^>]*>', '', h, flags=re.S)
MY = strip(read('*My_eBird*'))
ASSET = strip(read('6d31134d-ML668752900*'))
CAT = strip(read('21051c62-Media_Search*'))
buf = io.BytesIO(); Image.new('RGB', (64, 48), (20, 90, 120)).save(buf, 'JPEG'); JPEG = buf.getvalue()
buf = io.BytesIO(); Image.new('RGB', (64, 48), (90, 20, 120)).save(buf, 'JPEG'); JPEG2 = buf.getvalue()

CAMPAIGN = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
    f"import {{ FALLBACK_WLB_2026 }} from '{ROOT}/app/js/lib/campaign.js'; console.log(FALLBACK_WLB_2026)"]))

def asset_html(asset_id):
    html = ASSET.replace('668752900', str(asset_id))
    script = """<script>document.addEventListener('click',e=>{const b=e.target.closest('button');
      if(b&&b.querySelector('.Icon--download')){const a=document.createElement('a');a.href='https://cdn.download.ams.birds.cornell.edu/api/v2/asset/%s/original-test';a.download='x.jpg';document.body.append(a);a.click();}});</script>""" % asset_id
    return html.replace('</body>', script + '</body>')

CATALOG_JS = """<script>let n=0;document.querySelector('.pagination button').addEventListener('click',async()=>{
 n++;const r=await fetch('/mock-search?n='+n);const j=await r.json();
 j.results.forEach(x=>{const a=document.createElement('a');a.className='ResultsGallery-link';a.dataset.assetId=x.catalogId;a.href='https://macaulaylibrary.org/asset/'+x.catalogId;
 document.querySelector('.ResultsGallery-row').append(a)});if(n>=2)document.querySelector('.pagination').remove();});</script>"""

OBS = {'id': 5001, 'observed_on': '2026-10-02', 'place_guess': 'Kannur, Kerala, India', 'geojson': {'coordinates': [75.38, 11.93]},
       'positional_accuracy': 20, 'geoprivacy': None, 'taxon_geoprivacy': 'open', 'quality_grade': 'research',
       'taxon': {'id': 4954, 'name': 'Ardea purpurea', 'preferred_common_name': 'Purple Heron', 'rank': 'species'},
       'user': {'login': 'tester', 'name': 'Test User', 'id': 7},
       'photos': [{'id': 901, 'license_code': 'cc-by', 'url': 'https://inaturalist-open-data.s3.amazonaws.com/photos/901/square.jpg'},
                  {'id': 902, 'license_code': 'cc-by-nc', 'url': 'https://inaturalist-open-data.s3.amazonaws.com/photos/902/square.jpg'}]}

uploads, sdc_edits, seen = [], [], []

def commons(q, body, ctype):
    if body and ctype.startswith('multipart/'):
        msg = BytesParser(policy=email_policy).parsebytes(b'Content-Type: ' + ctype.encode() + b'\r\n\r\n' + body)
        f = {p.get_param('name', header='content-disposition'): (p.get_content() if p.get_content_maintype() == 'text' or not p.get_filename() else p.get_payload(decode=True)) for p in msg.iter_parts()}
        uploads.append({k: (v if isinstance(v, str) else len(v)) for k, v in f.items()})
        return {'upload': {'result': 'Success', 'filename': f['filename']}}
    if body: q = parse_qs(body.decode())
    a = q.get('action', [''])[0]
    if a == 'wbeditentity': sdc_edits.append(q); return {'success': 1}
    if a == 'query':
        if q.get('meta') == ['userinfo']: return {'query': {'userinfo': {'id': 1, 'name': 'Tester', 'rights': ['upload', 'edit', 'createpage'], 'groups': []}}}
        if q.get('meta') == ['tokens']: return {'query': {'tokens': {'csrftoken': 'abc+\\'}}}
        if q.get('list') == ['allpages']: return {'query': {'allpages': [{'title': 'Campaign:wlb_2026'}]}}
        if q.get('list') == ['allimages']: return {'query': {'allimages': []}}
        if q.get('prop') == ['revisions']: return {'query': {'pages': [{'title': 'Campaign:wlb_2026', 'revisions': [{'slots': {'main': {'content': json.dumps(CAMPAIGN)}}}]}]}}
        if 'titles' in q: return {'query': {'pages': [{'title': t, 'pageid': 77} for t in q['titles'][0].split('|')]}}
    return {}

def wikidata(q):
    sr = (q.get('srsearch') or [''])[0]
    if q.get('list'): return {'query': {'search': [{'title': 'Q18871'}] if ('purher1' in sr or 'Ardea purpurea' in sr or 'Booted' in sr or 'P3444' in sr) else []}}
    return {'entities': {'Q18871': {'id': 'Q18871', 'labels': {'en': {'value': 'Purple Heron'}}, 'claims': {
        'P225': [{'mainsnak': {'datavalue': {'value': 'Ardea purpurea'}}}], 'P3444': [{'mainsnak': {'datavalue': {'value': 'purher1'}}}],
        'P373': [{'mainsnak': {'datavalue': {'value': 'Ardea purpurea'}}}]}}}}

CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, api-user-agent, content-type', 'access-control-allow-methods': 'GET, POST'}

def handle(r):
    u = urlparse(r.url); q = parse_qs(u.query); seen.append(r.method + ' ' + r.url)
    html = lambda b: r.send(200, 'text/html', b)
    js = lambda o: r.send(200, 'application/json', json.dumps(o), CORS)
    host = u.netloc
    if r.method == 'OPTIONS': return r.send(204, 'text/plain', '', CORS)
    if host == 'wild2commons.toolforge.org':
        path = SITE / (u.path.lstrip('/') or 'index.html')
        if path.is_dir(): path = path / 'index.html'
        if not path.is_file(): return r.send(404, 'text/plain', 'no')
        types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png'}
        return r.send(200, types.get(path.suffix, 'application/octet-stream'), path.read_bytes())
    if host == 'ebird.org': return html(MY)
    if host == 'media.ebird.org':
        if u.path == '/mock-search':
            n = int(q['n'][0])
            return js({'results': [{'catalogId': 600000 + n * 100 + i, 'userId': 'USER506900', 'mediaType': 'Photo', 'commonName': f'Batch Bird {n}',
                                    'sciName': 'Testus flatus', 'speciesCode': 'tesfla1', 'latitude': 11.2, 'longitude': 75.8, 'locName': 'Kozhikode'} for i in range(30)]})
        return html(CAT.replace('</body>', CATALOG_JS + '</body>'))
    if host == 'macaulaylibrary.org':
        m = re.fullmatch(r'/asset/(\d+)', u.path)
        return html(asset_html(int(m.group(1)))) if m else r.send(404, 'text/plain', '')
    if host.endswith('birds.cornell.edu'): return r.send(200, 'image/jpeg', JPEG2, {'content-disposition': 'attachment; filename=x.jpg', **CORS})
    if host == 'api.inaturalist.org':
        if u.path == '/v1/users/me': return js({'results': [{'login': 'tester', 'name': 'Test User', 'id': 7}]})
        if u.path.startswith('/v1/observations/'): return js({'results': [OBS]})
        if u.path == '/v1/observations': return js({'results': [] if 'id_below' in q else [OBS], 'total_results': 1})
        return js({'results': []})
    if host == 'www.inaturalist.org':
        if u.path == '/users/api_token': return js({'api_token': 'jwt-test'})
        return html('<html><body><h1>Observation</h1></body></html>')
    if host == 'inaturalist-open-data.s3.amazonaws.com': return r.send(200, 'image/jpeg', JPEG, CORS)
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
        try: handle(Req(self, self.rfile.read(n) if n else b''))
        except Exception as e: print('mock error', self.path, e); raise
    do_GET = do_POST = do_OPTIONS = serve
class S(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True
cert = tempfile.mkdtemp()
subprocess.check_call(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', cert + '/k.pem', '-out', cert + '/c.pem', '-days', '2', '-subj', '/CN=mock'], stderr=subprocess.DEVNULL)
server = S(('127.0.0.1', 0), H); sc = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); sc.load_cert_chain(cert + '/c.pem', cert + '/k.pem')
server.socket = sc.wrap_socket(server.socket, server_side=True); PORT = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()

APP = 'https://wild2commons.toolforge.org/'
TOKEN = "sessionStorage.setItem('w2c-oauth', JSON.stringify({accessToken:'tok', expiresAt: Date.now()+3600e3}));" \
        "localStorage.setItem('w2c-settings', JSON.stringify({uploadDelaySec:3, reviewFirst:false}));"
shots = Path('/home/claude/shots'); shots.mkdir(exist_ok=True)
failures = []
def check(cond, label):
    print(('ok   ' if cond else 'FAIL ') + label)
    if not cond: failures.append(label)

with sync_playwright() as p, tempfile.TemporaryDirectory() as tmp:
    ctx = p.chromium.launch_persistent_context(tmp, headless=True, channel='chromium', accept_downloads=True, viewport={'width': 1360, 'height': 900},
        ignore_https_errors=True, args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', f'--host-resolver-rules=MAP * 127.0.0.1:{PORT}', '--ignore-certificate-errors', '--no-proxy-server'])
    ctx.add_init_script(f"if (location.hostname === 'wild2commons.toolforge.org' && !sessionStorage.getItem('w2c-oauth')) {{ {TOKEN} }}")
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    def wait(expr, timeout=20000):
        try: page.wait_for_function(expr, timeout=timeout)
        except Exception:
            print('TIMEOUT', expr)
            print(page.evaluate("() => ['notice','accountStatus','loadStatus','galleryTitle','progress'].map(i => i + ': ' + document.getElementById(i).textContent).join('\\n')"))
            print('errors', errors[:8]); page.screenshot(path=str(shots / 'w2c-timeout.png'), full_page=True)
            raise

    # ---- iNaturalist, own photos ----
    page.goto(APP)
    wait("document.getElementById('commonsUser').textContent.includes('Tester')")
    check(True, 'Commons login shown')
    page.screenshot(path=str(shots / 'w2c-step1.png'), full_page=True)
    page.click('.card[data-source=inat] button')
    wait("document.getElementById('loginInput').value === 'tester'")
    check(True, 'iNaturalist username detected through the extension')
    page.click('#toStep2')
    page.click('#searchForm button[type=submit]')
    wait("document.querySelectorAll('.tile').length === 2")
    check(page.locator('.tile.blocked').count() == 0, 'own photos are selectable even when NC (with warning)')
    page.locator('.tile').first.click()
    page.click('#toStep3')
    wait("document.getElementById('previewText').textContent.includes('{{Information')")
    text = page.text_content('#previewText')
    check('[[Category:Ardea purpurea]]' in text, 'species category from Wikidata')
    check('{{iNaturalistreview}}' in text and '{{iNaturalist|5001}}' in text, 'iNaturalist templates')
    check('Wiki loves Birds India event' in text, 'campaign template from the Campaign page')
    page.select_option('#campaignFields select', 'Bird portraits')
    wait("document.getElementById('previewText').textContent.includes('(Bird portraits)')")
    page.screenshot(path=str(shots / 'w2c-step3.png'), full_page=True)
    page.click('#uploadButton')
    wait("document.querySelector('#progress li[data-state=done]')", 30000)
    check(len(uploads) == 1 and uploads[0]['filename'] == 'Purple Heron (Ardea purpurea)_iNat5001-901.jpg', 'iNaturalist upload file name')
    check(uploads and '(Bird portraits)' in uploads[0]['text'] and uploads[0].get('ignorewarnings') is None, 'upload text and no ignorewarnings')
    check(uploads and uploads[0]['file'] == len(JPEG), 'original file bytes uploaded')
    check(len(sdc_edits) == 1 and sdc_edits[0]['id'] == ['M77'], 'structured data written')
    sdc = json.loads(sdc_edits[0]['data'][0]) if sdc_edits else {}
    check(any(c['mainsnak']['property'] == 'P180' for c in sdc.get('claims', [])), 'depicts in structured data')

    # ---- iNaturalist, someone else's photo from the record button link ----
    page.goto(APP + '?source=inat&record=5001')
    wait("document.getElementById('step3').hidden === false || document.getElementById('loadStatus').textContent.length > 0", 30000)
    check(page.evaluate("!document.getElementById('step3').hidden"), 'deep link opens step 3 with the record selected')

    # ---- extension button on an iNaturalist observation ----
    obs = ctx.new_page(); obs.goto('https://www.inaturalist.org/observations/5001')
    obs.wait_for_selector('#w2c-upload-button', timeout=10000)
    with ctx.expect_page() as opened: obs.click('#w2c-upload-button')
    new = opened.value; new.wait_for_load_state()
    check('source=inat' in new.url and 'record=5001' in new.url, 'record page button opens the app for that record')
    new.close(); obs.close()

    # ---- eBird, own photos through the extension ----
    page.goto(APP)
    page.click('.card[data-source=ebird] button')
    wait("document.getElementById('accountStatus').textContent.includes('USER506900')", 60000)
    check(True, 'eBird account found')
    page.click('#toStep2')
    page.fill('#searchForm input[name=batch]', '60')
    page.click('#searchForm button[type=submit]')
    wait("document.querySelectorAll('.tile').length >= 60", 120000)
    check(True, f"eBird batch of 60 loaded ({page.locator('.tile').count()})")
    page.screenshot(path=str(shots / 'w2c-step2-ebird.png'), full_page=False)
    page.locator('.tile:not(.blocked)').first.click()
    page.click('#toStep3')
    page.select_option('#campaignFields select', 'Others')
    wait("document.getElementById('previewText').textContent.includes('macaulaylibrary.org/asset/')")
    before = len(uploads)
    page.click('#uploadButton')
    page.wait_for_selector('#warningDialog[open]', timeout=10000)
    check('VRT' in page.inner_text('#warningBody'), 'eBird licence note shown before upload')
    page.screenshot(path=str(shots / 'w2c-warning.png'))
    page.click('#warningGo')
    wait("document.querySelector('#progress li[data-state=done], #progress li[data-state=failed]')", 120000)
    check(page.locator('#progress li[data-state=done]').count() == 1, 'eBird upload: ' + page.inner_text('#progress'))
    if len(uploads) > before:
        up = uploads[-1]
        check(re.search(r'_ML\d+\.jpg$', up['filename']) is not None, 'eBird file name ' + up['filename'])
        check(up['file'] == len(JPEG2), 'eBird original captured from "Download original"')
        check('{{own}}<br />First published on eBird' in up['text'] and 'eBird images' in up['text'], 'eBird source and category')
    check(not errors, 'no page errors: ' + '; '.join(errors[:5]))
    ctx.close()

print('FAILED: ' + ', '.join(failures) if failures else 'ALL PASSED')
sys.exit(1 if failures else 0)
