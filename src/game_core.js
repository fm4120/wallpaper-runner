/* =====================================================================
   PART 1 / 3 :  ART + SCENE
   Wallpaper-derived pixel art, palette and parallax scene renderer.
   Logical (art) space is always 640 x 400 - identical to the source
   wallpaper's grid, so rendering and collision share one coordinate
   system no matter how the window is sized.
   ===================================================================== */
'use strict';

var AW = 640, AH = 400;                 // logical art resolution (= wallpaper / 4)
var GROUND_Y = 346;                     // grass lip of the runner's tile
var FOREST_Y = 260;                     // canvas y of the tree-line tile's row 0
var FPS = 60, STEP = 1 / 60;

/* ---------------- palette (sampled from the wallpaper) ---------------- */
var C = {
  sky0: '#ab6a8c', sky1: '#875d83', sky2: '#7a5474', sky3: '#502e49',
  cloudA: '#866286', cloudB: '#96678a',
  far: '#502e49', far2: '#653656', mid: '#2f2138', ridge: '#e08591', ridge2: '#d47883',
  forest: '#160805',
  soil: '#2f1725', soilLt: '#45242f', soilRim: '#5a3137',
  grass: '#5fc33c', grassDk: '#2f7a3c', grassHi: '#b9d36a',
  moon: '#fffcf3', moon1: '#f2d9d6', moon2: '#d9a9b6', moon3: '#bd8aa2',
  gold: '#fdf36a', goldDk: '#c9a52e', goldRim: '#160805',
  ink: '#160805', bark: '#5a3137', barkDk: '#31150f'
};

/* ---------------- parallax layer silhouettes ----------------
   Sampled from the wallpaper at 4 px intervals (160 columns = 640 px).
   Profiles are "closed" (both ends forced to the same deep value) so a
   layer can scroll forever without a seam.                          */
var FAR_H = [218,213,213,211,209,206,204,201,199,199,194,192,192,190,187,185,183,180,178,173,171,168,168,166,163,164,164,165,167,169,171,173,175,177,179,181,183,185,186,188,190,192,194,196,197,196,194,192,190,185,183,183,199,214,230,245,261,277,292,300,300,302,296,292,288,286,285,280,277,276,274,268,255,197,200,200,203,203,206,206,206,208,211,211,211,214,214,216,216,219,219,219,222,222,224,222,222,220,220,218,215,213,211,211,209,206,206,204,201,199,199,197,196,196,197,262,265,267,270,272,273,278,278,283,283,289,292,294,297,299,302,305,300,298,293,289,286,284,279,274,272,267,265,260,255,251,251,248,246,244,241,239,237,234,232,230,227,225,222,220];
var MID_H = [272,269,267,265,262,260,258,258,267,265,260,255,253,248,246,242,239,234,232,229,225,218,215,206,185,177,168,166,166,166,171,173,176,178,180,183,183,185,188,188,190,192,195,197,201,201,206,208,208,203,196,183,185,185,188,190,192,197,199,204,210,224,239,253,268,282,297,309,311,314,316,319,321,324,325,325,325,325,325,325,320,316,316,316,316,316,316,316,316,315,315,315,315,314,314,308,307,308,308,308,307,307,310,313,316,319,321,320,316,312,308,306,303,300,299,297,295,292,288,285,281,278,275,275,277,281,285,289,290,290,289,288,285,279,276,275,274,272,270,272,275,277,275,272,269,265,261,257,252,248,244,240,235,232,230,228,230,234,238,241];
var FOR_H = [316,329,314,306,320,310,304,294,310,314,304,312,308,321,310,327,325,301,300,308,304,304,306,306,296,308,302,306,296,300,308,302,292,314,324,319,314,328,324,320,332,331,335,336,337,337,338,338,339,340,340,341,339,333,336,333,330,327,324,319,311,317,310,306,312,319,319,308,308,319,319,306,318,325,333,339,323,339,325,325,325,315,308,333,330,330,343,331,321,323,335,321,310,315,317,310,318,312,320,310,325,318,310,304,318,308,323,316,312,316,318,331,308,308,319,318,306,318,325,316,306,321,337,323,312,331,310,331,311,323,318,335,318,308,302,316,306,321,337,310,314,316,329,306,306,320,310,304,308,310,314,304,312,308,321,310,327,310,301,302];

/* cloud mask rows ([x, width] pairs, rows 0..83) are injected by the
   build step together with the palette - see tools/build.py           */

function closeProfile(p, edge) {
  var n = p.length, out = new Array(n), i;
  for (i = 0; i < n; i++) {
    var p0 = p[0], t;
    // blend the last `edge` columns into the first ones so the layer wraps
    if (i >= n - edge) {
      t = (i - (n - edge)) / (edge - 1);
      out[i] = p[i] * (1 - t) + p0 * t;
    } else {
      out[i] = p[i];
    }
  }
  out[n - 1] = out[0];
  return out;
}

/* ---------------- small helpers ---------------- */
function rnd(seed) {                       // deterministic PRNG (mulberry32)
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* build a canvas from an ASCII sprite + palette */
function spriteCanvas(rows, pal) {
  var h = rows.length, w = 0, y, x;
  for (y = 0; y < h; y++) if (rows[y].length > w) w = rows[y].length;
  var cv = makeCanvas(w, h), ctx = cv.getContext('2d');
  var img = ctx.createImageData(w, h), d = img.data;
  var cache = {};
  for (y = 0; y < h; y++) {
    var row = rows[y];
    for (x = 0; x < row.length; x++) {
      var ch = row.charAt(x);
      if (ch === '.') continue;
      var col = cache[ch] || (cache[ch] = hex2rgb(pal[ch] || '#ff00ff'));
      var o = (y * w + x) * 4;
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function hex2rgb(h) {
  return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
}

/* horizontally mirrored copy (used to hide the cloud layer's wrap seam).
   Pixel-exact, and deliberately avoids getImageData read-back where the
   canvas exposes its own buffer (the head-less software canvas used by
   the test rig), which keeps boot instant.                             */
function mirrored(src) {
  var w = src.width, h = src.height;
  var cv = makeCanvas(w, h), ctx = cv.getContext('2d');
  if (src._px && cv._px) {                    // software canvas fast path
    for (var y = 0; y < h; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        var o = (row + x) * 4, q = (row + (w - 1 - x)) * 4;
        cv._px[o] = src._px[q]; cv._px[o + 1] = src._px[q + 1];
        cv._px[o + 2] = src._px[q + 2]; cv._px[o + 3] = src._px[q + 3];
      }
    }
    return cv;
  }
  var s = src.getContext('2d').getImageData(0, 0, w, h).data;
  var img = ctx.createImageData(w, h), d = img.data;
  for (var y2 = 0; y2 < h; y2++) {
    for (var x2 = 0; x2 < w; x2++) {
      var o2 = (y2 * w + x2) * 4, q2 = (y2 * w + (w - 1 - x2)) * 4;
      d[o2] = s[q2]; d[o2 + 1] = s[q2 + 1]; d[o2 + 2] = s[q2 + 2]; d[o2 + 3] = s[q2 + 3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/* ---------------- asset bundle ---------------- */
var ASSET = null;

/* art-pixel dimensions of every sprite - available without a canvas so
   the simulation stays pure and testable head-less */
var SPR = (function () {
  var o = {};
  for (var k in ART) o[k] = { w: ART[k][0].length, h: ART[k].length };
  return o;
})();

/* art pixels -> logical pixels (one wallpaper pixel-tile = 8 logical px) */
var SCALE = 1.55;

function buildAssets() {
  var A = { spr: {}, cloud: null, cloudB: null, ground: null, groundFar: null, forest: null, ditherA: null, ditherB: null, decor: null };
  for (var k in ART) A.spr[k] = spriteCanvas(ART[k], APAL);

  /* --- clouds: two stacked masks, the lower one darker --- */
  var cw = 640, ch = 84;
  function cloudCanvas(colour) {
    var cv = makeCanvas(cw, ch), ctx = cv.getContext('2d');
    ctx.fillStyle = colour;
    for (var y = 0; y < ch; y++) {
      var runs = CLOUD_RUNS[y] || [];
      for (var i = 0; i < runs.length; i++) ctx.fillRect(runs[i][0], y, runs[i][1], 1);
    }
    return cv;
  }
  A.cloud = cloudCanvas(C.cloudA);
  A.cloudB = cloudCanvas(C.cloudB);
  /* the sheet has to wrap: cross-fade the last WRAP columns into the
     first ones so the layer scrolls forever without a visible cut      */
  var CLOUD_WRAP = 120;
  function wrapCloud(sheet) {
    var sw = sheet.width, sh = sheet.height;
    var sc = sheet.getContext('2d');
    var data = sc.getImageData(0, 0, sw, sh).data;
    /* `data` wraps the live buffer; copy it before writing back */
    var src2 = new Uint8ClampedArray(data);
    var img = sc.createImageData(sw, sh), d = img.data;
    var W = CLOUD_WRAP, start = sw - W;
    for (var y = 0; y < sh; y++) {
      for (var x = 0; x < sw; x++) {
        var o = (y * sw + x) * 4, q = (y * sw + ((x + W) % sw)) * 4;
        var t = 0;
        if (x >= start) t = (x - start) / (W - 1);       // 0 -> 1 at the tail
        var a = t * t * (3 - 2 * t);                     // smoothstep
        d[o] = src2[o] * (1 - a) + src2[q] * a;
        d[o + 1] = src2[o + 1] * (1 - a) + src2[q + 1] * a;
        d[o + 2] = src2[o + 2] * (1 - a) + src2[q + 2] * a;
        d[o + 3] = src2[o + 3] * (1 - a) + src2[q + 3] * a;
      }
    }
    sc.putImageData(img, 0, 0);
    return sheet;
  }
  wrapCloud(A.cloud);
  wrapCloud(A.cloudB);
  A.cloudM = mirrored(A.cloud);
  A.cloudBM = mirrored(A.cloudB);

  /* --- ground: procedural soil + pebbles, wall palette, 512x86 tile --- */
  var gw = 512, gh = 86;
  var g = makeCanvas(gw, gh), gc = g.getContext('2d');
  var r = rnd(0x51ee7);
  gc.fillStyle = C.soil; gc.fillRect(0, 0, gw, gh);
  // soft horizontal strata
  var bands = [[0, 4, C.soilRim], [4, 10, C.soilLt], [14, 22, C.soilLt], [30, 40, '#3a1f2b'], [52, 62, '#3a1f2b'], [72, 80, C.soilLt]];
  for (var b = 0; b < bands.length; b++) {
    gc.fillStyle = bands[b][2];
    for (var x = 0; x < gw; x += 2) {
      var hgt = bands[b][1] - bands[b][0];
      gc.fillRect(x, bands[b][0] + ((x & 2) ? 1 : 0), 2, hgt);
    }
  }
  // pebbles
  for (var i = 0; i < 340; i++) {
    var px = (r() * gw) | 0, py = 6 + ((r() * (gh - 14)) | 0);
    gc.fillStyle = (r() < 0.5) ? C.soilRim : C.soilLt;
    gc.fillRect(px, py, 2 + ((r() * 3) | 0), 2);
  }
  // grass lip + dark under-lip
  gc.fillStyle = C.grass;
  for (var x2 = 0; x2 < gw; x2 += 2) gc.fillRect(x2, 0, 2, 3 + (r() < 0.5 ? 0 : 1));
  gc.fillStyle = C.grassHi;
  for (var x3 = 0; x3 < gw; x3 += 4) if (r() < 0.55) gc.fillRect(x3, 0, 2, 2);
  gc.fillStyle = C.grassDk;
  for (var x4 = 0; x4 < gw; x4 += 2) gc.fillRect(x4, 6, 2, 2 + (r() < 0.4 ? 2 : 0));
  gc.fillStyle = '#1b0d08';
  for (var x5 = 0; x5 < gw; x5 += 2) gc.fillRect(x5, 10, 2, 1);
  A.ground = g;

  /* --- deeper soil layer behind, scrolled a little slower --- */
  var g2 = makeCanvas(gw, 60), g2c = g2.getContext('2d');
  g2c.fillStyle = '#251320'; g2c.fillRect(0, 0, gw, 60);
  var r2 = rnd(0x77aa1);
  for (var i2 = 0; i2 < 220; i2++) {
    var qx = (r2() * gw) | 0, qy = (r2() * 58) | 0;
    g2c.fillStyle = (r2() < 0.5) ? '#2b1626' : '#31192a';
    g2c.fillRect(qx, qy, 2 + ((r2() * 3) | 0), 2);
  }
  A.groundFar = g2;

  /* --- the two checkerboard sky phases, drawn once instead of every frame --- */
  function ditherTile(shift) {
    var d = makeCanvas(AW, 22), dc = d.getContext('2d');
    dc.fillStyle = C.sky0;
    for (var yy = 0; yy < 22; yy++) {
      for (var xx = ((yy + shift) & 1) ? 0 : 2; xx < AW; xx += 4) dc.fillRect(xx, yy, 2, 1);
    }
    return d;
  }
  A.ditherA = ditherTile(0);
  A.ditherB = ditherTile(1);

  /* --- near conifer tree-line, one 640 px tile (was per-frame fillRects) --- */
  var ft = makeCanvas(640, 78), fc = ft.getContext('2d');
  paintForest(fc, 16);              // row 0 of this canvas is canvas-y 276
  A.forest = ft;
  return A;
}
/* =====================================================================
   PART 2 / 3 :  SCENE RENDERER
   Every layer is drawn in the same 640 x 400 logical space, so window
   size can never affect artwork, hitboxes or AI decisions.
   ===================================================================== */

/* ---------------- sky ---------------- */
function skyBands(ctx) {
  var S = [
    [0, 24, C.sky0], [24, 190, C.sky0], [190, 212, C.sky1],
    [212, 262, C.sky2], [262, 316, C.sky3]
  ];
  for (var i = 0; i < S.length; i++) {
    ctx.fillStyle = S[i][2];
    ctx.fillRect(0, S[i][0], AW, S[i][1] - S[i][0]);
  }
}

/* ---------------- moon + its pixel halo ---------------- */
function drawMoon(ctx) {
  var cx = 318, cy = 84, r = 44;
  // dithered halo rings, largest first
  var rings = [[r + 26, C.moon3, 3], [r + 18, C.moon2, 3], [r + 11, C.moon1, 3], [r + 5, C.moon1, 4]];
  for (var k = 0; k < rings.length; k++) {
    var rr = rings[k][0], col = rings[k][1], step = rings[k][2];
    ctx.fillStyle = col;
    for (var y = -rr; y <= rr; y += step) {
      var w = Math.sqrt(Math.max(0, rr * rr - y * y));
      ctx.fillRect(Math.round(cx - w), Math.round(cy + y), Math.round(2 * w) + 1, step);
    }
  }
  ctx.fillStyle = C.moon;
  for (var y2 = -r; y2 <= r; y2 += 2) {
    var w2 = Math.sqrt(Math.max(0, r * r - y2 * y2));
    ctx.fillRect(Math.round(cx - w2), Math.round(cy + y2), Math.round(2 * w2) + 1, 2);
  }
}

/* ---------------- moonlit ridge (the pink beam in the wallpaper) ---------------- */
function drawRidge(ctx, sc) {
  var total = 640;
  var off = sc % total; if (off < 0) off += total;
  for (var x = 0; x < AW; x += 2) {
    var wx = (x + off) % total;                  // position inside the wallpaper
    var t = (wx - 28) / 122;                     // 0 at the west tip, 1 at the east tip
    if (t < 0 || t > 1) continue;
    var top = 312 - 96 * Math.pow(t, 1.55);      // ridge crest
    var low = 316 - 46 * t;                      // diagonal cut by the dark peak
    ctx.fillStyle = (t < 0.38) ? C.ridge2 : C.ridge;
    ctx.fillRect(x, Math.round(top), 2, Math.round(low - top));
  }
}

/* ---------------- generic silhouette layer ---------------- */
/* profile: 160 samples spaced 4 px apart, drawn as 4 px steps so the
   layer may scroll by any amount and wrap without a seam.  Neighbouring
   columns of equal height merge into a single rect, which keeps the
   per-frame draw count low enough for a rock-steady 60 fps.           */
function drawProfile(ctx, prof, sc, colour, bottom, detail) {
  var n = prof.length, total = n * 4;
  var off = Math.floor(sc) % total; if (off < 0) off += total;
  var yEnd = bottom === undefined ? AH : bottom;
  ctx.fillStyle = colour;
  var runX = 0, runY = prof[((off >> 2) % n + n) % n];
  for (var x = 4; x <= AW; x += 4) {
    var y = prof[((((x + off) >> 2) % n) + n) % n];
    if (y !== runY) {
      ctx.fillRect(runX, runY, x - runX, yEnd - runY + 2);
      runX = x; runY = y;
    }
  }
  ctx.fillRect(runX, runY, AW - runX, yEnd - runY + 2);
  if (detail) detail(ctx, off);
}

/* spikes of dark conifers riding the near tree-line.  Pre-rendered into
   one tile at boot (see buildAssets) and simply blitted each frame.    */
function paintForest(ctx, off) {
  var n = FOR_H.length;
  ctx.fillStyle = C.forest;
  /* the canvas passed in is 640 x 78 and its row 0 is canvas-y 276, so
     shift every silhouette by 276 to land inside the tile              */
  var BASE = 260;
  for (var x = -8; x < AW + 8; x += 4) {
    var i = (((x + off) >> 2) % n + n) % n;
    var y = FOR_H[i] - BASE;
    var h = (i * 7919) % 13;
    if (h < 8) {
      ctx.fillRect(x, y - h, 4, h + 2);
      if (h > 4) {
        ctx.fillRect(x - 4, y - h + 3, 4, 2);
        ctx.fillRect(x + 4, y - h + 5, 4, 2);
      }
    }
  }
}

/* ---------------- ground ---------------- */
function drawGround(ctx, sc) {
  var gw = ASSET.ground.width;
  var off = sc % gw; if (off < 0) off += gw;
  var y = GROUND_Y;
  // far soil behind
  var gw2 = ASSET.groundFar.width;
  var off2 = (sc * 0.72) % gw2; if (off2 < 0) off2 += gw2;
  var x = -off2;
  while (x < AW) { ctx.drawImage(ASSET.groundFar, x, y + 22); x += gw2; }
  // foreground soil
  x = -off;
  while (x < AW) { ctx.drawImage(ASSET.ground, x, y); x += gw; }
}

/* ---------------- clouds ---------------- */
function cloudBlit(ctx, src, sc, y) {
  var w = src.width;
  var off = sc % w; if (off < 0) off += w;
  var x = -off;
  while (x < AW + 1) { ctx.drawImage(src, x, y); x += w; }
}
function drawClouds(ctx, scA, scB) {
  cloudBlit(ctx, ASSET.cloudBM, scB, 30);
  cloudBlit(ctx, ASSET.cloudM, scA, 30);
}

/* ---------------- dithered sky band + moonlight haze ---------------- */
function drawSkyFx(ctx, phase) {
  // checkerboard dither, exactly like the wallpaper's band at y 190..211
  ctx.drawImage(phase ? ASSET.ditherB : ASSET.ditherA, 0, 190);
  // soft god-ray haze rising from the tree-line
  for (var i = 0; i < 34; i++) {
    ctx.globalAlpha = 0.05 * (1 - i / 34);
    ctx.fillRect(0, 300 - i * 3, AW, 3);
  }
  ctx.globalAlpha = 1;
}

/* ---------------- one full background frame ---------------- */
function drawScene(ctx, s) {
  ctx.imageSmoothingEnabled = false;
  skyBands(ctx);
  drawMoon(ctx);
  drawClouds(ctx, s.scroll * 0.035, s.scroll * 0.017);
  drawSkyFx(ctx, Math.floor(s.scroll * 0.02));
  drawProfile(ctx, FAR_H, s.scroll * 0.075, C.far, AH);
  drawRidge(ctx, s.scroll * 0.075);
  drawProfile(ctx, MID_H, s.scroll * 0.17, C.mid, AH);
  drawForestLayer(ctx, s.scroll * 0.42);
  drawGround(ctx, s.scroll);
}
/* the near conifer tree-line, pre-rendered once by paintForest and then
   simply blitted - this used to cost ~200 fillRects every frame        */
function drawForestLayer(ctx, sc) {
  var t = ASSET.forest, total = t.width;
  var off = sc % total; if (off < 0) off += total;
  var x = -off;                     // row 0 of the tile is canvas y FOREST_Y
  while (x < AW) { ctx.drawImage(t, Math.round(x), FOREST_Y); x += total; }
  ctx.fillStyle = C.forest;
  ctx.fillRect(0, FOREST_Y + t.height, AW, AH - (FOREST_Y + t.height) + 1);
}
/* the game band: dark soil behind the runner's lane, so props and the
   character never sit on top of the tile's foreground trees            */
function drawDirt(ctx) {
  ctx.fillStyle = C.soil;
  ctx.fillRect(0, 320, AW, AH - 320);
  ctx.fillStyle = C.soilLt;
  for (var x = 0; x < AW; x += 8) ctx.fillRect(x, 320, 4, 2);
}





