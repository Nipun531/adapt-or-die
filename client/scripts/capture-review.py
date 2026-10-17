"""Native-resolution review captures of the client via Chrome DevTools Protocol. Usage: python client/scripts/capture-review.py client/.impeccable/review (needs websocket-client, Chrome, API on :4000 with run #2, client on :5173)."""
import base64, json, subprocess, sys, time, urllib.request, os
import websocket

OUT = sys.argv[1]
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9333
prof = os.path.join(os.environ.get("TEMP", "."), "cdp-prof")
proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}", f"--user-data-dir={prof}",
                         "--window-size=1440,900", "--hide-scrollbars", f"--remote-allow-origins=http://127.0.0.1:{PORT}", "about:blank"])
try:
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
            page = [t for t in tabs if t["type"] == "page"][0]
            break
        except Exception:
            time.sleep(0.2)
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30)
    n = [0]
    def cmd(method, **params):
        n[0] += 1
        ws.send(json.dumps({"id": n[0], "method": method, "params": params}))
        while True:
            m = json.loads(ws.recv())
            if m.get("id") == n[0]:
                return m.get("result", m)
    def js(expr):
        return cmd("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
    def shot(name, w=1440, h=900, mobile=False):
        cmd("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=2 if mobile else 1, mobile=mobile)
        time.sleep(0.6)
        r = cmd("Page.captureScreenshot", format="png")
        open(os.path.join(OUT, name), "wb").write(base64.b64decode(r["data"]))
        print("saved", name)
    cmd("Page.enable"); cmd("Runtime.enable")
    cmd("Emulation.setDeviceMetricsOverride", width=1440, height=900, deviceScaleFactor=1, mobile=False)
    cmd("Emulation.setEmulatedMedia", features=[{"name": "prefers-reduced-motion", "value": "reduce"}])
    cmd("Page.navigate", url="http://localhost:5173/#/duel/2"); time.sleep(3)
    click_tab = "(name)=>{const b=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()===name);b&&b.click();window.scrollTo(0,0);return !!b}"
    js("window.scrollTo(0,0)"); shot("desktop.png")
    js(f"({click_tab})('Fight')"); time.sleep(1.2); js("window.scrollTo(0,0)"); shot("desktop-fight.png")
    js(f"({click_tab})('Aftermath')"); time.sleep(1.2); js("window.scrollTo(0,0)"); shot("desktop-aftermath.png")
    js("document.querySelector('.memory').scrollIntoView({block:'start'}); window.scrollBy(0,-76)"); time.sleep(0.5); shot("desktop-aftermath-memory.png")
    js(f"({click_tab})('Prepare')"); time.sleep(1)
    js("[...document.querySelectorAll('.item-card')].find(b=>b.textContent.includes('Rapier')).click()"); time.sleep(1.5)
    js("document.querySelector('.armory').scrollIntoView({block:'start'}); window.scrollBy(0,-76)"); time.sleep(0.5); shot("desktop-armory-preview.png")
    js("document.querySelector('.hand .begin').scrollIntoView({block:'end'})"); time.sleep(0.5); shot("desktop-prepare-hand.png")
    cmd("Page.navigate", url="http://localhost:5173/#/duel/2"); time.sleep(3)
    js("window.scrollTo(0,0)"); shot("mobile.png", 390, 844, True)
    js(f"({click_tab})('Fight')"); time.sleep(1.2); js("document.querySelector('.fight').scrollIntoView({block:'start'}); window.scrollBy(0,-60)"); time.sleep(0.4); shot("mobile-fight.png", 390, 844, True)
    ws.close()
finally:
    proc.terminate()
