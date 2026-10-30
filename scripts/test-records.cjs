const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '../');
const data = JSON.parse(fs.readFileSync(root + 'data/league.json'));
const snapshot = JSON.parse(fs.readFileSync(root + 'data/sleeper-history.json'));
const espn = JSON.parse(fs.readFileSync(root + 'data/espn-history.json'));
const owners = Object.fromEntries(data.owners.map(o => [o.sleeperUserId, o]));
const guha = data.owners.find(o => o.name === 'Guha Sundaram').sleeperUserId;
const expected = [], seasonRecords = [], excluded = [];
const cents = n => Math.round(n * 100);
const canonical = t => ({'The Yang Gang':'Yang Gang','Brown and Bijan LLC':'Pain.','Team Pain':'Pain.','Brown and Bijan Co.':'Pain.'}[t] || t);
// Build an independent ledger from the two source formats, before loading app.js.
for (const s of espn.seasons) {
  const teams = Object.fromEntries(s.teams.map(t => [t.teamId, t]));
  for (const t of s.teams) {
    const rows = s.games.filter(g => [g.homeTeamId, g.awayTeamId].includes(t.teamId));
    let w=0,l=0,ties=0,pf=0,pa=0;
    for (const g of rows) {
      const a=g.homeTeamId===t.teamId?g.hp:g.ap, b=g.homeTeamId===t.teamId?g.ap:g.hp;
      pf+=a;pa+=b;if(a>b)w++;else if(a<b)l++;else ties++;
    }
    assert.deepEqual([w,l,ties,pf,pa],[t.w,t.l,t.t,cents(t.pf),cents(t.pa)],`${s.year} ESPN ${t.ownerName}`);
    if(t.sleeperUserId) seasonRecords.push({year:s.year,id:t.sleeperUserId,w,l,t:ties,pf,pa});
    assert(!(s.year===2020 && t.sleeperUserId===guha));
  }
  for(const g of s.games){
    const row={year:s.year,week:g.week,a:teams[g.homeTeamId].sleeperUserId,b:teams[g.awayTeamId].sleeperUserId,ap:g.hp,bp:g.ap};
    (row.a&&row.b?expected:excluded).push(row);
  }
  const written = data.seasons.find(x=>x.year===s.year);
  for(const [rank,key] of [[1,'champion'],[2,'runnerUp'],[3,'third'],[4,'fourth']]) {
    const owner=s.teams.find(t=>t.finalRank===rank).ownerName;
    const id=data.owners.find(o=>o.name===owner).sleeperUserId;
    assert.equal(canonical(written[key]),owners[id].team,`${s.year} ESPN ${key}`);
  }
}
for(const s of snapshot.seasons){
  const year=+s.league.season, end=s.league.settings.playoff_week_start-1;
  const rosterOwners=Object.fromEntries(s.rosters.map(r=>[r.roster_id,r.owner_id]));
  const ledger=[];
  for(const [week,rows] of Object.entries(s.matchups)){
    if(+week>end || +week>s.league.settings.last_scored_leg)continue;
    const groups=new Map();
    for(const r of rows){if(r.matchup_id!=null){if(!groups.has(r.matchup_id))groups.set(r.matchup_id,[]);groups.get(r.matchup_id).push(r)}}
    for(const pair of groups.values()){
      assert.equal(pair.length,2);const [a,b]=pair;
      ledger.push({year,week:+week,a:rosterOwners[a.roster_id],b:rosterOwners[b.roster_id],ap:cents(a.custom_points??a.points),bp:cents(b.custom_points??b.points)});
    }
  }
  expected.push(...ledger);
  for(const r of s.rosters){
    const games=ledger.filter(g=>g.a===r.owner_id||g.b===r.owner_id);
    let w=0,l=0,t=0,pf=0,pa=0;
    for(const g of games){const a=g.a===r.owner_id?g.ap:g.bp,b=g.a===r.owner_id?g.bp:g.ap;pf+=a;pa+=b;if(a>b)w++;else if(a<b)l++;else t++}
    const v=r.settings;
    assert.deepEqual([w,l,t,pf,pa],[v.wins,v.losses,v.ties,(v.fpts||0)*100+(v.fpts_decimal||0),(v.fpts_against||0)*100+(v.fpts_against_decimal||0)],`${year} Sleeper ${owners[r.owner_id].name}`);
    seasonRecords.push({year,id:r.owner_id,w,l,t,pf,pa});
  }
  if(s.league.status==='complete'){
    const written=data.seasons.find(x=>x.year===year);
    for(const [place,winKey,loseKey] of [[1,'champion','runnerUp'],[3,'third','fourth']]){
      const match=s.winnersBracket.find(g=>g.p===place);
      assert.equal(owners[rosterOwners[match.w]].team,canonical(written[winKey]),`${year} ${winKey}`);
      assert.equal(owners[rosterOwners[match.l]].team,canonical(written[loseKey]),`${year} ${loseKey}`);
    }
  }
}
assert.equal(excluded.length,12,'Oliver had 12 regular-season games in 2020');
assert.equal(expected.filter(g=>g.year===2020&&(g.a===guha||g.b===guha)).length,0);
const src=fs.readFileSync(root+'app.js','utf8').replace(/\(async function init\(\) \{[\s\S]*?\}\)\(\);/,'');
async function run(offline){
  const nodes=new Map();const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',textContent:'',className:'',value:data.owners[0].sleeperUserId});return nodes.get(s)};
  const ctx=vm.createContext({console:{log:console.log,warn:()=>{}},AbortSignal,Date,Set,Map,document:{querySelector:node,querySelectorAll:()=>[]},sessionStorage:{getItem:()=>null,setItem:()=>{}},fetch:async url=>{
    if(offline)throw Error('offline test');
    const [,id,kind,week]=url.match(/\/league\/([^/]+)(?:\/(users|rosters|matchups))?(?:\/(\d+))?/)||[];
    const s=snapshot.seasons.find(s=>s.league.league_id===id);
    return {ok:true,json:async()=>s?(kind==='matchups'?s.matchups[week]:kind?s[kind]:s.league):{season:'2021',previous_league_id:'0'}};
  }});
  vm.runInContext(src,ctx);Object.assign(ctx,{data,snapshot,espn});
  await vm.runInContext(`(async()=>{DATA=data;SNAPSHOT=snapshot;ESPN_HISTORY=espn;DATA.owners.forEach(o=>OWNER_BY_SLEEPER[o.sleeperUserId]=o);await loadSleeper();buildEspnSeasons();await loadHeadToHead();renderAllTime();renderHeadToHead();})()`,ctx);
  const actual=JSON.parse(vm.runInContext('JSON.stringify(HEAD_TO_HEAD)',ctx));
  const key=g=>`${g.year}/${g.week}/${[g.a,g.b].sort().join('/')}`;
  assert.equal(actual.length,expected.length);assert.equal(new Set(actual.map(key)).size,actual.length);
  const ledgerMap=new Map(expected.map(g=>[key(g),g]));
  for(const g of actual){const e=ledgerMap.get(key(g));assert(e);assert.equal(g.ap,g.a===e.a?e.ap:e.bp);assert.equal(g.bp,g.b===e.b?e.bp:e.ap)}
  const totals=JSON.parse(vm.runInContext('JSON.stringify(allTimeTotals())',ctx));assert.equal(totals.length,10);
  for(const o of data.owners){
    const rows=seasonRecords.filter(r=>r.id===o.sleeperUserId);
    const total=totals.find(t=>t.team===o.team);
    for(const k of ['w','l','t'])assert.equal(total[k],rows.reduce((n,r)=>n+r[k],0),`${o.name} all-time ${k}`);
    for(const k of ['pf','pa'])assert.equal(cents(total[k]),rows.reduce((n,r)=>n+r[k],0),`${o.name} all-time ${k}`);
    assert.equal(total.seasons,rows.length);
    ctx.owner=o.sleeperUserId;
    const h=JSON.parse(vm.runInContext('JSON.stringify(headToHeadTotal(owner))',ctx));
    const removed=excluded.filter(g=>g.a===o.sleeperUserId||g.b===o.sleeperUserId);
    const rw=removed.filter(g=>(g.a===o.sleeperUserId?g.ap:g.bp)>(g.a===o.sleeperUserId?g.bp:g.ap)).length;
    const rl=removed.length-rw;
    assert.deepEqual([h.w,h.l,h.t],[total.w-rw,total.l-rl,total.t],`${o.name}: H2H only differs by games against Oliver`);
    for(const opponent of data.owners){if(opponent===o)continue;ctx.opponent=opponent.sleeperUserId;
      const pair=JSON.parse(vm.runInContext('JSON.stringify([headToHeadRecord(owner,opponent),headToHeadRecord(opponent,owner)])',ctx));
      assert.deepEqual([pair[0].w,pair[0].l,pair[0].t,cents(pair[0].pf),cents(pair[0].pa)],[pair[1].l,pair[1].w,pair[1].t,cents(pair[1].pa),cents(pair[1].pf)]);
    }
  }
  assert.equal(totals.find(t=>t.team===owners[guha].team).seasons,6);
  assert.equal(vm.runInContext('pct(1,1,2)',ctx),.5);
  console.log(`${offline?'Saved fallback':'Live fixture'}: ${expected.length} unique games; 7 seasons; all owners’ W/L/T/PF/PA validated; Oliver’s 12 games excluded from H2H; Guha starts in 2021.`);
}
(async()=>{await run(false);await run(true)})().catch(e=>{console.error(e);process.exit(1)});
