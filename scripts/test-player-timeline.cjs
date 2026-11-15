const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context=vm.createContext({Intl,Date});vm.runInContext(fs.readFileSync(__dirname+'/../player-history-model.js','utf8')+'\nthis.model=PlayerHistoryModel',context);const model=context.model;
const data=JSON.parse(fs.readFileSync(__dirname+'/../data/player-history.json'));
const byTrades=model.sorted(data.players,'trades'),byTeams=model.sorted(data.players,'teams');
assert(byTrades.every(p=>p.tradeCount>0));assert(byTrades.every((p,i)=>!i||p.tradeCount<=byTrades[i-1].tradeCount));assert(byTeams.every((p,i)=>!i||p.teamCount<=byTeams[i-1].teamCount));
assert.equal(model.sorted([{name:'Excluded',teamCount:2,tradeCount:100}], 'trades').length,0);
for(const p of data.players){
 const tradesOnly=model.tradeTimeline(p,data.deals,data.updatedAt);assert.equal(tradesOnly.length,p.tradeCount);assert(tradesOnly.every(t=>data.deals[t.dealId].status==='completed'));
 const rows=model.timeline(p,data.updatedAt);
 assert.equal(rows.filter(r=>r.kind==='Traded').length,p.tradeCount,p.name);
 assert.equal(new Set(rows.map(r=>r.id)).size,rows.length,`${p.name}: duplicate timeline events`);
 assert(rows.every((r,i)=>Number.isFinite(r.sortAt)&&(!i||rows[i-1].year<r.year||rows[i-1].year===r.year&&rows[i-1].sortAt<=r.sortAt)),p.name);
}
const player={history:[{ownerId:'a',year:2026,source:'Sleeper',weeks:[1,2,4],current:true,events:[{kind:'Drafted'},{kind:'Drafted',date:'2026-08-15',timestamp:Date.parse('2026-08-15T18:00:00Z')},{kind:'Traded out',tradeId:'t1'},{kind:'Traded in',tradeId:'t2'}]}],trades:[{id:'t1',year:2026,source:'Sleeper',timestamp:Date.parse('2026-10-01T10:00:00Z'),fromOwnerId:'a',toOwnerId:'b'},{id:'t2',year:2026,source:'Sleeper',timestamp:Date.parse('2026-10-01T12:00:00Z'),fromOwnerId:'b',toOwnerId:'a'}]};
const rows=model.timeline(player,'2026-11-15T03:00:00Z');assert.equal(rows.filter(r=>r.kind==='Drafted').length,1);assert.equal(rows.filter(r=>r.kind==='Rostered').length,2);assert.equal(rows.filter(r=>r.kind==='Traded').length,2);assert.equal(rows.at(-1).date,'2026-11-14');assert.equal(rows.at(-1).kind,'Current roster');
console.log('Sort and timeline checks passed: 3+ threshold, both rankings, all chronological events, separate same-day trades, split roster runs, single draft entries, and Eastern snapshot date');

assert.equal(model.sorted([{name:'Not traded',teamCount:10,tradeCount:0}], 'trades').length,0);
assert.equal(model.tradeTimeline({trades:[{id:'t1',dealId:'d1',year:2026,period:1},{id:'t2',dealId:'d2',year:2026,period:2},{id:'t3',dealId:'missing',year:2026,period:3}]},{d1:{status:'completed'},d2:{status:'pending'}},data.updatedAt).length,1);
console.log('Trade-only checks passed: no zero-trade players; no pending/missing/non-trade timeline records');
