"""End-to-end run with the optional extension installed: eBird photos load automatically.
Chromium + dist/chrome against a local HTTPS mock built from saved eBird / Macaulay Library pages.
Usage: node build.mjs && python3 tests/e2e_extension.py"""
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
b = io.BytesIO(); Image.new('RGB', (64, 48), (90, 20, 120)).save(b, 'JPEG'); ORIGINAL = b.getvalue()
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

uploads, sdc = [], []
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, api-user-agent, content-type', 'access-control-allow-methods': 'GET, POST'}

def commons(q, body, ctype):
    if body and ctype.startswith('multipart/'):
        msg = BytesParser(policy=email_policy).parsebytes(b'Content-Type: ' + ctype.encode() + b'\r\n\r\n' + body)
        f = {p.get_param('name', header='content-disposition'): (p.get_content() if not p.get_filename() else p.get_payload(decode=True)) for p in msg.iter_parts()}
        uploads.append(f); return {'upload': {'result': 'Success', 'filename': f['filename']}}
    if body: q = parse_qs(body.decode())
    a = q.get('action', [''])[0]
    if a == 'wbeditentity': sdc.append(q); return {'success': 1}
    if a == 'query':
        if q.get('meta') == ['userinfo']: return {'query': {'userinfo': {'id': 1, 'name': 'Tester', 'rights': ['upload', 'edit', 'createpage']}}}
        if q.get('meta') == ['tokens']: return {'query': {'tokens': {'csrftoken': 'abc+\\'}}}
        if q.get('list') == ['allimages']: return {'query': {'allimages': []}}
        if q.get('prop') == ['revisions']: return {'query': {'pages': [{'title': 'Campaign:wlb_2026', 'revisions': [{'slots': {'main': {'content': json.dumps(CAMPAIGN)}}}]}]}}
        if 'titles' in q: return {'query': {'pages': [{'title': t, 'pageid': 77} for t in q['titles'][0].split('|')]}}
    return {}

def handle(r):
    u = urlparse(r.url); q = parse_qs(u.query); host = u.netloc
    js = lambda o: r.send(200, 'application/json', json.dumps(o), CORS)
    html = lambda b: r.send(200, 'text/html', b)
    if r.method == 'OPTIONS': return r.send(204, 'text/plain', '', CORS)
    if host == 'wild2commons.toolforge.org':
        path = SITE / (u.path.lstrip('/') or 'index.html')
        if path.is_dir(): path = path / 'index.html'
        if not path.is_file(): return r.send(404, 'text/plain', 'no')
        types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.zip': 'application/zip', '.json': 'application/json'}
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
    if host.endswith('birds.cornell.edu'): return r.send(200, 'image/jpeg', ORIGINAL, {'content-disposition': 'attachment; filename=x.jpg', **CORS})
    if host == 'www.wikidata.org':
        if q.get('list'): return js({'query': {'search': [{'title': 'Q1'}]}})
        return js({'entities': {'Q1': {'id': 'Q1', 'labels': {'en': {'value': 'Booted Eagle'}}, 'claims': {'P225': [{'mainsnak': {'datavalue': {'value': 'Hieraaetus pennatus'}}}], 'P373': [{'mainsnak': {'datavalue': {'value': 'Hieraaetus pennatus'}}}]}}}})
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
        except (BrokenPipeError, ConnectionResetError): pass
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
    def wait(expr, timeout=20000):
        try: page.wait_for_function(expr, timeout=timeout)
        except Exception:
            print('TIMEOUT', expr)
            print(page.evaluate("() => ['notice','accountStatus','loadStatus','galleryTitle','progress'].map(i => i + ': ' + document.getElementById(i).textContent).join('\\n')"))
            page.screenshot(path=str(shots / 'ext-timeout.png'), full_page=True); raise

    page.goto(APP)
    wait("document.getElementById('versionLabel').textContent.includes('connected')")
    check(page.locator('.card[data-source=ebird] .promo').count() == 0 and 'load automatically' in page.inner_text('.card[data-source=ebird]'), 'eBird card says the extension is installed')
    page.click('.card[data-source=ebird] button')
    wait("document.getElementById('accountStatus').textContent.includes('USER506900')", 60000)
    check(page.is_hidden('#ebirdFields'), 'eBird account found automatically; data file not needed')
    page.click('#toStep2')
    page.click('#searchForm .segmented label:nth-child(2)')
    page.click('#searchForm button[type=submit]')
    wait("document.querySelectorAll('.tile').length >= 50", 120000)
    check(True, f"eBird photos loaded automatically, batch of 50 ({page.locator('.tile').count()})")
    check(page.is_hidden('#dropHint'), 'no "add files" needed with the extension')
    page.locator('.tile:not(.blocked)').first.click()
    page.click('#toStep3')
    page.select_option('#campaignFields select', 'Others')
    wait("document.getElementById('previewText').textContent.includes('macaulaylibrary.org/asset/')")
    page.click('#uploadButton')
    try: page.wait_for_selector('#warningDialog[open]', timeout=5000); page.click('#warningGo')
    except Exception: pass
    wait("document.querySelector('#progress li[data-state=done], #progress li[data-state=failed]')", 120000)
    check(page.locator('#progress li[data-state=done]').count() == 1, 'eBird upload: ' + page.inner_text('#progress'))
    check(bool(uploads) and uploads[-1]['file'] == ORIGINAL, 'original fetched through the extension')
    page.goto(APP + 'install.html')
    page.wait_for_function("document.getElementById('extStatus').classList.contains('ok')", timeout=10000)
    check('is installed' in page.inner_text('#extStatus'), 'install page detects the extension')
    check(not errors, 'no page errors: ' + '; '.join(errors[:5]))
    ctx.close()

print('FAILED: ' + ', '.join(failures) if failures else 'ALL PASSED')
sys.exit(1 if failures else 0)
