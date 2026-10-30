/* History controls share one filter across standings, rivalries, and the matrix. */
let EXPLORER = { mode: 'all', from: 2020, to: 2026, competition: 'regular', sort: 'pct', direction: -1 };
let PLAYOFF_GAMES = [];
let PLAYOFF_WARNING = '';
function selectedYear(year) { return EXPLORER.mode === 'all' || (+year >= EXPLORER.from && +year <= EXPLORER.to); }
function competitionLabel() { return ({regular:'Regular season',playoffs:'Playoffs',combined:'Regular season + playoffs'})[EXPLORER.competition]; }
function filteredGames() {
  const games = EXPLORER.competition === 'regular' ? HEAD_TO_HEAD : EXPLORER.competition === 'playoffs' ? PLAYOFF_GAMES : [...HEAD_TO_HEAD, ...PLAYOFF_GAMES];
  return games.filter(g => selectedYear(g.year));
}
function sleeperPlayoffSeries(league, rosters, bracket, weeks) {
  const owner = Object.fromEntries(rosters.map(r => [r.roster_id, r.owner_id]));
  return bracket.filter(g => g.w != null && g.l != null).flatMap(g => {
    let ap = 0, bp = 0; const played = [];
    Object.entries(weeks).forEach(([week, rows]) => {
      if (+week < league.settings.playoff_week_start) return;
      const a = rows.find(r => r.roster_id === g.t1), b = rows.find(r => r.roster_id === g.t2);
      if (!a || !b || a.matchup_id == null || a.matchup_id !== b.matchup_id) return;
      if (!Number.isFinite(a.custom_points ?? a.points) || !Number.isFinite(b.custom_points ?? b.points)) return;
      played.push(+week); ap += Math.round((a.custom_points ?? a.points) * 100); bp += Math.round((b.custom_points ?? b.points) * 100);
    });
    if (!played.length || !OWNER_BY_SLEEPER[owner[g.t1]] || !OWNER_BY_SLEEPER[owner[g.t2]]) return [];
    const winner = owner[g.w];
    if (ap !== bp && winner !== (ap > bp ? owner[g.t1] : owner[g.t2])) return [];
    return [{ year:+league.season, week:Math.min(...played), endWeek:Math.max(...played), a:owner[g.t1], b:owner[g.t2], ap, bp, winner,
      stage:g.p === 1 ? 'Championship' : g.p === 3 ? 'Third place' : 'Semifinal', source:'sleeper' }];
  });
}
async function loadPlayoffHistory() {
  PLAYOFF_WARNING = '';
  try { PLAYOFF_GAMES = (await getJSON('data/playoffs.json')).games; }
  catch (e) {
    PLAYOFF_GAMES = (SNAPSHOT?.seasons || []).flatMap(s => sleeperPlayoffSeries(s.league, s.rosters, s.winnersBracket || [], s.matchups));
    PLAYOFF_WARNING = 'The playoff archive could not be loaded; ESPN playoff series may be missing. Refresh to retry.';
  }
  const refresh = Object.values(SEASONS).filter(season => {
    const lg=season.league;if(!lg)return false;
    const scored=lg.settings.last_scored_leg||0;
    return scored>=lg.settings.playoff_week_start &&
      (lg.league_id===CURRENT?.league_id || PLAYOFF_GAMES.filter(g=>g.year===+lg.season).length<4);
  });
  await Promise.all(refresh.map(async season => {
    const lg=season.league,start=lg.settings.playoff_week_start;
    try {
      const bracket=await getJSON(`${API}/league/${lg.league_id}/winners_bracket`);
      const entries=await Promise.all(Array.from({length:lg.settings.last_scored_leg-start+1},async(_,i)=>[start+i,await getJSON(`${API}/league/${lg.league_id}/matchups/${start+i}`)]));
      const games=sleeperPlayoffSeries(lg,season.rosters,bracket,Object.fromEntries(entries));
      PLAYOFF_GAMES=[...PLAYOFF_GAMES.filter(g=>g.year!==+lg.season),...games];
    } catch(e) {PLAYOFF_WARNING='Some playoff results could not be refreshed. Showing the saved playoff archive where available.';}
  }));
}
function explorerTotals(options=EXPLORER) {
  const acceptsYear = year => options.mode === 'all' || (+year >= options.from && +year <= options.to);
  const rows = new Map(DATA.owners.map(o => [o.team, {team:o.team,id:o.sleeperUserId,w:0,l:0,t:0,pf:0,pa:0,seasons:0,titles:0,berths:0}]));
  const yearsByTeam = new Map(DATA.owners.map(o => [o.team,new Set()]));
  if (options.competition !== 'playoffs') Object.entries(SEASONS).forEach(([year, season]) => {
    if (!acceptsYear(year)) return;
    season.standings.forEach(r => {
      const total = rows.get(r.canonicalTeam); if (!total) return;
      for (const k of ['w','l','t','pf','pa']) total[k] += r[k] || 0;
      if (r.w+r.l+(r.t||0)) yearsByTeam.get(total.team).add(+year);
    });
  });
  if (options.competition !== 'regular') PLAYOFF_GAMES.filter(g => acceptsYear(g.year)).forEach(g => {
    for (const [id, pf, pa] of [[g.a,g.ap,g.bp],[g.b,g.bp,g.ap]]) {
      const o = OWNER_BY_SLEEPER[id], r = o && rows.get(o.team); if (!r) continue;
      r.pf += pf/100; r.pa += pa/100;
      if (pf > pa || (pf === pa && g.winner === id)) r.w++; else if (pf < pa || (pf === pa && g.winner && g.winner !== id)) r.l++; else r.t++;
      yearsByTeam.get(r.team).add(g.year);
    }
  });
  (DATA.seasons || []).filter(s => acceptsYear(s.year) && !s.inProgress).forEach(s => {
    const champion = rows.get(canonicalTeamFor(s.champion)); if (champion) champion.titles++;
    for (const k of ['champion','runnerUp','third','fourth']) {const r = rows.get(canonicalTeamFor(s[k])); if (r) r.berths++;}
  });
  rows.forEach(r => {r.seasons = yearsByTeam.get(r.team).size; r.pct=pct(r.w,r.l,r.t);});
  const key = options.sort;
  return [...rows.values()].sort((a,b) => options.direction * (key === 'name' ? OWNER_BY_SLEEPER[a.id].name.localeCompare(OWNER_BY_SLEEPER[b.id].name) : (a[key]-b[key])) || b.pf-a.pf || a.team.localeCompare(b.team));
}
function renderExplorerStandings() {
  const rows = explorerTotals();
  const heads = [['name','Franchise'],['w','W'],['l','L'],['t','T'],['pct','Win %'],['seasons','Seasons'],['pf','Points for'],['pa','Points against'],['titles','Titles'],['berths','Playoff berths']];
  $('#allTimeTable').innerHTML = `<div class="tbl-wrap"><table class="sortable-table"><thead><tr><th scope="col">#</th>${heads.map(([k,label]) => `<th scope="col" aria-sort="${EXPLORER.sort === k ? EXPLORER.direction === 1 ? 'ascending' : 'descending' : 'none'}"><button type="button" data-sort="${k}">${label}${EXPLORER.sort === k ? EXPLORER.direction === 1 ? ' ↑' : ' ↓' : ''}</button></th>`).join('')}</tr></thead><tbody>${rows.map((r,i) => `<tr data-owner="${r.id}" class="${typeof isFavorite === 'function' && isFavorite(r.id) ? 'my-team-row' : ''}"><td class="rank">${i+1}</td><td>${teamCell(r.team)}</td>${['w','l','t'].map(k=>`<td class="num">${r[k]}</td>`).join('')}<td class="num">${r.w+r.l+r.t ? r.pct.toFixed(3) : '—'}</td><td class="num">${r.seasons}</td><td class="num">${fmt(r.pf)}</td><td class="num">${fmt(r.pa)}</td><td class="num">${r.titles}</td><td class="num">${r.berths}</td></tr>`).join('')}</tbody></table></div>`;
  $('#allTimeTable').onclick = e => {const b=e.target.closest('[data-sort]');if(!b)return;EXPLORER.direction=EXPLORER.sort===b.dataset.sort?-EXPLORER.direction:b.dataset.sort==='name'?1:-1;EXPLORER.sort=b.dataset.sort;$('#standingsSort').value=EXPLORER.sort;renderExplorerStandings();};
  if ($('#filterSummary')) $('#filterSummary').textContent = `${EXPLORER.mode === 'all' ? 'All seasons' : EXPLORER.from === EXPLORER.to ? EXPLORER.from : `${EXPLORER.from}–${EXPLORER.to}`} · ${competitionLabel()}. Titles and playoff berths refer to the selected years.`;
  if ($('#standingsMethod')) $('#standingsMethod').textContent = 'Career standings include other owners’ games against Oliver in 2020. Head-to-head records exclude all of his games. Guha starts in 2021.' + (EXPLORER.competition !== 'regular' && PLAYOFF_WARNING ? ' '+PLAYOFF_WARNING : '');
}
function initExplorer() {
  const years=Object.keys(SEASONS).map(Number).sort((a,b)=>a-b);
  EXPLORER.from=years[0];EXPLORER.to=years[years.length-1];
  for(const id of ['fromYear','toYear']) $('#'+id).innerHTML=years.map(y=>`<option value="${y}">${y}</option>`).join('');
  $('#fromYear').value=String(EXPLORER.to);$('#toYear').value=String(EXPLORER.to);
  const options=DATA.owners.map(o=>`<option value="${o.sleeperUserId}">${esc(o.name)}</option>`).join('');
  $('#compareA').innerHTML=options;$('#compareB').innerHTML=options;
  $('#compareA').value=typeof favoriteOwnerId==='function' && favoriteOwnerId() || DATA.owners[0].sleeperUserId;
  $('#compareB').value=DATA.owners.find(o=>o.sleeperUserId!==$('#compareA').value).sleeperUserId;
  $('#explorerFilters').onsubmit=e=>e.preventDefault();
  $('#explorerFilters').onchange=()=>{
    EXPLORER.mode=$('#seasonPreset').value;EXPLORER.competition=$('#competition').value;
    EXPLORER.from=+$('#fromYear').value;EXPLORER.to=EXPLORER.mode==='single'?EXPLORER.from:+$('#toYear').value;
    if(EXPLORER.from>EXPLORER.to){EXPLORER.to=EXPLORER.from;$('#toYear').value=String(EXPLORER.to);}
    $('#fromYearLabel').hidden=EXPLORER.mode==='all';$('#toYearLabel').hidden=EXPLORER.mode!=='range';
    EXPLORER.sort=$('#standingsSort').value;EXPLORER.direction=EXPLORER.sort==='name'?1:-1;refreshExplorer();
  };
  $('#resetExplorer').onclick=()=>{EXPLORER.mode='all';EXPLORER.competition='regular';EXPLORER.sort='pct';EXPLORER.direction=-1;$('#seasonPreset').value='all';$('#competition').value='regular';$('#standingsSort').value='pct';$('#fromYearLabel').hidden=true;$('#toYearLabel').hidden=true;refreshExplorer();};
  for(const id of ['compareA','compareB']) $('#'+id).onchange=()=>{if($('#compareA').value===$('#compareB').value){const other=id==='compareA'?'compareB':'compareA';$('#'+other).value=DATA.owners.find(o=>o.sleeperUserId!==$('#'+id).value).sleeperUserId;}renderComparison();};
  if(typeof favoriteOwnerId==='function' && favoriteOwnerId()) $('#h2hOwner').value=favoriteOwnerId();
  refreshExplorer();
}
function refreshExplorer() {renderAllTime();renderHeadToHead();renderGridHistory();renderComparison();}
function renderComparison() {
  const a=$('#compareA')?.value,b=$('#compareB')?.value;if(!a||!b||a===b)return;
  const ao=OWNER_BY_SLEEPER[a],bo=OWNER_BY_SLEEPER[b],r=headToHeadRecord(a,b);
  const games=filteredGames().filter(g=>(g.a===a&&g.b===b)||(g.a===b&&g.b===a)).sort((x,y)=>y.year-x.year||y.week-x.week);
  const n=games.length;
  const score=g=>g.a===a?[g.ap,g.bp]:[g.bp,g.ap];
  const biggest=id=>games.filter(g=>g.winner ? g.winner===id : (g.a===id?g.ap>g.bp:g.bp>g.ap)).sort((x,y)=>Math.abs(y.ap-y.bp)-Math.abs(x.ap-x.bp))[0];
  const winLabel=id=>{const g=biggest(id);return g?`${fmt(Math.abs(g.ap-g.bp)/100)} pts · ${g.year}, W${g.week}${g.endWeek&&g.endWeek!==g.week?'–'+g.endWeek:''}`:'No wins in this view';};
  $('#comparisonSummary').innerHTML=`<div class="rivalry-score"><div>${typeof ownerAvatar==='function'?ownerAvatar(ao,true):''}<h4>${esc(ao.name)}</h4><p>${esc(ao.displayTeam||ao.team)}</p></div><div class="rivalry-record"><strong>${r.w} <span>–</span> ${r.l}</strong><p>${n} matchup${n===1?'':'s'}${r.t?` · ${r.t} tied`:''}</p></div><div>${typeof ownerAvatar==='function'?ownerAvatar(bo,true):''}<h4>${esc(bo.name)}</h4><p>${esc(bo.displayTeam||bo.team)}</p></div></div>${n?`<div class="rivalry-metrics"><div><span>Average per matchup</span><b>${fmt(r.pf/n)} / ${fmt(r.pa/n)}</b></div><div><span>${esc(ao.name.split(' ')[0])}'s biggest win</span><b>${winLabel(a)}</b></div><div><span>${esc(bo.name.split(' ')[0])}'s biggest win</span><b>${winLabel(b)}</b></div></div>`:'<p class="empty-state">These owners have no completed matchups for these filters. Try another season or competition.</p>'}`;
  $('#comparisonHistory').innerHTML=n?`<div class="tbl-wrap"><table><thead><tr><th>Season</th><th>Week / series</th><th>${esc(ao.name)}</th><th>${esc(bo.name)}</th><th>Winner</th></tr></thead><tbody>${games.map(g=>{const [ap,bp]=score(g);const winner=g.winner|| (ap>bp?a:ap<bp?b:null);return `<tr><td>${g.year}</td><td>${g.week}${g.endWeek&&g.endWeek!==g.week?'–'+g.endWeek:''}<span class="oname">${esc(g.stage||'Regular season')}</span></td><td class="num">${fmt(ap/100)}</td><td class="num">${fmt(bp/100)}</td><td>${winner?esc(OWNER_BY_SLEEPER[winner].name):'Tie'}</td></tr>`;}).join('')}</tbody></table></div>`:'<p>No games to show.</p>';
}

function renderExplorerGrid() {
  const years=Object.keys(SEASONS).map(Number).filter(selectedYear).sort((a,b)=>a-b);
  const byYear=Object.fromEntries(years.map(year=>[year,explorerTotals({...EXPLORER,mode:'single',from:year,to:year})]));
  $('#gridHistory').className='';
  $('#gridHistory').innerHTML=`<p class="tiny">${esc(competitionLabel())} records by season. A dash means no completed games in that competition.</p><div class="tbl-wrap"><table><thead><tr><th>Franchise</th>${years.map(y=>`<th class="num">${y}</th>`).join('')}</tr></thead><tbody>${DATA.owners.map(o=>`<tr><td>${teamCell(o.team)}</td>${years.map(year=>{const r=byYear[year].find(r=>r.id===o.sleeperUserId);return `<td class="num">${r.seasons?recordLabel(r):'—'}${r.titles?' 🏆':''}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function explorerCoverage() {
  const reg=HEAD_TO_HEAD.filter(g=>selectedYear(g.year)).length,post=PLAYOFF_GAMES.filter(g=>selectedYear(g.year)).length;
  let text=EXPLORER.competition==='regular'?`${reg} verified regular-season matchups` : EXPLORER.competition==='playoffs'?`${post} completed playoff series` : `${reg} regular-season matchups + ${post} completed playoff series`;
  text+=' for these filters. ESPN: 2020–2021. Sleeper: 2022 onward. Oliver’s games are excluded; Guha starts in 2021.';
  const coverage=H2H_COVERAGE.filter(c=>selectedYear(c.year));
  if(EXPLORER.competition!=='playoffs'&&coverage.some(c=>c.missing))text+=' Some regular-season weeks could not be loaded; these records are incomplete.';
  if(EXPLORER.competition!=='playoffs'&&coverage.some(c=>c.saved))text+=` Includes saved results from ${new Date(SNAPSHOT.updatedAt).toLocaleDateString()}.`;
  if(EXPLORER.competition!=='regular'&&PLAYOFF_WARNING)text+=' '+PLAYOFF_WARNING;
  if(!ESPN_HISTORY && EXPLORER.competition!=='playoffs')text+=' ESPN regular-season history could not be loaded.';
  return text;
}
