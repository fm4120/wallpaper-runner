/* Focused unit test: does spriteCanvas() actually write pixels? */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'wallpaper-runner.html'), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

let fillRectCalls = 0, createImageDataCalls = 0, putImageDataCalls = 0;

function parseColor(v) {
  if (typeof v !== 'string') return [255, 0, 255, 255];
  if (v[0] === '#') {
    const h = v.slice(1);
    const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16), 255];
  }
  return [255, 0, 255, 255];
}
function softCanvas(w, h) {
  const cv = {
    width: w, height: h, style: {}, _px: new Uint8ClampedArray(Math.max(1, w * h * 4)), _ctx: null,
    getContext() {
      if (this._ctx) return this._ctx;
      const self = this;
      this._ctx = {
        canvas: self, fillStyle: '#000', globalAlpha: 1, imageSmoothingEnabled: false,
        font: '10px monospace', textAlign: 'left', textBaseline: 'top',
        fillRect(x, y, ww, hh) {
          fillRectCalls++;
          const c = parseColor(this.fillStyle), A = c[3] / 255 * this.globalAlpha;
          const X0 = Math.max(0, Math.round(x)), Y0 = Math.max(0, Math.round(y));
          const X1 = Math.min(self.width, Math.round(x + ww)), Y1 = Math.min(self.height, Math.round(y + hh));
          for (let yy = Y0; yy < Y1; yy++) for (let xx = X0; xx < X1; xx++) {
            const o = (yy * self.width + xx) * 4;
            self._px[o] = c[0] * A + self._px[o] * (1 - A);
            self._px[o + 1] = c[1] * A + self._px[o + 1] * (1 - A);
            self._px[o + 2] = c[2] * A + self._px[o + 2] * (1 - A);
            self._px[o + 3] = Math.max(self._px[o + 3], 255 * A);
          }
        },
        clearRect() { }, drawImage() { }, fillText() { },
        measureText(t) { return { width: String(t).length * 6 }; },
        save() { }, restore() { }, translate() { }, scale() { }, beginPath() { },
        moveTo() { }, lineTo() { }, closePath() { }, fill() { }, stroke() { },
        createImageData(w2, h2) {
          createImageDataCalls++;
          return { width: w2, height: h2, data: new Uint8ClampedArray(w2 * h2 * 4) };
        },
        putImageData(img, ox, oy) {
          putImageDataCalls++;
          for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
            const s = (y * img.width + x) * 4, X = x + (ox | 0), Y = y + (oy | 0);
            if (X < 0 || Y < 0 || X >= self.width || Y >= self.height) continue;
            const o = (Y * self.width + X) * 4;
            self._px[o] = img.data[s]; self._px[o + 1] = img.data[s + 1];
            self._px[o + 2] = img.data[s + 2]; self._px[o + 3] = img.data[s + 3];
          }
        },
        getImageData() { return { width: 1, height: 1, data: new Uint8ClampedArray(4) }; }
      };
      return this._ctx;
    }
  };
  return cv;
}

const main = softCanvas(640, 400);
const sandbox = {
  console, Math, Date,
  document: {
    hidden: false, readyState: 'complete', title: '',
    getElementById: () => main,
    createElement: (t) => (t === 'canvas' ? softCanvas(0, 0) : { style: {} }),
    addEventListener() { }
  },
  window: { innerWidth: 1280, innerHeight: 800, addEventListener() { } },
  location: { hash: '' },
  requestAnimationFrame() { return 1; },
  Uint8ClampedArray, Float64Array, JSON, String, Number, Array, Object, Boolean, Error
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'game.js' });

console.log('call counters -> fillRect:', fillRectCalls, ' createImageData:', createImageDataCalls, ' putImageData:', putImageDataCalls);

/* call the sprite builder directly and check the result */
const cv = sandbox.spriteCanvas(sandbox.ART.run0, sandbox.APAL);
let opaque = 0, sample = [];
for (let i = 0; i < cv._px.length; i += 4) {
  if (cv._px[i + 3] > 0) {
    opaque++;
    if (sample.length < 3) sample.push([cv._px[i], cv._px[i + 1], cv._px[i + 2], cv._px[i + 3]]);
  }
}
console.log('spriteCanvas(ART.run0) ->', cv.width + 'x' + cv.height, 'opaque px:', opaque, 'samples:', JSON.stringify(sample));
console.log('after direct call -> createImageData:', createImageDataCalls, ' putImageData:', putImageDataCalls);
console.log('ART.run0[7] =', JSON.stringify(sandbox.ART.run0[7]));
console.log('APAL["1"] =', sandbox.APAL['1'], ' APAL["0"] =', sandbox.APAL['0']);

/* --- direct probe of the image-data path --- */
const id = sandbox.document.createElement('canvas').getContext('2d').createImageData(4, 3);
console.log('createImageData(4,3) ->', id.width + 'x' + id.height, 'data len:', id.data.length, 'ctor:', id.data.constructor.name);
id.data[0] = 10; id.data[1] = 20; id.data[2] = 30; id.data[3] = 255;
console.log('after write, first 4 bytes:', Array.from(id.data.slice(0, 4)));
const probe = softCanvas(4, 3);
probe.getContext('2d').putImageData(id, 0, 0);
console.log('after putImageData, canvas px:', Array.from(probe._px.slice(0, 8)));
console.log('typeof spriteCanvas:', typeof sandbox.spriteCanvas);
console.log('run0 non-dot chars:', (sandbox.ART.run0.join('').match(/[^.]/g) || []).length);

/* --- instrument spriteCanvas by tracing its internals --- */
const trace = { imgs: 0, set: 0, skip: 0 };
const origCreate = softCanvas(1,1); // placeholder, not used
const run0 = sandbox.ART.run0, pal = sandbox.APAL;
let w = 0, h = run0.length;
for (let y = 0; y < h; y++) if (run0[y].length > w) w = run0[y].length;
console.log('computed sprite size:', w + 'x' + h);
const tv = softCanvas(w, h);
const tctx = tv.getContext('2d');
const timg = tctx.createImageData(w, h);
console.log('imageData data length:', timg.data.length, 'expected:', w * h * 4);
let lit = 0;
for (let y = 0; y < h; y++) {
  const row = run0[y];
  for (let x = 0; x < row.length; x++) {
    const ch = row.charAt(x);
    if (ch === '.') continue;
    lit++;
    const col = pal[ch] ? [parseInt(pal[ch].substr(1,2),16), parseInt(pal[ch].substr(3,2),16), parseInt(pal[ch].substr(5,2),16)] : [255,0,255];
    const o = (y * w + x) * 4;
    timg.data[o] = col[0]; timg.data[o+1] = col[1]; timg.data[o+2] = col[2]; timg.data[o+3] = 255;
  }
}
console.log('lit pixels written manually:', lit);
tctx.putImageData(timg, 0, 0);
let op = 0;
for (let i = 3; i < tv._px.length; i += 4) if (tv._px[i] > 0) op++;
console.log('manual replication opaque px:', op);
console.log('first lit byte sample:', Array.from(timg.data.slice(0, 12)));

/* --- print the actual source of the loaded spriteCanvas --- */
console.log('=== spriteCanvas source as loaded ===');
console.log(sandbox.spriteCanvas.toString());
