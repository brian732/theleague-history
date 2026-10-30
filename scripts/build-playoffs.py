"""Archive championship-bracket series, counting multiweek games once."""
import json, datetime, urllib.request
from pathlib import Path
config=json.loads(Path('data/league.json').read_text())
owners={o['sleeperUserId']:o for o in config['owners']}
espn=json.loads(Path('data/espn-history.json').read_text())
sleeper=json.loads(Path('data/sleeper-history.json').read_text())
series=[]
for season in espn['seasons']:
    with urllib.request.urlopen(season['sourceUrl'],timeout=30) as r:raw=json.load(r)
    teams={t['teamId']:t for t in season['teams']}
    for g in raw['schedule']:
        if g['matchupPeriodId']<=season['regularWeeks']:continue
        a,b=teams[g['home']['teamId']],teams[g['away']['teamId']]
        if not (a['playoffSeed']<=4 and b['playoffSeed']<=4):continue
        if not a['sleeperUserId'] or not b['sleeperUserId']:continue
        weeks=sorted(map(int,g['home']['pointsByScoringPeriod']))
        series.append(dict(year=season['year'],week=weeks[0],endWeek=weeks[-1],a=a['sleeperUserId'],b=b['sleeperUserId'],ap=round(g['home']['totalPoints']*100),bp=round(g['away']['totalPoints']*100),winner=a['sleeperUserId'] if g['winner']=='HOME' else b['sleeperUserId'],stage='Championship' if {a['finalRank'],b['finalRank']}=={1,2} else 'Third place' if {a['finalRank'],b['finalRank']}=={3,4} else 'Semifinal',source='espn'))
for season in sleeper['seasons']:
    rosters={r['roster_id']:r['owner_id'] for r in season['rosters']}
    for g in season['winnersBracket']:
        if g.get('w') is None or g.get('l') is None:continue
        weeks=[];ap=bp=0
        for week,rows in season['matchups'].items():
            if int(week)<season['league']['settings']['playoff_week_start']:continue
            a=next((r for r in rows if r['roster_id']==g['t1']),None)
            b=next((r for r in rows if r['roster_id']==g['t2']),None)
            if not a or not b or a['matchup_id'] is None or a['matchup_id']!=b['matchup_id']:continue
            weeks.append(int(week));ap+=round((a['custom_points'] if a['custom_points'] is not None else a['points'])*100);bp+=round((b['custom_points'] if b['custom_points'] is not None else b['points'])*100)
        assert weeks
        a,b=rosters[g['t1']],rosters[g['t2']]
        assert (a if ap>bp else b)==rosters[g['w']],(season['league']['season'],g,ap,bp)
        series.append(dict(year=int(season['league']['season']),week=min(weeks),endWeek=max(weeks),a=a,b=b,ap=ap,bp=bp,winner=rosters[g['w']],stage='Championship' if g.get('p')==1 else 'Third place' if g.get('p')==3 else 'Semifinal',source='sleeper'))
for year in range(2020,2026):
    games=[g for g in series if g['year']==year]
    assert len(games)==4,(year,len(games))
Path('data/playoffs.json').write_text(json.dumps(dict(updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),games=series),indent=2)+'\n')
print('Archived',len(series),'completed playoff series')
