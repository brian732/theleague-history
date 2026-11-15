/* Roster history is a separately dated archive; load it only on its own page. */
(() => {
  const panel=document.getElementById('tab-players');if(!panel)return;
  const find=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let archive=null,loading=null,limit=50;
  const date=value=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
  const position=value=>value==='DEF'?'D/ST':value;
  function weekRanges(weeks){
    const sorted=[...new Set(weeks)].sort((a,b)=>a-b),ranges=[];
    for(let i=0;i<sorted.length;i++){let end=sorted[i];const start=end;while(sorted[i+1]===end+1){i++;end=sorted[i];}ranges.push(start===end?String(start):`${start}–${end}`);}
    return `${sorted.length===1?'Week':'Weeks'} ${ranges.join(', ')}`;
  }
  function owner(id){
    const current=typeof DATA!=='undefined'&&DATA?.owners.find(o=>o.sleeperUserId===id);
    return current?{name:current.name,team:current.displayTeam||current.team}:archive.owners.find(o=>o.id===id);
  }
  function seasonLabel(history){
    const parts=[];
    if(history.weeks.length)parts.push(weekRanges(history.weeks));
    else if(history.current)parts.push('Current roster');
    else if(history.rosterSnapshot)parts.push('Season roster snapshot');
    else parts.push('Draft / transaction record');
    if(history.current&&history.weeks.length)parts.push('Current roster');
    return `<div class="player-history-season"><b>${history.year}</b><span>${escape(parts.join(' · '))}</span><span class="pill gray">${escape(history.source)}</span></div>`;
  }
  function historyMarkup(player){
    const grouped=new Map();player.history.forEach(h=>{if(!grouped.has(h.ownerId))grouped.set(h.ownerId,[]);grouped.get(h.ownerId).push(h);});
    const rows=[...grouped.entries()].sort((a,b)=>Math.max(...b[1].map(h=>h.year))-Math.max(...a[1].map(h=>h.year))||owner(a[0]).name.localeCompare(owner(b[0]).name));
    return `<div class="player-history-detail"><div class="tbl-wrap"><table><caption>${escape(player.name)} · ${player.teamCount} distinct league teams</caption><thead><tr><th scope="col">League team</th><th scope="col">When rostered</th></tr></thead><tbody>${rows.map(([id,seasons])=>{
      const o=owner(id),events=seasons.flatMap(h=>h.events.map(e=>({...e,year:h.year,source:h.source}))).sort((a,b)=>b.year-a.year||(b.date||'').localeCompare(a.date||'')||(b.period||0)-(a.period||0)||a.kind.localeCompare(b.kind));
      return `<tr><th scope="row"><span class="tname">${escape(o.team)}</span><span class="oname">${escape(o.name)}</span></th><td>${seasons.sort((a,b)=>b.year-a.year).map(seasonLabel).join('')}${events.length?`<details class="player-history-events"><summary>Drafts &amp; transactions (${events.length})</summary><ul>${events.map(e=>`<li><span>${e.year}</span> ${escape(e.kind)}${e.date?' · '+escape(date(e.date)):e.period?' · '+escape(e.source==='ESPN'?'ESPN period '+e.period:'Week '+e.period):''}</li>`).join('')}</ul></details>`:''}</td></tr>`;
    }).join('')}</tbody></table></div></div>`;
  }
  function timelineMarkup(player){
    const rows=PlayerHistoryModel.timeline(player,archive.updatedAt);
    return `<div class="player-history-detail"><p class="tiny player-timeline-note">Oldest to newest. Dated moves use completion time. Weekly snapshots show observed rosters; their order within a week can be uncertain.</p><ol class="player-timeline">${rows.map(row=>{
      const when=row.date?date(row.date):row.weekStart?`${row.year} · ${row.weekStart===row.weekEnd?'Week '+row.weekStart:'Weeks '+row.weekStart+'–'+row.weekEnd}`:row.period?`${row.year} · ${row.source==='ESPN'?'ESPN period':'Week'} ${row.period}`:String(row.year);
      let team;
      if(row.kind==='Traded'){
        const from=owner(row.fromOwnerId),to=owner(row.toOwnerId);
        team=`<span>${escape(from.team)} <span aria-label="to">→</span> ${escape(to.team)}</span><span class="oname">${escape(from.name)} → ${escape(to.name)}</span>`;
      }else{const o=owner(row.ownerId);team=`<span>${escape(o.team)}</span><span class="oname">${escape(o.name)}</span>`;}
      return `<li><div class="player-timeline-when">${escape(when)}<span class="pill gray">${escape(row.source)}</span></div><div><b class="${row.kind==='Traded'?'player-trade-label':''}">${escape(row.kind)}</b><div class="player-timeline-team">${team}</div></div></li>`;
    }).join('')}</ol></div>`;
  }
  function detailMarkup(player){return find('playerHistoryView').value==='timeline'?timelineMarkup(player):historyMarkup(player);}
  function results(){
    if(!archive)return;
    const query=find('playerHistorySearch').value.trim().toLocaleLowerCase(),pos=find('playerHistoryPosition').value,sort=find('playerHistorySort').value;
    const ordered=PlayerHistoryModel.sorted(archive.players,sort),metric=sort==='trades'?'tradeCount':'teamCount';
    const players=ordered.filter(p=>(!query||p.name.toLocaleLowerCase().includes(query))&&(pos==='all'||p.position===pos));
    const ranks=new Map();ordered.forEach((p,i)=>{if(!ranks.has(p[metric]||0))ranks.set(p[metric]||0,i+1);});
    find('playerHistoryResults').textContent=`${players.length} player${players.length===1?'':'s'}${players.length>limit?` · showing ${limit}`:''} · ranked by ${sort==='trades'?'recorded trades':'distinct teams'}, most to least`;
    const list=find('playerHistoryList'),opened=new Set([...list.querySelectorAll('.player-history-record[open]')].map(d=>d.dataset.playerId));
    list.innerHTML=players.slice(0,limit).map(p=>`<details class="player-history-record" data-player-id="${escape(p.id)}"><summary><span class="player-history-rank">${ranks.get(p[metric]||0)}</span><span class="player-history-name">${escape(p.name)}<span>${escape(position(p.position))} · ${[...new Set(p.history.map(h=>h.year))].sort((a,b)=>a-b).join(', ')}</span></span><span class="player-history-count"><b>${sort==='trades'?(p.tradeCount||0):p.teamCount}</b> ${sort==='trades'?((p.tradeCount||0)===1?'recorded trade':'recorded trades'):'teams'}<span>${sort==='trades'?p.teamCount+' teams':(p.tradeCount||0)+((p.tradeCount||0)===1?' recorded trade':' recorded trades')}</span></span><span class="player-history-chevron" aria-hidden="true">+</span></summary><div class="player-history-body"></div></details>`).join('')||'<p class="loading">No players match these filters. Only players rostered by at least three league teams are included.</p>';
    list.querySelectorAll('.player-history-record').forEach((detail,i)=>{
      const render=()=>{if(detail.open&&!detail.dataset.loaded){detail.querySelector('.player-history-body').innerHTML=detailMarkup(players[i]);detail.dataset.loaded='true';}};
      detail.addEventListener('toggle',render);if(opened.has(detail.dataset.playerId)){detail.open=true;render();}
    });
    find('playerHistoryMore').hidden=players.length<=limit;
    find('playerHistoryMore').textContent=`Show ${Math.min(50,Math.max(0,players.length-limit))} more players`;
  }
  window.loadPlayerHistory=async()=>{
    if(archive){results();return;}
    if(loading)return loading;
    find('playerHistoryStatus').textContent='Loading roster history…';
    loading=(async()=>{
      try{
        const response=await fetch('data/player-history.json?v=20261114-trades',{cache:'no-cache',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Roster history could not be loaded.');
        const data=await response.json();if(!Array.isArray(data.players)||!Array.isArray(data.coverage))throw new Error('Roster history is unavailable.');archive=data;
        const updated=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/New_York'}).format(new Date(data.updatedAt));
        find('playerHistoryStatus').textContent=`${data.coverage[0].year}–${data.coverage.at(-1).year} · ESPN + Sleeper · Roster history snapshot: ${updated}`;
        find('playerHistoryCoverage').innerHTML=`<p>Team ranking counts distinct owner teams across seasons. Trade ranking counts each completed player transfer once using its transaction ID; a trade’s sending and receiving entries do not count twice. Draft picks and waiver moves are not trades. ESPN trade counts are minimums because archived player-level trade details are incomplete. Renamed teams count once, and a player returning to the same owner does not add another team. Starters, bench players, and players evidenced by completed drafts, acquisitions, drops or trades are included; failed and pending transactions are excluded. D/ST units are listed separately by position.</p><p>Weekly ranges are observed roster snapshots, not guaranteed uninterrupted stays. Draft and transaction details also capture short stays between snapshots. Sleeper transaction dates are completion dates; ESPN entries use completion dates where supplied, otherwise the scoring period. Oliver McDonough’s 2020 roster is excluded; Guha’s history begins in 2021.</p><ul>${data.coverage.map(s=>`<li><b>${s.year} · ${escape(s.source)}</b> — roster weeks ${s.rosterWeeks[0]}–${s.rosterWeeks.at(-1)}, ${s.draftPicks} draft picks and ${s.completedTransactions} completed transactions.</li>`).join('')}</ul><p>${(data.limitations||[]).map(escape).join(' ')}</p><p>This archive updates when league roster history is rebuilt. Dates and weeks refer to the fantasy season shown.</p>`;
        results();
      }catch(error){find('playerHistoryStatus').textContent='Roster history could not be loaded. Reload the page to try again.';}
      finally{loading=null;}
    })();return loading;
  };
  find('playerHistoryFilters').addEventListener('submit',e=>e.preventDefault());
  find('playerHistorySearch').addEventListener('input',()=>{limit=50;results();});
  find('playerHistoryPosition').addEventListener('change',()=>{limit=50;results();});
  for(const id of ['playerHistorySort','playerHistoryView'])find(id).addEventListener('change',()=>{limit=50;results();});
  find('playerHistoryMore').addEventListener('click',()=>{limit+=50;results();});
})();
