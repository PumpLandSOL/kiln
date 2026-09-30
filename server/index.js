// KLIN — private compute, fired in a sealed oven. Paid on Robinhood Chain.
//   Three ways to run a model: on Bittensor subnet 64 through the Chutes gateway (sealed hardware, the miner can't read
//   your words), on a GPU someone lends from their browser tab (the network), or on your own GPU inside your browser (private,
//   free, nothing leaves the tab). Lenders mine from a browser tab and keep LENDER_SHARE of what each answer costs.
//   Credits are bought with real USDG on Robinhood Chain, verified against the receipt. Sealed messages between wallets are
//   encrypted on-device; this relay only ever carries the sealed box. Dependency-free Node.
'use strict';
const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');

const PORT = process.env.PORT || 8226;
const ROOT = path.join(__dirname, '..');
const DATA_PATH = process.env.DATA_PATH || path.join(ROOT, 'data.json');
const KLIN_MINT = process.env.KLIN_MINT || '';
const TREASURY = (process.env.TREASURY || '0x580Aa9df627A396F32aE649EC427a4Cb430a5eD2');   // USDG credit top-ups are verified against this address
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const CHUTES_KEY = process.env.CHUTES_API_KEY || '';          // operator key used when people pay with KLIN credits
const MARGIN = +(process.env.MARGIN || 0.20);                  // on top of Chutes' price when paying with credits
const NET_PER_1K = +(process.env.NET_PER_1K || 0.01);          // USD per 1,000 tokens on a lent GPU
const LENDER_SHARE = +(process.env.LENDER_SHARE || 0.70);      // of NET price, to the lender
const MIN_DEPOSIT = +(process.env.MIN_DEPOSIT || 5);           // USDG
const MAILBOX_MAX = 200;

const isWallet = (s) => /^0x[a-fA-F0-9]{40}$/.test(s || '');
const num = (v, max) => { const x = Math.floor((+v || 0) * 1e6) / 1e6; return x > 0 ? Math.min(x, max == null ? x : max) : 0; };
const id8 = () => crypto.randomBytes(6).toString('base64url');

// ---------- ledger ----------
let db = { v: 1, wallets: {}, txs: {}, treasuryIn: { usdg: 0, n: 0 }, queue: [], stats: { answers: 0, tokens: 0, paidUsd: 0, lenderUsd: 0, marginUsd: 0, bittensor: 0, network: 0, relayed: 0 }, mailbox: {}, feed: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'))); } catch (e) {}
let saveT = null; function save() { if (saveT) return; saveT = setTimeout(() => { saveT = null; try { fs.writeFileSync(DATA_PATH, JSON.stringify(db)); } catch (e) {} }, 800); }
function W(a) { a = a.toLowerCase(); return db.wallets[a] || (db.wallets[a] = { credits: 0, deposited: 0, spent: 0, earned: 0, paidOut: 0, served: 0, hist: [] }); }
const hist = (w, e) => { w.hist.unshift({ ts: Date.now(), ...e }); if (w.hist.length > 100) w.hist.pop(); };
const feed = (e) => { db.feed.unshift({ ts: Date.now(), ...e }); if (db.feed.length > 60) db.feed.pop(); };

// ---------- Robinhood Chain: USDG deposits + live readout ----------
const USDG = { addr: (process.env.USDG_ADDR || '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168').toLowerCase(), dec: 6 };
const RPCS = (process.env.RH_RPCS || 'https://rpc.mainnet.chain.robinhood.com').split(',');
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const CHAIN = { ok: false, block: 0, treasuryUsdg: 0, lastRead: 0, blocks: [], avgMs: 0, tps: 0, baseFeeGwei: 0 };
const hexToNum = (h, dec) => { if (!h || h === '0x') return 0; const bi = BigInt(h); const d = 10n ** BigInt(dec || 18); return Number(bi / d) + Number(bi % d) / Number(d); };
async function rpc(method, params) {
  let err; for (const u of RPCS) { try { const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 8000);
    const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ac.signal }); clearTimeout(tm);
    const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; } catch (e) { err = e; } }
  throw err || new Error('rpc');
}
const balOf = (token, dec, who) => rpc('eth_call', [{ to: token, data: '0x70a08231' + who.slice(2).padStart(64, '0') }, 'latest']).then((r) => hexToNum(r, dec));
async function pollChain() {
  try {
    const latest = await rpc('eth_getBlockByNumber', ['latest', false]); const n = Number(BigInt(latest.number)); CHAIN.block = n;
    const want = []; for (let i = 23; i >= 0; i--) want.push(n - i);
    const have = new Map(CHAIN.blocks.map((b) => [b.n, b]));
    const fetched = await Promise.all(want.map((k) => have.get(k) ? have.get(k) : rpc('eth_getBlockByNumber', ['0x' + k.toString(16), false]).then((b) => ({ n: k, txs: (b.transactions || []).length, ts: Number(BigInt(b.timestamp)) * 1000, gas: Number(BigInt(b.gasUsed || '0x0')), fee: hexToNum(b.baseFeePerGas || '0x0', 9) })).catch(() => null)));
    CHAIN.blocks = fetched.filter(Boolean); const bs = CHAIN.blocks; if (bs.length > 2) { const span = (bs[bs.length - 1].ts - bs[0].ts) || 1; CHAIN.avgMs = Math.max(50, span / (bs.length - 1)); CHAIN.tps = bs.reduce((a, b) => a + b.txs, 0) / (span / 1000 || 1); }
    CHAIN.baseFeeGwei = hexToNum(latest.baseFeePerGas || '0x0', 9); CHAIN.treasuryUsdg = await balOf(USDG.addr, USDG.dec, TREASURY); CHAIN.ok = true; CHAIN.lastRead = Date.now();
  } catch (e) { CHAIN.ok = false; }
}
setInterval(pollChain, 15000); pollChain();
async function creditDeposit(w, txHash) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash || '')) throw 'paste the transaction hash';
  txHash = txHash.toLowerCase(); if (db.txs[txHash]) throw 'already credited';
  const [tx, rc] = await Promise.all([rpc('eth_getTransactionByHash', [txHash]), rpc('eth_getTransactionReceipt', [txHash])]);
  if (!tx) throw 'tx not found'; if (!rc) throw 'pending — try again in a few seconds'; if (rc.status !== '0x1') throw 'tx reverted';
  if ((tx.from || '').toLowerCase() !== w) throw 'tx not from your wallet';
  let amt = 0;
  for (const lg of rc.logs || []) { if ((lg.address || '').toLowerCase() !== USDG.addr || lg.topics[0] !== TRANSFER_TOPIC) continue; const from = '0x' + lg.topics[1].slice(26), to = '0x' + lg.topics[2].slice(26); if (from.toLowerCase() === w && to.toLowerCase() === TREASURY.toLowerCase()) amt += hexToNum(lg.data, USDG.dec); }
  if (!(amt > 0)) throw 'no USDG transfer to the treasury in this tx';
  if (amt < MIN_DEPOSIT) throw 'minimum top-up is ' + MIN_DEPOSIT + ' USDG — this transfer (' + amt.toFixed(2) + ') is not credited';
  const u = W(w); u.credits += amt; u.deposited += amt; db.txs[txHash] = { w, amt, block: Number(BigInt(rc.blockNumber)), ts: Date.now() }; db.treasuryIn.usdg += amt; db.treasuryIn.n++; hist(u, { type: 'top-up', usd: amt }); save();
  return { amt, tx: txHash };
}

// ---------- Bittensor subnet 64 via Chutes: live sealed model list + prices ----------
const CHUTES = { models: [], at: 0, ok: false };
async function pollChutes() {
  try { const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 12000); const r = await fetch('https://llm.chutes.ai/v1/models', { signal: ac.signal, headers: { accept: 'application/json' } }); clearTimeout(tm); const j = await r.json();
    const list = (j.data || []).filter((m) => m.confidential_compute && m.price && m.price.input && m.price.output).map((m) => ({ id: m.id, name: m.id.split('/').pop().replace(/-TEE$/, ''), inUsd: m.price.input.usd, outUsd: m.price.output.usd, inTao: m.price.input.tao, outTao: m.price.output.tao, ctx: m.context_length, quant: m.quantization, features: m.supported_features || [] }));
    if (list.length) { CHUTES.models = list; CHUTES.at = Date.now(); CHUTES.ok = true; }
  } catch (e) { CHUTES.ok = false; }
}
setInterval(pollChutes, 5 * 60000); pollChutes();
const modelOf = (id) => CHUTES.models.find((m) => m.id === id);

// stream a Chutes chat completion to the client as SSE. Bills credits (with margin) when no user key is given.
async function chatBittensor(req, res, d) {
  const m = modelOf(String(d.model || '')); if (!m) return json(res, 200, { error: 'pick a sealed model from the live list' });
  const msgs = Array.isArray(d.messages) ? d.messages.slice(-24).map((x) => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: String(x.content || '').slice(0, 8000) })) : [];
  if (!msgs.length) return json(res, 200, { error: 'say something' });
  const userKey = typeof d.key === 'string' && d.key.length > 10 ? d.key.trim() : '';
  let w = null; if (!userKey) { if (!CHUTES_KEY) return json(res, 200, { error: 'credits mode is not switched on for this server yet — paste your own Chutes key' }); if (!isWallet(d.wallet)) return json(res, 200, { error: 'connect a wallet, or paste a Chutes key' }); w = W(d.wallet); if (w.credits <= 0.0005) return json(res, 200, { error: 'no credits — top up on the Credits page, or paste a Chutes key' }); }
  sse(res); const t0 = Date.now(); let out = '', usage = null, first = 0;
  try {
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 120000);
    const r = await fetch('https://llm.chutes.ai/v1/chat/completions', { method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (userKey || CHUTES_KEY) }, body: JSON.stringify({ model: m.id, messages: msgs, stream: true, max_tokens: Math.min(2048, +d.maxTokens || 700), temperature: 0.7, stream_options: { include_usage: true } }) });
    if (!r.ok) { const t = await r.text().catch(() => ''); clearTimeout(tm); send(res, 'error', { error: 'Chutes ' + r.status + (r.status === 401 ? ': key rejected' : r.status === 402 ? ': that account is out of balance' : '') + (t ? ' · ' + t.slice(0, 120) : '') }); return res.end(); }
    const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    while (true) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line.startsWith('data:')) continue; const p = line.slice(5).trim(); if (p === '[DONE]') continue;
        try { const j = JSON.parse(p); const dl = j.choices && j.choices[0] && j.choices[0].delta; if (dl && dl.content) { if (!first) first = Date.now(); out += dl.content; send(res, 'tok', { t: dl.content }); } if (j.usage) usage = j.usage; } catch (e) {} } }
    clearTimeout(tm);
  } catch (e) { send(res, 'error', { error: 'the gateway dropped the stream' }); return res.end(); }
  const ms = Date.now() - t0; const pt = usage ? usage.prompt_tokens : estTok(msgs.map((x) => x.content).join(' ')), ct = usage ? usage.completion_tokens : estTok(out);
  const base = pt * m.inUsd / 1e6 + ct * m.outUsd / 1e6; const cost = userKey ? base : base * (1 + MARGIN);
  if (w) { w.credits = Math.max(0, w.credits - cost); w.spent += cost; db.stats.marginUsd += base * MARGIN; hist(w, { type: 'answer', mode: 'bittensor', model: m.name, tokens: pt + ct, usd: cost }); }
  db.stats.answers++; db.stats.bittensor++; db.stats.tokens += pt + ct; db.stats.paidUsd += cost; feed({ type: 'answer', mode: 'bittensor', model: m.name, tokens: ct }); save();
  send(res, 'receipt', { mode: 'bittensor', model: m.name, ranOn: 'Bittensor subnet 64 (Chutes), sealed hardware', promptTokens: pt, tokens: ct, tps: ct / Math.max(0.2, (Date.now() - (first || t0)) / 1000), ms, usd: cost, billed: userKey ? 'your Chutes account' : 'KLIN credits', creditsLeft: w ? w.credits : null }); res.end();
}
const estTok = (s) => Math.max(1, Math.round(String(s).length / 4));

// ---------- the network: GPUs lent from a browser tab ----------
//   lender: WebSocket /ws/lend  -> {type:'hello', wallet, model, gpu}   receives {type:'job', id, model, messages}   sends {type:'tok', id, t} … {type:'done', id, tokens, ms} | {type:'fail', id, why}
//   asker : POST /api/chat/network {wallet, lender, messages} -> SSE
const lenders = new Map();   // wallet -> { sock, model, gpu, since, busy, served }
const jobs = new Map();      // id -> { res, wallet, lender, t0, first, out }
function lenderList() { return [...lenders.entries()].map(([wallet, l]) => ({ wallet, model: l.model, gpu: l.gpu, since: l.since, busy: l.busy, served: l.served, earned: W(wallet).earned })); }
async function chatNetwork(req, res, d) {
  if (!isWallet(d.wallet)) return json(res, 200, { error: 'connect a wallet to use the network' }); const w = W(d.wallet);
  const lw = String(d.lender || '').toLowerCase(); const L = lenders.get(lw); if (!L) return json(res, 200, { error: 'that lender is not online' }); if (L.busy) return json(res, 200, { error: 'that GPU is busy — try another lender' });
  if (w.credits <= 0.0005) return json(res, 200, { error: 'no credits — top up on the Credits page' });
  const msgs = Array.isArray(d.messages) ? d.messages.slice(-16).map((x) => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: String(x.content || '').slice(0, 4000) })) : []; if (!msgs.length) return json(res, 200, { error: 'say something' });
  const id = id8(); sse(res); L.busy = true; jobs.set(id, { res, wallet: d.wallet.toLowerCase(), lender: lw, t0: Date.now(), first: 0, out: '', model: L.model });
  wsSend(L.sock, { type: 'job', id, model: L.model, messages: msgs });
  const timer = setTimeout(() => finishJob(id, { fail: 'the lender did not answer in time' }), 90000); jobs.get(id).timer = timer;
}
function finishJob(id, r) {
  const j = jobs.get(id); if (!j) return; jobs.delete(id); clearTimeout(j.timer); const L = lenders.get(j.lender); if (L) L.busy = false;
  if (r.fail) { send(j.res, 'error', { error: r.fail }); return j.res.end(); }
  const tokens = r.tokens || estTok(j.out); const cost = tokens / 1000 * NET_PER_1K; const toLender = cost * LENDER_SHARE;
  const w = W(j.wallet); w.credits = Math.max(0, w.credits - cost); w.spent += cost; hist(w, { type: 'answer', mode: 'network', model: j.model, tokens, usd: cost, lender: j.lender });
  const lw = W(j.lender); lw.earned += toLender; lw.served++; hist(lw, { type: 'served', tokens, usd: toLender, asker: j.wallet }); if (L) L.served++;
  db.stats.answers++; db.stats.network++; db.stats.tokens += tokens; db.stats.paidUsd += cost; db.stats.lenderUsd += toLender; feed({ type: 'answer', mode: 'network', model: j.model, tokens, lender: j.lender }); save();
  send(j.res, 'receipt', { mode: 'network', model: j.model, ranOn: 'a lent ' + (L ? L.gpu : 'GPU') + ' · ' + j.lender.slice(0, 6) + '…' + j.lender.slice(-4), tokens, tps: tokens / Math.max(0.2, (Date.now() - (j.first || j.t0)) / 1000), ms: Date.now() - j.t0, usd: cost, lenderUsd: toLender, billed: 'KLIN credits', creditsLeft: w.credits }); j.res.end();
}

// ---------- sealed-message relay: carries opaque boxes between public keys, never plaintext ----------
const relay = new Map();   // pub -> Set<sock>
function relayDeliver(to, msg) { const set = relay.get(to); if (set && set.size) { for (const s of set) wsSend(s, msg); return true; } const box = db.mailbox[to] || (db.mailbox[to] = []); box.push(msg); if (box.length > MAILBOX_MAX) box.shift(); save(); return false; }

// ---------- websocket (hand-rolled) ----------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function wsFrame(str) { const p = Buffer.from(str); const L = p.length; let h; if (L < 126) h = Buffer.from([0x81, L]); else if (L < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(L, 2); } else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(L), 2); } return Buffer.concat([h, p]); }
function wsSend(sock, obj) { try { sock.write(wsFrame(JSON.stringify(obj))); } catch (e) {} }
function wsParse(sock, onMsg) {   // decodes masked client frames; handles fragments, ping, close
  let buf = Buffer.alloc(0);
  sock.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) { const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80; let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (masked) off += 4; if (buf.length < off + len) return; const mask = masked ? buf.slice(off - 4, off) : null; const data = Buffer.from(buf.slice(off, off + len)); if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3]; buf = buf.slice(off + len);
      if (op === 8) { try { sock.end(); } catch (e) {} return; } if (op === 9) { try { sock.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); } catch (e) {} continue; } if (op === 1 && fin) { try { onMsg(JSON.parse(data.toString())); } catch (e) {} } }
  });
}
const server = http.createServer(handle);
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key']; const u = req.url.split('?')[0]; if (!key || !/^\/ws\/(lend|relay)$/.test(u)) return sock.destroy();
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + GUID).digest('base64') + '\r\n\r\n');
  let me = null; sock.on('error', () => {});
  if (u === '/ws/lend') {
    wsParse(sock, (m) => {
      if (m.type === 'hello' && isWallet(m.wallet)) { me = m.wallet.toLowerCase(); const old = lenders.get(me); if (old && old.sock !== sock) { try { old.sock.end(); } catch (e) {} } lenders.set(me, { sock, model: String(m.model || '').slice(0, 60), gpu: String(m.gpu || 'GPU').slice(0, 60), since: Date.now(), busy: false, served: 0 }); W(me); wsSend(sock, { type: 'ok', wallet: me, earned: W(me).earned, served: W(me).served }); feed({ type: 'lend', lender: me, gpu: m.gpu, model: m.model }); }
      else if (m.type === 'tok' && jobs.has(m.id)) { const j = jobs.get(m.id); if (j.lender !== me) return; if (!j.first) j.first = Date.now(); j.out += String(m.t || ''); send(j.res, 'tok', { t: m.t }); }
      else if (m.type === 'done' && jobs.has(m.id)) { if (jobs.get(m.id).lender !== me) return; finishJob(m.id, { tokens: +m.tokens || 0 }); }
      else if (m.type === 'fail' && jobs.has(m.id)) { if (jobs.get(m.id).lender !== me) return; finishJob(m.id, { fail: 'the lender could not run that: ' + String(m.why || '').slice(0, 80) }); }
      else if (m.type === 'bye' && me) { lenders.delete(me); }
    });
    sock.on('close', () => { if (me && lenders.get(me) && lenders.get(me).sock === sock) lenders.delete(me); for (const [id, j] of jobs) if (j.lender === me) finishJob(id, { fail: 'the lender went offline' }); });
  } else {
    wsParse(sock, (m) => {
      if (m.type === 'reg' && typeof m.pub === 'string' && m.pub.length > 20 && m.pub.length < 200) { me = m.pub; if (!relay.has(me)) relay.set(me, new Set()); relay.get(me).add(sock); const q = db.mailbox[me] || []; delete db.mailbox[me]; wsSend(sock, { type: 'ok', pub: me, queued: q.length }); for (const x of q) wsSend(sock, x); if (q.length) save(); }
      else if (m.type === 'send' && me && typeof m.to === 'string' && typeof m.box === 'string' && m.box.length < 20000) { const delivered = relayDeliver(m.to, { type: 'msg', from: me, to: m.to, box: m.box, ts: Date.now() }); db.stats.relayed++; wsSend(sock, { type: 'sent', to: m.to, delivered }); }
    });
    sock.on('close', () => { if (me && relay.get(me)) { relay.get(me).delete(sock); if (!relay.get(me).size) relay.delete(me); } });
  }
});

// ---------- http ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4', '.wasm': 'application/wasm' };
function serve(req, res) { let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/' || /^\/(chat|lend|messages|credits|network)$/.test(u)) u = '/client/index.html'; const f = path.normalize(path.join(ROOT, u)); if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end('no'); } fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' }); res.end(b); }); }
function json(res, c, o) { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); }
function sse(res) { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); }
function send(res, ev, o) { try { res.write('event: ' + ev + '\ndata: ' + JSON.stringify(o) + '\n\n'); } catch (e) {} }
function body(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 2e5) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (e) { r({}); } }); }); }
function account(addr) { const w = W(addr); return { wallet: addr.toLowerCase(), credits: w.credits, deposited: w.deposited, spent: w.spent, earned: w.earned, paidOut: w.paidOut, served: w.served, hist: w.hist.slice(0, 40), queue: db.queue.filter((q) => q.wallet === addr.toLowerCase()).slice(0, 10), online: lenders.has(addr.toLowerCase()) }; }
function state() { return { gov: 'KLIN', mint: KLIN_MINT, treasury: TREASURY, minDeposit: MIN_DEPOSIT, margin: MARGIN, netPer1k: NET_PER_1K, lenderShare: LENDER_SHARE, creditsMode: !!CHUTES_KEY, chutes: { ok: CHUTES.ok, at: CHUTES.at, models: CHUTES.models }, lenders: lenderList(), chain: { ok: CHAIN.ok, block: CHAIN.block, avgMs: CHAIN.avgMs, tps: CHAIN.tps, baseFeeGwei: CHAIN.baseFeeGwei, treasuryUsdg: CHAIN.treasuryUsdg, blocks: CHAIN.blocks.map((b) => ({ n: b.n, txs: b.txs, gas: b.gas })), usdg: USDG.addr }, stats: db.stats, relayOnline: relay.size, feed: db.feed.slice(0, 30), t: Date.now() }; }

async function handle(req, res) {
  const u = req.url.split('?')[0];
  if (req.method === 'GET') { if (u === '/api/state') return json(res, 200, state()); if (u === '/api/models') return json(res, 200, { ok: CHUTES.ok, at: CHUTES.at, models: CHUTES.models }); if (u === '/api/lenders') return json(res, 200, { lenders: lenderList() }); return serve(req, res); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  const d = await body(req);
  if (u === '/api/chat/bittensor') return chatBittensor(req, res, d);
  if (u === '/api/chat/network') return chatNetwork(req, res, d);
  if (!isWallet(d.wallet || '')) return json(res, 200, { error: 'connect a Robinhood Chain wallet' });
  const addr = d.wallet.toLowerCase(); const w = W(addr);
  if (u === '/api/account') return json(res, 200, account(addr));
  if (u === '/api/deposit') { try { const r = await creditDeposit(addr, d.tx); return json(res, 200, { ok: true, ...r, ...account(addr) }); } catch (e) { return json(res, 200, { error: String(e.message || e) }); } }
  if (u === '/api/dev/faucet' && process.env.DEV_FAUCET === '1') { w.credits += num(d.amount) || 0; save(); return json(res, 200, { ok: true, ...account(addr) }); }   // LOCAL TESTING ONLY
  if (u === '/api/withdraw') { const avail = w.earned - w.paidOut; const x = num(d.amount, avail); if (x < 1) return json(res, 200, { error: avail < 1 ? 'earnings under 1 USDG so far' : 'minimum 1 USDG' }); w.paidOut += x; const q = { id: id8(), wallet: addr, amt: x, asset: 'USDG', ts: Date.now(), status: 'queued', tx: null }; db.queue.unshift(q); if (db.queue.length > 500) db.queue.pop(); hist(w, { type: 'payout', usd: x }); save(); return json(res, 200, { ok: true, queued: q, ...account(addr) }); }
  if (u === '/api/admin/queue') { if (!ADMIN_KEY || d.key !== ADMIN_KEY) return json(res, 200, { error: 'no' }); return json(res, 200, { ok: true, queue: db.queue.slice(0, 100), deposits: Object.entries(db.txs).map(([tx, t]) => ({ tx, ...t })).slice(-50) }); }
  if (u === '/api/admin/paid') { if (!ADMIN_KEY || d.key !== ADMIN_KEY) return json(res, 200, { error: 'no' }); const q = db.queue.find((x) => x.id === d.id); if (!q) return json(res, 200, { error: 'no such item' }); q.status = 'paid'; q.tx = d.tx || null; q.paidTs = Date.now(); save(); return json(res, 200, { ok: true, q }); }
  json(res, 404, { error: 'unknown route' });
}
server.listen(PORT, () => console.log('KLIN · private compute · Robinhood Chain · :' + PORT + (CHUTES_KEY ? ' · credits mode on' : ' · credits mode off (no CHUTES_API_KEY)')));
