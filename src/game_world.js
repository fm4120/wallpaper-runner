/* =====================================================================
   PART 3 / 3 :  WORLD + AUTO-PILOT
   Deterministic 60 Hz simulation. No input is ever required: the pilot
   analyses the road ahead every tick and picks the safest action, then
   the richest one among the safe options.
   ===================================================================== */

/* ---- lanes: depth tracks inside the wallpaper's foreground band.
   LANE_Y[i] is the ground line of lane i - the line the character stands
   on and the line props in that lane sit on.  The 24 px pitch keeps the
   lanes visually separated.                                            */
var LANE_Y = [336, 360, 384];
var LANE_STEP = LANE_Y[1] - LANE_Y[0];
var ART_FOOT = 8;                    // art's grass lip below the run line
/* flying hazards share one altitude above every lane, so ducking is the
   answer no matter which lane the character happens to be running in  */
var FLY_Y1 = 350;

/* ---- obstacle catalogue ----------------------------------------------
   sc   : sprite scale (art pixels -> logical pixels)
   air  : flies above the running line instead of sitting on it
   gates: the only player states that can pass at all
   ---------------------------------------------------------------------- */
var OBST = {
  stump:   { spr: 'stump',   sc: 1.20, air: false, gates: ['jump'] },
  log:     { spr: 'log',     sc: 1.20, air: false, gates: ['jump'] },
  boulder: { spr: 'boulder', sc: 1.28, air: false, gates: ['jump'] },
  pillar:  { spr: 'pillar',  sc: 1.45, air: false, gates: [] },
  bat:     { spr: 'bat',     sc: 1.10, air: true,  gates: ['duck'] }
};

/* ---- player metrics (logical pixels) ----
   y is the reference line the character runs along; the collision box
   sits just above it and is deliberately smaller than the sprite, and it
   fits inside a single lane band so props in other lanes never clip it. */
var P = {
  x: 100, w: 22, stand: 20, duck: 10, footOffset: 0,
  g: 980, peak: 50,
  laneSpeed: 78, duckDelay: 0.11
};
var JUMP_V = -Math.sqrt(2 * P.g * P.peak);      // ~ -313, apex 50 px at 0.32 s

var CHAR_SC = 1.32;                  // character sprite scale (art px -> logical)

var RUN = {
  v0: 150, vMax: 290, ramp: 300,
  gap0: 315, gapMin: 200,
  coinGap: 104
};

/* lane the pilot will actually be standing in when a hazard that is `tti`
   seconds away arrives (a lane change takes time) */
function laneAt(s, tti) {
  if (s.lane === s.targetLane) return s.lane;
  if (tti <= Math.abs(s.targetLane - s.lane) * (8 / P.laneSpeed) + 0.05) return s.lane;
  return s.targetLane;
}

function mkWorld(seed) {
  return {
    rng: rnd(seed), seed: seed,
    x: P.x,
    time: 0, scroll: 0, speed: RUN.v0,
    obs: [], coins: [],
    spawnAt: 420, coinAt: 330,
    lane: 1, targetLane: 1, y: LANE_Y[1],
    vy: 0, onGround: true, ducking: false, duckT: 0,
    switchCd: 0, action: 'run',
    coinCount: 0, spawnedCoins: 0, dist: 0,
    dead: false, deadT: 0, deaths: 0, runs: 0,
    runCoins: 0, runDist: 0, runTime: 0,
    best: 0, bestCoins: 0,
    bigDist: 0, bigCoins: 0, bigSpawn: 0, bigRuns: 0, bigTime: 0,
    lastRun: null, needsSort: false, coinHead: 0
  };
}

/* ---------------- geometry ----------------
   one ground line per lane drives both the artwork and the hitboxes, so
   what the player sees is exactly what the simulation tests            */
function propSize(o) {
  var d = OBST[o.t], s = SPR[d.spr];
  return { w: s.w * d.sc, h: s.h * d.sc };
}
/* sprite placement: the art's bottom rests on the lane's art line */
function propRect(o) {
  var d = OBST[o.t], sz = propSize(o);
  var gy = d.air ? FLY_Y1 : (o.y + ART_FOOT);
  return { x: o.x - sz.w / 2, y: gy - sz.h, w: sz.w, h: sz.h, ground: gy };
}
/* hitbox: forgiving box, kept inside a single lane band for ground props
   so a prop can never reach into a neighbouring lane's character        */
function obBox(o) {
  var d = OBST[o.t], sz = propSize(o), pad = Math.max(1, sz.w * 0.07);
  var y1 = d.air ? FLY_Y1 : o.y;
  var y0 = y1 - Math.min(sz.h, LANE_STEP - 2);
  return { x0: o.x - sz.w / 2 + pad, x1: o.x + sz.w / 2 - pad, y0: y0, y1: y1 };
}
/* does this prop threaten the character running in lane `lane`? */
function threatens(o, lane) {
  return OBST[o.t].air || o.lane === lane;
}
function playerTop(s) { return s.y + P.footOffset - (s.ducking ? P.duck : P.stand); }
function playerBox(s) {
  var h = s.ducking ? P.duck : P.stand, b = s.y + P.footOffset;
  return { x0: s.x - P.w / 2, x1: s.x + P.w / 2, y0: b - h, y1: b };
}
function overlapsPlayer(s, o) {
  return hitAt(s, o, playerTop(s), s.y + P.footOffset);
}

/* Latest moment (seconds from now) at which a jump still carries the
   whole body over yTop for `dur` seconds, or Infinity when the arc can
   never do it.  Returns 0 when the player is already clear.            */
function clearTime(feetY, yTop, dur) {
  var h = feetY - P.stand - yTop;                // how far the head must rise
  if (h <= 0) return 0;                          // already clear
  var v = JUMP_V, g = P.g;
  var disc = v * v - 2 * g * h;
  if (disc < 0) return Infinity;                 // the arc never gets that high
  var sq = Math.sqrt(disc);
  var tUp = (-v - sq) / g;                       // head clears on the way up
  var tDown = (-v + sq) / g;                     // body drops back to it
  if (tUp < 0) tUp = 0;
  if (tDown - tUp < dur) return Infinity;        // not above it long enough
  return Math.max(0, tDown - dur);               // must start the jump by then
}

/* how (if at all) this obstacle can be passed, and from which distance
   the required action has to be started.
   `hitAt` mirrors the real collision test exactly (same boxes, same
   forgiveness) so the pilot can never disagree with the simulation.
   The jump test is trajectory based: the player must be above the
   obstacle's top for the whole crossing, so the aim is to be exactly at
   the apex when the obstacle passes.                                  */
function hitAt(s, o, top, bottom) {
  var b = obBox(o);
  return (s.x + P.w / 2 - 2 > b.x0) && (s.x - P.w / 2 + 2 < b.x1) &&
         (bottom - 1 > b.y0) && (top + 1 < b.y1);
}
function passesUnder(s, o) {
  var b = obBox(o);
  return (s.y + P.footOffset - P.duck + 1) >= b.y0;
}
function jumpPath(s, o) {
  var b = obBox(o), bot = s.y + P.footOffset;
  return { xLand: b.x1 + P.w / 2 + 3, xStart: b.x0 - P.w / 2 - 46 };
}
function passInfo(s, o, spd) {
  var b = obBox(o), d = OBST[o.t];
  var bot = s.y + P.footOffset;
  var canJump = false, jt = Infinity, jd = 0, canDuck = false;
  /* an obstacle with no gate can never be passed in this lane - it is a
     lane change, no matter how far away it still is                    */
  if (d.gates.length === 0) return { ok: false, need: 'lane' };
  if (d.gates.indexOf('jump') >= 0 && s.onGround) {
    /* the arc must span the obstacle's *hitbox* plus a small margin */
    jd = ((b.x1 - b.x0) + P.w + 30) / spd;
    jt = clearTime(bot, b.y0, jd);
    canJump = (jt < Infinity);
  }
  if (d.gates.indexOf('duck') >= 0 && s.onGround) canDuck = passesUnder(s, o);

  if (hitAt(s, o, bot - P.stand, bot)) {                   // running into it
    if (!canJump && !canDuck) return { ok: false, need: 'lane' };
    if (canDuck && !canJump) return { ok: true, need: 'duck', when: P.duckDelay, dur: 0.1 };
    if (canJump && canDuck) return { ok: true, need: 'duck', when: P.duckDelay, dur: 0.1 };
    return { ok: true, need: 'jump', when: jt, dur: jd };
  }
  if (!s.onGround) {
    /* already airborne: only the final landing arc matters */
    if (hitAt(s, o, bot - P.stand, bot + P.peak)) return { ok: false, need: 'lane' };
    return { ok: true, need: null };
  }
  /* on the ground and not yet touching: a jump becomes *required* once the
     remaining distance is shorter than the arc needed to clear the prop  */
  if (canJump) {
    var far = (b.x0 - (s.x + P.w / 2)) / spd;
    if (far < 1.05) {
      if (far > jd) return { ok: true, need: 'jump', when: jt, dur: jd };
      return { ok: false, need: 'lane' };                  // window missed
    }
  }
  if (canDuck) {
    var dfar = (b.x0 - (s.x + P.w / 2)) / spd;
    if (dfar < 0.65) return { ok: true, need: 'duck', when: P.duckDelay, dur: 0.1 };
  }
  return { ok: true, need: null };
}

/* the first prop that can still hurt a character running in `lane`
   (flying hazards threaten every lane)                                 */
function nextHazardIn(s, lane) {
  var best = null, bd = 1e9;
  for (var i = 0; i < s.obs.length; i++) {
    var o = s.obs[i];
    if (!threatens(o, lane)) continue;
    var b = obBox(o);
    if (b.x1 < s.x - P.w / 2) continue;
    var dist = b.x0 - (s.x + P.w / 2);
    if (dist < bd) { bd = dist; best = o; }
  }
  return best;
}

/* ---------------- coin affinity ----------------
   how many coins lie on a lane's natural running path just ahead       */
function coinScore(s, lane, win) {
  var y = LANE_Y[lane], bot = y + P.footOffset, top = bot - P.stand, n = 0;
  var lo = s.x - 16, hi = s.x + win;
  for (var i = 0; i < s.coins.length; i++) {
    var c = s.coins[i];
    if (c.lane !== lane || c.got) continue;
    if (c.x < lo || c.x > hi) continue;
    if (c.y >= top - 14 && c.y <= bot + 4) n++;
  }
  return n;
}

/* ---------------- action lookahead ----------------
   Every candidate action is verified by replaying the real physics and
   the real collision boxes; the same pass also counts the coins that
   would be picked up, so "safe" and "profitable" come from one model.  */
function tryAction(s, action, targetLane) {
  var h = 1 / 30, T = 2.0, steps = Math.round(T / h);
  var bot0 = s.y + P.footOffset;
  var y = s.y, vy = s.vy || 0, onGround = s.onGround;
  var duck = (action === 'duck');
  var tgt = (targetLane === undefined) ? s.targetLane : targetLane;
  var x = s.x, i, k, dx = s.speed * h;
  var coins = 0, safe = true;
  /* a jump is only ever committed to with margin to spare, because the
     real tick and this 30 Hz model drift apart by a pixel or two       */
  var MARGIN = (action === 'jump') ? 3 : 0;
  /* only the props that can reach the character matter.  While a lane
     change is in flight the runner physically straddles two lanes, so
     both of them have to be collision-checked.                        */
  var props = [], far = 0;
  var laneList = [tgt];
  if (s.lane !== tgt) laneList.push(s.lane);
  for (k = 0; k < s.obs.length; k++) {
    var src = s.obs[k];
    var onIt = false;
    for (var q2 = 0; q2 < laneList.length; q2++) if (threatens(src, laneList[q2])) onIt = true;
    if (!onIt) continue;
    var bx = obBox(src);
    if (bx.x1 < s.x - P.w / 2) continue;
    props.push({ t: src.t, x: src.x, y: src.y, lane: tgt });
    if (bx.x0 > far) far = bx.x0;
  }
  /* coins are collected as the world scrolls past (the list stays sorted
     by x, so only the relevant window is walked)                       */
  var purses = [], start = s.coinHead || 0, k2;
  while (start < s.coins.length && s.coins[start].x < s.x - 40) start++;
  for (k2 = start; k2 < s.coins.length; k2++) {
    var c = s.coins[k2];
    if (c.x > s.x + 420) break;
    if (c.lane !== tgt) continue;
    purses.push({ x: c.x, y: c.y });
  }
  var horizon = Math.max(far, s.x + 340);
  var lastStep = steps;
  if (props.length === 0) horizon = s.x + 340;
  lastStep = Math.min(steps, Math.ceil(((horizon - (x - P.w / 2)) / s.speed + 0.10) / h) + 1);

  for (i = 0; i < lastStep; i++) {
    if (i === 0 && action === 'jump' && onGround) { vy = JUMP_V; onGround = false; }
    if (!onGround) {
      vy += P.g * h; y += vy * h;
      var gy = LANE_Y[tgt];
      if (y >= gy && vy > 0) { y = gy; vy = 0; onGround = true; }
    } else {
      var ty = LANE_Y[tgt];
      if (Math.abs(ty - y) < 1e-6) y = ty;
      else { var st = P.laneSpeed * h, d = ty - y; y += (Math.abs(d) <= st) ? d : (d > 0 ? st : -st); }
    }
    var bb = bot0 - (duck ? P.duck : P.stand) - MARGIN;
    var pb = y + P.footOffset + MARGIN;
    for (k = 0; k < props.length; k++) {
      props[k].x -= dx;
      if (props[k].x < -60) continue;
      var ob = obBox(props[k]);
      if (pb - 1 > ob.y0 && bb + 1 < ob.y1 &&
          x + P.w / 2 - 2 + MARGIN > ob.x0 && x - P.w / 2 + 2 - MARGIN < ob.x1) {
        safe = false; k = props.length; i = lastStep;
      }
    }
    if (!safe) break;
    for (k = 0; k < purses.length; k++) {
      var p = purses[k];
      if (p.dead) continue;
      p.x -= dx;
      if (p.x < x - 40) { p.dead = true; continue; }
      if (p.x > x - P.w / 2 - 8 && p.x < x + P.w / 2 + 8 &&
          p.y > bb - 10 && p.y < pb + 10) { p.dead = true; coins++; }
    }
  }
  var out = s._res || (s._res = { safe: true, coins: 0 });
  out.safe = safe; out.coins = coins;
  return out;
}
/* cheap wrapper for the many "is this lane survivable" questions */
function canDo(s, action, lane) { return tryAction(s, action, lane).safe; }

/* how soon (seconds) the first prop that needs a *different* form than
   the current one will arrive in this lane                               */
function urgency(s, lane, action) {
  var d = (action === 'duck') ? P.duck : P.stand;
  var bb = s.y + P.footOffset - d;
  var pb = s.y + P.footOffset, t = 1e9;
  for (var i = 0; i < s.obs.length; i++) {
    var o = s.obs[i];
    if (!threatens(o, lane)) continue;
    var b = obBox(o);
    if (b.x1 < s.x - P.w / 2) continue;
    if (pb - 1 > b.y0 && bb + 1 < b.y1) {
      var gap = b.x0 - (s.x + P.w / 2);
      if (gap < 0) gap = 0;
      var tt = gap / s.speed;
      if (tt < t) t = tt;
    }
  }
  return t;
}

/* level a lane: 0 free, 1 act now (need), 2 change lane, 3 fatal */
function laneLevel(s, lane) {
  var res = { lane: lane, level: 0, need: null, tti: 1e9 };
  var hz = nextHazardIn(s, lane);
  if (hz) res.tti = Math.max(0, (obBox(hz).x0 - (s.x + P.w / 2)) / s.speed);
  var runR = tryAction(s, 'run', lane), runOK = runR.safe;
  if (runOK) {
    /* still safe, but a form change may become necessary in a moment -
       the expensive arc test only runs when the prop is actually close   */
    var tj = urgency(s, lane, 'jump'), td = urgency(s, lane, 'duck');
    if (tj < res.tti) res.tti = tj;
    if (td < res.tti) res.tti = td;
    if (tj <= 0.45 && s.onGround && canDo(s, 'jump', lane)) {
      res.level = 1; res.need = 'jump';
    } else if (td <= 0.16 && s.onGround && canDo(s, 'duck', lane)) {
      res.level = 1; res.need = 'duck';
    }
    return res;
  }
  var jumpOK = s.onGround && canDo(s, 'jump', lane);
  var duckOK = s.onGround && canDo(s, 'duck', lane);
  if (jumpOK || duckOK) {
    res.level = 1;
    res.need = jumpOK ? 'jump' : 'duck';
    return res;
  }
  var esc = (lane !== s.lane) ? Math.abs(lane - s.lane) * (8 / P.laneSpeed) : 1e9;
  res.level = (res.tti >= esc + 0.12) ? 2 : 3;
  res.need = 'lane';
  return res;
}

/* ---------------- the auto-pilot ----------------
   Priority is exactly: safety > coins > smoothness.
   1. act (jump / duck) when that alone survives the lane we are in;
   2. otherwise pick the lane with the best safe coin return;
   3. a lane change is always a safety action first.                   */
function pilot(s, dt) {
  var spd = s.speed, cur = s.lane, i, L;
  s.switchCd -= dt;
  if (!s.onGround) {
    /* mid-air: the lane is locked, only keep the current form alive */
    s.action = s.ducking ? 'duck' : 'jump';
    return;
  }
  var lv = [], lneed = [], li = [], runCoins = [0, 0, 0];
  for (i = 0; i < 3; i++) {
    var a = laneLevel(s, i);
    lv[i] = a.level; lneed[i] = a.need; li[i] = a;
    var rr = tryAction(s, 'run', i);
    runCoins[i] = rr.safe ? rr.coins : -1;          // -1 marks an unsafe lane
  }

  /* -- acting beats moving: never hop lanes for what we can clear -- */
  if (lv[cur] === 1 && lneed[cur]) {
    s.targetLane = cur;                            // abort any hop in progress
    s.action = lneed[cur];
    s.ducking = (s.action === 'duck');
    if (s.action === 'jump') { s.vy = JUMP_V; s.onGround = false; }
    return;
  }
  s.action = 'run';
  s.ducking = false;

  /* -- lane choice: safest first, then the richest coin trail -- */
  var laneOK = function (L) {
    if (lv[L] >= 3 || runCoins[L] < 0) return false;
    if (L === cur) return true;
    if (s.switchCd > 0) return false;
    if (s.lane !== s.targetLane && L !== s.targetLane) return false;
    var esc = Math.abs(L - cur) * (8 / P.laneSpeed);
    if (li[L].tti < esc + 0.30) return false;
    var mid = (L + cur) / 2;
    if (mid !== cur && mid !== L && lv[mid] >= 3) return false;
    return true;
  };

  var best = cur, bestScore = -1e9;
  for (L = 0; L < 3; L++) {
    if (!laneOK(L)) continue;
    var sc = -lv[L] * 6 + runCoins[L];
    if (L === cur) sc += 0.6;
    if (L === s.targetLane) sc += 0.3;
    if (sc > bestScore) { bestScore = sc; best = L; }
  }

  /* a threatened lane always steps aside ... */
  var curDanger = (lv[cur] >= 2 && li[cur].tti <= 2.4);
  if (!curDanger) {
    /* ... otherwise only a clearly richer coin trail justifies a hop */
    if (best !== cur && runCoins[best] < runCoins[cur] + 3) best = cur;
  }
  if (best !== cur && s.switchCd <= 0) { s.targetLane = best; s.switchCd = 0.26; }
}

/* ---------------- one simulation tick ---------------- */
function updateWorld(s, dt, opts) {
  opts = opts || {};
  if (s.dead) { s.deadT += dt; return; }

  s.time += dt; s.runTime += dt;
  s.speed = Math.min(RUN.vMax, RUN.v0 + (RUN.vMax - RUN.v0) * (s.time / RUN.ramp));
  var dx = s.speed * dt;
  s.x = P.x;
  s.scroll += dx; s.dist += dx; s.runDist += dx;

  if (!opts.noPilot) pilot(s, dt);

  /* vertical */
  if (!s.onGround) {
    s.vy += P.g * dt;
    s.y += s.vy * dt;
    var gy = LANE_Y[s.targetLane];
    if (s.y >= gy && s.vy > 0) { s.y = gy; s.vy = 0; s.onGround = true; }
  }
  /* lateral: one lane change at a time, and `lane` only flips on arrival
     so the pilot can never plan a second hop while still travelling     */
  if (s.onGround) {
    var ty = LANE_Y[s.targetLane];
    if (Math.abs(ty - s.y) < 0.001) { s.y = ty; s.lane = s.targetLane; }
    else {
      var step = P.laneSpeed * dt, d = ty - s.y;
      if (Math.abs(d) <= step) { s.y = ty; s.lane = s.targetLane; }
      else s.y += (d > 0 ? step : -step);
    }
  }
  /* duck transition */
  if (s.ducking) s.duckT = Math.min(1, s.duckT + dt / P.duckDelay);
  else s.duckT = Math.max(0, s.duckT - dt / P.duckDelay);

  /* collisions + pickups */
  var pb, i, o, c;
  for (i = s.obs.length - 1; i >= 0; i--) {
    o = s.obs[i];
    o.x -= dx;
    if (o.x < -90) { s.obs.splice(i, 1); continue; }
    if (overlapsPlayer(s, o)) {
      s.dead = true; s.deadT = 0; s.deaths++; s.runs++;
      s.lastHit = { t: o.t, lane: o.lane, x: o.x, y: o.y,
                    box: obBox(o), pbox: playerBox(s), py: s.y,
                    onGround: s.onGround, ducking: s.ducking };
      s.bigDist += s.runDist; s.bigCoins += s.runCoins; s.bigTime += s.runTime;
      s.bigSpawn += s.spawnedCoins; s.bigRuns++;
      if (s.runCoins > s.bestCoins) s.bestCoins = s.runCoins;
      if (s.runDist > s.best) s.best = s.runDist;
      s.lastRun = { coins: s.runCoins, dist: s.runDist, time: s.runTime };
      return;
    }
  }
  for (i = s.coins.length - 1; i >= 0; i--) {
    c = s.coins[i];
    c.x -= dx;
    if (c.x < -40) { s.coins.splice(i, 1); continue; }
    if (c.got) continue;
    pb = playerBox(s);
    if (c.x > pb.x0 - 8 && c.x < pb.x1 + 8 && c.y > pb.y0 - 10 && c.y < pb.y1 + 10) {
      c.got = true; s.coinCount++; s.runCoins++;
      s.coins.splice(i, 1);
    }
  }
  spawnAhead(s);
}

/* ---------------- course generation ---------------- */
function spawnAhead(s) {
  var d = s.time / RUN.ramp;
  var gap = RUN.gap0 + (RUN.gapMin - RUN.gap0) * d;
  var horizon = s.scroll + AW + 560;
  var guard = 0;
  while (s.spawnAt < horizon && guard++ < 40) {
    makeGroup(s, s.spawnAt);
    s.spawnAt += gap * (0.85 + s.rng() * 0.45);
  }
  guard = 0;
  var cHorizon = s.scroll + AW + 520;
  while (s.coinAt < cHorizon && guard++ < 60) {
    makeCoins(s, s.coinAt);
    s.coinAt += RUN.coinGap * (0.85 + s.rng() * 0.4);
  }
  /* keep the list ordered so the AI can window it cheaply */
  if (s.coins.length > 1 && s.needsSort) {
    s.coins.sort(function (a, b) { return a.x - b.x; });
    s.needsSort = false;
  }
}

function hazardNear(s, lane, x, pad) {
  for (var i = 0; i < s.obs.length; i++) {
    var o = s.obs[i];
    if (o.lane !== lane && !OBST[o.t].air) continue;
    var b = obBox(o);
    if (x > b.x0 - pad && x < b.x1 + pad) return o;
  }
  return null;
}

function makeGroup(s, at) {
  var r = s.rng;
  var kinds = ['stump', 'log', 'boulder', 'bat', 'stump', 'log'];
  if (s.time > 18) kinds.push('pillar');
  if (s.time > 40) kinds.push('pillar', 'bat');

  var free = [];
  for (var i = 0; i < 3; i++) if (!hazardNear(s, i, at, 34)) free.push(i);
  if (free.length === 0) return;

  var kind = kinds[(r() * kinds.length) | 0];
  var block = [];
  if (OBST[kind].gates.length === 0) {                    // pillar: leave a way round
    var n = (free.length >= 3 && r() < 0.45) ? 2 : 1;
    for (var k = 0; k < n && free.length > 1; k++) {
      var pk = (r() * free.length) | 0;
      block.push(free[pk]); free.splice(pk, 1);
    }
  } else {
    var p0 = (r() * free.length) | 0;
    block.push(free[p0]);
    if (r() < 0.3 && free.length > 1) {
      var rest = [];
      for (var q = 0; q < free.length; q++) if (free[q] !== block[0]) rest.push(free[q]);
      if (rest.length) block.push(rest[(r() * rest.length) | 0]);
    }
  }
  for (var b = 0; b < block.length; b++) {
    s.obs.push({ t: kind, x: at, y: LANE_Y[block[b]], lane: block[b] });
  }
}

/* Coin trails always follow a path the character can actually run:
   - flat trails float in the middle of the picking band, so a runner
     collects them with margin to spare;
   - an arc trail over a jumpable prop follows the real jump parabola,
     so it is collected exactly when the prop is cleared.
   Trails appear in one or two lanes at a time, which is what makes a
   high collection rate reachable at all.                              */
var COIN_LIFT = 16;                  // how high a runner's coin floats
var COIN_MAX = 120;                  // never flood the lane with coins

function addCoin(s, lane, x, y) {
  if (x < s.x - 30) return;
  s.coins.push({ x: x, y: y, lane: lane, got: false });
  s.needsSort = true;
  s.spawnedCoins++;
}

function makeCoins(s, at) {
  if (s.coins.length >= COIN_MAX) return;
  var r = s.rng;
  var lanes = [0, 1, 2];
  /* shuffle, then take one to three lanes for this step */
  for (var k = 2; k > 0; k--) {
    var j = (r() * (k + 1)) | 0, t = lanes[k]; lanes[k] = lanes[j]; lanes[j] = t;
  }
  var count = (r() < 0.40) ? 3 : ((r() < 0.78) ? 2 : 1);
  for (var li = 0; li < count; li++) makeTrail(s, lanes[li], at);
  /* A coin trail is only worth having if the runner can reach it.  One
     extra trail is laid in the lane the character is heading for, so a
     skilled pilot really can bank most of the coins on the screen.    */
  if (count < 3 && r() < 0.85) {
    var lead = s.targetLane;
    var already = false;
    for (var q = 0; q < count; q++) if (lanes[q] === lead) already = true;
    if (!already) makeTrail(s, lead, at);
  }
}

function makeTrail(s, lane, at) {
  var r = s.rng;
  var hz = hazardNear(s, lane, at, 30);
  var grounded = LANE_Y[lane] + P.footOffset;
  var n, i, x, y;
  if (hz) {
    if (OBST[hz.t].gates.indexOf('jump') < 0) return;      // never bait a duck lane
    var ob = obBox(hz);
    n = 3 + ((r() * 2) | 0);
    var width = Math.max(30, ob.x1 - ob.x0);
    var step = width / (n + 1);
    var centre = (ob.x0 + ob.x1) / 2;
    for (i = 0; i < n; i++) {
      x = centre - width / 2 + step * (i + 1);
      var t = (x - centre) / (width * 0.75 + 14);          // -1 .. 1 across the hop
      if (t < -1) t = -1; if (t > 1) t = 1;
      y = grounded - 10 - 30 * (1 - t * t);
      if (hazardNear(s, lane, x, 6)) continue;
      addCoin(s, lane, x, y);
    }
    return;
  }
  /* flat trail, centred in the picking band */
  n = 4 + ((r() * 3) | 0);
  var x0 = at - (n - 1) * 8;
  for (i = 0; i < n; i++) {
    x = x0 + i * 16;
    if (hazardNear(s, lane, x, 12)) continue;
    y = grounded - COIN_LIFT;
    addCoin(s, lane, x, y);
  }
}

/* fresh world, carrying the running totals across */
function restart(s) {
  var seed = (s.seed * 1664525 + 1013904223) >>> 0;
  var ns = mkWorld(seed);
  ns.deaths = s.deaths; ns.runs = s.runs;
  ns.best = s.best; ns.bestCoins = s.bestCoins;
  ns.bigDist = s.bigDist; ns.bigCoins = s.bigCoins;
  ns.bigSpawn = s.bigSpawn; ns.bigRuns = s.bigRuns; ns.bigTime = s.bigTime;
  ns.lastRun = s.lastRun;
  return ns;
}













