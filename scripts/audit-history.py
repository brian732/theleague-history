import json,collections
from pathlib import Path
c=json.load(open('data/league.json'));e=json.load(open('data/espn-history.json'));s=json.load(open('data/sleeper-history.json'))
byid={o['sleeperUserId']:o for o in c['owners']}; scores=[]; games=[]; starts=[]; season_pf=[]
for season in e['seasons']:
 ts={t['teamId']:t for t in season['teams']};y=season['year']; lookup={(r['week'],r['teamId']):r['points'] for r in season['weeklyScores']}
 for r in season['weeklyScores']:
  t=ts[r['teamId']]
  if t['sleeperUserId']:scores.append((r['points'],y,r['week'],t['canonicalTeam']))
  if r['teamId']<r['opponentId'] and t['sleeperUserId'] and ts[r['opponentId']]['sleeperUserId']:
   games.append((r['points']+lookup[(r['week'],r['opponentId'])],y,r['week'],t['canonicalTeam'],ts[r['opponentId']]['canonicalTeam']))
 for t in season['teams']:
  if t['sleeperUserId']:
   season_pf.append((round(t['pf']*100),y,t['canonicalTeam']))
   starts.append((y,t['canonicalTeam'],[(g['hp']-g['ap']) if g['homeTeamId']==t['teamId'] else g['ap']-g['hp'] for g in sorted(season['games'],key=lambda g:g['week']) if t['teamId'] in [g['homeTeamId'],g['awayTeamId']]]))
for season in s['seasons']:
 y=int(season['league']['season']);end=season['league']['settings']['playoff_week_start']-1; ts={r['roster_id']:byid[r['owner_id']]['team'] for r in season['rosters']};outcomes=collections.defaultdict(list)
 for w,rows in sorted(season['matchups'].items(),key=lambda x:int(x[0])):
  groups=collections.defaultdict(list)
  for r in rows:
   if r['matchup_id'] is None:continue
   scores.append((round((r['custom_points'] if r['custom_points'] is not None else r['points'])*100),y,int(w),ts[r['roster_id']]))
   if r['matchup_id'] is not None:groups[r['matchup_id']].append(r)
  for pair in groups.values():
   if len(pair)!=2:continue
   a,b=pair;ap=round((a['custom_points'] if a['custom_points'] is not None else a['points'])*100);bp=round((b['custom_points'] if b['custom_points'] is not None else b['points'])*100)
   games.append((ap+bp,y,int(w),ts[a['roster_id']],ts[b['roster_id']]))
   if int(w)<=end:outcomes[a['roster_id']].append(ap-bp);outcomes[b['roster_id']].append(bp-ap)
 for r in season['rosters']:
  v=r['settings'];season_pf.append((v['fpts']*100+v.get('fpts_decimal',0),y,ts[r['roster_id']]))
  starts.append((y,ts[r['roster_id']],outcomes[r['roster_id']]))
def streak(xs,win):
 n=0
 for x in xs:
  if (x>0 if win else x<0):n+=1
  else:break
 return n
print('Weekly team high:',max(scores));print('Weekly team low:',min(scores));print('Weekly combined high:',max(games));print('Season PF high:',max(season_pf))
print('Best start:',max((streak(xs,True),y,t) for y,t,xs in starts));print('Worst start:',max((streak(xs,False),y,t) for y,t,xs in starts))

assert max(scores)[0] == round(float(c['recordBook'][0]['value'])*100)
assert max(games)[0] == round(float(c['recordBook'][1]['value'])*100)
assert min(scores)[0] == round(float(c['recordBook'][2]['value'])*100)
assert max(season_pf)[0] == round(float(c['recordBook'][6]['value'])*100)
assert max(streak(xs,True) for y,t,xs in starts) == int(c['recordBook'][4]['value'].split('-')[0])
assert max(streak(xs,False) for y,t,xs in starts) == int(c['recordBook'][5]['value'].split('-')[1])
print('All team scoring and season-start record book entries match the source history. Single-player entry remains labeled unverified.')
