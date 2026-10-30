/* ============================================================
   The League (est. 2020)

   HOW THIS WORKS
   --------------
   1. All written content (owner bios, recaps, awards, rules) is
      read from data/league.json. That is the only file you edit.
   2. All standings, records and win/loss data from 2022 onward are
      fetched LIVE from Sleeper's public API every time the page
      loads. You never type in a standing again.
   3. The app finds every past season by itself: it starts at the
      current league ID in league.json and walks backwards through
      Sleeper's `previous_league_id` chain.

   EVERY AUGUST: change league.sleeperLeagueId in data/league.json
   to the new season's ID. That is the whole annual maintenance job.
   ============================================================ */

const API = 'https://api.sleeper.app/v1';
const ESPN_YEARS = [2020, 2021];   // pre-Sleeper, sourced from league.json

let DATA = null;      // league.json
let SEASONS = {};     // year -> { standings:[...], source:'sleeper'|'espn' }
let SNAPSHOT = null;
let HEAD_TO_HEAD = [];
let H2H_COVERAGE = [];
let CURRENT = null;   // current-season league object from Sleeper
let OWNER_BY_SLEEPER = {};

/* ---------- helpers ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (w, l, t = 0) => (w + l + t) ? ((w + t / 2) / (w + l + t)) : 0;
const fmt = n => Number(n).toFixed(2);

async function getJSON(url) {
  // Expire live data after five minutes; ignore the old unbounded cache.
  try {
    const cached = JSON.parse(sessionStorage.getItem('v2:' + url));
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.data;
  } catch (e) { /* storage unavailable or stale format */ }
  const r = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  const j = await r.json();
  try { sessionStorage.setItem('v2:' + url, JSON.stringify({ at: Date.now(), data: j })); } catch (e) { /* quota; fine */ }
  return j;
}

/* ============================================================
   BOOT
   ============================================================ */
(async function init() {
  initTheme();
  initTabs();

  try {
    DATA = await getJSON('data/league.json');
  } catch (e) {
    $('#nowStandings').innerHTML =
      `<p class="loading">Could not load <code>data/league.json</code>. ${esc(e.message)}</p>`;
    return;
  }

  DATA.owners.forEach(o => { OWNER_BY_SLEEPER[o.sleeperUserId] = o; });

  document.title = `${DATA.league.name} (est. ${DATA.league.established})`;
  $('#league-name').textContent = DATA.league.name;
  $('#league-est').textContent = `est. ${DATA.league.established}`;

  // Things that need no network
  renderInfo();
  renderOwnersShell();
  renderSeasonsNav();
  renderRecords();
  renderRules();
  renderFooter();

  // Things that do
  try { SNAPSHOT = await getJSON('data/sleeper-history.json'); } catch (e) { /* live API still available */ }
  await loadSleeper();
  buildEspnSeasons();
  renderSeasonsNav();
  renderLive();
  renderAllTime();
  renderGridHistory();
  renderTrophies();
  renderOwnerRecords();
  renderSeason(currentSeasonYear());
  await loadHeadToHead();
  renderHeadToHead();
})();

/* ============================================================
   SLEEPER
   ============================================================ */
async function loadSleeper() {
  const badge = $('#liveBadge');
  try {
    let id = DATA.league.sleeperLeagueId;
    const chain = [];
    const seen = new Set();

    while (id && id !== '0' && !seen.has(id)) {
      seen.add(id);
      const lg = await getJSON(`${API}/league/${id}`);
      if (!lg) break;
      if (+lg.season < 2022) break;
      chain.push(lg);
      id = lg.previous_league_id;
    }

    CURRENT = chain[0];

    await Promise.all(chain.map(async lg => {
      const [users, rosters] = await Promise.all([
        getJSON(`${API}/league/${lg.league_id}/users`),
        getJSON(`${API}/league/${lg.league_id}/rosters`)
      ]);
      const uById = Object.fromEntries(users.map(u => [u.user_id, u]));

      const standings = rosters.map(r => {
        const u = uById[r.owner_id] || {};
        const s = r.settings || {};
        const owner = OWNER_BY_SLEEPER[r.owner_id];
        return {
          ownerName: owner ? owner.name : (u.display_name || 'Unknown'),
          team: (u.metadata && u.metadata.team_name) || u.display_name || '—',
          canonicalTeam: owner ? owner.team : ((u.metadata && u.metadata.team_name) || u.display_name),
          sleeperUserId: r.owner_id,
          w: s.wins || 0,
          l: s.losses || 0,
          t: s.ties || 0,
          pf: (s.fpts || 0) + (s.fpts_decimal || 0) / 100,
          pa: (s.fpts_against || 0) + (s.fpts_against_decimal || 0) / 100
        };
      }).sort((a, b) => (b.w - a.w) || (b.pf - a.pf));

      SEASONS[+lg.season] = { rosters, standings, source: 'sleeper', league: lg };
    }));

    badge.textContent = `Live from Sleeper · ${chain.length} seasons`;
    badge.className = 'badge live';
  } catch (e) {
    (SNAPSHOT?.seasons || []).forEach(saved => {
      const lg = saved.league;
      const standings = saved.rosters.map(r => {
        const owner = OWNER_BY_SLEEPER[r.owner_id];
        const user = saved.users.find(u => u.user_id === r.owner_id) || {};
        const v = r.settings || {};
        return { ownerName: owner?.name || user.display_name || 'Unknown',
          team: user.metadata?.team_name || owner?.team || user.display_name,
          canonicalTeam: owner?.team || user.display_name, sleeperUserId: r.owner_id,
          w: v.wins || 0, l: v.losses || 0, t: v.ties || 0,
          pf: (v.fpts || 0) + (v.fpts_decimal || 0) / 100,
          pa: (v.fpts_against || 0) + (v.fpts_against_decimal || 0) / 100 };
      }).sort((a, b) => b.w - a.w || b.pf - a.pf);
      if (!SEASONS[+lg.season]) SEASONS[+lg.season] = { standings, rosters: saved.rosters, source: 'sleeper', league: lg };
    });
    CURRENT = SEASONS[+CURRENT?.season]?.league || Object.values(SEASONS).sort((a,b) => +b.league.season - +a.league.season)[0]?.league || null;
    badge.textContent = SNAPSHOT ? `Sleeper unavailable · saved ${new Date(SNAPSHOT.updatedAt).toLocaleDateString()}` : 'Sleeper unavailable — showing recorded data';
    badge.className = 'badge err';
    console.warn('Sleeper fetch failed:', e);
  }
}

function buildEspnSeasons() {
  (DATA.seasons || []).forEach(s => {
    if (SEASONS[s.year]) return;             // Sleeper already covered it
    if (!s.standings) return;
    SEASONS[s.year] = {
      source: 'espn',
      standings: s.standings.map(r => ({
        ownerName: ownerForTeamLabel(r.team),
        team: r.team,
        canonicalTeam: canonicalTeamFor(r.team),
        w: r.w, l: r.l, t: 0, pf: r.pf || 0, pa: 0
      }))
    };
  });
}

/* Map historical/renamed team labels back to today's franchise. */
const TEAM_ALIASES = {
  'my ball zach ertz': 'PanFam',
  'hide and zeke': 'PanFam',
  'panfam': 'PanFam',
  // NOTE: 2020's "Team McDonough" is deliberately NOT mapped to Pain.
  // Oliver McDonough owned that season; Guha bought the franchise afterwards,
  // so his all-time record starts in 2021. Unmapped labels are excluded from
  // all-time totals automatically (see allTimeTotals).
  'netflix and hill': 'Pain.',
  "netflix 'n hill": 'Pain.',
  'brown and bijan llc': 'Pain.',
  'brown and bijan co.': 'Pain.',
  'pain.': 'Pain.',
  'the yang gang': 'Yang Gang',
  'yang gang': 'Yang Gang',
  'the silent majority': 'The Silent Majority',
  '~ suck my ditka': '~ Suck My Ditka',
  'suck my ditka': '~ Suck My Ditka',
  "oj's dream team": "OJ's Dream Team",
  'ojs dream team': "OJ's Dream Team",
  '25 and under': '25 and Under',
  '25 & under': '25 and Under',
  'team fielding': 'Team Fielding',
  'north korea ginga ninjas': 'NORTH KOREA GINGA NINJAS',
  'big dick mvp aaron godgers': 'Big Dick MVP Aaron GODgers'
};

function normLabel(s) {
  return String(s)
    .replace(/\s*\([^)]*\)\s*$/, '')            // strip "(PanFam)" hints
    .replace(/[‘’]/g, "'")
    .trim().toLowerCase();
}
function canonicalTeamFor(label) {
  return TEAM_ALIASES[normLabel(label)] || label;
}
function ownerForTeamLabel(label) {
  const canon = canonicalTeamFor(label);
  const o = DATA.owners.find(x => normLabel(x.team) === normLabel(canon));
  return o ? o.name : '';
}

function currentSeasonYear() {
  const yrs = (DATA.seasons || []).map(s => s.year);
  return Math.max(...yrs, ...Object.keys(SEASONS).map(Number));
}

/* ============================================================
   THIS SEASON
   ============================================================ */
function renderLive() {
  const yr = CURRENT ? +CURRENT.season : currentSeasonYear();
  const s = SEASONS[yr];
  $('#nowTitle').textContent = `${yr} Standings`;

  if (!s) { $('#nowStandings').innerHTML = '<p class="loading">No data for this season yet.</p>'; return; }

  const playoffTeams = (CURRENT && CURRENT.settings && CURRENT.settings.playoff_teams) || 4;

  const rows = s.standings.map((r, i) => `
    <tr class="${i === playoffTeams - 1 ? 'cut' : ''}">
      <td class="rank">${i + 1}</td>
      <td>
        <span class="tname">${esc(r.team)}</span>
        ${i < playoffTeams ? '<span class="pill">Playoff</span>' : ''}
        <span class="oname">${esc(r.ownerName)}</span>
      </td>
      <td class="num">${r.w}-${r.l}${r.t ? '-' + r.t : ''}</td>
      <td class="num">${fmt(r.pf)}</td>
      <td class="num">${fmt(r.pa)}</td>
      <td class="num">${r.pa ? (r.pf - r.pa > 0 ? '+' : '') + fmt(r.pf - r.pa) : '—'}</td>
    </tr>`).join('');

  $('#nowStandings').innerHTML = `
    <div class="tbl-wrap"><table>
      <thead><tr>
        <th></th><th>Team</th>
        <th class="num">Record</th><th class="num">PF</th><th class="num">PA</th><th class="num">Diff</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="tiny" style="margin-top:.8rem">
      Top ${playoffTeams} make the playoffs (line shown). Updates automatically — refresh after games finish.
    </p>`;
}

function renderInfo() {
  const L = DATA.league;
  $('#infoList').innerHTML = [
    ['Commissioner', esc(L.commissioner)],
    ['Platform', esc(L.platform)],
    ['Structure', esc(L.structure)],
    ['Entry fee', esc(L.entryFee)],
    ['Group chat', L.groupChat
      ? `<a href="${esc(L.groupChat.url)}" target="_blank" rel="noopener">${esc(L.groupChat.platform)} →</a>` : '—'],
    ['Sleeper', `<a href="https://sleeper.com/leagues/${esc(L.sleeperLeagueId)}" target="_blank" rel="noopener">Open league →</a>`]
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  $('#payoutList').innerHTML = (L.payouts || [])
    .map(p => `<dt>${esc(p.place)}</dt><dd>${esc(p.amount)}</dd>`).join('');

  $('#punishList').innerHTML = (DATA.punishments || []).slice().reverse()
    .map(p => `<div><b>${p.year}</b><span>${esc(p.punishment)}${p.loser && p.loser !== '—' ? ` — <em>${esc(p.loser)}</em>` : ''}</span></div>`)
    .join('');
}

/* ============================================================
   TROPHY CASE
   ============================================================ */
function renderTrophies() {
  const seasons = (DATA.seasons || []).slice().sort((a, b) => b.year - a.year);

  $('#trophyGrid').innerHTML = seasons.map(s => {
    if (s.inProgress || !s.champion) {
      return `<div class="trophy live-season">
        <div class="yr">${s.year}</div>
        <div class="champ">In progress</div>
        <div class="who">Season underway</div>
      </div>`;
    }
    const owner = DATA.owners.find(o => normLabel(o.team) === normLabel(canonicalTeamFor(s.champion)));
    return `<div class="trophy">
      <div class="yr">${s.year}</div>
      <div class="champ">${esc(s.champion)}</div>
      <div class="who">${esc(owner ? owner.name : '')}</div>
      ${s.runnerUp ? `<div class="beat">def. ${esc(s.runnerUp)}</div>` : ''}
    </div>`;
  }).join('');

  // championship + playoff appearance tallies, computed from the season records
  const champ = {}, playoff = {};
  const bump = (o, k, f) => { o[k] = o[k] || { w: 0, a: 0 }; o[k][f]++; };

  seasons.forEach(s => {
    if (s.inProgress) return;
    if (s.champion)  { bump(champ, canonicalTeamFor(s.champion), 'a'); champ[canonicalTeamFor(s.champion)].w++; }
    if (s.runnerUp)  { bump(champ, canonicalTeamFor(s.runnerUp), 'a'); }
    ['champion', 'runnerUp', 'third', 'fourth'].forEach(k => {
      if (s[k]) { const t = canonicalTeamFor(s[k]); playoff[t] = (playoff[t] || 0) + 1; }
    });
  });

  $('#champTable').innerHTML = tallyTable(
    Object.entries(champ).sort((a, b) => b[1].w - a[1].w || b[1].a - a[1].a),
    ['Franchise', 'Titles', 'Appearances'],
    ([t, v]) => [teamCell(t), v.w ? '🏆'.repeat(v.w) + ` ${v.w}` : '—', v.a]
  );

  const allTeams = DATA.owners.map(o => o.team);
  $('#playoffTable').innerHTML = tallyTable(
    allTeams.map(t => [t, playoff[t] || 0]).sort((a, b) => b[1] - a[1]),
    ['Franchise', 'Playoff Berths'],
    ([t, n]) => [teamCell(t), n]
  );
}

function teamCell(team) {
  const o = DATA.owners.find(x => normLabel(x.team) === normLabel(team));
  return `<span class="tname">${esc(team)}</span>${o ? `<span class="oname">${esc(o.name)}</span>` : ''}`;
}

function tallyTable(rows, heads, mapRow) {
  const body = rows.map((r, i) => {
    const cells = mapRow(r);
    return `<tr><td class="rank">${i + 1}</td>` +
      cells.map((c, j) => `<td class="${j === 0 ? '' : 'num'}">${c}</td>`).join('') + '</tr>';
  }).join('');
  return `<div class="tbl-wrap"><table>
    <thead><tr><th></th>${heads.map((h, j) => `<th class="${j === 0 ? '' : 'num'}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

/* ============================================================
   ALL-TIME
   ============================================================ */
function allTimeTotals() {
  const tot = {};
  // Only franchises that still exist today count toward all-time totals.
  // This is what keeps 2020's Team McDonough out of Guha's record.
  const active = new Set(DATA.owners.map(o => normLabel(o.team)));
  Object.entries(SEASONS).forEach(([yr, s]) => {
    s.standings.forEach(r => {
      if (!active.has(normLabel(r.canonicalTeam))) return;
      const key = r.canonicalTeam;
      tot[key] = tot[key] || { team: key, w: 0, l: 0, t: 0, pf: 0, seasons: 0 };
      tot[key].w += r.w; tot[key].l += r.l; tot[key].t += r.t || 0;
      tot[key].pf += r.pf; tot[key].seasons++;
    });
  });
  return Object.values(tot).sort((a, b) => pct(b.w, b.l, b.t) - pct(a.w, a.l, a.t) || b.pf - a.pf);
}

function renderAllTime() {
  const rows = allTimeTotals();
  if (!rows.length) { $('#allTimeTable').innerHTML = '<p class="loading">No data.</p>'; return; }

  const titles = {};
  (DATA.seasons || []).forEach(s => {
    if (s.champion && !s.inProgress) {
      const t = canonicalTeamFor(s.champion);
      titles[t] = (titles[t] || 0) + 1;
    }
  });

  $('#allTimeTable').innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr>
      <th></th><th>Franchise</th>
      <th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">Pct</th>
      <th class="num">Seasons</th><th class="num">Total PF</th><th class="num">Titles</th>
    </tr></thead>
    <tbody>${rows.map((r, i) => `
      <tr>
        <td class="rank">${i + 1}</td>
        <td>${teamCell(r.team)}</td>
        <td class="num">${r.w}</td>
        <td class="num">${r.l}</td>
        <td class="num">${r.t}</td>
        <td class="num">${pct(r.w, r.l, r.t).toFixed(3).replace(/^0/, '')}</td>
        <td class="num">${r.seasons}</td>
        <td class="num">${fmt(r.pf)}</td>
        <td class="num">${titles[r.team] ? '🏆'.repeat(titles[r.team]) : '—'}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function renderGridHistory() {
  const years = Object.keys(SEASONS).map(Number).sort((a, b) => a - b);
  const teams = DATA.owners.map(o => o.team);

  const cell = (team, yr) => {
    const s = SEASONS[yr];
    if (!s) return '<td class="num">—</td>';
    const r = s.standings.find(x => normLabel(x.canonicalTeam) === normLabel(team));
    if (!r) return '<td class="num">—</td>';
    const season = (DATA.seasons || []).find(z => z.year === yr);
    const isChamp = season && season.champion && normLabel(canonicalTeamFor(season.champion)) === normLabel(team);
    return `<td class="num">${r.w}-${r.l}${r.t ? '-' + r.t : ''}${isChamp ? ' 🏆' : ''}</td>`;
  };

  $('#gridHistory').className = '';
  $('#gridHistory').innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>Franchise</th>${years.map(y => `<th class="num">${y}</th>`).join('')}</tr></thead>
    <tbody>${teams.map(t =>
      `<tr><td>${teamCell(t)}</td>${years.map(y => cell(t, y)).join('')}</tr>`).join('')}
    </tbody></table></div>`;
}

/* ============================================================
   OWNERS
   ============================================================ */
function renderOwnersShell() {
  $('#ownerGrid').innerHTML = DATA.owners.map(o => `
    <article class="owner" data-team="${esc(o.team)}">
      <div class="top">
        <div>
          <h4>${esc(o.name)}</h4>
          <div class="team">${esc(o.team)}</div>
          <div class="role">${esc(o.role)}</div>
        </div>
        <div class="rings" data-rings></div>
      </div>
      <p class="school">${esc(o.school)}</p>
      <p class="bio">${esc(o.bio)}</p>
      ${o.hobbies ? `<div class="hob">${o.hobbies.map(h => `<em>${esc(h)}</em>`).join('')}</div>` : ''}
      <div class="rec" data-rec><span>Loading record…</span></div>
    </article>`).join('');

  $('#formerList').innerHTML = (DATA.formerOwners || [])
    .map(f => `<div><b>${esc(f.name)}</b><span>${esc(f.note)}</span></div>`).join('');
}

function renderOwnerRecords() {
  const tot = Object.fromEntries(allTimeTotals().map(r => [normLabel(r.team), r]));
  const titles = {};
  (DATA.seasons || []).forEach(s => {
    if (s.champion && !s.inProgress) {
      const t = normLabel(canonicalTeamFor(s.champion));
      titles[t] = (titles[t] || 0) + 1;
    }
  });

  $$('.owner').forEach(el => {
    const key = normLabel(el.dataset.team);
    const r = tot[key];
    el.querySelector('[data-rings]').textContent = titles[key] ? '🏆'.repeat(titles[key]) : '';
    el.querySelector('[data-rec]').innerHTML = r
      ? `<span>All-time <b>${r.w}-${r.l}${r.t ? '-' + r.t : ''}</b></span>
         <span>Win pct <b>${pct(r.w, r.l, r.t).toFixed(3).replace(/^0/, '')}</b></span>
         <span>Titles <b>${titles[key] || 0}</b></span>`
      : '<span>No record data</span>';
  });
}

/* ============================================================
   SEASON ARCHIVE
   ============================================================ */
function renderSeasonsNav() {
  const years = [...new Set([...(DATA.seasons || []).map(s => s.year), ...Object.keys(SEASONS).map(Number)])].sort((a, b) => b - a);
  $('#yearNav').innerHTML = years.map(y => `<button data-year="${y}">${y}</button>`).join('');
  $('#yearNav').onclick = e => {
    const b = e.target.closest('button[data-year]');
    if (b) renderSeason(+b.dataset.year);
  };
}

function renderSeason(year) {
  $$('#yearNav button').forEach(b => b.classList.toggle('active', +b.dataset.year === year));
  const s = (DATA.seasons || []).find(x => x.year === year) || (SEASONS[year] && { year, inProgress: SEASONS[year].league?.status !== 'complete' });
  if (!s) return;

  const live = SEASONS[year];
  const slots = [
    ['Champion', s.champion, 'win'],
    ['Runner-up', s.runnerUp, ''],
    ['3rd', s.third, ''],
    ['4th', s.fourth, ''],
    ['Last place', s.dfl, 'dfl']
  ].filter(x => x[1]);

  let html = '';

  if (slots.length) {
    html += `<div class="season-head">${slots.map(([lbl, val, cls]) =>
      `<div class="slot ${cls}"><div class="lbl">${lbl}</div><div class="val">${esc(val)}</div></div>`).join('')}</div>`;
  }

  if (s.notableEvents) {
    html += `<div class="notable"><b>Notable events</b>${esc(s.notableEvents)}</div>`;
  }

  if (s.recap) html += `<p class="recap">${esc(s.recap)}</p>`;

  if (live) {
    const showPA = live.standings.some(r => r.pa > 0);
    html += `<h3 class="sub">${s.inProgress ? 'Current' : 'Final'} Standings ${live.source === 'sleeper'
      ? '<span class="pill">Verified via Sleeper</span>'
      : '<span class="pill gray">ESPN era — as recorded</span>'}</h3>`;
    html += `<div class="tbl-wrap"><table>
      <thead><tr><th></th><th>Team</th><th class="num">Record</th><th class="num">PF</th>${showPA ? '<th class="num">PA</th>' : ''}</tr></thead>
      <tbody>${live.standings.map((r, i) => `
        <tr><td class="rank">${i + 1}</td>
          <td><span class="tname">${esc(r.team)}</span><span class="oname">${esc(r.ownerName)}</span></td>
          <td class="num">${r.w}-${r.l}${r.t ? '-' + r.t : ''}</td>
          <td class="num">${r.pf ? fmt(r.pf) : '—'}</td>
          ${showPA ? `<td class="num">${r.pa ? fmt(r.pa) : '—'}</td>` : ''}
        </tr>`).join('')}
      </tbody></table></div>`;
  }

  if (s.awards && s.awards.length) {
    html += `<h3 class="sub">League Awards</h3><div class="awards">${s.awards.map(a => `
      <div class="aw">
        <div class="t">${esc(a.award)}</div>
        <div class="w">${esc(a.winner)}</div>
        ${a.detail ? `<div class="d">${esc(a.detail)}</div>` : ''}
      </div>`).join('')}</div>`;
  }

  if (s.meeting || (s.ruleChanges && s.ruleChanges.length)) {
    html += `<h3 class="sub">League Meeting</h3><div class="meeting">`;
    if (s.meeting) {
      if (s.meeting.title)  html += `<h3>${esc(s.meeting.title)}</h3>`;
      if (s.meeting.detail) html += `<p>${esc(s.meeting.detail)}</p>`;
      if (s.meeting.election) html += `<p><strong>Commissioner election.</strong> ${esc(s.meeting.election)}</p>`;
      if (s.meeting.tally) {
        html += `<div class="tally">${s.meeting.tally.map(t =>
          `<div><b>${esc(t.voter)}</b><span>${esc(t.vote)}</span></div>`).join('')}</div>`;
      }
    }
    if (s.ruleChanges && s.ruleChanges.length) {
      html += `<p style="margin-top:1.2rem"><strong>Rule changes</strong></p>
        <ul class="rc">${s.ruleChanges.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`;
    }
    html += `</div>`;
  }

  $('#seasonBody').innerHTML = html;
}

/* ============================================================
   RECORD BOOK
   ============================================================ */
function renderRecords() {
  $('#recordList').innerHTML = (DATA.recordBook || []).map(r => `
    <div class="rec-row">
      <div class="v">${esc(r.value)}</div>
      <div class="meta">
        <div class="lbl">${esc(r.record)} ${r.verified
          ? '<span class="pill">Verified</span>'
          : '<span class="pill gray">Unverified</span>'}</div>
        <div class="hold">${esc(r.holder)}</div>
        <div class="when">${esc(r.when)}</div>
      </div>
      ${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}
    </div>`).join('');
}

/* ============================================================
   RULEBOOK
   ============================================================ */
function renderRules() {
  const R = DATA.rules || {};
  let html = '';

  if (R.scoring) {
    html += `<div class="rule-block"><h3 class="sub" style="margin-top:0">Scoring</h3>`;
    if (R.scoring.summary) html += `<p class="sumry">${esc(R.scoring.summary)}</p>`;
    html += `<div class="score-grid">${(R.scoring.groups || []).map(g => `
      <div class="score-card">
        <h4>${esc(g.name)}</h4>
        <ul>${g.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      </div>`).join('')}</div></div>`;
  }

  const blocks = [
    ['Draft', R.draft], ['Trades', R.trades], ['Waiver Acquisitions', R.waivers],
    ['Playoff Structure', R.playoffs], ['Miscellaneous Rules', R.misc], ['Annual Meeting', R.annualMeeting]
  ];
  blocks.forEach(([title, list]) => {
    if (!list || !list.length) return;
    html += `<div class="rule-block"><h3 class="sub">${esc(title)}</h3>
      <ul class="rules">${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  });

  $('#rulesBody').innerHTML = html;
}

function renderFooter() {
  const L = DATA.league;
  $('#footNote').innerHTML =
    `${esc(L.name)} (est. ${L.established}) · Commissioner ${esc(L.commissioner)}` +
    (L.address ? ` · ${esc(L.address)}` : '');
}

/* ============================================================
   UI PLUMBING
   ============================================================ */
function initTabs() {
  const go = name => {
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) go(b.dataset.tab);
  });
  const h = location.hash.slice(1);
  if (h && $('#tab-' + h)) go(h);
  window.addEventListener('hashchange', () => {
    const n = location.hash.slice(1);
    if (n && $('#tab-' + n)) go(n);
  });
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('tl-theme'); } catch (e) { /* private mode */ }
  if (saved) document.documentElement.dataset.theme = saved;
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('tl-theme', next); } catch (e) { /* ignore */ }
  });
}

/* ---------- verified regular-season head-to-head history ---------- */
function completedRegularWeeks(league) {
  const end = (league.settings?.playoff_week_start || 15) - 1;
  return Math.max(0, league.status === 'complete' ? end : Math.min(end, league.settings?.last_scored_leg || 0));
}

function matchupGames(rows, rosters, year, week) {
  const owners = Object.fromEntries(rosters.map(r => [r.roster_id, r.owner_id]));
  const groups = {};
  rows.forEach(r => {
    if (r.matchup_id != null) (groups[r.matchup_id] ||= []).push(r);
  });
  return Object.values(groups).flatMap(pair => {
    if (pair.length !== 2) return [];
    const [a, b] = pair;
    const aId = owners[a.roster_id], bId = owners[b.roster_id];
    const ap = a.custom_points ?? a.points, bp = b.custom_points ?? b.points;
    if (!OWNER_BY_SLEEPER[aId] || !OWNER_BY_SLEEPER[bId] || ap == null || bp == null) return [];
    if (!Number.isFinite(Number(ap)) || !Number.isFinite(Number(bp))) return [];
    return [{ year, week, a: aId, b: bId, ap: Math.round(Number(ap) * 100), bp: Math.round(Number(bp) * 100) }];
  });
}

async function loadHeadToHead() {
  HEAD_TO_HEAD = [];
  H2H_COVERAGE = [];
  const tasks = [];
  Object.entries(SEASONS).forEach(([year, season]) => {
    if (season.source !== 'sleeper') return;
    const saved = SNAPSHOT?.seasons.find(s => s.league.league_id === season.league.league_id);
    const coverage = { year: +year, weeks: completedRegularWeeks(season.league), loaded: 0, saved: 0, missing: 0 };
    H2H_COVERAGE.push(coverage);
    for (let week = 1; week <= coverage.weeks; week++) {
      tasks.push(async () => {
        let rows, rosters = season.rosters;
        try { rows = await getJSON(`${API}/league/${season.league.league_id}/matchups/${week}`); }
        catch (e) {
          rows = saved?.matchups[week];
          rosters = saved?.rosters;
          if (rows) coverage.saved++;
        }
        if (!Array.isArray(rows) || !rosters) { coverage.missing++; return; }
        const games = matchupGames(rows, rosters, +year, week);
        // Never present a partial or empty response as a complete week.
        if (games.length !== DATA.owners.length / 2) { coverage.missing++; return; }
        HEAD_TO_HEAD.push(...games);
        coverage.loaded++;
      });
    }
  });
  for (let i = 0; i < tasks.length; i += 8) await Promise.all(tasks.slice(i, i + 8).map(run => run()));
}

function headToHeadRecord(owner, opponent) {
  const record = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
  HEAD_TO_HEAD.forEach(g => {
    if (!((g.a === owner && g.b === opponent) || (g.b === owner && g.a === opponent))) return;
    const [pf, pa] = g.a === owner ? [g.ap, g.bp] : [g.bp, g.ap];
    record.pf += pf / 100; record.pa += pa / 100;
    if (pf > pa) record.w++; else if (pf < pa) record.l++; else record.t++;
  });
  return record;
}
const recordLabel = r => `${r.w}–${r.l}–${r.t}`;

function renderHeadToHead() {
  const owners = DATA.owners;
  const coverage = H2H_COVERAGE.sort((a, b) => a.year - b.year);
  $('#h2hCoverage').textContent = `Verified coverage: ${coverage.map(c => `${c.year} (${c.loaded}/${c.weeks} completed weeks)`).join(' · ') || 'unavailable'}. 2020–2021 ESPN weekly results are not available; those seasons are excluded. No records are inferred from season totals.` +
    (coverage.some(c => c.missing) ? ' Some matchup weeks could not be loaded; the records below are incomplete.' : '') +
    (coverage.some(c => c.saved) ? ` Includes saved results from ${new Date(SNAPSHOT.updatedAt).toLocaleDateString()}.` : '');
  if (!HEAD_TO_HEAD.length) {
    $('#h2hMatrix').innerHTML = '<p>No completed matchup data available.</p>';
    return;
  }
  $('#h2hMatrix').className = '';
  $('#h2hMatrix').innerHTML = `<div class="tbl-wrap h2h-scroll" tabindex="0" role="region" aria-label="Head-to-head records, scroll horizontally to see every owner"><table class="h2h-table">
    <caption>Regular-season head-to-head · row owner's W–L–T</caption>
    <thead><tr><th scope="col">Owner</th>${owners.map(o => `<th scope="col">${esc(o.name)}</th>`).join('')}</tr></thead>
    <tbody>${owners.map(o => `<tr><th scope="row">${esc(o.name)}</th>${owners.map(other => {
      if (o === other) return '<td class="num h2h-self" aria-label="Same owner">—</td>';
      const r = headToHeadRecord(o.sleeperUserId, other.sleeperUserId);
      return `<td class="num ${r.w > r.l ? 'h2h-winning' : ''}" title="${esc(o.name)} vs ${esc(other.name)}">${recordLabel(r)}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
  $('#h2hOwner').innerHTML = owners.map(o => `<option value="${esc(o.sleeperUserId)}">${esc(o.name)}</option>`).join('');
  $('#h2hOwner').onchange = renderHeadToHeadDetail;
  renderHeadToHeadDetail();
}

function renderHeadToHeadDetail() {
  const owner = $('#h2hOwner').value;
  $('#h2hDetail').innerHTML = tallyTable(DATA.owners.filter(o => o.sleeperUserId !== owner),
    ['Opponent', 'W–L–T', 'Win %', 'Points For', 'Points Against'], o => {
      const r = headToHeadRecord(owner, o.sleeperUserId);
      return [`<span class="tname">${esc(o.name)}</span><span class="oname">${esc(o.team)}</span>`, recordLabel(r),
        r.w + r.l + r.t ? pct(r.w, r.l, r.t).toFixed(3) : '—', fmt(r.pf), fmt(r.pa)];
    });
}
