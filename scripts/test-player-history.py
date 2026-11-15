"""Validate published roster-history data; optionally reconcile the cached API sources."""
import collections, hashlib, json, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];WORK=ROOT.parent/'player-history-work'
data=json.loads((ROOT/'data/player-history.json').read_text())
players=data['players'];by_id={p['id']:p for p in players};owners={o['id']for o in data['owners']}
assert len(by_id)==len(players)and len(owners)==10
assert [p['teamCount']for p in players]==sorted((p['teamCount']for p in players),reverse=True)
assert all(3<=p['teamCount']<=10 for p in players)
assert {c['year']for c in data['coverage']}==set(range(2020,2027))
assert [(c['year'],c['source'])for c in data['coverage'][:2]]==[(2020,'ESPN'),(2021,'ESPN')]
for p in players:
    assert p['teamCount']==len({h['ownerId']for h in p['history']})
    assert len({(h['ownerId'],h['year'])for h in p['history']})==len(p['history'])
    for h in p['history']:
        assert h['ownerId']in owners and h['weeks']==sorted(set(h['weeks']))
        assert h['weeks']or h['events']or h.get('rosterSnapshot')
        assert not(h['year']==2020 and h['ownerId']=='735732965774053376'),'Guha must not inherit 2020 ownership'
        for e in h['events']:assert e['kind']in ['Drafted','Added','Dropped','Traded in','Traded out']
print(f'Data: {len(players)} unique entries, all counts 3–10, descending ranking, seven seasons, ownership and timing validated')

if '--audit-sources'not in sys.argv:sys.exit()
def cached(url):
    file=WORK/'cache'/(hashlib.sha256(url.encode()).hexdigest()+'.json')
    assert file.exists(),f'Build the archive first; missing source: {url}'
    return json.loads(file.read_text())
nfl=json.loads((WORK/'sleeper-players.json').read_text())
def canonical_sid(sid):
    p=nfl.get(sid,{})
    if p.get('position')=='DEF':return'def:'+{'OAK':'LV','JAC':'JAX','WSH':'WAS','SD':'LAC','STL':'LAR'}.get(sid,sid)
    return'espn:'+str(p['espn_id'])if p.get('espn_id')and str(p['espn_id'])!='0'else'sleeper:'+sid
codes={1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',9:'GB',10:'TEN',11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',16:'MIN',17:'NE',18:'NO',19:'NYG',20:'NYJ',21:'PHI',22:'ARI',23:'PIT',24:'LAC',25:'SF',26:'SEA',27:'TB',28:'WAS',29:'CAR',30:'JAX',33:'BAL',34:'HOU'}
def canonical_espn(pid):return'def:'+codes[abs(pid)-16000]if pid<0 else'espn:'+str(pid)
expected=collections.defaultdict(set);weeks=collections.defaultdict(set);failed_pairs=set();weekly_pairs=set()
def add(key,owner,year,week=None):
    if owner not in owners:return
    expected[key].add(owner)
    if week:weeks[(key,owner,year)].add(week);weekly_pairs.add((key,owner))
espn_teams={s['year']:{t['teamId']:t['sleeperUserId']for t in s['teams']}for s in json.loads((ROOT/'data/espn-history.json').read_text())['seasons']}
for c in data['coverage']:
    year=c['year']
    if c['source']=='Sleeper':
        base='https://api.sleeper.app/v1/league/'+c['leagueId'];rosters=cached(base+'/rosters');mapping={r['roster_id']:r['owner_id']for r in rosters}
        for r in rosters:
            for sid in set((r.get('players')or[])+(r.get('reserve')or[])+(r.get('taxi')or[])):add(canonical_sid(sid),r['owner_id'],year)
        for week in c['rosterWeeks']:
            for r in cached(base+'/matchups/'+str(week)):
                for sid in r['players']:add(canonical_sid(sid),mapping[r['roster_id']],year,week)
        for draft in cached(base+'/drafts'):
            for pick in cached('https://api.sleeper.app/v1/draft/'+draft['draft_id']+'/picks'):
                owner=mapping[pick['roster_id']]
                assert not pick.get('picked_by')or pick['picked_by']==owner,'Draft-slot owner differs from actual picker'
                add(canonical_sid(pick['player_id']),owner,year)
        for period in c['transactionPeriods']:
            for t in cached(base+'/transactions/'+str(period)):
                for action in ['adds','drops']:
                    for sid,rid in(t.get(action)or{}).items():
                        key=canonical_sid(sid);owner=mapping[rid]
                        if t.get('status')=='complete':add(key,owner,year)
                        else:failed_pairs.add((key,owner))
    else:
        base=f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/92157291';mapping=espn_teams[year]
        for week in c['rosterWeeks']:
            for team in cached(base+f'?view=mRoster&scoringPeriodId={week}')['teams']:
                for e in team['roster']['entries']:add(canonical_espn(e['playerId']),mapping[team['id']],year,week)
        for pick in cached(base+'?view=mDraftDetail')['draftDetail']['picks']:
            if pick.get('playerId')not in(None,0,-1):add(canonical_espn(pick['playerId']),mapping[pick['teamId']],year)
        for period in c['transactionPeriods']:
            for t in cached(base+f'?view=mTransactions2&scoringPeriodId={period}').get('transactions')or[]:
                valid=t.get('status')=='EXECUTED'and t['type']in{'DRAFT','WAIVER','FREEAGENT','ROSTER','TRADE_ACCEPT'}and(t['type']!='TRADE_ACCEPT'or t.get('executionType')=='PROCESS')
                for item in t.get('items')or[]:
                    pid=item.get('playerId')
                    if pid in(None,0,-1)or item.get('type')not in{'DRAFT','ADD','DROP','TRADE'}:continue
                    for team in[item.get('fromTeamId'),item.get('toTeamId')]:
                        owner=mapping.get(team)
                        if owner not in owners:continue
                        key=canonical_espn(pid)
                        if valid:add(key,owner,year)
                        else:failed_pairs.add((key,owner))
qualified={key:os for key,os in expected.items()if len(os)>2}
assert set(by_id)==set(qualified),'Qualifying-player set differs from raw API evidence'
for key,owner_ids in qualified.items():
    actual=by_id[key]
    assert {h['ownerId']for h in actual['history']}==owner_ids,(actual['name'],'owner mismatch')
    for h in actual['history']:assert set(h['weeks'])==weeks[(key,h['ownerId'],h['year'])],(actual['name'],'weekly evidence mismatch')
failed_only={(k,o)for k,o in failed_pairs if o not in expected.get(k,set())}
for key,owner in failed_only:assert key not in by_id or owner not in {h['ownerId']for h in by_id[key]['history']},'Unsuccessful transaction counted'
nonweekly={(k,o)for k,os in qualified.items()for o in os if(k,o)not in weekly_pairs}
assert nonweekly,'The archive should include short/draft-only stays beyond weekly snapshots'
assert any({h['source']for h in p['history']}=={'ESPN','Sleeper'}for p in players),'No cross-platform identity merges'
print(f'Sources reconciled: every qualifying player, distinct owner, and observed week; {len(failed_only)} unsuccessful-only player/team pairs excluded; {len(nonweekly)} draft/current/transaction-only pairs retained')
