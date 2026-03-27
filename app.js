let APP_DATA = null;

// Load tournament data from JSON file
async function loadTournamentData() {
  try {
    const response = await fetch('tournament-data.json');
    if (!response.ok) throw new Error('Failed to load tournament data');
    APP_DATA = await response.json();
    console.log('Tournament data loaded successfully');
  } catch (error) {
    console.error('Error loading tournament data:', error);
    alert('Failed to load tournament data. Please refresh the page.');
  }
}

// APP_DATA will be loaded from tournament-data.json

// ----------------------------
// QUICK CONFIG
// ----------------------------
const CONFIG = {
  appTitle: "ShuttleStorm Live Tracker",
  adminPin: "Equilend123!@#", // light protection only; not secure
  useSupabase: true,
  supabaseUrl: "https://lydlxkbwagzuossjocfo.supabase.co",
  supabaseAnonKey: "sb_publishable_mjOLD0bsE0zOZ4Dlv3EP7w_ROel4gMS",
  supabaseTable: "match_scores"
};

const state = {
  activeMatchTab: "All",
  activeStandingTab: "Overall",
  activeParticipationTab: "Smash Force",
  activeTeamFilter: "all",
  activeSlotFilter: "all",
  activeScheduleTeamFilter: "all",
  activeScheduleSlotFilter: "all",
  isAdmin: false,
  currentMatchId: null,
  results: {},
  supabase: null
};

let TEAM_LOOKUP = {};
let LEAGUE_TEAMS = [];
let GROUPS = {};
const MATCH_TYPES = ["All", "League", "Final", "Completed", "Upcoming"];

// Initialize data-dependent constants after APP_DATA is loaded
function initializeConstants() {
  TEAM_LOOKUP = Object.fromEntries(APP_DATA.teams.map(t => [t.id, t]));
  LEAGUE_TEAMS = APP_DATA.teams.map(t => t.id);
  GROUPS = {
    "Group A": APP_DATA.teams.filter(t => t.group === "Group A").map(t => t.id),
    "Group B": APP_DATA.teams.filter(t => t.group === "Group B").map(t => t.id),
  };
  document.getElementById("subtitle").textContent = `${CONFIG.appTitle} • ${APP_DATA.tournament.date}`;
}
document.title = CONFIG.appTitle;

function normalizeScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getEffectiveTeam(match, side) {
  const raw = side === "A" ? match.teamA : match.teamB;
  if (raw === "A1") return getGroupLeader("Group A")?.teamId || "A1";
  if (raw === "B1") return getGroupLeader("Group B")?.teamId || "B1";
  return raw;
}

function getTeamLabel(teamId) {
  if (!TEAM_LOOKUP[teamId]) return teamId;
  return `${teamId} • ${TEAM_LOOKUP[teamId].displayName}`;
}

function getTeamShort(teamId) {
  if (!TEAM_LOOKUP[teamId]) return teamId;
  return TEAM_LOOKUP[teamId].displayName;
}

function getMatchResult(matchId) {
  return state.results[matchId] || {
    matchId,
    set1A: null, set1B: null,
    set2A: null, set2B: null,
    set3A: null, set3B: null,
    status: "upcoming",
    remarks: "",
    playersA: [],
    playersB: [],
    plannedPlayersA: [],
    plannedPlayersB: []
  };
}

function completedSets(result) {
  return [
    [result.set1A, result.set1B],
    [result.set2A, result.set2B],
    [result.set3A, result.set3B],
  ].filter(([a,b]) => a !== null && b !== null);
}

function computeWinnerForResult(match, result) {
  const sets = completedSets(result);
  let aSets = 0;
  let bSets = 0;
  for (const [a,b] of sets) {
    if (a > b) aSets++;
    if (b > a) bSets++;
  }
  if (aSets === 0 && bSets === 0) return "";
  if (aSets === bSets) return "";
  return aSets > bSets ? getEffectiveTeam(match, "A") : getEffectiveTeam(match, "B");
}

function totalPointsForSide(result, side) {
  const keys = side === "A"
    ? ["set1A","set2A","set3A"]
    : ["set1B","set2B","set3B"];
  return keys.reduce((sum, key) => sum + (Number(result[key]) || 0), 0);
}

function totalPointsAgainstSide(result, side) {
  const keys = side === "A"
    ? ["set1B","set2B","set3B"]
    : ["set1A","set2A","set3A"];
  return keys.reduce((sum, key) => sum + (Number(result[key]) || 0), 0);
}

function computeStandings(teamIds = LEAGUE_TEAMS) {
  const rows = teamIds.map(teamId => ({
    teamId,
    teamName: getTeamShort(teamId),
    group: TEAM_LOOKUP[teamId]?.group || "",
    played: 0,
    wins: 0,
    losses: 0,
    points: 0,
    scored: 0,
    conceded: 0,
    diff: 0,
  }));

  const map = Object.fromEntries(rows.map(r => [r.teamId, r]));
  const leagueMatches = APP_DATA.matches.filter(m => m.stage === "League");

  for (const match of leagueMatches) {
    const result = getMatchResult(match.id);
    if (result.status !== "completed") continue;

    const teamA = getEffectiveTeam(match, "A");
    const teamB = getEffectiveTeam(match, "B");
    if (!map[teamA] || !map[teamB]) continue;

    const winner = computeWinnerForResult(match, result);
    const aRow = map[teamA];
    const bRow = map[teamB];

    aRow.played += 1;
    bRow.played += 1;

    const aScored = totalPointsForSide(result, "A");
    const bScored = totalPointsForSide(result, "B");
    aRow.scored += aScored;
    aRow.conceded += bScored;
    bRow.scored += bScored;
    bRow.conceded += aScored;

    if (winner === teamA) {
      aRow.wins += 1;
      bRow.losses += 1;
      aRow.points += APP_DATA.tournament.pointsForWin;
    } else if (winner === teamB) {
      bRow.wins += 1;
      aRow.losses += 1;
      bRow.points += APP_DATA.tournament.pointsForWin;
    }
  }

  rows.forEach(r => r.diff = r.scored - r.conceded);

  // Apply penalty for teams with non-participating players
  rows.forEach(r => {
    const penalty = calculateTeamParticipationPenalty(r.teamId);
    r.points -= penalty;
    if (penalty > 0) {
      r.penalty = penalty;
    }
  });

  rows.sort((a,b) =>
    b.points - a.points ||
    b.diff - a.diff ||
    b.scored - a.scored ||
    a.teamId.localeCompare(b.teamId)
  );
  return rows;
}

function calculateTeamParticipationPenalty(teamId) {
  const team = TEAM_LOOKUP[teamId];
  if (!team) return 0;

  const leagueMatches = APP_DATA.matches.filter(m => m.stage === "League");
  const allLeaguesCompleted = leagueMatches.every(m => getMatchResult(m.id).status === "completed");

  if (!allLeaguesCompleted) return 0;

  const participatingPlayers = new Set();

  for (const match of leagueMatches) {
    const result = getMatchResult(match.id);
    if (result.status !== "completed") continue;

    const teamA = getEffectiveTeam(match, "A");
    const teamB = getEffectiveTeam(match, "B");

    if (teamA === teamId && result.playersA) {
      result.playersA.forEach(p => participatingPlayers.add(p));
    }
    if (teamB === teamId && result.playersB) {
      result.playersB.forEach(p => participatingPlayers.add(p));
    }
  }

  const nonParticipatingCount = team.players.filter(p => !participatingPlayers.has(p)).length;
  return nonParticipatingCount * 2;
}

function getGroupLeader(group) {
  const standings = computeStandings(GROUPS[group]);
  return standings[0] || null;
}

function computePlayerStats() {
  const playerStats = new Map();

  const leagueMatches = APP_DATA.matches.filter(m => m.stage === "League");

  for (const match of leagueMatches) {
    const result = getMatchResult(match.id);
    if (result.status !== "completed") continue;

    const winner = computeWinnerForResult(match, result);
    if (!winner) continue;

    const teamA = getEffectiveTeam(match, "A");
    const teamB = getEffectiveTeam(match, "B");
    const isSingles = match.matchType === "Singles";
    const pointsForWin = isSingles ? 2 : 1;

    const winningPlayers = winner === teamA ? result.playersA : result.playersB;
    const losingPlayers = winner === teamA ? result.playersB : result.playersA;
    const winningTeam = winner === teamA ? teamA : teamB;
    const losingTeam = winner === teamA ? teamB : teamA;

    // Update stats for winning players
    if (winningPlayers && winningPlayers.length > 0) {
      winningPlayers.forEach(player => {
        if (!playerStats.has(player)) {
          playerStats.set(player, {
            name: player,
            team: winningTeam,
            points: 0,
            matchesWon: 0,
            matchesLost: 0,
            matchesPlayed: 0
          });
        }
        const stats = playerStats.get(player);
        stats.points += pointsForWin;
        stats.matchesWon += 1;
        stats.matchesPlayed += 1;
      });
    }

    // Update stats for losing players
    if (losingPlayers && losingPlayers.length > 0) {
      losingPlayers.forEach(player => {
        if (!playerStats.has(player)) {
          playerStats.set(player, {
            name: player,
            team: losingTeam,
            points: 0,
            matchesWon: 0,
            matchesLost: 0,
            matchesPlayed: 0
          });
        }
        const stats = playerStats.get(player);
        stats.matchesLost += 1;
        stats.matchesPlayed += 1;
      });
    }
  }

  return Array.from(playerStats.values()).sort((a, b) =>
    b.points - a.points ||
    b.matchesWon - a.matchesWon ||
    a.name.localeCompare(b.name)
  );
}

function getTeamParticipation(teamId) {
  const team = TEAM_LOOKUP[teamId];
  if (!team) return [];

  const playerMatches = new Map();
  team.players.forEach(p => playerMatches.set(p, 0));

  const leagueMatches = APP_DATA.matches.filter(m => m.stage === "League");

  for (const match of leagueMatches) {
    const result = getMatchResult(match.id);
    if (result.status !== "completed") continue;

    const teamA = getEffectiveTeam(match, "A");
    const teamB = getEffectiveTeam(match, "B");

    if (teamA === teamId && result.playersA) {
      result.playersA.forEach(p => {
        if (playerMatches.has(p)) {
          playerMatches.set(p, playerMatches.get(p) + 1);
        }
      });
    }
    if (teamB === teamId && result.playersB) {
      result.playersB.forEach(p => {
        if (playerMatches.has(p)) {
          playerMatches.set(p, playerMatches.get(p) + 1);
        }
      });
    }
  }

  return Array.from(playerMatches.entries())
    .map(([name, matches]) => ({ name, matches }))
    .sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name));
}

function enrichMatch(match) {
  const result = getMatchResult(match.id);
  const teamA = getEffectiveTeam(match, "A");
  const teamB = getEffectiveTeam(match, "B");
  const winner = computeWinnerForResult(match, result);
  const aScore = totalPointsForSide(result, "A");
  const bScore = totalPointsForSide(result, "B");
  return {
    ...match,
    effectiveTeamA: teamA,
    effectiveTeamB: teamB,
    result,
    winner,
    aScore,
    bScore
  };
}

function renderTeamFilter() {
  const select = document.getElementById("teamFilter");
  const teams = APP_DATA.teams.map(t => t.id).sort();

  select.innerHTML = `
    <option value="all">All Teams</option>
    ${teams.map(teamId => {
      const team = TEAM_LOOKUP[teamId];
      return `<option value="${teamId}" ${state.activeTeamFilter === teamId ? "selected" : ""}>${team.displayName}</option>`;
    }).join("")}
  `;

  select.onchange = () => {
    state.activeTeamFilter = select.value;
    renderMatches();
  };
}

function renderSlotFilter() {
  const select = document.getElementById("slotFilter");
  const slots = [...new Set(APP_DATA.matches.map(m => m.slot))].sort();

  select.innerHTML = `
    <option value="all">All Slots</option>
    ${slots.map(slot => {
      return `<option value="${slot}" ${state.activeSlotFilter === slot ? "selected" : ""}>${slot}</option>`;
    }).join("")}
  `;

  select.onchange = () => {
    state.activeSlotFilter = select.value;
    renderMatches();
  };
}

function renderMatchTabs() {
  const wrap = document.getElementById("matchTabs");
  wrap.innerHTML = MATCH_TYPES.map(tab => `
    <button class="tab ${state.activeMatchTab === tab ? "active" : ""}" data-match-tab="${tab}">
      ${tab}
    </button>
  `).join("");
  wrap.querySelectorAll("[data-match-tab]").forEach(btn => btn.onclick = () => {
    state.activeMatchTab = btn.dataset.matchTab;
    renderMatchTabs();
    renderMatches();
  });
}

function renderStandingTabs() {
  const tabs = ["Overall", "Group A", "Group B"];
  const wrap = document.getElementById("standingTabs");
  wrap.innerHTML = tabs.map(tab => `
    <button class="tab ${state.activeStandingTab === tab ? "active" : ""}" data-standing-tab="${tab}">
      ${tab}
    </button>
  `).join("");
  wrap.querySelectorAll("[data-standing-tab]").forEach(btn => btn.onclick = () => {
    state.activeStandingTab = btn.dataset.standingTab;
    renderStandingTabs();
    renderStandings();
  });
}

function filterMatches(enriched) {
  let filtered = enriched;

  // Filter by tab (stage/status)
  const tab = state.activeMatchTab;
  if (tab === "League") filtered = filtered.filter(m => m.stage === "League");
  else if (tab === "Final") filtered = filtered.filter(m => m.stage === "Final");
  else if (tab === "Completed") filtered = filtered.filter(m => m.result.status === "completed");
  else if (tab === "Upcoming") filtered = filtered.filter(m => m.result.status !== "completed");

  // Filter by team
  if (state.activeTeamFilter !== "all") {
    filtered = filtered.filter(m =>
      m.effectiveTeamA === state.activeTeamFilter ||
      m.effectiveTeamB === state.activeTeamFilter
    );
  }

  // Filter by slot
  if (state.activeSlotFilter !== "all") {
    filtered = filtered.filter(m => m.slot === state.activeSlotFilter);
  }

  return filtered;
}

function renderMatches() {
  const list = document.getElementById("matchList");
  const items = filterMatches(APP_DATA.matches.map(enrichMatch));

  if (!items.length) {
    list.innerHTML = `<div class="match-card"><div>No matches found.</div></div>`;
    return;
  }

  list.innerHTML = items.map(match => {
    const statusClass = match.result.status || "upcoming";
    const winnerName = match.winner ? getTeamShort(match.winner) : "—";
    const actualPlayersA = match.result.playersA || [];
    const actualPlayersB = match.result.playersB || [];
    const plannedPlayersA = match.result.plannedPlayersA || [];
    const plannedPlayersB = match.result.plannedPlayersB || [];

    const displayPlayersA = actualPlayersA.length > 0 ? actualPlayersA : plannedPlayersA;
    const displayPlayersB = actualPlayersB.length > 0 ? actualPlayersB : plannedPlayersB;

    return `
      <div class="match-card">
        <div class="match-meta">
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <span class="badge">${match.stage}</span>
            <span class="badge">${match.slot}</span>
            <span class="badge">${match.time || ""}</span>
            <span class="badge">${match.court}</span>
            <span class="badge">${match.matchType}</span>
          </div>
          <span class="status ${statusClass}">${statusClass.toUpperCase()}</span>
        </div>

        <div class="teams-row">
          <div class="team-box">
            <strong>${getTeamShort(match.effectiveTeamA)}</strong>
            <div class="muted">${match.effectiveTeamA}</div>
            ${displayPlayersA.length > 0 ? `
              <div style="margin-top:6px; font-size:12px;">
                ${displayPlayersA.map(p => `<div style="color:#94a3b8;">👤 ${p}</div>`).join("")}
              </div>
            ` : ""}
          </div>
          <div class="score-big">${match.aScore} - ${match.bScore}</div>
          <div class="team-box">
            <strong>${getTeamShort(match.effectiveTeamB)}</strong>
            <div class="muted">${match.effectiveTeamB}</div>
            ${displayPlayersB.length > 0 ? `
              <div style="margin-top:6px; font-size:12px;">
                ${displayPlayersB.map(p => `<div style="color:#94a3b8;">👤 ${p}</div>`).join("")}
              </div>
            ` : ""}
          </div>
        </div>

        <div class="match-meta">
          <div>Winner: <strong>${winnerName}</strong></div>
          <div>${match.result.remarks ? `Remarks: ${match.result.remarks}` : ""}</div>
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn small primary" data-edit-match="${match.id}">Update Score</button>
          <button class="btn small" data-quick-live="${match.id}">Mark Live</button>
          ${state.isAdmin ? `<button class="btn small" data-plan-match="${match.id}">Set Players</button>` : ""}
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-edit-match]").forEach(btn => btn.onclick = () => openModal(btn.dataset.editMatch));
  list.querySelectorAll("[data-quick-live]").forEach(btn => btn.onclick = async () => {
    const matchId = btn.dataset.quickLive;
    const result = { ...getMatchResult(matchId), status: "live" };
    await persistResult(matchId, result);
    render();
  });
  list.querySelectorAll("[data-plan-match]").forEach(btn => btn.onclick = () => openPlanModal(btn.dataset.planMatch));
}

function renderStandings() {
  const wrap = document.getElementById("standingsWrap");
  let rows;
  if (state.activeStandingTab === "Overall") rows = computeStandings();
  else rows = computeStandings(GROUPS[state.activeStandingTab]);

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Team</th>
          <th class="right">P</th>
          <th class="right">W</th>
          <th class="right">L</th>
          <th class="right">Pts</th>
          <th class="right">Scored</th>
          <th class="right">Against</th>
          <th class="right">Diff</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>
              <strong>${row.teamName}</strong><br />
              <span class="muted">${row.teamId} • ${row.group}</span>
              ${row.penalty ? `<br /><span class="status danger" style="font-size:10px; padding:2px 6px;">-${row.penalty} penalty</span>` : ""}
            </td>
            <td class="right">${row.played}</td>
            <td class="right">${row.wins}</td>
            <td class="right">${row.losses}</td>
            <td class="right"><strong>${row.points}</strong></td>
            <td class="right">${row.scored}</td>
            <td class="right">${row.conceded}</td>
            <td class="right">${row.diff > 0 ? "+" : ""}${row.diff}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderFinals() {
  const groupA = computeStandings(GROUPS["Group A"]);
  const groupB = computeStandings(GROUPS["Group B"]);
  const a1 = groupA[0];
  const b1 = groupB[0];
  document.getElementById("kpiFinalists").textContent = `${a1 ? a1.teamName : "TBD"} vs ${b1 ? b1.teamName : "TBD"}`;

  const finalMatches = APP_DATA.matches.filter(m => m.stage === "Final").map(enrichMatch);
  document.getElementById("finalsWrap").innerHTML = `
    <div class="card-list">
      <div class="match-card">
        <div class="match-meta">
          <div><span class="pill">Group A Leader</span></div>
          <div>${a1 ? `${a1.teamName} (${a1.points} pts, ${a1.diff > 0 ? "+" : ""}${a1.diff} diff)` : "TBD"}</div>
        </div>
        <div class="match-meta">
          <div><span class="pill">Group B Leader</span></div>
          <div>${b1 ? `${b1.teamName} (${b1.points} pts, ${b1.diff > 0 ? "+" : ""}${b1.diff} diff)` : "TBD"}</div>
        </div>
      </div>
      ${finalMatches.map(match => `
        <div class="match-card">
          <div class="match-meta">
            <div>${match.slot} • ${match.time} • ${match.court}</div>
            <div>${match.matchType}</div>
          </div>
          <div class="teams-row">
            <div class="team-box"><strong>${getTeamShort(match.effectiveTeamA)}</strong></div>
            <div class="score-big">${match.aScore} - ${match.bScore}</div>
            <div class="team-box"><strong>${getTeamShort(match.effectiveTeamB)}</strong></div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderTeams() {
  const wrap = document.getElementById("teamsWrap");
  wrap.innerHTML = APP_DATA.teams.map(team => `
    <div class="match-card">
      <div class="match-meta">
        <div><strong>${team.displayName}</strong></div>
        <div>${team.id} • ${team.group}</div>
      </div>
      <div>${team.players.map(p => `<span class="badge">${p}</span>`).join(" ")}</div>
    </div>
  `).join("");
}

function renderScheduleTeamFilter() {
  const select = document.getElementById("scheduleTeamFilter");
  const teams = APP_DATA.teams.map(t => t.id).sort();

  select.innerHTML = `
    <option value="all">All Teams</option>
    ${teams.map(teamId => {
      const team = TEAM_LOOKUP[teamId];
      return `<option value="${teamId}" ${state.activeScheduleTeamFilter === teamId ? "selected" : ""}>${team.displayName}</option>`;
    }).join("")}
  `;

  select.onchange = () => {
    state.activeScheduleTeamFilter = select.value;
    renderSchedule();
  };
}

function renderScheduleSlotFilter() {
  const select = document.getElementById("scheduleSlotFilter");
  const slots = [...new Set(APP_DATA.matches.map(m => m.slot))].sort();

  select.innerHTML = `
    <option value="all">All Slots</option>
    ${slots.map(slot => {
      return `<option value="${slot}" ${state.activeScheduleSlotFilter === slot ? "selected" : ""}>${slot}</option>`;
    }).join("")}
  `;

  select.onchange = () => {
    state.activeScheduleSlotFilter = select.value;
    renderSchedule();
  };
}

function filterScheduleMatches(enriched) {
  let filtered = enriched;

  // Filter by team
  if (state.activeScheduleTeamFilter !== "all") {
    filtered = filtered.filter(m =>
      m.effectiveTeamA === state.activeScheduleTeamFilter ||
      m.effectiveTeamB === state.activeScheduleTeamFilter
    );
  }

  // Filter by slot
  if (state.activeScheduleSlotFilter !== "all") {
    filtered = filtered.filter(m => m.slot === state.activeScheduleSlotFilter);
  }

  return filtered;
}

function renderSchedule() {
  const wrap = document.getElementById("scheduleList");
  const enrichedMatches = APP_DATA.matches.map(enrichMatch);
  const items = filterScheduleMatches(enrichedMatches);

  if (!items.length) {
    wrap.innerHTML = `<div class="match-card"><div>No matches found.</div></div>`;
    return;
  }

  // Group by slot
  const bySlot = {};
  items.forEach(m => {
    if (!bySlot[m.slot]) bySlot[m.slot] = [];
    bySlot[m.slot].push(m);
  });

  wrap.innerHTML = Object.keys(bySlot).sort().map(slot => {
    const matches = bySlot[slot];
    return `
      <div style="margin-bottom:20px;">
        <h3 style="margin-bottom:12px; color:#22c55e;">${slot} (${matches[0].time})</h3>
        <div style="display:grid; gap:8px;">
          ${matches.map(m => `
            <div style="display:grid; grid-template-columns: 100px 1fr 80px 1fr 130px; gap:10px; padding:10px; background:#1e293b; border:1px solid #334155; border-radius:6px; align-items:center; font-size:13px;">
              <div style="color:#94a3b8;">${m.court}</div>
              <div style="text-align:right;">
                <strong>${getTeamShort(m.effectiveTeamA)}</strong>
                <div style="font-size:11px; color:#94a3b8;">${m.effectiveTeamA}</div>
              </div>
              <div style="text-align:center; color:#22c55e; font-weight:bold;">
                ${m.result.status === "completed" ? `${m.scoreA} - ${m.scoreB}` : "vs"}
              </div>
              <div>
                <strong>${getTeamShort(m.effectiveTeamB)}</strong>
                <div style="font-size:11px; color:#94a3b8;">${m.effectiveTeamB}</div>
              </div>
              <div style="text-align:right;">
                <span class="badge ${m.result.status === "completed" ? "badge-success" : "badge-upcoming"}">${m.matchType}</span>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function renderPlayerStats() {
  const stats = computePlayerStats();

  // Separate men and women
  const men = stats.filter(p => !isLikelyFemale(p.name));
  const women = stats.filter(p => isLikelyFemale(p.name));

  renderPlayerStatsMen(men);
  renderPlayerStatsWomen(women);
}

function renderPlayerStatsMen(men) {
  const wrap = document.getElementById("playerStatsMenWrap");

  if (!men.length) {
    wrap.innerHTML = `<div class="muted" style="padding:8px;">No completed matches with player data yet.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th class="right">Pts</th>
          <th class="right">W</th>
          <th class="right">L</th>
        </tr>
      </thead>
      <tbody>
        ${men.slice(0, 5).map((p, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>
              <strong>${p.name}</strong><br />
              <span class="muted">${getTeamShort(p.team)}</span>
            </td>
            <td class="right"><strong>${p.points}</strong></td>
            <td class="right">${p.matchesWon}</td>
            <td class="right">${p.matchesLost}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderPlayerStatsWomen(women) {
  const wrap = document.getElementById("playerStatsWomenWrap");

  if (!women.length) {
    wrap.innerHTML = `<div class="muted" style="padding:8px;">No completed matches with player data yet.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th class="right">Pts</th>
          <th class="right">W</th>
          <th class="right">L</th>
        </tr>
      </thead>
      <tbody>
        ${women.slice(0, 5).map((p, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>
              <strong>${p.name}</strong><br />
              <span class="muted">${getTeamShort(p.team)}</span>
            </td>
            <td class="right"><strong>${p.points}</strong></td>
            <td class="right">${p.matchesWon}</td>
            <td class="right">${p.matchesLost}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function isLikelyFemale(name) {
  const femaleNames = ["Salony", "Praveena", "Kalaivani", "Tanya", "Lakshmi", "Charitha", "neelam", "Akhila", "BANI",
    "Amisha", "Poulomi", "Shubhangi", "Ramya", "Anukriti", "Reetu"];
  return femaleNames.some(fn => name.includes(fn));
}

function renderParticipationTabs() {
  const tabs = APP_DATA.teams.map(t => t.displayName);
  const wrap = document.getElementById("participationTabs");
  wrap.innerHTML = tabs.map(tab => `
    <button class="tab ${state.activeParticipationTab === tab ? "active" : ""}" data-participation-tab="${tab}">
      ${tab}
    </button>
  `).join("");
  wrap.querySelectorAll("[data-participation-tab]").forEach(btn => btn.onclick = () => {
    state.activeParticipationTab = btn.dataset.participationTab;
    renderParticipationTabs();
    renderParticipation();
  });
}

function renderParticipation() {
  const wrap = document.getElementById("participationWrap");
  const teamName = state.activeParticipationTab;
  const team = APP_DATA.teams.find(t => t.displayName === teamName);

  if (!team) return;

  const participation = getTeamParticipation(team.id);
  const nonParticipating = participation.filter(p => p.matches === 0);
  const penalty = calculateTeamParticipationPenalty(team.id);

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Player</th>
          <th class="right">Matches Played</th>
        </tr>
      </thead>
      <tbody>
        ${participation.map(p => `
          <tr>
            <td>
              ${p.name}
              ${p.matches === 0 ? `<span class="status danger" style="font-size:10px; padding:2px 6px; margin-left:8px;">Not played</span>` : ""}
            </td>
            <td class="right"><strong>${p.matches}</strong></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    ${penalty > 0 ? `<div class="footer-note" style="color:#ef4444;">⚠️ This team will have ${penalty} points deducted (${nonParticipating.length} player(s) not participated).</div>` : ""}
  `;
}

function updateKpis() {
  const leagueMatches = APP_DATA.matches.filter(m => m.stage === "League");
  const enriched = leagueMatches.map(enrichMatch);
  const completed = enriched.filter(m => m.result.status === "completed").length;
  document.getElementById("kpiCompleted").textContent = completed;
  document.getElementById("kpiUpcoming").textContent = leagueMatches.length - completed;
  document.getElementById("toggleAdminBtn").textContent = state.isAdmin ? "Admin On" : "Admin Mode";

  // Calculate current slot
  const liveMatch = enriched.find(m => m.result.status === "live");
  const upcomingMatch = enriched.find(m => m.result.status === "upcoming");
  let currentSlot = "All completed";
  if (liveMatch) {
    currentSlot = liveMatch.slot;
  } else if (upcomingMatch) {
    currentSlot = upcomingMatch.slot;
  }
  document.getElementById("kpiCurrentSlot").textContent = currentSlot;
}

function openModal(matchId) {
  if (!state.isAdmin) {
    const pin = prompt("Enter admin PIN");
    if (pin !== CONFIG.adminPin) return;
    state.isAdmin = true;
  }
  state.currentMatchId = matchId;
  const match = APP_DATA.matches.find(m => m.id === matchId);
  const result = getMatchResult(matchId);

  document.getElementById("scoreModalBackdrop").classList.add("open");
  document.getElementById("modalTitle").textContent = `${match.matchType} • ${match.slot}`;
  document.getElementById("modalMeta").textContent = `${match.stage} • ${match.court} • ${match.time}`;
  document.getElementById("modalTeamA").value = getTeamLabel(getEffectiveTeam(match, "A"));
  document.getElementById("modalTeamB").value = getTeamLabel(getEffectiveTeam(match, "B"));
  document.getElementById("a1").value = result.set1A ?? "";
  document.getElementById("b1").value = result.set1B ?? "";
  document.getElementById("a2").value = result.set2A ?? "";
  document.getElementById("b2").value = result.set2B ?? "";
  document.getElementById("a3").value = result.set3A ?? "";
  document.getElementById("b3").value = result.set3B ?? "";
  document.getElementById("remarks").value = result.remarks || "";
  document.getElementById("matchStatus").value = result.status || "upcoming";
  document.getElementById("winnerPreview").value = computeWinnerForResult(match, result) ? getTeamShort(computeWinnerForResult(match, result)) : "";

  renderPlayerSelection(match, result);
  attachFieldListeners();
}

function renderPlayerSelection(match, result) {
  const teamA = getEffectiveTeam(match, "A");
  const teamB = getEffectiveTeam(match, "B");
  const teamAPlayers = TEAM_LOOKUP[teamA]?.players || [];
  const teamBPlayers = TEAM_LOOKUP[teamB]?.players || [];

  const requiredPlayers = match.matchType === "Singles" ? 1 : 2;

  // Use actual players if set, otherwise use planned players as default
  const selectedPlayersA = result.playersA && result.playersA.length > 0 ? result.playersA : (result.plannedPlayersA || []);
  const selectedPlayersB = result.playersB && result.playersB.length > 0 ? result.playersB : (result.plannedPlayersB || []);

  const playersAWrap = document.getElementById("playersAWrap");
  const playersBWrap = document.getElementById("playersBWrap");

  playersAWrap.innerHTML = `
    <label>Players from ${getTeamShort(teamA)} (select ${requiredPlayers})${result.plannedPlayersA && result.plannedPlayersA.length > 0 ? ' <span class="muted">- pre-filled</span>' : ""}</label>
    ${teamAPlayers.map(player => `
      <label class="player-checkbox">
        <input type="checkbox"
          class="player-select-a"
          value="${player}"
          ${selectedPlayersA.includes(player) ? "checked" : ""}
        />
        ${player}
      </label>
    `).join("")}
  `;

  playersBWrap.innerHTML = `
    <label>Players from ${getTeamShort(teamB)} (select ${requiredPlayers})${result.plannedPlayersB && result.plannedPlayersB.length > 0 ? ' <span class="muted">- pre-filled</span>' : ""}</label>
    ${teamBPlayers.map(player => `
      <label class="player-checkbox">
        <input type="checkbox"
          class="player-select-b"
          value="${player}"
          ${selectedPlayersB.includes(player) ? "checked" : ""}
        />
        ${player}
      </label>
    `).join("")}
  `;

  // Add change listeners to enforce max selection
  document.querySelectorAll(".player-select-a").forEach(cb => {
    cb.addEventListener("change", () => enforcePlayerLimit("player-select-a", requiredPlayers));
  });
  document.querySelectorAll(".player-select-b").forEach(cb => {
    cb.addEventListener("change", () => enforcePlayerLimit("player-select-b", requiredPlayers));
  });
}

function enforcePlayerLimit(className, maxPlayers) {
  const checkboxes = document.querySelectorAll(`.${className}`);
  const checked = Array.from(checkboxes).filter(cb => cb.checked);

  if (checked.length > maxPlayers) {
    checked[0].checked = false;
  }
}

function closeModal() {
  document.getElementById("scoreModalBackdrop").classList.remove("open");
  state.currentMatchId = null;
}

function openPlanModal(matchId) {
  state.currentMatchId = matchId;
  const match = APP_DATA.matches.find(m => m.id === matchId);
  const result = getMatchResult(matchId);

  document.getElementById("planModalBackdrop").classList.add("open");
  document.getElementById("planModalTitle").textContent = `Set Players: ${match.matchType} • ${match.slot}`;
  document.getElementById("planModalMeta").textContent = `${match.stage} • ${match.court} • ${match.time}`;

  renderPlanPlayerSelection(match, result);
}

function renderPlanPlayerSelection(match, result) {
  const teamA = getEffectiveTeam(match, "A");
  const teamB = getEffectiveTeam(match, "B");
  const teamAPlayers = TEAM_LOOKUP[teamA]?.players || [];
  const teamBPlayers = TEAM_LOOKUP[teamB]?.players || [];

  const requiredPlayers = match.matchType === "Singles" ? 1 : 2;
  const plannedPlayersA = result.plannedPlayersA || [];
  const plannedPlayersB = result.plannedPlayersB || [];

  const planPlayersAWrap = document.getElementById("planPlayersAWrap");
  const planPlayersBWrap = document.getElementById("planPlayersBWrap");

  planPlayersAWrap.innerHTML = `
    <label><strong>${getTeamShort(teamA)}</strong> - Select ${requiredPlayers} player(s)</label>
    ${teamAPlayers.map(player => `
      <label class="player-checkbox">
        <input type="checkbox"
          class="plan-player-select-a"
          value="${player}"
          ${plannedPlayersA.includes(player) ? "checked" : ""}
        />
        ${player}
      </label>
    `).join("")}
  `;

  planPlayersBWrap.innerHTML = `
    <label><strong>${getTeamShort(teamB)}</strong> - Select ${requiredPlayers} player(s)</label>
    ${teamBPlayers.map(player => `
      <label class="player-checkbox">
        <input type="checkbox"
          class="plan-player-select-b"
          value="${player}"
          ${plannedPlayersB.includes(player) ? "checked" : ""}
        />
        ${player}
      </label>
    `).join("")}
  `;

  document.querySelectorAll(".plan-player-select-a").forEach(cb => {
    cb.addEventListener("change", () => enforcePlayerLimit("plan-player-select-a", requiredPlayers));
  });
  document.querySelectorAll(".plan-player-select-b").forEach(cb => {
    cb.addEventListener("change", () => enforcePlayerLimit("plan-player-select-b", requiredPlayers));
  });
}

function closePlanModal() {
  document.getElementById("planModalBackdrop").classList.remove("open");
  state.currentMatchId = null;
}

async function savePlannedPlayers() {
  const plannedPlayersA = Array.from(document.querySelectorAll(".plan-player-select-a:checked")).map(cb => cb.value);
  const plannedPlayersB = Array.from(document.querySelectorAll(".plan-player-select-b:checked")).map(cb => cb.value);

  const result = getMatchResult(state.currentMatchId);
  result.plannedPlayersA = plannedPlayersA;
  result.plannedPlayersB = plannedPlayersB;

  await persistResult(state.currentMatchId, result);
  closePlanModal();
  render();
}

function openSupabaseModal() {
  document.getElementById("supabaseModalBackdrop").classList.add("open");
  document.getElementById("supabaseUrlInput").value = CONFIG.supabaseUrl || "";
  document.getElementById("supabaseKeyInput").value = CONFIG.supabaseAnonKey || "";
  document.getElementById("currentSyncMode").textContent = CONFIG.useSupabase ? "Supabase Live" : "Local";
}

function closeSupabaseModal() {
  document.getElementById("supabaseModalBackdrop").classList.remove("open");
}

async function enableSupabase() {
  const url = document.getElementById("supabaseUrlInput").value.trim();
  const key = document.getElementById("supabaseKeyInput").value.trim();

  if (!url || !key) {
    alert("Please enter both Supabase URL and Anon Key");
    return;
  }

  CONFIG.useSupabase = true;
  CONFIG.supabaseUrl = url;
  CONFIG.supabaseAnonKey = key;
  saveSupabaseConfig();

  closeSupabaseModal();

  // Reinitialize Supabase connection
  await initSupabase();
  render();

  alert("Live Sync enabled! All devices will now see updates in real-time.");
}

function disableSupabase() {
  if (!confirm("Disable Live Sync and switch to Local mode?")) return;

  CONFIG.useSupabase = false;
  CONFIG.supabaseUrl = "";
  CONFIG.supabaseAnonKey = "";
  saveSupabaseConfig();

  closeSupabaseModal();

  // Unsubscribe from Supabase
  if (state.supabase) {
    state.supabase = null;
  }

  document.getElementById("syncChip").textContent = "Mode: Local";
  render();

  alert("Switched to Local mode. Changes will only be saved in this browser.");
}

function getModalResult() {
  const playersA = Array.from(document.querySelectorAll(".player-select-a:checked")).map(cb => cb.value);
  const playersB = Array.from(document.querySelectorAll(".player-select-b:checked")).map(cb => cb.value);

  return {
    matchId: state.currentMatchId,
    set1A: normalizeScore(document.getElementById("a1").value),
    set1B: normalizeScore(document.getElementById("b1").value),
    set2A: normalizeScore(document.getElementById("a2").value),
    set2B: normalizeScore(document.getElementById("b2").value),
    set3A: normalizeScore(document.getElementById("a3").value),
    set3B: normalizeScore(document.getElementById("b3").value),
    remarks: document.getElementById("remarks").value.trim(),
    status: document.getElementById("matchStatus").value,
    playersA,
    playersB
  };
}

function attachFieldListeners() {
  ["a1","b1","a2","b2","a3","b3","matchStatus"].forEach(id => {
    document.getElementById(id).oninput = previewWinner;
    document.getElementById(id).onchange = previewWinner;
  });
}

function previewWinner() {
  const match = APP_DATA.matches.find(m => m.id === state.currentMatchId);
  if (!match) return;
  const result = getModalResult();
  const winner = computeWinnerForResult(match, result);
  document.getElementById("winnerPreview").value = winner ? getTeamShort(winner) : "";
}

function saveLocal() {
  localStorage.setItem("badminton_tracker_results_v1", JSON.stringify(state.results));
}

function loadLocal() {
  try {
    state.results = JSON.parse(localStorage.getItem("badminton_tracker_results_v1") || "{}");
  } catch {
    state.results = {};
  }

  // Load Supabase config from localStorage
  try {
    const savedConfig = localStorage.getItem("badminton_tracker_supabase_config");
    if (savedConfig) {
      const config = JSON.parse(savedConfig);
      CONFIG.useSupabase = config.useSupabase || false;
      CONFIG.supabaseUrl = config.supabaseUrl || "";
      CONFIG.supabaseAnonKey = config.supabaseAnonKey || "";
    }
  } catch {
    // Ignore errors
  }
}

function saveSupabaseConfig() {
  const config = {
    useSupabase: CONFIG.useSupabase,
    supabaseUrl: CONFIG.supabaseUrl,
    supabaseAnonKey: CONFIG.supabaseAnonKey
  };
  localStorage.setItem("badminton_tracker_supabase_config", JSON.stringify(config));
}

async function initSupabase() {
  if (!CONFIG.useSupabase || !CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
    document.getElementById("syncChip").textContent = "Mode: Local";
    return;
  }
  state.supabase = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
  document.getElementById("syncChip").textContent = "Mode: Supabase Live";
  document.getElementById("saveHint").textContent = "Supabase Live mode is on. Updates sync across phones and laptops.";

  const { data, error } = await state.supabase.from(CONFIG.supabaseTable).select("*");
  if (!error && Array.isArray(data)) {
    data.forEach(row => {
      state.results[row.match_id] = {
        matchId: row.match_id,
        set1A: row.set1_a,
        set1B: row.set1_b,
        set2A: row.set2_a,
        set2B: row.set2_b,
        set3A: row.set3_a,
        set3B: row.set3_b,
        remarks: row.remarks || "",
        status: row.status || "upcoming",
        playersA: row.players_a || [],
        playersB: row.players_b || [],
        plannedPlayersA: row.planned_players_a || [],
        plannedPlayersB: row.planned_players_b || []
      };
    });
  }

  state.supabase
    .channel("live-scores")
    .on("postgres_changes", { event: "*", schema: "public", table: CONFIG.supabaseTable }, payload => {
      const row = payload.new || payload.old;
      if (!row) return;
      state.results[row.match_id] = {
        matchId: row.match_id,
        set1A: row.set1_a,
        set1B: row.set1_b,
        set2A: row.set2_a,
        set2B: row.set2_b,
        set3A: row.set3_a,
        set3B: row.set3_b,
        remarks: row.remarks || "",
        status: row.status || "upcoming",
        playersA: row.players_a || [],
        playersB: row.players_b || [],
        plannedPlayersA: row.planned_players_a || [],
        plannedPlayersB: row.planned_players_b || []
      };
      render();
    })
    .subscribe();
}

async function persistResult(matchId, result) {
  state.results[matchId] = result;
  saveLocal();

  if (state.supabase) {
    const payload = {
      match_id: matchId,
      set1_a: result.set1A,
      set1_b: result.set1B,
      set2_a: result.set2A,
      set2_b: result.set2B,
      set3_a: result.set3A,
      set3_b: result.set3B,
      remarks: result.remarks,
      status: result.status,
      players_a: result.playersA || [],
      players_b: result.playersB || [],
      planned_players_a: result.plannedPlayersA || [],
      planned_players_b: result.plannedPlayersB || []
    };
    const { error } = await state.supabase.from(CONFIG.supabaseTable).upsert(payload);
    if (error) alert("Supabase save failed: " + error.message);
  }
}

function render() {
  renderStandingTabs();
  renderStandings();

  renderMatchTabs();
  renderTeamFilter();
  renderSlotFilter();
  renderMatches();

  renderFinals();
  renderPlayerStats();
  renderParticipationTabs();
  renderParticipation();
  renderTeams();

  renderScheduleTeamFilter();
  renderScheduleSlotFilter();
  renderSchedule();

  updateKpis();
}

async function handleSave() {
  const result = getModalResult();
  await persistResult(state.currentMatchId, result);
  closeModal();
  render();
}

async function handleMarkLive() {
  const result = getModalResult();
  result.status = "live";
  await persistResult(state.currentMatchId, result);
  previewWinner();
  render();
}

async function handleReset() {
  if (!confirm("Reset this match result?")) return;
  const reset = {
    matchId: state.currentMatchId,
    set1A: null, set1B: null,
    set2A: null, set2B: null,
    set3A: null, set3B: null,
    remarks: "",
    status: "upcoming"
  };
  await persistResult(state.currentMatchId, reset);
  closeModal();
  render();
}

function exportJson() {
  const blob = new Blob([JSON.stringify({ data: APP_DATA, results: state.results }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "badminton-tournament-results.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed.results && typeof parsed.results === "object") {
        state.results = parsed.results;
        saveLocal();
        render();
        if (state.supabase) {
          for (const [matchId, result] of Object.entries(state.results)) {
            await persistResult(matchId, result);
          }
        }
      }
    } catch (err) {
      alert("Invalid JSON file");
    }
  };
  reader.readAsText(file);
}

function bindEvents() {
  document.getElementById("closeModalBtn").onclick = closeModal;
  document.getElementById("saveScoreBtn").onclick = handleSave;
  document.getElementById("markLiveBtn").onclick = handleMarkLive;
  document.getElementById("resetScoreBtn").onclick = handleReset;

  document.getElementById("closePlanModalBtn").onclick = closePlanModal;
  document.getElementById("savePlannedPlayersBtn").onclick = savePlannedPlayers;
  document.getElementById("clearPlannedPlayersBtn").onclick = async () => {
    if (!confirm("Clear all planned players for this match?")) return;
    const result = getMatchResult(state.currentMatchId);
    result.plannedPlayersA = [];
    result.plannedPlayersB = [];
    await persistResult(state.currentMatchId, result);
    closePlanModal();
    render();
  };

  document.getElementById("toggleAdminBtn").onclick = () => {
    if (state.isAdmin) {
      state.isAdmin = false;
      render();
      return;
    }
    const pin = prompt("Enter admin PIN");
    if (pin === CONFIG.adminPin) {
      state.isAdmin = true;
      render();
    }
  };
  document.getElementById("exportBtn").onclick = exportJson;
  document.getElementById("importInput").onchange = e => {
    const file = e.target.files?.[0];
    if (file) importJson(file);
    e.target.value = "";
  };

  document.getElementById("setupSupabaseBtn").onclick = openSupabaseModal;
  document.getElementById("closeSupabaseModalBtn").onclick = closeSupabaseModal;
  document.getElementById("saveSupabaseBtn").onclick = enableSupabase;
  document.getElementById("disableSupabaseBtn").onclick = disableSupabase;

  document.getElementById("scoreModalBackdrop").addEventListener("click", e => {
    if (e.target.id === "scoreModalBackdrop") closeModal();
  });
  document.getElementById("planModalBackdrop").addEventListener("click", e => {
    if (e.target.id === "planModalBackdrop") closePlanModal();
  });
  document.getElementById("supabaseModalBackdrop").addEventListener("click", e => {
    if (e.target.id === "supabaseModalBackdrop") closeSupabaseModal();
  });
}

async function init() {
  await loadTournamentData();
  if (!APP_DATA) {
    console.error('Failed to load tournament data, cannot initialize app');
    return;
  }
  initializeConstants();
  loadLocal();
  bindEvents();
  await initSupabase();
  render();
}

init();
