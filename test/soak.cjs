/* Headless soak test: runs the real game core + world at a fixed 60 Hz.
   Reports the acceptance metrics (deaths, survival, coin rate, perf). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const TOOLS = path.join(__dirname, '..', 'tools');
const sandbox = { console, Math, Date, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 } };
vm.createContext(sandbox);

const art = JSON.parse(fs.readFileSync(path.join(TOOLS, 'art.json'), 'utf8'));
const cloud = JSON.parse(fs.readFileSync(path.join(TOOLS, 'cloud_runs.json'), 'utf8'));
sandbox.APAL = art.pal;
sandbox.ART = art.art;
sandbox.CLOUD_RUNS = cloud;

for (const f of ['game_core.js', 'game_world.js']) {
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: f });
  } catch (e) {
    console.error('LOAD FAIL', f, e.message);
    process.exit(1);
  }
}

const { mkWorld, updateWorld, restart, playerBox, obBox, OBST, P, LANE_Y, AW, AH, rnd } = sandbox;
const STEP = 1 / 60;

function runOne(seed, seconds, trace) {
  let s = mkWorld(seed);
  const frames = Math.round(seconds * 60);
  const t0 = process.hrtime.bigint();
  let maxFrameUs = 0;
  let deaths0 = 0, spawn0 = 0;
  const log = [];
  let lastRunStart = 0;
  for (let i = 0; i < frames; i++) {
    const a = process.hrtime.bigint();
    updateWorld(s, STEP);
    const b = process.hrtime.bigint();
    const us = Number(b - a) / 1000;
    if (us > maxFrameUs) maxFrameUs = us;
    if (s.dead) {
      if (trace) log.push({ t: s.time.toFixed(2), run: (s.runTime).toFixed(2), coins: s.runCoins, dist: Math.round(s.runDist), action: s.action, lane: s.lane, y: Math.round(s.y), onGround: s.onGround, ducking: s.ducking, speed: Math.round(s.speed), kinds: s.obs.map(o => o.t + '@' + o.lane + ':' + Math.round(o.x)).slice(0, 4) });
      s = restart(s);
    }
  }
  const total = process.hrtime.bigint();
  return {
    seconds, deaths: s.deaths, runs: s.bigRuns,
    avgSurvival: s.bigRuns ? s.bigTime / s.bigRuns : 0,
    avgDist: s.bigRuns ? s.bigDist / s.bigRuns : 0,
    coinRate: s.bigSpawn ? s.bigCoins / s.bigSpawn : 0,
    coins: s.bigCoins, spawned: s.bigSpawn,
    wallMs: Number(total - t0) / 1e6, maxFrameUs, log,
    finalSpeed: s.speed
  };
}

const SECONDS = Number(process.argv[2] || 300);
const seeds = [1, 7, 42, 1234, 99991];
let agg = { deaths: 0, runs: 0, time: 0, dist: 0, coins: 0, spawned: 0, wall: 0, maxUs: 0 };
const per = [];
for (const seed of seeds) {
  const r = runOne(seed, SECONDS, seed === 7);
  per.push(r);
  agg.deaths += r.deaths; agg.runs += r.runs; agg.time += r.seconds * 0; // per-run times summed below
  agg.dist += r.avgDist * r.runs; agg.coins += r.coins; agg.spawned += r.spawned;
  agg.wall += r.wallMs; agg.maxUs = Math.max(agg.maxUs, r.maxFrameUs);
  console.log(`seed ${String(seed).padStart(6)} | deaths ${String(r.deaths).padStart(3)} | runs ${String(r.runs).padStart(3)} | avg survival ${r.avgSurvival.toFixed(1)}s | avg dist ${Math.round(r.avgDist)} | coin rate ${(100 * r.coinRate).toFixed(1)}% (${r.coins}/${r.spawned}) | sim ${r.wallMs.toFixed(0)}ms | max frame ${r.maxFrameUs.toFixed(0)}us`);
}
const totalRuns = per.reduce((a, r) => a + r.runs, 0);
const totalTime = per.reduce((a, r) => a + r.avgSurvival * r.runs, 0);
console.log('\n---- aggregate over ' + seeds.length + ' x ' + SECONDS + 's (' + (seeds.length * SECONDS / 60).toFixed(0) + ' min) ----');
console.log('  deaths / 5min        : ' + (agg.deaths / seeds.length / (SECONDS / 300)).toFixed(2) + '   (limit 5)');
console.log('  runs (restarts)      : ' + totalRuns);
console.log('  avg survival         : ' + (totalTime / totalRuns).toFixed(1) + 's   (min 45s)');
console.log('  avg distance / run   : ' + Math.round(agg.dist / totalRuns) + ' px');
console.log('  coin collection rate : ' + (100 * agg.coins / agg.spawned).toFixed(1) + '%   (target 70%)');
console.log('  simulation speed     : ' + (SECONDS * seeds.length * 1000 / agg.wall).toFixed(0) + 'x realtime');
console.log('  worst frame (logic)  : ' + agg.maxUs.toFixed(0) + ' us');

const t = per.find(r => r.log && r.log.length);
if (t) {
  console.log('\n---- first 12 death events (seed 7) ----');
  t.log.slice(0, 12).forEach(e => console.log('  t=' + e.t + ' run=' + e.run + 's coins=' + e.coins + ' dist=' + e.dist + ' | lane=' + e.lane + ' y=' + e.y + ' ground=' + e.onGround + ' duck=' + e.ducking + ' act=' + e.action + ' spd=' + e.speed + ' | ' + e.kinds.join(' ')));
}
