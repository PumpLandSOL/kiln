// capture real KILN pages for the demo video (dev server on :8226, DEV_FAUCET=1)
'use strict';
const { open, sleep } = require('./cdp.cjs'); const path = require('path'); const fs = require('fs');
const B = 'http://localhost:' + (process.env.PORT || 8226); const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const W = '0x00000000000000000000000000000000000000a1';
const post = (u, b) => fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
(async () => {
  for (let i = 0; i < 30; i++) { const s = await (await fetch(B + '/api/state')).json(); if (s.chutes.ok) break; await sleep(1000); }
  await post('/api/dev/faucet', { wallet: W, amount: 12 });
  const c = await open(B + '/', 1440, 860, 9561); await sleep(4000);
  const S = async (n, wait = 1200) => { await sleep(wait); await c.shot(path.join(OUT, n + '.png')); console.log(n); };
  await c.ev("localStorage.setItem('kiln_w','" + W + "'); 1");
  await c.send('Page.navigate', { url: B + '/' }); await sleep(4500); await S('01-home');
  await c.ev('window.scrollTo(0, 700); 1'); await S('02-home-2', 900);
  const tabs = ['network', 'lend', 'messages', 'credits'];
  for (let i = 0; i < tabs.length; i++) {
    const on = await c.ev('window.scrollTo(0,0); document.querySelector(\'nav.tabs button[data-view="' + tabs[i] + '"]\').click(); [...document.querySelectorAll(".view.on")].map((s) => s.dataset.view).join(",")');
    console.log('view on:', on); await S('0' + (i + 3) + '-' + tabs[i], 1000);
  }
  c.close();
})().catch((e) => { console.error(e); process.exit(1); });
