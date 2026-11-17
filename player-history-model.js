/* Pure sorting and timeline helpers, shared by the page and regression checks. */
const PlayerHistoryModel = (() => {
  function sorted(players,sort='teams'){
    const metric=sort==='trades'?'tradeCount':'teamCount';
    return players.filter(p=>p.teamCount>2&&(sort!=='trades'||(p.tradeCount||0)>0)).slice().sort((a,b)=>(b[metric]||0)-(a[metric]||0)||b.teamCount-a.teamCount||a.name.localeCompare(b.name));
  }
  // Snapshots have week precision, not a transaction timestamp. Place each run
  // at its first observed week, capped at the archive date for the live week.
  function weekOrder(year,week,asOf){
    const september=new Date(Date.UTC(year,8,1));
    const firstMonday=1+(8-september.getUTCDay())%7;
    return Math.min(Date.UTC(year,8,firstMonday+7*week,23,59),asOf);
  }
  function timeline(player,asOfValue){
    const asOf=Date.parse(asOfValue),rows=[],drafts=new Map();
    const parts=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/New_York'}).formatToParts(new Date(asOf));
    const asOfDate=['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');
    for(const h of player.history){
      for(const e of h.events){
        if(e.kind==='Traded in'||e.kind==='Traded out')continue;
        const row={...e,ownerId:h.ownerId,year:h.year,source:h.source};
        row.sortAt=e.timestamp||(e.date?Date.parse(e.date+'T12:00:00Z'):e.period?weekOrder(h.year,e.period,asOf):Date.UTC(h.year,0,1));
        row.id=e.id||`${h.ownerId}:${h.year}:${e.kind}:${e.date||e.period||''}`;
        if(e.kind==='Drafted'){
          const key=`${h.year}:${h.ownerId}`;
          if(!drafts.has(key)||(!drafts.get(key).date&&row.date))drafts.set(key,row);
        }else rows.push(row);
      }
      const weeks=[...new Set(h.weeks)].sort((a,b)=>a-b);
      for(let i=0;i<weeks.length;i++){
        const start=weeks[i];let end=start;while(weeks[i+1]===end+1){i++;end=weeks[i];}
        rows.push({id:`week:${h.ownerId}:${h.year}:${start}`,kind:'Rostered',ownerId:h.ownerId,year:h.year,source:h.source,weekStart:start,weekEnd:end,sortAt:weekOrder(h.year,start,asOf)});
      }
      if(!weeks.length&&!h.events.length&&h.rosterSnapshot&&!h.current)rows.push({id:`snapshot:${h.ownerId}:${h.year}`,kind:'Season roster snapshot',ownerId:h.ownerId,year:h.year,source:h.source,sortAt:weekOrder(h.year,18,asOf)});
      if(h.current)rows.push({id:`current:${h.ownerId}:${h.year}`,kind:'Current roster',ownerId:h.ownerId,year:h.year,source:h.source,date:asOfDate,sortAt:asOf});
    }
    rows.push(...drafts.values());
    for(const trade of player.trades||[])rows.push({...trade,kind:'Traded',sortAt:trade.timestamp||(trade.date?Date.parse(trade.date+'T12:00:00Z'):weekOrder(trade.year,trade.period||1,asOf))});
    return rows.sort((a,b)=>a.year-b.year||a.sortAt-b.sortAt||Number(a.kind==='Current roster')-Number(b.kind==='Current roster')||a.id.localeCompare(b.id));
  }
  function tradeTimeline(player,deals,asOfValue){
    return (player.trades||[]).filter(t=>deals[t.dealId]?.status==='completed').slice().sort((a,b)=>a.year-b.year||(a.timestamp||weekOrder(a.year,a.period||1,Date.parse(asOfValue)))-(b.timestamp||weekOrder(b.year,b.period||1,Date.parse(asOfValue)))||a.id.localeCompare(b.id));
  }
  function ownerLeaderboard(owners,deals,year='all'){
    const rows=owners.map(o=>({...o,deals:[]})),byId=new Map(rows.map(o=>[o.id,o])),seen=new Set();
    for(const deal of Object.values(deals||{})){
      if(deal.status!=='completed'||seen.has(deal.id)||(year!=='all'&&String(deal.year)!==String(year)))continue;
      seen.add(deal.id);
      const participants=new Set((deal.transfers||[]).filter(a=>a.fromOwnerId&&a.toOwnerId&&a.fromOwnerId!==a.toOwnerId&&['player','pick','faab'].includes(a.type)).flatMap(a=>[a.fromOwnerId,a.toOwnerId]));
      for(const id of participants)if(byId.has(id))byId.get(id).deals.push(deal);
    }
    for(const row of rows){row.deals.sort((a,b)=>b.year-a.year||(b.timestamp||0)-(a.timestamp||0)||(b.period||0)-(a.period||0)||a.id.localeCompare(b.id));row.tradeCount=row.deals.length;}
    rows.sort((a,b)=>b.tradeCount-a.tradeCount||a.name.localeCompare(b.name));
    let rank=0;rows.forEach((row,i)=>{if(!i||row.tradeCount!==rows[i-1].tradeCount)rank=i+1;row.rank=rank;});
    return rows;
  }
  return {sorted,timeline,tradeTimeline,ownerLeaderboard};
})();
