"""Refresh the public Sleeper fallback snapshot. Run from the repository root."""
import concurrent.futures
import datetime
import json
import urllib.request
from pathlib import Path

API = 'https://api.sleeper.app/v1'
def get(path):
    with urllib.request.urlopen(API + path, timeout=30) as response:
        return json.load(response)

config = json.loads(Path('data/league.json').read_text())
league_id = config['league']['sleeperLeagueId']
seasons = []
seen = set()
while league_id and league_id != '0' and league_id not in seen:
    seen.add(league_id)
    league = get('/league/' + league_id)
    # 2020–21 are recorded ESPN seasons, not the unrelated Sleeper league.
    if int(league['season']) >= 2022:
        root = '/league/' + league_id
        end = league['settings'].get('last_scored_leg', 17)
        if league['status'] != 'complete':
            end = min(end, league['settings'].get('last_scored_leg', 0))
        paths = [root + '/users', root + '/rosters'] + [root + '/matchups/' + str(w) for w in range(1, end + 1)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(get, paths))
        seasons.append(dict(league=league, users=results[0], rosters=results[1], winnersBracket=get(root + '/winners_bracket'), matchups={str(w): rows for w, rows in enumerate(results[2:], 1)}))
    league_id = league.get('previous_league_id')
# Keep only fields used by the site; player lineups and unrelated user metadata
# are unnecessary for standings and owner-versus-owner history.
for saved in seasons:
    saved['league'] = {k: saved['league'][k] for k in ('league_id', 'season', 'status', 'previous_league_id', 'settings')}
    saved['users'] = [{k: u.get(k) for k in ('user_id', 'display_name', 'metadata')} for u in saved['users']]
    saved['users'] = [dict(u, metadata={'team_name': (u['metadata'] or {}).get('team_name')}) for u in saved['users']]
    saved['rosters'] = [{k: r.get(k) for k in ('roster_id', 'owner_id', 'settings')} for r in saved['rosters']]
    saved['matchups'] = {w: [{k: r.get(k) for k in ('roster_id', 'matchup_id', 'points', 'custom_points')} for r in rows] for w, rows in saved['matchups'].items()}
snapshot = dict(updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), seasons=seasons)
Path('data/sleeper-history.json').write_text(json.dumps(snapshot, separators=(',', ':')) + '\n')
print('Saved seasons:', ', '.join(str(s['league']['season']) for s in seasons))
