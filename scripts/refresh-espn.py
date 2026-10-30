"""Fetch and validate ESPN's 2020–2021 archive; preserve ownership by season."""
import collections
import datetime
import json
import re
import urllib.request
from pathlib import Path

config_path = Path('data/league.json')
config_text = config_path.read_text()
config = json.loads(config_text)
# ESPN profile names differ from the owner's known name in these two cases.
NAME_ALIASES = {'jon pan': 'Jonathan Pan', 'joe gilhooly': 'Sean Gilhooly'}
by_name = {o['name'].lower(): o for o in config['owners']}
seasons = []
for year in (2020, 2021):
    url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/92157291?view=mTeam&view=mMatchup&view=mSettings'
    with urllib.request.urlopen(url, timeout=30) as response:
        raw = json.load(response)
    assert raw['seasonId'] == year and raw['id'] == 92157291
    members = {m['id']: m for m in raw['members']}
    teams = []
    for team in raw['teams']:
        assert len(team['owners']) == 1, 'Multiple owners require review'
        member = members[team['owners'][0]]
        profile_name = (member['firstName'] + ' ' + member['lastName']).strip()
        owner = by_name.get(NAME_ALIASES.get(profile_name.lower(), profile_name).lower())
        if profile_name == 'Oliver McDonough':
            assert year == 2020
            owner = None
        else:
            assert owner, f'Unmapped owner: {profile_name}'
            assert not (year == 2020 and owner['name'] == 'Guha Sundaram')
        r = team['record']['overall']
        teams.append(dict(teamId=team['id'], team=team['name'],
            espnOwnerName=profile_name, ownerName=owner['name'] if owner else profile_name,
            sleeperUserId=owner['sleeperUserId'] if owner else None,
            canonicalTeam=owner['team'] if owner else team['name'],
            w=r['wins'], l=r['losses'], t=r['ties'], pf=round(r['pointsFor'],2), pa=round(r['pointsAgainst'],2),
            finalRank=team.get('rankCalculatedFinal'), playoffSeed=team.get('playoffSeed')))
    weeks = raw['settings']['scheduleSettings']['matchupPeriodCount']
    games = []
    for g in raw['schedule']:
        if g['matchupPeriodId'] > weeks:
            continue
        assert 'home' in g and 'away' in g and g['winner'] in ('HOME', 'AWAY', 'TIE')
        games.append(dict(id=g['id'], week=g['matchupPeriodId'],
            homeTeamId=g['home']['teamId'], awayTeamId=g['away']['teamId'],
            hp=round(g['home']['totalPoints']*100), ap=round(g['away']['totalPoints']*100)))
    assert len(games) == weeks * 5
    counts = collections.Counter(g['week'] for g in games)
    assert counts == {w:5 for w in range(1,weeks+1)}
    for team in teams:
        played = [g for g in games if team['teamId'] in (g['homeTeamId'],g['awayTeamId'])]
        results = [(g['hp'],g['ap']) if g['homeTeamId']==team['teamId'] else (g['ap'],g['hp']) for g in played]
        assert [sum(a>b for a,b in results),sum(a<b for a,b in results),sum(a==b for a,b in results)] == [team['w'],team['l'],team['t']], (year,team['ownerName'],'WLT')
        assert sum(a for a,b in results) == round(team['pf']*100), (year,team['ownerName'],'PF')
        assert sum(b for a,b in results) == round(team['pa']*100), (year,team['ownerName'],'PA')
    weekly_scores = []
    for g in raw['schedule']:
        for side, other in [('home','away'),('away','home')]:
            for week, points in g[side]['pointsByScoringPeriod'].items():
                weekly_scores.append(dict(week=int(week), teamId=g[side]['teamId'], opponentId=g[other]['teamId'], points=round(points*100)))
    seasons.append(dict(year=year, sourceUrl=url, regularWeeks=weeks, teams=teams, games=games, weeklyScores=weekly_scores))
    written = next(s for s in config['seasons'] if s['year']==year)
    old = written['standings']
    for t in teams:
        # Compare previously recorded labels through the known canonical mapping.
        candidates=[r for r in old if r['w']==t['w'] and r['l']==t['l'] and abs(r.get('pf',0)-t['pf'])<.011]
        if not candidates: print('Corrected recorded standing:',year,t['ownerName'],t['w'],t['l'],t['pf'])
    written.update(verified=True, espnLeagueId='92157291')
    written['standings'] = [{k:t[k] for k in ('team','ownerName','sleeperUserId','canonicalTeam','w','l','t','pf','pa')} for t in sorted(teams,key=lambda t:(-t['w'],-t['pf']))]
    # Independently reconcile written champion, finalist, third and fourth with ESPN.
    for rank,key in [(1,'champion'),(2,'runnerUp'),(3,'third'),(4,'fourth')]:
        t=next(t for t in teams if t['finalRank']==rank)
        print(year,key,t['ownerName'],t['canonicalTeam'],'| previously:',written.get(key))
        written[key]=t['canonicalTeam']
    print(year,':',weeks,'weeks;',len(games),'games; all 10 records and PF/PA reconciled')
Path('data/espn-history.json').write_text(json.dumps(dict(leagueId='92157291',updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),seasons=seasons),indent=2)+'\n')
for season in seasons:
    year = season['year']
    start = config_text.index('"year": ' + str(year), config_text.index('"seasons":'))
    end = config_text.find('"year": ', start + 1)
    if end < 0: end = len(config_text)
    block = config_text[start:end]
    written = next(s for s in config['seasons'] if s['year'] == year)
    rows = ',\n'.join('        ' + json.dumps(r, ensure_ascii=False) for r in written['standings'])
    block = re.sub(r'"standings": \[.*?\]', lambda _: '"standings": [\n' + rows + '\n      ]', block, count=1, flags=re.S)
    block = block.replace('"verified": false', '"verified": true')
    if '"espnLeagueId"' not in block:
        block = block.replace('"platform": "ESPN",', '"platform": "ESPN",\n      "espnLeagueId": "92157291",', 1)
    config_text = config_text[:start] + block + config_text[end:]
config_path.write_text(config_text)
