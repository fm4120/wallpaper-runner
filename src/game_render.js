/* =====================================================================
   PART 4 :  FOREGROUND + HUD + MAIN LOOP
   Draws the character, props, coins and the seven-segment HUD, then runs
   a fixed 60 Hz simulation with an adaptive, non-stretching viewport.
   ===================================================================== */

/* ---------------- foreground decoration (procedural, 640 px tile) ------- */
var DECOR_W = 640;
var DECOR_Y = 318;                      // canvas y of the foreground decor tile
function buildDecor() {
  var cv = makeCanvas(DECOR_W, 82), ctx = cv.getContext('2d');
  var r = rnd(0x2f7a11), x;
  /* a few coarse soil strata so the dirt is not a flat slab */
  ctx.fillStyle = '#3a1f2b';
  for (x = 0; x < DECOR_W; x += 2) ctx.fillRect(x, 20 + (r() < 0.5 ? 0 : 2), 2, 5);
  ctx.fillStyle = C.soilLt;
  for (x = 0; x < DECOR_W; x += 4) if (r() < 0.4) ctx.fillRect(x, 34, 4, 3);
  /* pebbles scattered through the dirt */
  for (var i = 0; i < 150; i++) {
    var px = (r() * DECOR_W) | 0, py = 16 + ((r() * 42) | 0);
    ctx.fillStyle = (r() < 0.55) ? C.soilRim : '#6b3b3f';
    ctx.fillRect(px, py, 2 + ((r() * 3) | 0), 2);
  }
  /* conifers in front of the character, exactly like the wallpaper's
     foreground row, plus small ferns between them                     */
  for (x = 6; x < DECOR_W; x += 62 + ((r() * 34) | 0)) {
    ctx.drawImage(ASSET.spr.tree, x, 4 + ((r() * 8) | 0));
  }
  for (x = 20; x < DECOR_W; x += 30 + ((r() * 26) | 0)) {
    if (r() < 0.55) ctx.drawImage(ASSET.spr.fern, x, 30 + ((r() * 14) | 0));
  }
  return cv;
}

/* ---------------- character ---------------- */
function shadowOf(ctx, s, base, shrink) {
  var w = 30 - shrink;
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = C.forest;
  for (var i = 0; i < 3; i++) ctx.fillRect(s.x - w / 2 + i * 2, base + i, w - i * 4, 1);
  ctx.globalAlpha = 1;
}

function drawPlayer(ctx, s) {
  var laneIdx = 0, best = 1e9, i;
  for (i = 0; i < 3; i++) {
    var d = Math.abs(LANE_Y[i] - s.y);
    if (d < best) { best = d; laneIdx = i; }
  }
  var sc = CHAR_SC;                               // one size keeps the hitbox honest
  var air = !s.onGround;
  var lift = LANE_Y[laneIdx] - s.y;               // >= 0 while jumping
  var ground = LANE_Y[laneIdx] + ART_FOOT;
  var foot = s.y + ART_FOOT;

  shadowOf(ctx, s, ground, Math.max(0, Math.min(18, lift * 0.35)));

  var name;
  if (air) name = 'run2';
  else if (s.ducking) name = 'duck';
  else name = 'run' + ((Math.floor(s.scroll / 5.2) % 4));
  var img = ASSET.spr[name];
  var w = Math.round(img.width * sc), h = Math.round(img.height * sc);
  ctx.drawImage(img, Math.round(s.x - w * 0.42), Math.round(foot - h), w, h);
}

/* ---------------- props ---------------- */
function drawObstacles(ctx, s, flying) {
  for (var i = 0; i < s.obs.length; i++) {
    var o = s.obs[i];
    if (!!OBST[o.t].air !== flying) continue;
    var r = propRect(o);
    var img = ASSET.spr[OBST[o.t].spr];
    var x = Math.round(r.x), y = Math.round(r.y);
    if (flying) {
      /* the bat hovers, so give it a slow flutter */
      y += Math.round(Math.sin(s.time * 6 + o.x * 0.05) * 2);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = C.forest;
      ctx.fillRect(x + 2, Math.round(r.ground) + 1, Math.round(r.w) - 4, 1);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(img, x, y, Math.round(r.w), Math.round(r.h));
  }
}

/* ---------------- coins ---------------- */
function drawCoins(ctx, s) {
  var f = Math.floor(s.time * 11) % 4;
  var img = ASSET.spr['coin' + f];
  var gl = ASSET.spr['coin0'];
  for (var i = 0; i < s.coins.length; i++) {
    var c = s.coins[i];
    if (c.x < -20 || c.x > AW + 20) continue;
    /* soft glint every half second keeps them reading as treasure */
    var pulse = (s.time * 2 + i * 0.7) % 1;
    if (pulse < 0.18) {
      ctx.globalAlpha = 0.30 * (1 - pulse / 0.18);
      ctx.drawImage(gl, Math.round(c.x - 9), Math.round(c.y - 9), 18, 18);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(img, Math.round(c.x - img.width / 2), Math.round(c.y - img.height / 2));
  }
}

/* ---------------- seven-segment HUD (copied from the wallpaper) -------- */
var SEG7 = [
  0x3F, /* 0 */ 0x06, /* 1 */ 0x5B, /* 2 */ 0x4F, /* 3 */ 0x66, /* 4 */
  0x6D, /* 5 */ 0x7D, /* 6 */ 0x07, /* 7 */ 0x7F, /* 8 */ 0x6F  /* 9 */
];
/* segment index: 0 top, 1 tr, 2 br, 3 bottom, 4 bl, 5 tl, 6 middle */
function drawDigits(ctx, value, rx, ry, w, h, col) {
  var txt = String(value);
  var tw = w + 4;
  var x0 = rx - txt.length * tw;
  ctx.fillStyle = col;
  var t = Math.max(2, Math.round(h * 0.14));       // stroke thickness
  for (var i = 0; i < txt.length; i++) {
    var ch = txt.charCodeAt(i) - 48;
    if (ch < 0 || ch > 9) continue;
    var m = SEG7[ch], x = x0 + i * tw;
    if (m & 0x01) ctx.fillRect(x + t, ry, w - 2 * t, t);
    if (m & 0x02) ctx.fillRect(x + w - t, ry + t, t, h / 2 - t);
    if (m & 0x04) ctx.fillRect(x + w - t, ry + h / 2, t, h / 2 - t);
    if (m & 0x08) ctx.fillRect(x + t, ry + h - t, w - 2 * t, t);
    if (m & 0x10) ctx.fillRect(x, ry + h / 2, t, h / 2 - t);
    if (m & 0x20) ctx.fillRect(x, ry + t, t, h / 2 - t);
    if (m & 0x40) ctx.fillRect(x + t, ry + h / 2 - t / 2, w - 2 * t, t);
  }
}

function pad5(n) {
  var s = String(Math.max(0, Math.round(n)));
  while (s.length < 5) s = '0' + s;
  return s;
}

function drawHUD(ctx, s) {
  /* top-right score and "HI" line, exactly like the wallpaper */
  var hx = AW - 16;
  drawDigits(ctx, pad5(Math.round(s.dist / 40)), hx, 16, 12, 22, C.gold);
  ctx.fillStyle = C.gold;
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  var hiTxt = 'HI ' + pad5(Math.round(s.best / 40));
  ctx.fillText(hiTxt, hx - 12 - ctx.measureText(hiTxt).width, 54);
  /* coins sit under the hi-score, small so they never fight the score */
  var cTxt = 'C ' + pad5(s.coinCount);
  ctx.fillText(cTxt, hx - 12 - ctx.measureText(cTxt).width, 70);
  /* live fps, tucked in the bottom-left corner */
  ctx.globalAlpha = 0.5;
  ctx.font = '10px monospace';
  ctx.fillText(Math.round(fps) + ' FPS', 8, AH - 8);
  ctx.globalAlpha = 1;
}

/* ---------------- death overlay ---------------- */
function drawDeath(ctx, s) {
  var a = Math.min(0.72, s.deadT * 3);
  ctx.globalAlpha = a;
  ctx.fillStyle = C.forest;
  ctx.fillRect(AW / 2 - 150, 118, 300, 116);
  ctx.globalAlpha = Math.min(1, s.deadT * 3);
  ctx.fillStyle = C.gold;
  ctx.fillRect(AW / 2 - 150, 118, 300, 2);
  ctx.fillRect(AW / 2 - 150, 232, 300, 2);
  ctx.font = 'bold 17px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('TRIP!', AW / 2, 148);
  ctx.font = 'bold 13px monospace';
  var last = s.lastRun || { coins: s.runCoins, dist: s.runDist, time: s.runTime };
  ctx.fillText('COINS ' + last.coins, AW / 2, 176);
  ctx.fillText('DIST  ' + Math.round(last.dist / 40) + ' m', AW / 2, 196);
  ctx.fillText('TIME  ' + last.time.toFixed(1) + ' s', AW / 2, 216);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

/* ---------------- one complete frame ---------------- */
function render(ctx, s) {
  ctx.imageSmoothingEnabled = false;
  drawScene(ctx, s);                       // sky, moon, clouds, mountains, ground
  drawDirt(ctx);                           // the runner's own soil band
  ctx.drawImage(ASSET.decor, -((s.scroll % DECOR_W) | 0), DECOR_Y);
  drawCoins(ctx, s);
  drawObstacles(ctx, s, false);
  drawPlayer(ctx, s);
  drawObstacles(ctx, s, true);             // fliers pass in front of the runner
  drawHUD(ctx, s);
  if (s.dead) drawDeath(ctx, s);
}

/* =====================================================================
   BOOT + MAIN LOOP
   ===================================================================== */
var canvas, ctx, view = { w: AW, h: AH }, G, acc = 0, last = 0, fpsAcc = 0, fpsN = 0, fps = 60;

function resize() {
  var availW = window.innerWidth, availH = window.innerHeight;
  var s = Math.min(availW / AW, availH / AH);
  /* integer zoom keeps the pixels crisp; fall back to fractional when the
     window is smaller than the art itself                                 */
  var z = (s >= 1) ? Math.floor(s * 2) / 2 : s;
  var w = Math.max(1, Math.round(AW * z)), h = Math.max(1, Math.round(AH * z));
  canvas.width = AW; canvas.height = AH;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  view.w = w; view.h = h;
  ctx.imageSmoothingEnabled = false;
}

function boot() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d', { alpha: false });
  ASSET = buildAssets();
  ASSET.decor = buildDecor();
  G = mkWorld((Date.now() & 0x7fffffff) || 12345);
  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { last = 0; acc = 0; }
  });
  /* headless capture hook: `#shot=T,seed` freezes one exact frame so the
     artwork can be screenshotted without an animation loop running      */
  var m = /shot=([\d.]+)(?:,(\d+))?/.exec(location.hash || '');
  if (m) {
    var upto = parseFloat(m[1]);
    if (m[2]) G = mkWorld(parseInt(m[2], 10));
    var steps = Math.round(upto / STEP);
    for (var i = 0; i < steps; i++) { updateWorld(G, STEP); if (G.dead) G = restart(G); }
    render(ctx, G);
    document.title = 'shot ready';
    window.__SHOT__ = true;
    return;
  }
  requestAnimationFrame(frame);
}

function frame(now) {
  if (!last) { last = now; requestAnimationFrame(frame); return; }
  var dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;                 // never let a stall warp the sim
  acc += dt;
  var guard = 0;
  while (acc >= STEP && guard++ < 8) {
    acc -= STEP;
    updateWorld(G, STEP);
    if (G.dead && G.deadT >= 1.1) G = restart(G);
  }
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  render(ctx, G);
  if (!window.__SHOT__) requestAnimationFrame(frame);
}

/* the script sits at the end of <body>, but guard anyway so the game
   starts whether the document is still parsing or already complete */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}






