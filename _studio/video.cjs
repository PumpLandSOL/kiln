// deterministic video render: node video.cjs <scene.html> <out.mp4> <seconds>. Seeks window.__seek(t) per frame, encodes locked 30fps
'use strict';
const { execFile } = require('child_process'); const { promisify } = require('util'); const fs = require('fs'); const path = require('path');
const { open, sleep } = require('./cdp.cjs'); const pexec = promisify(execFile);
const [, , scene, outName, durS] = process.argv; const W = 1280, H = 720, FPS = 30, DUR = +durS;
const OUT = path.join(__dirname, '..', 'brand', outName); const FR = path.join(__dirname, 'frames-' + path.basename(scene, '.html'));
(async () => {
  fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR);
  const c = await open('file:///' + path.join(__dirname, 'src', scene).split(path.sep).join('/'), W, H, 9500 + Math.floor(Math.random() * 400));
  try {
    await sleep(2500); await c.ev('document.fonts.ready.then(()=>1)'); await c.ev('Promise.resolve(window.__ready).then(()=>1)');
    for (let f = 0; f < FPS * DUR; f++) { await c.ev(`window.__seek(${(f / FPS).toFixed(4)})`); await c.shot(path.join(FR, `f_${String(f).padStart(4, '0')}.jpg`), 'jpeg'); if (f % 90 === 0) console.log('frame', f); }
  } finally { c.close(); }
  await pexec('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(FR, 'f_%04d.jpg'), '-vf', 'format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', OUT], { maxBuffer: 1 << 26 });
  fs.rmSync(FR, { recursive: true, force: true }); console.log('OK', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
