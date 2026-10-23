const fs=require('fs'),path=require('path'),vm=require('vm');
const SRC=path.join(__dirname,'..','src'),TOOLS=path.join(__dirname,'..','tools');
const sb={console,Math,Date};vm.createContext(sb);
const art=JSON.parse(fs.readFileSync(path.join(TOOLS,'art.json'),'utf8'));
sb.APAL=art.pal;sb.ART=art.art;sb.CLOUD_RUNS=JSON.parse(fs.readFileSync(path.join(TOOLS,'cloud_runs.json'),'utf8'));
for(const f of ['game_core.js','game_world.js'])vm.runInContext(fs.readFileSync(path.join(SRC,f),'utf8'),sb,{filename:f});
const S=sb;
let s=S.mkWorld(1);
const t0=Date.now();
for(let i=0;i<60*300;i++){ if(s.dead) s=S.restart(s); S.updateWorld(s,1/60); }
const ms=Date.now()-t0;
console.log('300s sim in',ms,'ms =',(300000/ms).toFixed(0)+'x realtime');
console.log('deaths',s.deaths,'runs',s.bigRuns,'avgSurvival',(s.bigTime/s.bigRuns).toFixed(1),'coinRate',(100*s.bigCoins/s.bigSpawn).toFixed(1)+'%','avgDist',Math.round(s.bigDist/s.bigRuns));
