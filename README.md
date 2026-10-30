# The League (est. 2020) — league site

A self-updating website for The League. Standings and records pull **live from Sleeper**;
everything written (bios, recaps, awards, rules) lives in one file you edit in your browser.

---

## Part 1 — Put it online (one time, ~10 minutes)

### 1. Lock down your GitHub account first

You already have a **personal** account (`brian732`), which is the important part — a repo in a
Polymarket *organization* could be taken back by IT on offboarding. A personal repo can't be.

Before anything else, do these three things:

1. **Settings → Emails** → add a personal email → verify it → set it as **Primary**.
   Leave the work email on the account as a secondary. This is what keeps password reset working
   after `brian@polymarket.com` is deactivated.
2. **Settings → Password and authentication** → confirm you have a real password set
   (not only "Sign in with Google," which dies with the work Workspace account).
3. Turn on **2FA** and save the recovery codes somewhere that isn't the work laptop.

### 2. Create the repo

1. github.com → **New repository**
2. Name: `the-league` · Visibility: **Public** (required for free GitHub Pages)
3. Don't add a README — this folder has one
4. **Create repository**

### 3. Upload these files

On the empty repo page, click **uploading an existing file**, then drag in the *contents* of this
folder (not the folder itself):

```
index.html
styles.css
app.js
README.md
.nojekyll
data/league.json
```

Commit.

### 4. Turn on Pages

**Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → **Save**

Wait about a minute. Your site is live at:

```
https://brian732.github.io/the-league/
```

---

## Part 2 — Updating it

### The annual job: one line

Every August when the new Sleeper season is created, open `data/league.json` and change:

```json
"sleeperLeagueId": "1312965631825428480"
```

to the new season's ID (it's in your Sleeper league URL: `sleeper.com/leagues/THIS_NUMBER`).

That's it. The site walks backwards through Sleeper's season chain by itself and picks up every
past year automatically. **You will never type in a standing, a record, or a win-loss total.**

### Everything else

Open `data/league.json` on GitHub, click the **pencil icon**, edit, **Commit changes**. The site
updates in about 30 seconds.

| To change… | Edit this |
|---|---|
| Entry fee, payouts, commissioner, group chat link | `league` |
| A new season's recap, awards, meeting notes, rule changes | add an object to `seasons` |
| Owner bios, teams, hobbies | `owners` |
| Loser's punishments | `punishments` |
| Record book | `recordBook` |
| Scoring and rules | `rules` |

**After a season ends**, add one entry to `seasons` with the year, champion, runner-up, 3rd, 4th,
DFL, a recap, the awards, and the meeting notes. The standings table fills itself in from Sleeper.

> **One gotcha:** JSON is picky. Every item needs a comma after it except the last one in a list,
> and all quotes must be straight `"` not curly `"`. If the site goes blank after an edit, that's
> almost always why — paste the file into jsonlint.com to find the line.

---

## Part 3 — Transferring ownership

### The 10-second version

**Repo → Settings → scroll to Danger Zone → Transfer ownership → type the new account name.**

The other account accepts, and it's theirs. GitHub auto-redirects the old URL so existing
bookmarks keep working. They'll need to re-enable Pages under their Settings → Pages.

### Making the URL survive the transfer (recommended)

Right now the URL contains your username, so a transfer changes it. To make the address permanent
and account-independent, buy a domain (~$12/yr from Namecheap, Cloudflare, or Porkbun) and point it
at Pages:

1. At the registrar, add a `CNAME` record: `www` → `brian732.github.io`
2. In the repo: **Settings → Pages → Custom domain** → enter your domain → Save
3. Tick **Enforce HTTPS**

Now the league bookmarks `theleague2020.com` (or whatever) and it keeps working no matter who owns
the repo. Transfer the repo and the domain, and nobody in the league notices anything changed.

### If you're ever locked out completely

You still have every file. Download the folder (or your last copy), make a new GitHub account, drag
the files in, enable Pages. Live again in five minutes. The content can't be stranded — that's the
whole reason it's plain files and not a hosted app.

---

## 2026 update and head-to-head records

All-time standings include the current season's recorded wins, losses and ties.
The All-Time tab also shows an owner-versus-owner matrix and an owner selector
with wins, losses, ties, win percentage and points for/against.

Head-to-head coverage is **regular season, 2020 onward**, through Sleeper's last
completed scoring week. ESPN league **92157291** supplies 2020 (12 weeks) and
2021 (13 weeks); Sleeper supplies 2022 onward. Playoffs, consolation games and
unfinished weeks are excluded from head-to-head records.

The ESPN archive is mapped by owner name in each season. Jon Pan maps to Jonathan
Pan; ESPN's Joe Gilhooly profile owns OJ's Dream Team and maps to Sean Gilhooly.
Sleeper seasons use each season's roster owner IDs. Historical team names are
preserved while records belong to their owners.

**Oliver's 12 games in 2020 are excluded for BOTH opponents from head-to-head
records. Guha starts in 2021 and inherits none of Oliver's results.** Overall
standings still include other owners' legitimate 2020 games against Oliver, so
matrix row totals can differ from overall standings. A total column makes this
explicit. The unrelated 2021 Sleeper league remains excluded.

Live requests expire from the browser cache after five minutes. If Sleeper is
unavailable, the site uses `data/sleeper-history.json` and labels the saved date.
Missing matchup weeks are disclosed in the coverage note.

To refresh the fallback snapshot from public Sleeper data, run from this folder:

```sh
python3 scripts/refresh-sleeper.py
python3 scripts/refresh-espn.py
```

To verify matchup totals against every owner's recorded season standings,
including all seven seasons, PF/PA, championship finishes, the saved-data fallback,
current-season totals, and the Oliver/Guha ownership boundary:

```sh
node scripts/test-records.cjs
python3 scripts/audit-history.py
```

The October 2026 audit reconciled every owner's wins, losses, ties, points for
and points against to the weekly matchups and platform standings. It verified
ESPN final ranks and Sleeper winners brackets against the written trophy history.
It also checked team scoring records and season-opening streaks. Team Fielding's
worst-start record was corrected from 0–7 to **0–6**: he won Week 7 of 2025,
109.94–94.34. Unpaired Sleeper playoff/bye scores are excluded from game records.
The historical single-player record remains explicitly unverified.

## How it works, briefly

- `index.html` — page structure. Rarely needs touching.
- `styles.css` — all visual design. Rarely needs touching.
- `app.js` — reads `league.json`, fetches Sleeper, renders everything. Commented throughout.
- `data/league.json` — **the only file you normally edit.**
- `.nojekyll` — tells GitHub Pages to serve the files as-is.

Sleeper's API is public and read-only, so there are no keys, no accounts, and nothing to expire.
If Sleeper is ever down, the site still loads — it just shows a notice and the written history.

---

## Known data issues carried over from the original doc

These were found by checking the doc against Sleeper's actual records. They are **already
corrected** in this site, but flagged here so the league knows what changed:

1. **PanFam's all-time record was 39-42 in the doc; it's actually 38-43.** Every other franchise
   reconciled to the win. This drops PanFam from a tie for 5th into a three-way tie for 7th with
   NORTH KOREA GINGA NINJAS and ~ Suck My Ditka.
2. **The two-team scoring record was stale.** The doc lists 317.30 (Week 5, 2021). PanFam vs
   Yang Gang in Week 8, 2025 hit **322.22** and nobody logged it.
3. **2022 Yang Gang points against** was 1498.46 in the doc; Sleeper says 1498.58.
4. **The scoring section didn't match the live league settings** — see below.
5. **Brown and Bijan LLC and Team Pain are listed as separate franchises** in the doc's
   championship history. They're the same team (Guha). Merged here.

### Scoring corrections (doc vs. what Sleeper is actually running)

| Rule | Doc said | Sleeper actually has |
|---|---|---|
| Bench spots | 7 | **8** |
| IR spots | 4 | **3** (the 2023 rule change was never applied to this section) |
| D/ST 14-17 pts allowed | 1 point | **14-20 = 1 point** |
| D/ST 35-45 / 46+ | -3 / -5 | **35+ = -4**, single band |
| D/ST yards 300-349 | missing | **0 points** |
| FG made | "3 pts for all FGs" | 3 pts **0-59 yds**, 5 pts **60+** |
| PAT missed | not listed | **-1 point** |
| Special teams fumble recovery | not listed | **2 points** |
| "1 point safety = 1 point" | listed | **no such setting exists** |
| Trade deadline | "121:59 PM EST" | typo for 11:59 PM |

### Open question

There is a **fully-played 2021 Sleeper league** in your account
(`734985825976172544`, "The League (est. 2020)") with all ten of the same owners, a completed
14-game season, and a champion of Jerry — none of which matches the doc's 2021 ESPN season
(13 games, champion Yang Gang). The site currently ignores it and uses the doc's ESPN numbers.

The 2020–2021 ESPN seasons are now independently verified from ESPN league 92157291,
including weekly scores and final ranks. The 2021 Sleeper league remains excluded.
