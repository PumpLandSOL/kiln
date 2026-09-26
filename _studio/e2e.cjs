// KILN E2E (dev server, DEV_FAUCET=1, fresh DATA_PATH). Uses Node's built-in WebSocket client as a fake lender and two relay peers.
const B = 'http://localhost:' + (process.env.PORT || 8226), WS = B.replace('http', 'ws');
const A = '0x00000000000000000000000000000000000000a1', L = '0x00000000000000000000000000000000000000b2';
const post = (u, w, b) => fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: w, ...b }) }).then((r) => r.json());
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  · ' + x : '')); if (!c) fails++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sseCollect = async (u, b) => { const r = await fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); if (r.headers.get('content-type').includes('json')) return { json: await r.json() }; const t = await r.text(); const ev = [...t.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => [m[1], JSON.parse(m[2])]); return { toks: ev.filter((e) => e[0] === 'tok').map((e) => e[1].t).join(''), receipt: (ev.find((e) => e[0] === 'receipt') || [])[1], error: (ev.find((e) => e[0] === 'error') || [])[1] }; };
(async () => {
  for (let i = 0; i < 30; i++) { const s = await (await fetch(B + '/api/state')).json(); if (s.chutes.ok && s.chain.ok) break; await sleep(1000); }
  const s0 = await (await fetch(B + '/api/state')).json();
  ok('chutes sealed model list live with prices', s0.chutes.ok && s0.chutes.models.length >= 5 && s0.chutes.models.every((m) => m.inUsd > 0 && m.outUsd > 0), s0.chutes.models.length + ' models, e.g. ' + s0.chutes.models[0].name + ' $' + s0.chutes.models[0].inUsd + ' in');
  ok('chain readout live: 24 blocks, avg ms, tps', s0.chain.ok && s0.chain.blocks.length >= 20 && s0.chain.avgMs > 0, 'block ' + s0.chain.block + ' · ' + Math.round(s0.chain.avgMs) + 'ms · ' + s0.chain.tps.toFixed(1) + ' tps');
  const noKey = await sseCollect('/api/chat/bittensor', { model: s0.chutes.models[0].id, messages: [{ role: 'user', content: 'hi' }] }); ok('bittensor without key or credits is refused politely', noKey.json && /credits|key/.test(noKey.json.error), noKey.json && noKey.json.error);
  const badKey = await sseCollect('/api/chat/bittensor', { model: s0.chutes.models[0].id, messages: [{ role: 'user', content: 'hi' }], key: 'cpk_not_a_real_key_1234567890' }); ok('bad Chutes key surfaces a gateway error', badKey.error && /Chutes 4/.test(badKey.error.error), badKey.error && badKey.error.error);
  // network: fake lender
  await post('/api/dev/faucet', A, { amount: 2 });
  const lend = new WebSocket(WS + '/ws/lend'); await new Promise((r) => lend.addEventListener('open', r)); let hello = null;
  lend.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.type === 'ok') hello = m; if (m.type === 'job') { const words = ['A', 'token', 'is', 'a', 'chunk', 'of', 'text.']; let i = 0; const iv = setInterval(() => { if (i < words.length) lend.send(JSON.stringify({ type: 'tok', id: m.id, t: words[i++] + ' ' })); else { clearInterval(iv); lend.send(JSON.stringify({ type: 'done', id: m.id, tokens: 1500 })); } }, 20); } });
  lend.send(JSON.stringify({ type: 'hello', wallet: L, model: 'Llama-3.2-1B', gpu: 'RTX 4090' })); await sleep(300);
  ok('lender registered', hello && hello.wallet === L, JSON.stringify(hello));
  const ls = await (await fetch(B + '/api/lenders')).json(); ok('lender listed as online', ls.lenders.length === 1 && ls.lenders[0].gpu === 'RTX 4090');
  const off = await sseCollect('/api/chat/network', { wallet: A, lender: '0x00000000000000000000000000000000000000c3', messages: [{ role: 'user', content: 'x' }] }); ok('unknown lender refused', off.json && /not online/.test(off.json.error));
  const r1 = await sseCollect('/api/chat/network', { wallet: A, lender: L, messages: [{ role: 'user', content: 'what is a token' }] });
  ok('network answer streamed from the lender', r1.toks.trim() === 'A token is a chunk of text.', JSON.stringify(r1.toks));
  ok('receipt: 1500 tokens at $0.01/1k = $0.015, lender gets 70%', r1.receipt && near(r1.receipt.usd, 0.015) && near(r1.receipt.lenderUsd, 0.0105), JSON.stringify(r1.receipt));
  const a1 = await post('/api/account', A, {}); ok('asker billed', near(a1.credits, 2 - 0.015) && a1.hist[0].type === 'answer', 'credits ' + a1.credits);
  const l1 = await post('/api/account', L, {}); ok('lender credited 70%', near(l1.earned, 0.0105) && l1.served === 1 && l1.online === true, 'earned ' + l1.earned);
  const wd = await post('/api/withdraw', L, { amount: 1 }); ok('payout below 1 USDG refused', /under 1/.test(wd.error || ''));
  lend.close(); await sleep(300); const ls2 = await (await fetch(B + '/api/lenders')).json(); ok('lender gone after close', ls2.lenders.length === 0);
  // relay: two peers, offline mailbox
  const p1 = new WebSocket(WS + '/ws/relay'); await new Promise((r) => p1.addEventListener('open', r)); const got1 = []; p1.addEventListener('message', (e) => got1.push(JSON.parse(e.data)));
  p1.send(JSON.stringify({ type: 'reg', pub: 'PUB_ONE_abcdefghijklmnopqrstuv' })); await sleep(150);
  p1.send(JSON.stringify({ type: 'send', to: 'PUB_TWO_abcdefghijklmnopqrstuv', box: 'OPAQUE_SEALED_BYTES_1' })); await sleep(150);
  ok('relay queues for an offline key', got1.some((m) => m.type === 'sent' && m.delivered === false));
  const p2 = new WebSocket(WS + '/ws/relay'); await new Promise((r) => p2.addEventListener('open', r)); const got2 = []; p2.addEventListener('message', (e) => got2.push(JSON.parse(e.data)));
  p2.send(JSON.stringify({ type: 'reg', pub: 'PUB_TWO_abcdefghijklmnopqrstuv' })); await sleep(200);
  ok('queued box delivered on register, content opaque', got2.some((m) => m.type === 'msg' && m.box === 'OPAQUE_SEALED_BYTES_1' && m.from === 'PUB_ONE_abcdefghijklmnopqrstuv'), JSON.stringify(got2.map((m) => m.type)));
  p1.send(JSON.stringify({ type: 'send', to: 'PUB_TWO_abcdefghijklmnopqrstuv', box: 'OPAQUE_2' })); await sleep(150);
  ok('live delivery when online', got2.some((m) => m.type === 'msg' && m.box === 'OPAQUE_2') && got1.some((m) => m.type === 'sent' && m.delivered === true));
  p1.close(); p2.close();
  const st = await (await fetch(B + '/api/state')).json(); ok('stats', st.stats.answers === 1 && st.stats.network === 1 && st.stats.relayed === 2, JSON.stringify(st.stats));
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
