/* Renders real game frames into PNGs by rasterising the canvas calls the
   game issues (software canvas), so the artwork can be reviewed without
   a browser.  Usage:
     node record.cjs <seconds,seconds,...> [seed] [outDir]
   Frames land in ../frames/frame_<t>.png (640x400, 2x nearest upscale). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const HTML = path.join(__dirname, '..', 'wallpaper-runner.html');
const html = fs.readFileSync(HTML, 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

/* ---------- tiny PNG writer (RGBA, no dependencies) ---------- */
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy ? rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
              : Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]));
}

/* ---------- software canvas ---------- */
function parseColor(v) {
  if (typeof v !== 'string') return [255, 0, 255, 255];
  if (v[0] === '#') {
    const h = v.slice(1);
    const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16), 255];
  }
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (m) {
    const p = m[1].split(',').map(Number);
    return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? Math.round(p[3] * 255) : 255];
  }
  return [255, 0, 255, 255];
}
function softCanvas(w, h) {
  const cv = {
    style: {}, _px: null, _ctx: null, _w: 0, _h: 0,
    get width() { return this._w; },
    set width(v) { this._w = Math.max(0, Math.round(v)); this._alloc(); },
    get height() { return this._h; },
    set height(v) { this._h = Math.max(0, Math.round(v)); this._alloc(); },
    _alloc() {
      const need = Math.max(4, this._w * this._h * 4);
      if (!this._px || this._px.length !== need) this._px = new Uint8ClampedArray(need);
    },
    getContext() {
      if (this._ctx) return this._ctx;
      const cvv = this;
      const ctx = {
        canvas: cvv,
        fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1,
        font: '10px monospace', textAlign: 'left', textBaseline: 'top',
        imageSmoothingEnabled: false,
        fillRect(x, y, ww, hh) {
          const [r, g, b, a0] = parseColor(this.fillStyle);
          const A = a0 / 255 * this.globalAlpha;
          let X0 = Math.round(x), Y0 = Math.round(y);
          let X1 = Math.round(x + ww), Y1 = Math.round(y + hh);
          if (X1 < X0) { const t = X0; X0 = X1; X1 = t; }
          if (Y1 < Y0) { const t = Y0; Y0 = Y1; Y1 = t; }
          X0 = Math.max(0, X0); Y0 = Math.max(0, Y0);
          X1 = Math.min(cvv.width, X1); Y1 = Math.min(cvv.height, Y1);
          for (let yy = Y0; yy < Y1; yy++) {
            for (let xx = X0; xx < X1; xx++) {
              const o = (yy * cvv.width + xx) * 4;
              if (A >= 0.999) { cvv._px[o] = r; cvv._px[o + 1] = g; cvv._px[o + 2] = b; cvv._px[o + 3] = 255; }
              else {
                cvv._px[o] = r * A + cvv._px[o] * (1 - A);
                cvv._px[o + 1] = g * A + cvv._px[o + 1] * (1 - A);
                cvv._px[o + 2] = b * A + cvv._px[o + 2] * (1 - A);
                cvv._px[o + 3] = Math.max(cvv._px[o + 3], 255 * A);
              }
            }
          }
        },
        clearRect(x, y, ww, hh) { const s = this.fillStyle, a = this.globalAlpha; this.fillStyle = 'rgba(0,0,0,0)'; this.globalAlpha = 1; this.fillRect(x, y, ww, hh); this.fillStyle = s; this.globalAlpha = a; },
        drawImage(src, a1, a2, a3, a4, a5, a6, a7, a8) {
          let sx = 0, sy = 0, sw = src.width, sh = src.height, dx, dy, dw, dh;
          if (arguments.length === 3) { dx = a1; dy = a2; dw = sw; dh = sh; }
          else if (arguments.length === 5) { dx = a1; dy = a2; dw = a3; dh = a4; }
          else { sx = a1; sy = a2; sw = a3; sh = a4; dx = a5; dy = a6; dw = a7; dh = a8; }
          const A = this.globalAlpha;
          for (let yy = 0; yy < dh; yy++) {
            const syy = sy + Math.floor(yy * sh / dh);
            if (syy < 0 || syy >= src.height) continue;
            for (let xx = 0; xx < dw; xx++) {
              const sxx = sx + Math.floor(xx * sw / dw);
              if (sxx < 0 || sxx >= src.width) continue;
              const so = (syy * src.width + sxx) * 4;
              const sa = (src._px[so + 3] / 255) * A;
              if (sa <= 0) continue;
              const X = Math.round(dx) + xx, Y = Math.round(dy) + yy;
              if (X < 0 || Y < 0 || X >= cvv.width || Y >= cvv.height) continue;
              const o = (Y * cvv.width + X) * 4;
              cvv._px[o] = src._px[so] * sa + cvv._px[o] * (1 - sa);
              cvv._px[o + 1] = src._px[so + 1] * sa + cvv._px[o + 1] * (1 - sa);
              cvv._px[o + 2] = src._px[so + 2] * sa + cvv._px[o + 2] * (1 - sa);
              cvv._px[o + 3] = Math.max(cvv._px[o + 3], 255 * sa);
            }
          }
        },
        fillText() { },        // the tiny monospace HUD labels are indicative only
        measureText(t) { return { width: String(t).length * 6 }; },
        save() {}, restore() {}, translate() {}, scale() {}, beginPath() {},
        moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
        createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
        putImageData(img, ox, oy) {
          for (let y = 0; y < img.height; y++) {
            for (let x = 0; x < img.width; x++) {
              const s = (y * img.width + x) * 4;
              const X = x + (ox | 0), Y = y + (oy | 0);
              if (X < 0 || Y < 0 || X >= cvv.width || Y >= cvv.height) continue;
              const o = (Y * cvv.width + X) * 4;
              cvv._px[o] = img.data[s]; cvv._px[o + 1] = img.data[s + 1];
              cvv._px[o + 2] = img.data[s + 2]; cvv._px[o + 3] = img.data[s + 3];
            }
          }
        },
        getImageData(x, y, w, h) { /*__MIRROR_OK__*/
          const out = new Uint8ClampedArray(w * h * 4);
          for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
            const s = ((y + yy) * cvv.width + (x + xx)) * 4, o = (yy * w + xx) * 4;
            out[o] = cvv._px[s]; out[o + 1] = cvv._px[s + 1];
            out[o + 2] = cvv._px[s + 2]; out[o + 3] = cvv._px[s + 3];
          }
          return { width: w, height: h, data: out };
        }
      };
      this._ctx = ctx;
      return ctx;
    }
  };
  cv.width = w; cv.height = h;      // allocates the backing buffer
  return cv;
}

/* ---------- boot the game on the software canvas ---------- */
const expected = process.argv[2] ? process.argv[2].split(',').map(Number) : [5, 20, 45];
const seed = process.argv[3] ? parseInt(process.argv[3], 10) : 7;
const outDir = process.argv[4] || path.join(__dirname, '..', 'frames');
fs.mkdirSync(outDir, { recursive: true });

const main = softCanvas(640, 400);
const listeners = {};
const doc = {
  hidden: false, readyState: 'complete', title: '',
  getElementById: () => main,
  createElement: (t) => (t === 'canvas' ? softCanvas(0, 0) : { style: {} }),
  addEventListener(k, fn) { (listeners[k] = listeners[k] || []).push(fn); }
};
let raf = null;
const sandbox = {
  console, Math, Date, document: doc,
  window: { innerWidth: 1280, innerHeight: 800, addEventListener() {} },
  location: { hash: '' },
  requestAnimationFrame(fn) { raf = fn; return 1; },
  Uint8ClampedArray, Float64Array, JSON, String, Number, Array, Object, Boolean, Error
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'game.js' });
console.log('booted on software canvas; raf registered:', !!raf);

const STEP = 1 / 60;
let simT = 0, t = 0, written = 0;
const targets = expected.slice().sort((a, b) => a - b);
for (let i = 0; i < 60 * 200 && targets.length; i++) {
  const fn = raf; raf = null;
  t += 1000 / 60;
  fn(t);
  simT = sandbox.G.time;
  if (simT >= targets[0]) {
    const want = targets.shift();
    upscale(main, path.join(outDir, 'frame_' + want + 's.png'));
    written++;
  }
}
console.log('frames written:', written, 'final sim time:', simT.toFixed(1) + 's');

function upscale(src, file) {
  const S = 2, W = src.width * S, H = src.height * S;
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = ((y / S | 0) * src.width + (x / S | 0)) * 4, o = (y * W + x) * 4;
      out[o] = src._px[s]; out[o + 1] = src._px[s + 1];
      out[o + 2] = src._px[s + 2]; out[o + 3] = 255;
    }
  }
  writePNG(file, W, H, out);
  console.log('  wrote', path.basename(file), W + 'x' + H);
}
