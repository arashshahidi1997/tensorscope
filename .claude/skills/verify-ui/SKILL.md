---
name: verify-ui
description: Visually verify a TensorScope frontend change in the live app by driving a headless browser — screenshot, console/network errors, and (for canvas/uPlot views) a drawn-pixel check. Use after any frontend edit that affects rendering, because jsdom can't render canvas so "tests pass" never proves a view actually draws.
---

# verify-ui — browser-verify a TensorScope frontend change

jsdom can't render canvas/uPlot (the CLAUDE.md gotcha), so unit tests never
prove a view paints. This skill drives a real headless browser against the live
app to confirm what the user would actually see — turning blind "paste me the
console" loops into direct inspection.

## 0. Prefer the Playwright MCP
If the `playwright` MCP tools are available this session (`browser_navigate`,
`browser_take_screenshot`, `browser_console_messages`, `browser_evaluate`), use
them directly — navigate to `http://127.0.0.1:5173`, screenshot, read console,
and `browser_evaluate` the drawn-pixel check from step 3. If the MCP isn't loaded
(it loads at session start), use the Bash fallback below.

## 1. Make sure the app is up
- Check ports: `pixi run python -c "import socket;[print(p,'open' if socket.socket().connect_ex(('127.0.0.1',p))==0 else 'closed') for p in (5173,8000)]"`
- If down, launch in screen (survives SSH disconnect): `make audit-ui` (real iEEG)
  or `make dev-ui` (demo dataset); wait ~3 s.
- ALWAYS verify against **:5173** (Vite dev, reads live `src/`), NEVER :8000
  (serves the stale `static/` bundle — your change won't be there).

## 2. Drive a headless browser (Bash fallback)
Playwright lives in `/tmp/pwdbg`. If missing, reinstall:
`mkdir -p /tmp/pwdbg && cd /tmp/pwdbg && npm init -y && npm i playwright && npx playwright install chromium`
(run via `pixi run bash -c "…"` so node is 22, not the host's v12).

Write a probe script (adjust the selector/wait for the view under test):

```js
// /tmp/pwdbg/verify.mjs
import { chromium } from 'playwright';
const b = await chromium.launch();                       // headless on gamma2
const p = await b.newPage({ viewport: { width: 1680, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('response', r => { if (/\/api\/v1\//.test(r.url())) errs.push(`[${r.status()}] ${r.url().split('/api/v1')[1]}`); });
await p.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(13000);                            // let slice fetches land
await p.screenshot({ path: '/tmp/pwdbg/page.png' });
const nav = await p.$('.navigator-bar');                  // or the view you changed
if (nav) await nav.screenshot({ path: '/tmp/pwdbg/view.png' });
// Canvas views: confirm pixels were actually painted (the DOM can't show this).
const drawn = await p.evaluate(sel => {
  const c = document.querySelector(sel); if (!c) return 'no-canvas';
  try { const x = c.getContext('2d'); const d = x.getImageData(0,0,c.width,c.height).data;
    let n=0; for (let i=0;i<d.length;i+=4) if (d[i]||d[i+1]||d[i+2]) n++; return n; }
  catch(e){ return 'err:'+e.message; }
}, '.navigator-bar canvas');
console.log(JSON.stringify({ drawnPixels: drawn }));
console.log('LOG/NET:', errs.slice(-15).join(' | ') || '(clean)');
await b.close();
```

Run it, then **Read `/tmp/pwdbg/page.png` and `view.png`** (the Read tool shows images):
`pixi run node /tmp/pwdbg/verify.mjs`

## 3. Interpret + report
- **Read the screenshot** — does the view render what the change intended?
- **`drawnPixels: 0` on a properly-sized canvas** = the chart was created but never
  painted → a lifecycle/sizing bug, NOT missing data. (A non-zero count means it
  drew something; compare before/after for a real diff.)
- **Console errors / non-200 `/api/v1/...`** = data or JS-throw problem.
- Report the screenshot, the drawn-pixel count, and any errors with a one-line diagnosis.

## Gotchas
- Verify on **:5173**, not :8000 (static-bundle shadow).
- All JS tooling via `pixi run` (bare `node` on this host is v12).
- Headless Chromium runs on gamma2 against localhost — no display server, no SSH tunnels.
- Agents can't run the live launcher in the foreground (SIGTERM'd, exit 144) — use the
  `make audit-ui` / `make dev-ui` screen targets, which detach and survive disconnects.
