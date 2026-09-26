// tiny CDP helper over headless Chrome (no deps)
'use strict';
const { spawn } = require('child_process'); const os = require('os'); const path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(url, W, H, PORT) {
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${W},${H}`, `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', `--user-data-dir=${path.join(os.tmpdir(), 'hushcdp_' + PORT + '_' + Date.now())}`, url], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {} await sleep(200); }
  const p = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const ev = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).then((r) => r.result && r.result.value);
  const shot = async (file, fmt = 'png') => { const s = await send('Page.captureScreenshot', { format: fmt, quality: 94 }); require('fs').writeFileSync(file, Buffer.from(s.data, 'base64')); };
  return { send, ev, shot, close: () => { try { ws.close(); } catch {} chrome.kill(); } };
}
module.exports = { open, sleep };
