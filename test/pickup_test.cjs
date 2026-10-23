/* Direct pickup test: put a single coin in front of the character and see
   whether it is collected, at several heights and in every lane. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const TOOLS = path.join(__dirname, '..', 'tools');
const sandbox = { console, Math, Date };
vm.createContext(sandbox);
const art = JSON.parse(fs.readFileSync(path.join(TOOLS, 'art.json'), 'utf8'));
sandbox.APAL = art.pal; sandbox.ART = art.art;
sandbox.CLOUD_RUNS = JSON.parse(fs.readFileSync(path.join(TOOLS, 'cloud_runs.json'), 'utf8'));
for (const f of ['game_core.js', 'game_world.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
}
const S = sandbox;
const STEP = 1 / 60;

/* run the world without the pilot so nothing perturbs the path */
function trial(lane, lift, opts) {
  opts = opts || {};
  let s = S.mkWorld(4242);
  s.lane = lane; s.targetLane = lane; s.y = S.LANE_Y[lane];
  const grounded = S.LANE_Y[lane] + S.P.footOffset;
  /* clear whatever generation produced, then drop one test coin */
  s.coins.length = 0;
  s.obs.length = 0;
  s.spawnAt = 1e9; s.coinAt = 1e9;
  s.coins.push({ x: 260, y: grounded - lift, lane: lane, got: false });
  let frames = 0, got = false;
  for (let i = 0; i < 200; i++) {
    S.updateWorld(s, STEP, { noPilot: true });
    if (s.coins.length === 0 || s.coins[0].got) { got = true; frames = i; break; }
  }
  return { got, frames, coinX: s.coins.length ? s.coins[0].x : null };
}

console.log('=== single-coin pickup, no pilot, three lanes ===');
console.log('lift = how far the coin floats above the lane foot line\n');
const lifts = [0, 4, 8, 12, 16, 20, 24, 28, 32];
console.log('lane\\lift  ' + lifts.map(l => String(l).padStart(5)).join(''));
for (const lane of [0, 1, 2]) {
  const row = lifts.map(l => {
    const r = trial(lane, l);
    return (r.got ? '  yes' : '   no').padStart(5);
  });
  console.log('  L' + lane + '     ' + row.join(''));
}

console.log('\n=== pickup while jumping (coin on the arc) ===');
for (const lift of [30, 38, 46, 54]) {
  let s = S.mkWorld(99);
  s.lane = 1; s.targetLane = 1; s.y = S.LANE_Y[1];
  const grounded = S.LANE_Y[1] + S.P.footOffset;
  s.coins.length = 0; s.obs.length = 0; s.spawnAt = 1e9; s.coinAt = 1e9;
  s.coins.push({ x: 250, y: grounded - lift, lane: 1, got: false });
  let got = false;
  for (let i = 0; i < 240; i++) {
    /* jump when the coin is ~0.30 s away */
    if (s.onGround && (s.coins.length && s.coins[0].x - s.x) < 46) { s.vy = S.JUMP_V; s.onGround = false; }
    S.updateWorld(s, STEP, { noPilot: true });
    if (s.coins.length === 0) { got = true; break; }
  }
  console.log('  coin at laneFoot-' + String(lift).padStart(2) + '  ->  ' + (got ? 'COLLECTED' : 'missed'));
}
