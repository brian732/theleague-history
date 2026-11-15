"""Rebuild cross-platform player ownership from public source records.
Raw responses stay outside the repository. No player is matched by name.
"""
import collections, concurrent.futures, datetime, hashlib, json, time, urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT.parent/'player-history-work'
CACHE=WORK/'cache';CACHE.mkdir(parents=True,exist_ok=True)
SLEEPER='https://api.sleeper.app/v1'
TZ=ZoneInfo('America/New_York')
ESPN_ROOT='https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons'
POSITIONS={1:'QB',2:'RB',3:'WR',4:'TE',5:'K',16:'DEF'}
DEFENSES={1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',9:'GB',10:'TEN',11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',16:'MIN',17:'NE',18:'NO',19:'NYG',20:'NYJ',21:'PHI',22:'ARI',23:'PIT',24:'LAC',25:'SF',26:'SEA',27:'TB',28:'WAS',29:'CAR',30:'JAX',33:'BAL',34:'HOU'}
ABBREVIATIONS={'OAK':'LV','JAC':'JAX','WSH':'WAS','SD':'LAC','STL':'LAR'}
config=json.loads((ROOT/'data/league.json').read_text())
owners={o['sleeperUserId']:{'id':o['sleeperUserId'],'name':o['name'],'team':o['team']}for o in config['owners']}
espn_archive=json.loads((ROOT/'data/espn-history.json').read_text())
espn_owner={s['year']:{t['teamId']:t['sleeperUserId']for t in s['teams']}for s in espn_archive['seasons']}


def fetch(url, fresh=False):
    path=CACHE/(hashlib.sha256(url.encode()).hexdigest()+'.json')
    if path.exists() and not fresh:return json.loads(path.read_text())
    error=None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url,timeout=35)as response:result=json.load(response)
            path.write_text(json.dumps(result,separators=(',',':')))
            return result
        except Exception as exc:error=exc;time.sleep(.25*(attempt+1))
    raise RuntimeError(f'{url}: {error}')


def batch(urls,fresh=False):
    with concurrent.futures.ThreadPoolExecutor(max_workers=6)as pool:
        return list(pool.map(lambda url:fetch(url,fresh),urls))


def day(timestamp):
    return datetime.datetime.fromtimestamp(timestamp/1000,TZ).date().isoformat() if timestamp else None


# ESPN athlete IDs bridge platforms; defenses use a stable NFL franchise abbreviation.
player_file=WORK/'sleeper-players.json'
if player_file.exists() and time.time()-player_file.stat().st_mtime<86400:nfl=json.loads(player_file.read_text())
else:nfl=fetch(SLEEPER+'/players/nfl',fresh=True);player_file.write_text(json.dumps(nfl))
metadata={};sleeper_id={}
for sid,p in nfl.items():
    if p.get('position')=='DEF':key='def:'+ABBREVIATIONS.get(sid,sid)
    elif p.get('espn_id') and str(p['espn_id'])!='0':key='espn:'+str(p['espn_id'])
    else:key='sleeper:'+sid
    sleeper_id[sid]=key
    name=p.get('full_name')or' '.join(filter(None,[p.get('first_name'),p.get('last_name')]))
    if p.get('position')=='DEF':name+=' D/ST'
    if name and (key not in metadata or p.get('active')):metadata[key]={'id':key,'name':name,'position':p.get('position')or'—'}


def espn_key(pid,info=None):
    if pid<0:
        code=DEFENSES.get((info or{}).get('proTeamId')or(abs(pid)-16000))
        assert code,('Unmapped ESPN defense',pid)
        key='def:'+code
        if key not in metadata:metadata[key]={'id':key,'name':(info or{}).get('fullName',code+' D/ST'),'position':'DEF'}
    else:
        key='espn:'+str(pid)
        if key not in metadata and info:metadata[key]={'id':key,'name':info['fullName'],'position':POSITIONS.get(info.get('defaultPositionId'),'—')}
    return key


ledger=collections.defaultdict(dict)
coverage=[];counts=collections.Counter();source_audit=[];trade_ledger=collections.defaultdict(dict);deals={}


def observe(key,owner,year,source,week=None,event=None):
    if owner not in owners:counts['excludedOwnerObservations']+=1;return
    assert key and not key.endswith(':0'),key
    slot=ledger[key].setdefault((owner,year),{'ownerId':owner,'year':year,'source':source,'weeks':set(),'events':set(),'current':False})
    if week:slot['weeks'].add(int(week))
    if event:slot['events'].add(tuple(sorted(event.items())))
    return slot


def record_trade(key,identifier,from_owner,to_owner,year,source,timestamp=None,period=None):
    if from_owner not in owners or to_owner not in owners or from_owner==to_owner:return
    trade={'id':identifier,'dealId':identifier[:-(len(key)+1)],'fromOwnerId':from_owner,'toOwnerId':to_owner,'year':year,'source':source}
    if timestamp:trade.update(timestamp=timestamp,date=day(timestamp))
    if period:trade['period']=int(period)
    trade_ledger[key][identifier]=trade


def record_sleeper_deal(tx,roster_owner,year):
    identifier=f"sleeper:{year}:{tx['transaction_id']}"
    transfers=[]
    for sid in sorted(set(tx.get('adds')or{})&set(tx.get('drops')or{})):
        a=roster_owner[tx['drops'][sid]];b=roster_owner[tx['adds'][sid]]
        if a!=b:transfers.append({'type':'player','playerId':sleeper_id.get(sid,'sleeper:'+sid),'fromOwnerId':a,'toOwnerId':b})
    for pick in tx.get('draft_picks')or[]:
        a=roster_owner[pick['previous_owner_id']];b=roster_owner[pick['owner_id']]
        if a!=b:transfers.append({'type':'pick','season':str(pick['season']),'round':pick['round'],'originalOwnerId':roster_owner[pick['roster_id']],'fromOwnerId':a,'toOwnerId':b})
    for budget in tx.get('waiver_budget')or[]:
        a=roster_owner[budget['sender']];b=roster_owner[budget['receiver']]
        if a!=b and budget['amount']:transfers.append({'type':'faab','amount':budget['amount'],'fromOwnerId':a,'toOwnerId':b})
    deal={'id':identifier,'year':year,'source':'Sleeper','status':'completed','transfers':transfers,'period':int(tx.get('leg')or 0)}
    if tx.get('status_updated'):deal.update(timestamp=tx['status_updated'],date=day(tx['status_updated']))
    deals[identifier]=deal


def record_espn_deal(tx,owner_map,year):
    identifier=f"espn:{year}:{tx['id']}"
    transfers=[]
    for item in tx.get('items')or[]:
        if item.get('type')!='TRADE' or item.get('playerId')in(None,0,-1):continue
        a=owner_map.get(item.get('fromTeamId'));b=owner_map.get(item.get('toTeamId'))
        if a in owners and b in owners and a!=b:transfers.append({'type':'player','playerId':espn_key(item['playerId']),'fromOwnerId':a,'toOwnerId':b})
    if not transfers:return
    deal={'id':identifier,'year':year,'source':'ESPN','status':'completed','transfers':transfers,'period':tx['scoringPeriodId']}
    if tx.get('processDate'):deal.update(timestamp=tx['processDate'],date=day(tx['processDate']))
    deals[identifier]=deal


league_id=config['league']['sleeperLeagueId'];seen=set();leagues=[]
while league_id and league_id!='0' and league_id not in seen:
    seen.add(league_id);league=fetch(SLEEPER+'/league/'+league_id,fresh=not leagues)
    if int(league['season'])<2022:break
    leagues.append(league);league_id=league.get('previous_league_id')

for league in sorted(leagues,key=lambda s:s['season']):
    year=int(league['season']);base=SLEEPER+'/league/'+league['league_id'];live=league['status']!='complete'
    last_week=min(18,max(league['settings'].get('leg',1),league['settings'].get('last_scored_leg',0)))
    if not live:last_week=min(18,league['settings'].get('last_scored_leg',17))
    requests=[base+'/rosters',base+'/drafts']+[base+'/matchups/'+str(w)for w in range(1,last_week+1)]+[base+'/transactions/'+str(w)for w in range(0,19)]
    values=batch(requests,fresh=live);rosters,drafts=values[:2];weekly=values[2:2+last_week];transactions=values[2+last_week:]
    roster_owner={r['roster_id']:r.get('owner_id')for r in rosters}
    assert len(rosters)==10 and all(o in owners for o in roster_owner.values()),(year,'owner mapping')
    for week,rows in enumerate(weekly,1):
        assert len(rows)==10 and all(isinstance(r.get('players'),list)for r in rows),(year,week,'weekly roster missing')
        for r in rows:
            for sid in set(r['players']):observe(sleeper_id.get(sid,'sleeper:'+sid),roster_owner[r['roster_id']],year,'Sleeper',week)
    for r in rosters:
        for sid in set((r.get('players')or[])+(r.get('reserve')or[])+(r.get('taxi')or[])):
            slot=observe(sleeper_id.get(sid,'sleeper:'+sid),r.get('owner_id'),year,'Sleeper')
            if slot:slot['current']=live;slot['rosterSnapshot']=True
    draft_count=0
    for draft in drafts:
        picks=fetch(SLEEPER+'/draft/'+draft['draft_id']+'/picks',fresh=live)
        if not picks:
            assert not draft.get('start_time') and not draft.get('last_picked'),(year,'started draft unavailable')
            counts['unusedDraftPlaceholdersSkipped']+=1
            continue
        for pick in picks:
            sid=pick['player_id'];owner=roster_owner.get(pick.get('roster_id'))
            assert owner,(year,'draft owner')
            observe(sleeper_id.get(sid,'sleeper:'+sid),owner,year,'Sleeper',event={'kind':'Drafted',**({'date':day(draft['start_time']),'timestamp':draft['start_time']}if draft.get('start_time') else{})})
            draft_count+=1
    tx_seen=set();complete=failed=0
    for rows in transactions:
        for tx in rows:
            if tx['transaction_id']in tx_seen:continue
            tx_seen.add(tx['transaction_id'])
            if tx.get('status')!='complete':failed+=1;continue
            complete+=1
            if tx['type']=='trade':record_sleeper_deal(tx,roster_owner,year)
            for action in ['adds','drops']:
                for sid,rid in(tx.get(action)or{}).items():
                    owner=roster_owner.get(rid);assert owner,(year,'transaction owner')
                    key=sleeper_id.get(sid,'sleeper:'+sid)
                    traded=tx['type']=='trade' and sid in(tx.get('adds')or{}) and sid in(tx.get('drops')or{}) and tx['adds'][sid]!=tx['drops'][sid]
                    trade_id=f"sleeper:{year}:{tx['transaction_id']}:{key}"
                    event={'kind':('Traded in'if action=='adds'else'Traded out')if traded else('Added'if action=='adds'else'Dropped'),'id':f"sleeper:{tx['transaction_id']}:{sid}:{action}",'period':int(tx.get('leg')or 0)}
                    if tx.get('status_updated'):event.update(date=day(tx['status_updated']),timestamp=tx['status_updated'])
                    if traded:
                        event['tradeId']=trade_id
                        record_trade(key,trade_id,roster_owner[tx['drops'][sid]],roster_owner[tx['adds'][sid]],year,'Sleeper',tx.get('status_updated'),tx.get('leg'))
                    observe(key,owner,year,'Sleeper',event=event)
    coverage.append({'year':year,'source':'Sleeper','leagueId':league['league_id'],'rosterWeeks':list(range(1,last_week+1)),'transactionPeriods':list(range(0,19)),'completedTransactions':complete,'draftPicks':draft_count,'current':live})
    counts['failedSleeperTransactionsExcluded']+=failed
    print(f'Sleeper {year}: {last_week} weekly rosters, {draft_count} draft picks, {complete} completed transactions ({failed} failed/pending excluded)',flush=True)

for year,owner_map in sorted(espn_owner.items()):
    base=f'{ESPN_ROOT}/{year}/segments/0/leagues/92157291'
    draft=fetch(base+'?view=mDraftDetail');final_week=draft['status']['finalScoringPeriod'];last_period=draft['status']['latestScoringPeriod']
    requests=[base+f'?view=mRoster&scoringPeriodId={w}'for w in range(1,final_week+1)]+[base+f'?view=mTransactions2&scoringPeriodId={w}'for w in range(1,last_period+1)]
    values=batch(requests);weekly=values[:final_week];tx_responses=values[final_week:]
    fingerprints=[]
    for week,raw in enumerate(weekly,1):
        assert raw['id']==92157291 and raw['seasonId']==year and raw['scoringPeriodId']==week
        assert len(raw['teams'])==10 and all(t.get('roster',{}).get('entries')for t in raw['teams']),(year,week,'ESPN roster unavailable')
        fingerprints.append(tuple(sorted((t['id'],e['playerId'])for t in raw['teams']for e in t['roster']['entries'])))
        for team in raw['teams']:
            assert team['id']in owner_map,(year,'unknown ESPN team')
            for entry in team['roster']['entries']:
                p=entry['playerPoolEntry']['player'];key=espn_key(entry['playerId'],p)
                observe(key,owner_map[team['id']],year,'ESPN',week)
    assert len(set(fingerprints))>1,(year,'ESPN scoringPeriodId was ignored')
    for pick in draft['draftDetail']['picks']:
        if not pick.get('playerId') or pick['playerId']==-1:
            counts['unfilledEspnDraftPicksSkipped']+=1
            continue
        observe(espn_key(pick['playerId']),owner_map[pick['teamId']],year,'ESPN',event={'kind':'Drafted',**({'date':day(draft['settings']['draftSettings']['date']),'timestamp':draft['settings']['draftSettings']['date']}if draft.get('settings',{}).get('draftSettings',{}).get('date')else{})})
    complete=failed=0;seen=set();types=collections.Counter()
    for period,raw in enumerate(tx_responses,1):
        assert raw['scoringPeriodId']==period
        for tx in raw.get('transactions')or[]:
            assert tx['scoringPeriodId']==period,(year,period,'transaction filter ignored')
            if tx['id']in seen:continue
            seen.add(tx['id']);types[tx['type']]+=1
            if tx.get('status')!='EXECUTED':failed+=1;continue
            # A processed decline/veto is not a roster move. Old trade-review
            # records often have no player items and cannot prove a transfer.
            if tx['type'] not in {'DRAFT','WAIVER','FREEAGENT','ROSTER','TRADE_ACCEPT'}:
                counts['espnNonAcquisitionRecordsExcluded']+=1
                continue
            if tx['type']=='TRADE_ACCEPT' and tx.get('executionType')!='PROCESS':continue
            if tx['type']=='TRADE_ACCEPT':record_espn_deal(tx,owner_map,year)
            items=[i for i in tx.get('items')or[] if i.get('type')in {'DRAFT','ADD','DROP','TRADE'} and i.get('playerId') not in (None,0,-1)]
            if items and tx['type']!='DRAFT':complete+=1
            for item in items:
                pid=item.get('playerId');a=item.get('fromTeamId');b=item.get('toTeamId')
                if not pid or pid==-1:continue
                key=espn_key(pid)
                trade_id=f"espn:{year}:{tx['id']}:{key}"
                traded=item.get('type')=='TRADE' and a in owner_map and b in owner_map and a!=b
                if traded:record_trade(key,trade_id,owner_map[a],owner_map[b],year,'ESPN',tx.get('processDate'),period)
                for tid,kind in [(a,'Traded out'if a and b and a!=b else'Dropped'),(b,'Traded in'if a and b and a!=b else'Added')]:
                    if tid not in owner_map:continue
                    # Lineup-only transactions prove membership but are not acquisitions.
                    event={'kind':kind,'period':period,'id':f"espn:{year}:{tx['id']}:{pid}:{tid}:{kind}"}if a!=b else None
                    if event and tx.get('processDate'):event.update(timestamp=tx['processDate'],date=day(tx['processDate']))
                    if event and traded:event['tradeId']=trade_id
                    # The draft endpoint already supplies the single draft event.
                    if tx['type']=='DRAFT':event=None
                    observe(key,owner_map[tid],year,'ESPN',event=event)
    coverage.append({'year':year,'source':'ESPN','leagueId':'92157291','rosterWeeks':list(range(1,final_week+1)),'transactionPeriods':list(range(1,last_period+1)),'completedTransactions':complete,'draftPicks':sum(p.get('playerId') not in (None,0,-1)for p in draft['draftDetail']['picks'])})
    counts['failedEspnTransactionsExcluded']+=failed
    source_audit.append({'year':year,'types':dict(types),'distinctWeeklySnapshots':len(set(fingerprints))})
    print(f'ESPN {year}: {final_week} distinct-week roster requests, {len(draft["draftDetail"]["picks"])} draft picks, {complete} executed transactions ({failed} others excluded)',flush=True)

# Only unresolved ESPN IDs need individual lookups, and only when they can qualify.
required={key for key,rows in ledger.items()if len({o for o,y in rows})>=3}
required.update(a['playerId']for deal in deals.values()for a in deal['transfers']if a['type']=='player')
unresolved=sorted(required-metadata.keys())
for key in unresolved:
    if key.startswith('espn:'):
        athlete=fetch('https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/'+key.split(':')[1])
        metadata[key]={'id':key,'name':athlete.get('displayName')or athlete['fullName'],'position':athlete.get('position',{}).get('abbreviation','—')}
    else:raise AssertionError(('Player metadata missing',key))

for deal in deals.values():
    for asset in deal['transfers']:
        assert asset['fromOwnerId']in owners and asset['toOwnerId']in owners and asset['fromOwnerId']!=asset['toOwnerId']
        if asset['type']=='player':asset.update(name=metadata[asset['playerId']]['name'],position=metadata[asset['playerId']]['position'])

players=[]
for key,rows in ledger.items():
    owner_ids={o for o,y in rows}
    if len(owner_ids)<3:continue
    assert key in metadata,key
    normalized=[]
    for slot in rows.values():
        normalized.append({**slot,'weeks':sorted(slot['weeks']),'events':sorted([dict(e)for e in slot['events']],key=lambda e:(e.get('date',''),e.get('period',0),e['kind']))})
    trades=sorted(trade_ledger[key].values(),key=lambda t:(t['year'],t.get('timestamp',0),t.get('period',0),t['id']))
    players.append({**metadata[key],'teamCount':len(owner_ids),'tradeCount':len(trades),'trades':trades,'history':sorted(normalized,key=lambda r:(-r['year'],owners[r['ownerId']]['name']))})
players.sort(key=lambda p:(-p['teamCount'],p['name'].casefold()))
assert all(p['teamCount']==len({h['ownerId']for h in p['history']})and p['teamCount']>2 for p in players)
assert all(h['ownerId']in owners for p in players for h in p['history'])
assert len({p['id']for p in players})==len(players)
assert all(t['dealId']in deals and deals[t['dealId']]['status']=='completed'for p in players for t in p['trades'])
output={'updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'leagueName':config['league']['name'],'counting':'Distinct current-owner teams across all included seasons. Team-name changes count once.','minimumTeams':3,'tradeCounting':'One completed player transfer per transaction; receiving and sending records count once. ESPN counts are verified minimums because archived trade item details are incomplete.','owners':list(owners.values()),'coverage':sorted(coverage,key=lambda s:s['year']),'limitations':['ESPN returns weekly rosters and available completed moves, but some archived trade records have no player details. Trade-only stays entirely between weekly snapshots can be missing.'],'exclusions':[{'year':2020,'reason':'Oliver McDonough’s roster is excluded. Guha’s ownership begins in 2021.'}],'players':players,'deals':deals}
(ROOT/'data/player-history.json').write_text(json.dumps(output,separators=(',',':'),ensure_ascii=False)+'\n')
(WORK/'audit.json').write_text(json.dumps({'counts':dict(counts),'espn':source_audit,'allObservedPlayers':len(ledger),'qualifiedPlayers':len(players),'qualifiedWithoutMetadata':len(unresolved),'top':[{k:p[k]for k in['name','position','teamCount']}for p in players[:20]]},indent=2)+'\n')
print(f'Saved {len(players)} players with 3+ distinct teams ({len(ledger)} players observed). Cross-platform matches use ESPN athlete IDs, never names.',flush=True)
