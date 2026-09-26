'use strict';
const $ = (id) => document.getElementById(id);
const api = (u, b) => fetch(u, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : undefined).then((r) => r.json());
const fmt = (n, d = 2) => (n == null || !isFinite(n)) ? '—' : (+n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const usd = (n) => n == null ? '—' : n === 0 ? 'Free' : n < 0.01 ? '$' + n.toFixed(4) : '$' + fmt(n, 2);
const ago = (ts) => { const s = Math.max(0, (Date.now() - ts) / 1000); return s < 60 ? Math.floor(s) + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h'; };
function toast(m, err) { const t = $('toast'); t.textContent = m; t.className = 'toast on' + (err ? ' err' : ''); clearTimeout(toast._t); toast._t = setTimeout(() => t.className = 'toast', 2800); }

let S = null, A = null, mode = 'bittensor', history = [], busy = false;
let wallet = localStorage.getItem('kiln_w') || '';
let chutesKey = localStorage.getItem('kiln_ck') || '';
const CHAIN_HEX = '0x1237'; const evm = () => window.ethereum || null;
function setConnected() { $('connect').textContent = wallet ? wallet.slice(0, 4) + '…' + wallet.slice(-4) : 'Connect wallet'; }
async function ensureChain(eth) { try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] }); } catch (e) { if (e && e.code === 4902) { try { await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_HEX, chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'], blockExplorerUrls: ['https://explorer.mainnet.chain.robinhood.com'] }] }); } catch (e2) {} } } }
async function connect() { const eth = evm(); if (!eth) { $('wmodal').classList.add('on'); return; } try { const acc = await eth.request({ method: 'eth_requestAccounts' }); if (!acc || !acc.length) throw 0; await ensureChain(eth); wallet = acc[0].toLowerCase(); localStorage.setItem('kiln_w', wallet); setConnected(); toast('connected · Robinhood Chain'); await loadAccount(); } catch (e) { toast('connection cancelled', true); } }
if (window.ethereum && window.ethereum.on) window.ethereum.on('accountsChanged', (acc) => { if (acc && acc.length) { wallet = acc[0].toLowerCase(); localStorage.setItem('kiln_w', wallet); setConnected(); loadAccount(); } });
$('connect').onclick = () => { if (wallet) { wallet = ''; localStorage.removeItem('kiln_w'); A = null; setConnected(); renderAccount(); toast('disconnected'); } else connect(); };
$('wmodal').onclick = (e) => { if (e.target.id === 'wmodal') $('wmodal').classList.remove('on'); };
$('wsave').onclick = async () => { const v = $('waddr').value.trim(); if (!/^0x[a-fA-F0-9]{40}$/.test(v)) return toast('invalid address', true); wallet = v.toLowerCase(); localStorage.setItem('kiln_w', wallet); setConnected(); $('wmodal').classList.remove('on'); await loadAccount(); };
const needWallet = () => { if (!wallet) { connect(); return true; } return false; };

// ---------- router ----------
function go(v) { document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.dataset.view === v)); document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v)); history.replaceState(null, '', v === 'home' ? '/' : '/' + v); window.scrollTo(0, 0); if (v === 'messages') initMessages(); if (v === 'lend') checkGpu(); }
document.querySelectorAll('nav.tabs button').forEach((b) => b.onclick = () => go(b.dataset.view));
document.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => go(b.dataset.go));

// ---------- state ----------
async function loadState() { S = await api('/api/state'); renderState(); }
function renderState() {
  if (!S) return; const C = S.chain, M = S.chutes.models;
  $('live').textContent = (S.chutes.ok ? M.length + ' sealed models' : 'gateway offline') + ' · ' + (C.ok ? 'block ' + C.block.toLocaleString() : 'chain offline');
  $('strip').innerHTML = (M.length ? M.concat(M) : []).map((m) => `<span>${m.name} <b>$${m.inUsd} in · $${m.outUsd} out</b></span>`).join('') || 'reading live prices from Bittensor subnet 64…';
  $('n-sealed').textContent = M.length; $('hero-lab').textContent = 'Powered by Bittensor · ' + M.length + ' sealed models live on subnet 64';
  $('models-tbl').innerHTML = '<tr><th>model</th><th>in / M tokens</th><th>out / M tokens</th><th>in TAO</th><th>context</th><th>quant</th></tr>' + M.map((m) => `<tr><td>${m.name}</td><td>$${m.inUsd}</td><td>$${m.outUsd}</td><td>${m.inTao.toFixed(5)}</td><td>${(m.ctx / 1024).toFixed(0)}k</td><td>${m.quant || '—'}</td></tr>`).join('');
  const sel = $('model'); if (mode === 'bittensor') { const cur = sel.value; sel.innerHTML = M.map((m) => `<option value="${m.id}">${m.name} · $${m.outUsd}/M out</option>`).join(''); if (cur && M.some((m) => m.id === cur)) sel.value = cur; }
  if (mode === 'network') { const cur = sel.value; sel.innerHTML = S.lenders.length ? S.lenders.map((l) => `<option value="${l.wallet}">${l.wallet.slice(0, 6)}…${l.wallet.slice(-4)} · ${l.model} · ${l.gpu}${l.busy ? ' · busy' : ''}</option>`).join('') : '<option value="">no lenders online</option>'; if (cur) sel.value = cur; }
  $('ch-block').textContent = C.ok ? C.block.toLocaleString() : '—'; $('ch-ms').textContent = C.ok ? Math.round(C.avgMs) + ' ms' : '—'; $('ch-tps').textContent = C.ok ? C.tps.toFixed(0) : '—'; $('ch-fee').textContent = C.ok ? C.baseFeeGwei.toFixed(4) + ' gwei' : '—'; $('st-ans').textContent = S.stats.answers;
  const mx = Math.max(1, ...C.blocks.map((b) => b.txs)); $('blocks').innerHTML = C.blocks.map((b) => `<i style="height:${Math.max(4, b.txs / mx * 100)}%" class="${b.txs > mx * .6 ? 'hot' : ''}" title="#${b.n} · ${b.txs} tx"></i>`).join('');
  $('h-share').textContent = Math.round(S.lenderShare * 100) + '%'; $('f-margin').textContent = Math.round(S.margin * 100) + '%'; $('c-margin').textContent = Math.round(S.margin * 100) + '%'; $('f-net').textContent = '$' + S.netPer1k + ' per 1,000 tokens'; $('c-net').textContent = '$' + S.netPer1k + ' / 1,000 tokens';
  $('cr-mode').textContent = S.creditsMode ? 'on' : 'off on this server · use your Chutes key'; $('cr-tre').textContent = S.treasury.slice(0, 8) + '…' + S.treasury.slice(-6); $('cr-min').textContent = S.minDeposit + ' USDG';
  if (S.mint) { $('cabar').style.display = 'flex'; $('ca-mint').textContent = S.mint; }
  $('lenders').innerHTML = S.lenders.length ? S.lenders.map((l) => `<div class="lender"><span class="dot ${l.busy ? 'busy' : ''}"></span><b>${l.wallet.slice(0, 8)}…${l.wallet.slice(-6)}</b><span>${l.model}</span><span style="color:var(--ash)">${l.gpu}</span><span style="margin-left:auto;font-family:'JetBrains Mono';font-size:12px">${l.served} served · earned ${usd(l.earned)}</span><button class="btn sm" data-pick="${l.wallet}">Use</button></div>`).join('') : '<p style="color:var(--ash)">No GPUs online right now. <a href="#" data-go2="lend">Be the first to lend one →</a></p>';
  $('lenders').querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { setMode('network'); $('model').value = b.dataset.pick; go('home'); toast('next question goes to ' + b.dataset.pick.slice(0, 8) + '…'); });
  $('lenders').querySelectorAll('[data-go2]').forEach((a) => a.onclick = (e) => { e.preventDefault(); go(a.dataset.go2); });
  $('feed').innerHTML = S.feed.map((e) => `<div class="r"><span>${ago(e.ts)}</span><span>${e.type === 'answer' ? `${e.mode} · ${e.model} · ${e.tokens} tokens${e.lender ? ' · ' + e.lender.slice(0, 6) + '…' : ''}` : e.type === 'lend' ? `${e.lender.slice(0, 6)}… went online with ${e.model} on ${e.gpu}` : e.type}</span></div>`).join('') || '<div class="r"><span>—</span><span>quiet kiln</span></div>';
}

// ---------- chat ----------
function setMode(m) { mode = m; document.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m)); if (m === 'private') { $('model').innerHTML = PRIV.map((p) => `<option value="${p.id}">${p.name} · ${p.size}</option>`).join(''); $('model').value = privId; } renderState(); }
document.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { setMode(b.dataset.mode); if (b.classList.contains('btn')) $('q').focus(); });
const PRIV = [{ id: 'SmolLM2-360M-Instruct-q4f16_1-MLC', name: 'SmolLM2 360M', size: '380 MB' }, { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 1B', size: '880 MB' }, { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen2.5 1.5B', size: '1.6 GB' }];
let privId = PRIV[1].id, engine = null, engineId = '', webllm = null, gpuName = '';
async function gpuInfo() { if (!navigator.gpu) return ''; try { const ad = await navigator.gpu.requestAdapter(); if (!ad) return ''; const info = ad.info || (ad.requestAdapterInfo ? await ad.requestAdapterInfo() : {}); return (info.description || info.device || info.vendor || 'WebGPU device').trim(); } catch (e) { return 'WebGPU device'; } }
async function getEngine(id, onProg) {
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser. Use Chrome or Edge on a machine with a GPU.');
  if (!webllm) webllm = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm');
  if (engine && engineId === id) return engine;
  if (engine) { try { await engine.unload(); } catch (e) {} }
  engine = await webllm.CreateMLCEngine(id, { initProgressCallback: (p) => onProg && onProg(p) }); engineId = id; gpuName = gpuName || await gpuInfo(); return engine;
}
function addMsg(cls, text) { const d = document.createElement('div'); d.className = 'm ' + cls; d.textContent = text; $('msgs').appendChild(d); $('msgs').scrollTop = 1e9; return d; }
function addReceipt(r) { const d = document.createElement('div'); d.className = 'rc'; d.innerHTML = `<b>${r.model}</b> on ${r.ranOn}. ${r.tokens} tokens at ${r.tps.toFixed(0)} tokens/s. <b>${r.usd == null ? 'Free' : usd(r.usd)}</b>${r.billed ? ', ' + r.billed : ''}${r.lenderUsd != null ? ' · lender keeps ' + usd(r.lenderUsd) : ''}${r.note ? ' · ' + r.note : ''}`; $('msgs').appendChild(d); $('msgs').scrollTop = 1e9; }
function heat(el, tok) { const s = document.createElement('span'); s.className = 'w hot'; s.textContent = tok; el.appendChild(s); requestAnimationFrame(() => setTimeout(() => s.classList.remove('hot'), 40)); $('msgs').scrollTop = 1e9; }
async function ask() {
  const q = $('q').value.trim(); if (!q || busy) return; $('q').value = ''; busy = true; addMsg('u', q); history.push({ role: 'user', content: q }); const a = addMsg('a', ''); let out = '';
  try {
    if (mode === 'private') {
      $('load').style.display = ''; const eng = await getEngine($('model').value, (p) => { $('load-t').textContent = p.text; $('load-b').style.width = Math.round((p.progress || 0) * 100) + '%'; }); $('load').style.display = 'none';
      const t0 = Date.now(); let first = 0, n = 0; const st = await eng.chat.completions.create({ messages: history.slice(-12), stream: true, max_tokens: 400, temperature: 0.7 });
      for await (const ch of st) { const t = ch.choices[0].delta.content || ''; if (t) { if (!first) first = Date.now(); out += t; n++; heat(a, t); } }
      const name = PRIV.find((p) => p.id === $('model').value).name; addReceipt({ model: name, ranOn: 'your GPU' + (gpuName ? ' (' + gpuName + ')' : '') + ', in private mode', tokens: n, tps: n / Math.max(0.2, (Date.now() - first) / 1000), usd: null, note: 'Nothing left this tab.' });
    } else {
      const url = mode === 'bittensor' ? '/api/chat/bittensor' : '/api/chat/network';
      const body = mode === 'bittensor' ? { wallet: wallet || undefined, key: chutesKey || undefined, model: $('model').value, messages: history.slice(-16) } : { wallet, lender: $('model').value, messages: history.slice(-16) };
      if (mode === 'network' && needWallet()) throw new Error('connect a wallet for the network');
      if (mode === 'bittensor' && !chutesKey && !wallet) { connect(); throw new Error('connect a wallet for credits, or save a Chutes key on the Credits page'); }
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if ((r.headers.get('content-type') || '').includes('json')) { const j = await r.json(); throw new Error(j.error || 'refused'); }
      const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /event: (\w+)/.exec(blk), dt = /data: (.*)/.exec(blk); if (!ev || !dt) continue; const d = JSON.parse(dt[1]); if (ev[1] === 'tok') { out += d.t; heat(a, d.t); } else if (ev[1] === 'receipt') { addReceipt(d); if (d.creditsLeft != null && A) { A.credits = d.creditsLeft; renderAccount(); } } else if (ev[1] === 'error') throw new Error(d.error); } }
    }
    history.push({ role: 'assistant', content: out });
  } catch (e) { if (!out) a.remove(); const s = document.createElement('div'); s.className = 'sys'; s.textContent = e.message || String(e); $('msgs').appendChild(s); history.pop(); $('load').style.display = 'none'; }
  busy = false;
}
$('send').onclick = ask; $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });

// ---------- mine ----------
let lendWs = null, lendEngine = null, lendOn = false, served = 0;
async function checkGpu() { $('l-gpu').textContent = navigator.gpu ? (await gpuInfo() || 'available') : 'not available (use Chrome or Edge)'; $('l-addr').textContent = wallet ? wallet.slice(0, 8) + '…' + wallet.slice(-6) : 'connect a wallet'; }
function llog(t) { const d = document.createElement('div'); d.className = 'r'; d.innerHTML = `<span>${new Date().toISOString().slice(11, 19)}</span><span>${t}</span>`; $('l-log').prepend(d); }
$('l-go').onclick = async () => {
  if (lendOn) { lendOn = false; try { lendWs.send(JSON.stringify({ type: 'bye' })); lendWs.close(); } catch (e) {} $('l-state').textContent = 'offline'; $('l-go').textContent = 'Load model and go online'; $('l-gauge').style.width = '0'; llog('went offline'); return; }
  if (needWallet()) return; if (!navigator.gpu) return toast('WebGPU is not available in this browser', true);
  const id = $('l-model').value; $('l-load').style.display = ''; $('l-go').disabled = true;
  try { lendEngine = await getEngine(id, (p) => { $('l-load-t').textContent = p.text; $('l-load-b').style.width = Math.round((p.progress || 0) * 100) + '%'; }); } catch (e) { $('l-go').disabled = false; $('l-load').style.display = 'none'; return toast(e.message, true); }
  $('l-load').style.display = 'none'; $('l-go').disabled = false;
  const name = PRIV.find((p) => p.id === id).name; const gpu = gpuName || 'WebGPU';
  lendWs = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/lend');
  lendWs.onopen = () => { lendWs.send(JSON.stringify({ type: 'hello', wallet, model: name, gpu })); lendOn = true; $('l-state').textContent = 'online · ' + name; $('l-go').textContent = 'Go offline'; llog('online with ' + name + ' on ' + gpu); };
  lendWs.onclose = () => { if (lendOn) { lendOn = false; $('l-state').textContent = 'disconnected'; $('l-go').textContent = 'Load model and go online'; llog('connection closed'); } };
  lendWs.onmessage = async (e) => { const m = JSON.parse(e.data);
    if (m.type === 'ok') { $('l-served').textContent = m.served; $('l-earned').textContent = usd(m.earned); }
    if (m.type === 'job') { llog('job ' + m.id + ' · ' + m.messages.length + ' messages'); $('l-gauge').style.width = '100%'; let n = 0; const t0 = Date.now();
      try { const st = await lendEngine.chat.completions.create({ messages: m.messages, stream: true, max_tokens: 350, temperature: 0.7 }); for await (const ch of st) { const t = ch.choices[0].delta.content || ''; if (t) { n++; lendWs.send(JSON.stringify({ type: 'tok', id: m.id, t })); } } lendWs.send(JSON.stringify({ type: 'done', id: m.id, tokens: n, ms: Date.now() - t0 })); served++; $('l-served').textContent = served; llog('answered in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's · ' + n + ' tokens'); loadAccount(); }
      catch (err) { lendWs.send(JSON.stringify({ type: 'fail', id: m.id, why: err.message })); llog('failed: ' + err.message); }
      $('l-gauge').style.width = '8%'; }
  };
};

// ---------- sealed messages (X25519 + HKDF + AES-GCM, padded) ----------
const b64 = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
let myKeys = null, myPub = '', contacts = JSON.parse(localStorage.getItem('kiln_contacts') || '[]'), threads = JSON.parse(localStorage.getItem('kiln_threads') || '{}'), cur = '', relayWs = null;
const PAD = 256;
async function makeKeys() { const kp = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']); const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)); const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey); localStorage.setItem('kiln_sk', JSON.stringify(jwk)); return { kp, pub: b64(raw) }; }
async function loadKeys() { const j = localStorage.getItem('kiln_sk'); if (j) { try { const jwk = JSON.parse(j); const priv = await crypto.subtle.importKey('jwk', jwk, { name: 'X25519' }, true, ['deriveBits']); const pubJwk = { kty: 'OKP', crv: 'X25519', x: jwk.x }; const pub = await crypto.subtle.importKey('jwk', pubJwk, { name: 'X25519' }, true, []); const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pub)); return { kp: { privateKey: priv, publicKey: pub }, pub: b64(raw) }; } catch (e) {} } return makeKeys(); }
async function sharedKey(theirPub) { const their = await crypto.subtle.importKey('raw', unb64(theirPub), { name: 'X25519' }, false, []); const bits = await crypto.subtle.deriveBits({ name: 'X25519', public: their }, myKeys.kp.privateKey, 256); const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('kiln-sealed-v1'), info: new TextEncoder().encode([myPub, theirPub].sort().join('|')) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
async function seal(theirPub, text) { const k = await sharedKey(theirPub); const pt = new TextEncoder().encode(text); if (pt.length > PAD - 2) throw new Error('keep it under ' + (PAD - 2) + ' bytes'); const padded = new Uint8Array(PAD); padded[0] = pt.length >> 8; padded[1] = pt.length & 255; padded.set(pt, 2); const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, padded)); const box = new Uint8Array(12 + ct.length); box.set(iv); box.set(ct, 12); return b64(box); }
async function open(theirPub, boxB64) { const k = await sharedKey(theirPub); const box = unb64(boxB64); const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.slice(0, 12) }, k, box.slice(12))); const n = (padded[0] << 8) | padded[1]; return new TextDecoder().decode(padded.slice(2, 2 + n)); }
async function safety(theirPub) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode([myPub, theirPub].sort().join('|')))); let s = ''; for (let i = 0; i < 12; i++) { const v = ((h[i * 2] << 8) | h[i * 2 + 1]) % 100000; s += String(v).padStart(5, '0'); } return s.match(/.{5}/g); }
async function initMessages() {
  if (!myKeys) { myKeys = await loadKeys(); myPub = myKeys.pub; } $('my-pub').textContent = myPub; renderContacts(); connectRelay();
}
function connectRelay() { if (relayWs && relayWs.readyState <= 1) return; relayWs = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/relay'); relayWs.onopen = () => relayWs.send(JSON.stringify({ type: 'reg', pub: myPub })); relayWs.onmessage = async (e) => { const m = JSON.parse(e.data); if (m.type === 'msg') { try { const text = await open(m.from, m.box); pushThread(m.from, { me: false, text, ts: m.ts }); if (!contacts.some((c) => c.pub === m.from)) { contacts.push({ pub: m.from, name: 'unknown ' + m.from.slice(0, 6) }); saveContacts(); renderContacts(); } if (cur === m.from) renderThread(); else toast('sealed note from ' + (contacts.find((c) => c.pub === m.from) || {}).name); } catch (err) { toast('a box arrived that this key cannot open', true); } } if (m.type === 'sent') $('relay-sees').textContent = `from ${myPub.slice(0, 6)}… to ${m.to.slice(0, 6)}… · ${new Date().toLocaleTimeString()} · ${m.delivered ? 'delivered' : 'held until they come online'} · box ${12 + PAD + 16} bytes, same as every note`; }; relayWs.onclose = () => setTimeout(connectRelay, 3000); }
const saveContacts = () => localStorage.setItem('kiln_contacts', JSON.stringify(contacts)); const saveThreads = () => localStorage.setItem('kiln_threads', JSON.stringify(threads));
function pushThread(pub, m) { (threads[pub] = threads[pub] || []).push(m); if (threads[pub].length > 200) threads[pub].shift(); saveThreads(); }
function renderContacts() { $('contacts').innerHTML = contacts.map((c) => `<div class="contact" style="cursor:pointer" data-c="${c.pub}"><span>${c.name}</span><b>${c.pub.slice(0, 10)}…</b><span style="margin-left:auto;color:var(--dust);font-size:11px">${(threads[c.pub] || []).length} notes</span></div>`).join('') || '<p style="color:var(--dust);font-size:13px">No contacts yet.</p>'; $('contacts').querySelectorAll('[data-c]').forEach((el) => el.onclick = async () => { cur = el.dataset.c; $('t-name').textContent = (contacts.find((c) => c.pub === cur) || {}).name; $('safety').innerHTML = (await safety(cur)).map((g) => `<span>${g}</span>`).join(''); renderThread(); }); }
function renderThread() { $('thread').innerHTML = (threads[cur] || []).map((m) => `<div class="msg ${m.me ? 'me' : 'them'}">${m.text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}<small>${new Date(m.ts).toLocaleTimeString()}</small></div>`).join('') || '<p style="color:var(--dust);font-size:13px">Nothing yet. Say hello.</p>'; $('thread').scrollTop = 1e9; }
$('c-add').onclick = () => { const p = $('c-pub').value.trim(), n = $('c-name').value.trim() || 'contact'; if (p.length < 20 || p === myPub) return toast('paste a valid key', true); if (!contacts.some((c) => c.pub === p)) contacts.push({ pub: p, name: n }); saveContacts(); renderContacts(); $('c-pub').value = ''; $('c-name').value = ''; toast('added'); };
$('m-send').onclick = async () => { const t = $('m-in').value.trim(); if (!t || !cur) return toast(cur ? 'write something' : 'pick a contact', true); try { const box = await seal(cur, t); relayWs.send(JSON.stringify({ type: 'send', to: cur, box })); pushThread(cur, { me: true, text: t, ts: Date.now() }); $('m-in').value = ''; renderThread(); } catch (e) { toast(e.message, true); } };
$('m-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('m-send').onclick(); });
$('pub-copy').onclick = () => { navigator.clipboard.writeText(myPub); toast('key copied'); }; $('pub-new').onclick = async () => { if (!confirm('A new key means old notes cannot be opened and contacts must re-add you. Continue?')) return; myKeys = await makeKeys(); myPub = myKeys.pub; $('my-pub').textContent = myPub; try { relayWs.close(); } catch (e) {} connectRelay(); toast('new key'); };

// ---------- credits / account ----------
async function loadAccount() { if (!wallet) { A = null; renderAccount(); return; } A = await api('/api/account', { wallet }); if (A.error) { toast(A.error, true); A = null; } renderAccount(); }
function renderAccount() {
  $('cr-bal').textContent = A ? usd(A.credits) : '—'; $('cr-earn').textContent = A ? usd(A.earned - A.paidOut) + ' available' : '—';
  $('cr-hist').innerHTML = A && A.hist.length ? A.hist.map((h) => `<div class="r"><span>${ago(h.ts)}</span><span>${h.type}${h.mode ? ' · ' + h.mode : ''}${h.model ? ' · ' + h.model : ''}${h.tokens ? ' · ' + h.tokens + ' tok' : ''} · ${usd(h.usd)}</span></div>`).join('') : '<div class="r"><span>—</span><span>nothing yet</span></div>';
  $('cr-queue').innerHTML = A && A.queue.length ? A.queue.map((q) => `<div class="row"><span>payout ${fmt(q.amt, 2)} USDG · ${q.id}</span><b>${q.status === 'paid' ? 'paid' + (q.tx ? ' · ' + q.tx.slice(0, 10) + '…' : '') : 'queued'}</b></div>`).join('') : '';
  if (A) { $('l-served').textContent = A.served; $('l-earned').textContent = usd(A.earned); } $('ck').value = chutesKey ? chutesKey.slice(0, 8) + '…' : '';
}
$('ck-save').onclick = () => { const v = $('ck').value.trim(); if (v.length < 10 || v.includes('…')) return toast('paste the full key', true); chutesKey = v; localStorage.setItem('kiln_ck', v); renderAccount(); toast('key saved in this browser'); };
$('ck-clear').onclick = () => { chutesKey = ''; localStorage.removeItem('kiln_ck'); renderAccount(); toast('key forgotten'); };
$('cr-credit').onclick = async () => { if (needWallet()) return; const r = await api('/api/deposit', { wallet, tx: ($('cr-tx').value || '').trim() }); if (r.error) return toast(r.error, true); A = r; renderAccount(); toast(`credited ${fmt(r.amt, 2)} USDG`); };
$('cr-wdgo').onclick = async () => { if (needWallet()) return; const r = await api('/api/withdraw', { wallet, amount: +$('cr-wd').value }); if (r.error) return toast(r.error, true); A = r; renderAccount(); toast('payout queued'); };
$('cr-send').onclick = async () => {
  if (needWallet()) return; const amount = +$('cr-in').value; const minDep = (S && S.minDeposit) || 5; if (!amount || amount < minDep) return toast('minimum top-up is ' + minDep + ' USDG', true);
  const eth = evm(); if (!eth) return toast('open a wallet to send USDG, or paste a tx hash', true);
  try { await ensureChain(eth); const units = BigInt(Math.round(amount * 1e6)).toString(16).padStart(64, '0'); const data = '0xa9059cbb' + S.treasury.slice(2).toLowerCase().padStart(64, '0') + units;
    const tx = await eth.request({ method: 'eth_sendTransaction', params: [{ from: wallet, to: S.chain.usdg, data }] }); toast('sent · waiting for the receipt…');
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 3000)); const r = await api('/api/deposit', { wallet, tx }); if (r.ok) { A = r; renderAccount(); return toast(`credited ${fmt(r.amt, 2)} USDG`); } if (r.error && !/pending|not found/.test(r.error)) return toast(r.error, true); }
    toast('still pending — paste the hash to credit later', true); } catch (e) { toast('transaction cancelled', true); }
};
$('ca-copy').onclick = () => { navigator.clipboard.writeText(S.mint); toast('copied'); };

// ---------- boot ----------
(async function () { setConnected(); await loadState(); await loadAccount(); setMode('bittensor'); const p = location.pathname.slice(1); if (['lend', 'network', 'messages', 'credits'].includes(p)) go(p); setInterval(loadState, 8000); })();
