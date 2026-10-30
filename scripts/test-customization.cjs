const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'../'),read=name=>JSON.parse(fs.readFileSync(root+'data/'+name));
const data=read('league.json'),snapshot=read('sleeper-history.json'),espn=read('espn-history.json'),playoffs=read('playoffs.json');
const markup=fs.readFileSync(root+'index.html','utf8');
assert(!/announcementList|editAnnouncements|addAnnouncement/.test(markup));
assert(markup.indexOf('class="rivalry"')>markup.indexOf('id="gridHistory"'));
const nodes=new Map(),node=s=>{if(!nodes.has(s))nodes.set(s,{value:'',innerHTML:'',textContent:'',disabled:false,remove(){}});return nodes.get(s)};
const ctx=vm.createContext({console:{warn(){}},AbortSignal,Date,Set,Map,TextEncoder,TextDecoder,Uint8Array,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),document:{querySelector:node,querySelectorAll:()=>[]},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},localStorage:{removeItem(){}},fetch:async()=>{throw Error('offline fixture')}});
for(const file of ['explorer.js','preferences.js','editor.js','app.js'])vm.runInContext(fs.readFileSync(root+file,'utf8').replace(/\(async function init\(\) \{[\s\S]*?\}\)\(\);/,''),ctx);
Object.assign(ctx,{data,snapshot,espn,playoffs});
const run=code=>vm.runInContext(code,ctx),json=code=>JSON.parse(run('JSON.stringify('+code+')'));
(async()=>{
 await run(`(async()=>{DATA=data;SNAPSHOT=snapshot;ESPN_HISTORY=espn;DATA.owners.forEach(o=>OWNER_BY_SLEEPER[o.sleeperUserId]=o);await loadSleeper();buildEspnSeasons();await loadHeadToHead();PLAYOFF_GAMES=playoffs.games;})()`);
 assert.equal(run('filteredGames().length'),428);
 run('renderTrophies()');
 assert.equal((node('#champTable').innerHTML.match(/<tr>/g)||[]).length,11,'all ten owners plus the header');
 for(const name of ['Team Fielding','PanFam','~ Suck My Ditka','NORTH KOREA GINGA NINJAS'])assert(node('#champTable').innerHTML.includes(name));
 assert(node('#champTable').innerHTML.includes('>0</td>'));
 assert.equal(run('rivalryResultClass("a","a")'),'result-win');assert.equal(run('rivalryResultClass("a","b")'),'result-loss');assert.equal(run('rivalryResultClass(null,"a")'),'result-tie');
 const original=json('allTimeTotals()'),view=json('explorerTotals()');
 for(const r of original){const v=view.find(x=>x.team===r.team);for(const k of ['w','l','t','pf','pa'])assert(Math.abs(r[k]-v[k])<.001,`${r.team} regular ${k}`)}
 run("EXPLORER.competition='playoffs'");assert.equal(run('filteredGames().length'),24);
 const post=json('explorerTotals()');assert.equal(post.reduce((n,r)=>n+r.w,0),24);assert.equal(post.reduce((n,r)=>n+r.l,0),24);
 run("EXPLORER.competition='combined'");assert.equal(run('filteredGames().length'),452);
 const combined=json('explorerTotals()');for(const r of original){const v=combined.find(x=>x.team===r.team),p=post.find(x=>x.team===r.team);assert.equal(v.w,r.w+p.w);assert.equal(v.l,r.l+p.l)}
 run("EXPLORER.mode='single';EXPLORER.from=2020;EXPLORER.to=2020;EXPLORER.competition='regular'");assert.equal(run('filteredGames().length'),48);assert.equal(json('explorerTotals()').find(r=>r.team==='Pain.').w,0);
 run("EXPLORER.competition='playoffs';EXPLORER.from=2026;EXPLORER.to=2026");assert.equal(run('filteredGames().length'),0);assert(json('explorerTotals()').every(r=>r.w===0&&r.l===0));
 run("EXPLORER.mode='range';EXPLORER.from=2020;EXPLORER.to=2021");assert.equal(run('filteredGames().length'),8);assert.equal(run("PLAYOFF_GAMES.filter(g=>g.year===2020&&g.stage==='Championship')[0].endWeek"),16);
 for(const saved of snapshot.seasons){ctx.saved=saved;const actual=json('sleeperPlayoffSeries(saved.league,saved.rosters,saved.winnersBracket,saved.matchups)');assert.equal(actual.length,playoffs.games.filter(g=>g.year===+saved.league.season).length);for(const g of actual){const archived=playoffs.games.find(x=>x.year===g.year&&x.a===g.a&&x.b===g.b);assert.deepEqual(g,archived)}}

 // A completed current season must still refresh even when the bundled archive is older.
 let bracketReads=0;
 ctx.fetch=async url=>{if(url==='data/playoffs.json')return {ok:true,json:async()=>playoffs};const saved=snapshot.seasons.find(s=>url.includes(s.league.league_id));if(url.endsWith('/winners_bracket')){bracketReads++;return{ok:true,json:async()=>saved.winnersBracket}}const week=url.split('/').pop();return{ok:true,json:async()=>saved.matchups[week]}};
 run("CURRENT=SEASONS[2025].league");await run('loadPlayoffHistory()');assert.equal(bracketReads,1);assert.equal(run('PLAYOFF_GAMES.length'),24);
 ctx.id=data.owners[0].sleeperUserId;
 run("PUBLISHED_DATA=cloneContent(DATA);EDITOR_DRAFT=emptyDraft();EDITOR_DRAFT.owners[id]={bio:'Unicode 🏈 preview <script>text</script>'};");
 ctx.sharedPhoto='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=';
 run('EDITOR_DRAFT.owners[id].photo=sharedPhoto');
 const withPhoto=json('validateDraft(EDITOR_DRAFT,PUBLISHED_DATA)');assert.equal(withPhoto.owners[data.owners[0].sleeperUserId].photo,ctx.sharedPhoto);
 run('PREFERENCES.photos={[id]:"https://example.com/old-local-override.jpg"}');
 assert(run('ownerAvatar({...DATA.owners[0],photo:sharedPhoto})').includes(ctx.sharedPhoto));assert(!run('ownerAvatar({...DATA.owners[0],photo:sharedPhoto})').includes('old-local-override'));
 assert.throws(()=>run('validateDraft({owners:{[id]:{photo:"data:image/svg+xml;base64,PHN2Zz4="}},seasons:{}},PUBLISHED_DATA)'),/HTTPS/);
 assert.throws(()=>run('validateDraft({owners:{[id]:{photo:"data:image/jpeg;base64,"+"A".repeat(100001)}},seasons:{}},PUBLISHED_DATA)'),/too long/);

 const patched=json('applyDraft(PUBLISHED_DATA,validateDraft(EDITOR_DRAFT,PUBLISHED_DATA))');assert.equal(patched.owners[0].bio,'Unicode 🏈 preview <script>text</script>');assert.equal(patched.owners[0].sleeperUserId,data.owners[0].sleeperUserId);
 assert.equal(run("decodeGitHubContent(encodeGitHubContent({text:'🏈 Guha’s league'})).text"),'🏈 Guha’s league');
 run('latest=cloneContent(PUBLISHED_DATA);latest.league.entryFee="$300";');assert.equal(json('mergePublishedDraft(latest,PUBLISHED_DATA,EDITOR_DRAFT)').league.entryFee,'$300');
 run('latest.owners[0].bio="Changed elsewhere"');assert.throws(()=>run('mergePublishedDraft(latest,PUBLISHED_DATA,EDITOR_DRAFT)'),/changed on GitHub/);
 assert.throws(()=>run("validateDraft({owners:{[id]:{photo:'javascript:alert(1)'}},seasons:{}},PUBLISHED_DATA)"),/HTTPS/);
 assert.throws(()=>run("validateDraft({owners:{},seasons:{2026:{recap:'',awards:[{award:'',winner:''}]}}},PUBLISHED_DATA)"),/name and winner/);
 const protectedContent=json("applyDraft(PUBLISHED_DATA,validateDraft({owners:{[id]:{bio:'New',sleeperUserId:'bad',team:'bad'}},seasons:{}},PUBLISHED_DATA))");assert.equal(protectedContent.owners[0].team,data.owners[0].team);assert.equal(protectedContent.owners[0].sleeperUserId,data.owners[0].sleeperUserId);
 // Exercise the real publishing flow against a fake GitHub transport, never a live write.
 run('captureEditorFields=()=>{};fillEditorFields=()=>{};repaintEditableContent=()=>{};PREVIEWED_DRAFT=JSON.stringify(EDITOR_DRAFT);');
 const writes=[];ctx.fetch=async(url,options)=>{assert(url.startsWith('https://api.github.com/repos/brian732/theleague-history/contents/data/league.json'));assert.equal(options.headers.Authorization,'Bearer test-token');if(options.method==='PUT'){writes.push(JSON.parse(options.body));return{ok:true,json:async()=>({commit:{sha:'fixture'}})}}return{ok:true,json:async()=>({sha:'base-sha',content:Buffer.from(JSON.stringify(data)).toString('base64')})}};
 node('#publishToken').value='test-token';await run('publishEditorDraft({preventDefault(){}})');assert.equal(node('#publishToken').value,'');assert.equal(writes.length,1);assert.equal(writes[0].sha,'base-sha');assert.equal(writes[0].branch,'main');const sharedWrite=JSON.parse(Buffer.from(writes[0].content,'base64').toString('utf8'));assert.equal(sharedWrite.owners[0].photo,ctx.sharedPhoto);ctx.freshOwner=sharedWrite.owners[0];run('PREFERENCES.photos={}');assert(run('ownerAvatar(freshOwner)').includes(ctx.sharedPhoto));assert(node('#publishStatus').innerHTML.includes('Published to GitHub'));
 console.log('Customization checks passed: season filters, empty playoffs, all 24 series, combined totals, editor validation/conflicts, Unicode, shared photo publishing across devices, and mocked authorized publishing.');
})().catch(e=>{console.error(e);process.exit(1)});
