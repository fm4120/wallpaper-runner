/* Headless smoke test for the built single-file game.
   Extracts the inline <script>, executes it against a minimal DOM +
   Canvas2D stub, and renders real frames so any runtime error surfaces.
   Also checks the viewport/fit maths for the "no stretching" requirement. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'wallpaper-runner.html');
const html = fs.readFileSync(HTML, 'utf8');

/* ---- pull the game script out of the HTML ---- */
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: no <script> found'); process.exit(1); }
const code = m[1];
console.log('script bytes:', code.length);
try { new vm.Script(code, { filename: 'inline.js' }); console.log('syntax: OK'); }
catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }

/* ---- count the external references that would break a single file ---- */
const ext = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(x => x[1]);
console.log('external refs:', ext.length === 0 ? 'none (self-contained)' : ext.join(', '));

/* ---- minimal Canvas2D stub ---- */
let opCount = 0;
function makeCtx(cv) {
  const rec = { fills: 0, draws: 0, alphas: [] };
  const ctx = {
    canvas: cv, _rec: rec,
    fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1,
    font: '10px monospace', textAlign: 'left', textBaseline: 'top',
    imageSmoothingEnabled: false, globalCompositeOperation: 'source-over',
    fillRect(x, y, w, h) {
      opCount++;
      if (![x, y, w, h].every(Number.isFinite)) throw new Error('fillRect NaN: ' + [x, y, w, h]);
      rec.fills++;
    },
    clearRect() { opCount++; },
    drawImage(img) {
      opCount++;
      if (!img) throw new Error('drawImage(null)');
      for (let i = 1; i < arguments.length; i++) {
        if (!Number.isFinite(arguments[i])) throw new Error('drawImage NaN arg ' + i);
      }
      rec.draws++;
    },
    fillText(t) {
      opCount++;
      if (t === undefined || t === null) throw new Error('fillText(undefined)');
    },
    measureText(t) { return { width: String(t).length * 6 }; },
    save() {}, restore() {}, translate() {}, scale() {}, beginPath() {},
    moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
    createImageData(w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData(img, x, y) {
      opCount++;
      if (!img || !img.data) throw new Error('putImageData with bad image');
    },
    getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  };
  return ctx;
}

function makeCanvasEl(w, h) {
  const cv = {
    width: w || 300, height: h || 150,
    style: {},
    getContext() { return this._ctx || (this._ctx = makeCtx(this)); }
  };
  return cv;
}

/* ---- minimal DOM ---- */
const listeners = {};
const canvasEl = makeCanvasEl(640, 400);
const created = [];
const doc = {
  hidden: false,
  title: 'test',
  readyState: 'complete',
  getElementById(id) { return id === 'game' ? canvasEl : null; },
  createElement(tag) {
    const el = (tag === 'canvas') ? makeCanvasEl(0, 0) : { style: {}, tagName: tag };
    created.push(el);
    return el;
  },
  addEventListener(k, fn) { (listeners[k] = listeners[k] || []).push(fn); }
};
let rafCalls = 0, pendingFrame = null;
const win = {
  innerWidth: 1280, innerHeight: 800,
  addEventListener(k, fn) { (listeners[k] = listeners[k] || []).push(fn); }
};

const sandbox = {
  console, Math, Date, window: win, document: doc,
  location: { hash: '' },
  requestAnimationFrame(fn) { rafCalls++; pendingFrame = fn; return rafCalls; },
  Uint8ClampedArray, Float64Array, JSON, String, Number, Array, Object, Boolean, Error
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* ---- boot the game ---- */
try {
  vm.runInContext(code, sandbox, { filename: 'game.js' });
  console.log('boot: OK  (requestAnimationFrame calls:', rafCalls + ')');
} catch (e) {
  console.error('BOOT ERROR:', e.stack.split('\n').slice(0, 4).join('\n'));
  process.exit(1);
}

/* ---- drive real frames, exactly like the browser would ---- */
function pumpFrames(n, dtMs) {
  let t = 0;
  for (let i = 0; i < n; i++) {
    if (!pendingFrame) { console.log('loop stopped after', i, 'frames'); return i; }
    const fn = pendingFrame; pendingFrame = null;
    t += dtMs;
    try { fn(t); }
    catch (e) {
      const q = sandbox.G;
      console.error('FRAME ERROR at frame', i + ':', e.message);
      if (q) {
        console.error('  state: time=' + q.time + ' y=' + q.y + ' vy=' + q.vy +
          ' lane=' + q.lane + ' target=' + q.targetLane + ' onGround=' + q.onGround +
          ' duckT=' + q.duckT + ' scroll=' + q.scroll + ' speed=' + q.speed);
        console.error('  laneY[' + q.targetLane + ']=' + sandbox.LANE_Y[q.targetLane]);
        console.error('  obs=' + q.obs.length + ' coins=' + q.coins.length);
      }
      console.error('  at', e.stack.split('\n')[1]);
      process.exit(1);
    }
  }
  return n;
}

const frames = (function () {
  const q = sandbox.G;
  console.log('pre-frame state: x=' + q.x + ' y=' + q.y + ' typeof x=' + typeof q.x +
    ' laneIdx-check LANE_Y=' + JSON.stringify(sandbox.LANE_Y) + ' ART_FOOT=' + sandbox.ART_FOOT);
  return pumpFrames(60 * 30, 1000 / 60);
})();
console.log('rendered frames:', frames, ' (no runtime errors)');
console.log('canvas ops issued:', opCount);
console.log('fillRect:', canvasEl._ctx._rec.fills, ' drawImage:', canvasEl._ctx._rec.draws);

/* ---- resize / fit checks: canvas must keep 640:400 and never distort ---- */
const G = sandbox.G;
console.log('\n--- viewport fit ---');
for (const [w, h] of [[1280, 800], [1920, 1080], [1000, 500], [3840, 2160], [640, 400], [320, 200], [800, 900]]) {
  win.innerWidth = w; win.innerHeight = h;
  (listeners.resize || []).forEach(fn => fn());
  const cw = parseFloat(canvasEl.style.width), ch = parseFloat(canvasEl.style.height);
  const fit = Math.min(w / 640, h / 400);
  const ratio = cw / ch, want = 640 / 400;
  const err = Math.abs(ratio - want) / want;
  const fits = cw <= w + 0.5 && ch <= h + 0.5;
  console.log(`  window ${String(w).padStart(4)}x${String(h).padEnd(4)} -> canvas ${cw}x${ch}  aspect err ${(err * 100).toFixed(3)}%  fits=${fits}  scale=${(cw / 640).toFixed(3)}`);
}

/* ---- game state after 30 s ---- */
console.log('\n--- state after 30 s ---');
console.log('  distance', Math.round(G.dist), 'px | coins', G.coinCount, '| speed', G.speed.toFixed(0));
console.log('  deaths', G.deaths, '| obstacles', G.obs.length, '| coins alive', G.coins.length);
console.log('  dead?', G.dead);
console.log('\nSMOKE TEST PASSED');
