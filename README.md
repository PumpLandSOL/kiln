# KILN — private compute, fired in a sealed oven

Run open models three ways: on **Bittensor subnet 64** through the Chutes gateway (sealed hardware; the miner can't read your words), on a **GPU someone lends from their browser tab** (the network), or on **your own GPU in-browser via WebGPU** (private mode, free, nothing leaves the tab). Mine with your GPU from a tab and keep 70%. Send sealed messages between wallets (X25519 + HKDF + AES-GCM, padded; the relay only carries the box). Pay per token with USDG credits verified on Robinhood Chain.

Dependency-free Node (needs Node 22+ for the built-in WebSocket client used by tests). `npm start` (port 8226). Local dev with faucet: `node _studio/dev.js`. Tests: `_studio/e2e.cjs` on a fresh `DATA_PATH`.

Env: `CHUTES_API_KEY` (turns on credits mode for Bittensor answers), `MARGIN` (0.20), `NET_PER_1K` (0.01), `LENDER_SHARE` (0.70), `MIN_DEPOSIT` (5 USDG), `KILN_MINT`, `TREASURY`, `ADMIN_KEY`, `DATA_PATH`.

Routes: GET /api/state, /api/models, /api/lenders · POST /api/chat/bittensor (SSE), /api/chat/network (SSE), /api/account, /api/deposit, /api/withdraw, /api/admin/* · WS /ws/lend, /ws/relay.
