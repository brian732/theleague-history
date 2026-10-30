const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const path=require('node:path');
const root=path.join(__dirname,'../');
const data=JSON.parse(fs.readFileSync(root+'data/league.json'));
const snapshot=JSON.parse(fs.readFileSync(root+'data/sleeper-history.json'));
const expectedGames=snapshot.seasons.reduce((n,s)=>n+Object.values(s.matchups).reduce((m,rows)=>m+rows.length/2,0),0);
const nodes=new Map();
const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',textContent:'',className:'',value:data.owners[0].sleeperUserId});return nodes.get(s)};
const src=fs.readFileSync(root+'app.js','utf8').replace(/\(async function init\(\) \{[\s\S]*?\}\)\(\);/,'');
async function run(offline){
 const ctx=vm.createContext({console:{log:console.log,warn:()=>{}},AbortSignal,Date,Set,Map,document:{querySelector:node,querySelectorAll:()=>[]},sessionStorage:{getItem:()=>null,setItem:()=>{}},fetch:async url=>{
   if(offline)throw Error('offline test');
   const [,id,kind,week]=url.match(/\/league\/([^/]+)(?:\/(users|rosters|matchups))?(?:\/(\d+))?/)||[];
   const saved=snapshot.seasons.find(s=>s.league.league_id===id);
   const value=saved?(kind==='matchups'?saved.matchups[week]:kind?saved[kind]:saved.league):{season:'2021',previous_league_id:'0'};
   return {ok:true,json:async()=>value};
 }});
 vm.runInContext(src,ctx);ctx.data=data;ctx.snapshot=snapshot;
 await vm.runInContext(`(async()=>{DATA=data; SNAPSHOT=snapshot; DATA.owners.forEach(o=>OWNER_BY_SLEEPER[o.sleeperUserId]=o); await loadSleeper(); buildEspnSeasons(); await loadHeadToHead(); renderAllTime(); renderHeadToHead();})()`,ctx);
 assert.equal(vm.runInContext('HEAD_TO_HEAD.length',ctx),expectedGames);
 assert.equal(vm.runInContext('H2H_COVERAGE.reduce((n,c)=>n+c.missing,0)',ctx),0);
 for(const saved of snapshot.seasons){
  const year=+saved.league.season;
  for(const roster of saved.rosters){
   ctx.owner=roster.owner_id;ctx.year=year;
   const actual=vm.runInContext(`(()=>{let w=0,l=0,t=0; HEAD_TO_HEAD.filter(g=>g.year===year&&(g.a===owner||g.b===owner)).forEach(g=>{const a=g.a===owner?g.ap:g.bp,b=g.a===owner?g.bp:g.ap;if(a>b)w++;else if(a<b)l++;else t++;});return [w,l,t]})()`,ctx);
   assert.deepEqual(Array.from(actual),[roster.settings.wins,roster.settings.losses,roster.settings.ties],`${year} ${roster.owner_id}`);
  }
 }
 const totals=vm.runInContext('allTimeTotals()',ctx);assert.equal(totals.length,10);
 assert.equal(totals.reduce((n,r)=>n+r.w,0), vm.runInContext('Object.values(SEASONS).reduce((n,s)=>n+s.standings.filter(r=>DATA.owners.some(o=>o.team===r.canonicalTeam)).reduce((a,r)=>a+r.w,0),0)',ctx));
 assert.equal(vm.runInContext('completedRegularWeeks({status:"in_season",settings:{playoff_week_start:15,last_scored_leg:8}})',ctx),8);
 assert.equal(vm.runInContext('pct(1,1,2)',ctx),.5);
 ctx.rosters=[{roster_id:1,owner_id:data.owners[0].sleeperUserId},{roster_id:2,owner_id:data.owners[1].sleeperUserId}];
 assert.equal(vm.runInContext('matchupGames([{roster_id:1,matchup_id:1,points:10,custom_points:0},{roster_id:2,matchup_id:1,points:0}],rosters,2026,1)[0].ap',ctx),0);
 console.log(`${offline?'Saved fallback':'Live API fixture'}: ${expectedGames} games; every owner reconciles with all five seasons; 2026 included.`);
}
(async()=>{await run(false);await run(true)})().catch(e=>{console.error(e);process.exit(1)});
