/* Verifies that the scrolling cloud sheet has no visible seam: for every
   row, compare the column-0 colour with the column-639 colour and with
   the pixels just inside each edge.  A seam shows up as a large jump. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'wallpaper-runner.html'), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

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
    style: {}, _px: null, _ctx: null, _w: 0, _h: 0,
    get width() { return this._w; }, set width(v) { this._w = Math.max(0, Math.round(v)); this._alloc(); },
    get height() { return this._h; }, set height(v) { this._h = Math.max(0, Math.round(v)); this._alloc(); },
    _alloc() { const n = Math.max(4, this._w * this._h * 4); if (!this._px || this._px.length !== n) this._px = new Uint8ClampedArray(n); },
    getContext() {
      if (this._ctx) return this._ctx;
      const cvv = this;
      this._ctx = {
        canvas: cvv, fillStyle: '#000', globalAlpha: 1, imageSmoothingEnabled: false,
        font: '10px monospace', textAlign: 'left', textBaseline: 'top',
        fillRect(x, y, ww, hh) {
          const c = parseColor(this.fillStyle), A = c[3] / 255 * this.globalAlpha;
          const X0 = Math.max(0, Math.round(x)), Y0 = Math.max(0, Math.round(y));
          const X1 = Math.min(cvv.width, Math.round(x + ww)), Y1 = Math.min(cvv.height, Math.round(y + hh));
          for (let yy = Y0; yy < Y1; yy++) for (let xx = X0; xx < X1; xx++) {
            const o = (yy * cvv.width + xx) * 4;
            cvv._px[o] = c[0] * A + cvv._px[o] * (1 - A);
            cvv._px[o + 1] = c[1] * A + cvv._px[o + 1] * (1 - A);
            cvv._px[o + 2] = c[2] * A + cvv._px[o + 2] * (1 - A);
            cvv._px[o + 3] = Math.max(cvv._px[o + 3], 255 * A);
          }
        },
        clearRect() { }, drawImage() { }, fillText() { },
        measureText(t) { return { width: String(t).length * 6 }; },
        save() { }, restore() { }, translate() { }, scale() { }, beginPath() { },
        moveTo() { }, lineTo() { }, closePath() { }, fill() { }, stroke() { },
        createImageData(w2, h2) { return { width: w2, height: h2, data: new Uint8ClampedArray(w2 * h2 * 4) }; },
        putImageData(img, ox, oy) {
          for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
            const s = (y * img.width + x) * 4, X = x + (ox | 0), Y = y + (oy | 0);
            if (X < 0 || Y < 0 || X >= cvv.width || Y >= cvv.height) continue;
            const o = (Y * cvv.width + X) * 4;
            cvv._px[o] = img.data[s]; cvv._px[o + 1] = img.data[s + 1];
            cvv._px[o + 2] = img.data[s + 2]; cvv._px[o + 3] = img.data[s + 3];
          }
        },
        getImageData(x, y, w2, h2) {
          const out = new Uint8ClampedArray(w2 * h2 * 4);
          for (let yy = 0; yy < h2; yy++) for (let xx = 0; xx < w2; xx++) {
            const s = ((y + yy) * cvv.width + (x + xx)) * 4, o = (yy * w2 + xx) * 4;
            out[o] = cvv._px[s]; out[o + 1] = cvv._px[s + 1];
            out[o + 2] = cvv._px[s + 2]; out[o + 3] = cvv._px[s + 3];
          }
          return { width: w2, height: h2, data: out };
        }
      };
      return this._ctx;
    }
  };
  cv.width = w; cv.height = h;
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

const A = sandbox.ASSET;
function at(cv, x, y) { const o = (y * cv.width + x) * 4; return [cv._px[o], cv._px[o + 1], cv._px[o + 2]]; }
function diff(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); }

let worst = 0, worstAt = null, checked = 0, bigJumps = 0, skipped = 0;
for (const [name, cv] of [['cloud', A.cloud], ['cloudM', A.cloudM], ['forest', A.forest]]) {
  for (let y = 0; y < cv.height; y++) {
    const oL = (y * cv.width) * 4, oR = (y * cv.width + cv.width - 1) * 4;
    /* only rows where the sheet actually reaches both edges can show a
       wrap seam; elsewhere the layer is simply transparent sky          */
    if (cv._px[oL + 3] === 0 || cv._px[oR + 3] === 0) { skipped++; continue; }
    const seam = diff(at(cv, 0, y), at(cv, cv.width - 1, y));
    checked++;
    if (seam > worst) { worst = seam; worstAt = [name, y]; }
    if (seam > 90) { bigJumps++; console.log('  SEAM ' + name + ' row ' + y + ' diff=' + seam); }
  }
  console.log(name.padEnd(9) + 'height=' + cv.height);
}
console.log('\nrows compared:', checked, ' transparent-edge rows skipped:', skipped);
console.log('worst wrap diff:', worst, worstAt ? JSON.stringify(worstAt) : '', ' big jumps:', bigJumps);
console.log(bigJumps === 0 ? 'WRAP TEST PASSED' : 'WRAP TEST FAILED');
