#!/usr/bin/env node
/*
 * tools/og/og-image.html → assets/img/og-image.png (1200x630) 로 렌더링합니다.
 * Edge 또는 Chrome 을 헤드리스로 띄워 캡처합니다. (외부 패키지 불필요, 인터넷 필요: 웹폰트)
 *
 *   node tools/og/render.js
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(__dirname, 'og-image.html');
const OUT = path.join(ROOT, 'assets', 'img', 'og-image.png');
const PORT = 9400 + Math.floor(Math.random() * 500);

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];
const browser = CANDIDATES.find((p) => fs.existsSync(p));
if (!browser) { console.error('Edge 또는 Chrome 을 찾을 수 없어요.'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'og-render-'));
  const proc = spawn(browser, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch {}
      if (!target) await sleep(200);
    }
    if (!target) throw new Error('브라우저에 연결하지 못했어요');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const pending = new Map();
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(SRC).href });
    await sleep(1000);
    await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
    await sleep(500);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
    fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
    console.log('저장됨: ' + path.relative(ROOT, OUT));
    ws.close();
  } finally {
    proc.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
})().catch((err) => { console.error(err.message || err); process.exit(1); });
