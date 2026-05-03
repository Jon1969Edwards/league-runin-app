const standingsInput = document.getElementById("standingsInput");
const fixturesInput = document.getElementById("fixturesInput");
const modeSelect = document.getElementById("modeSelect");
const simulationsInput = document.getElementById("simulationsInput");
const apiTokenInput = document.getElementById("apiTokenInput");
const seasonInput = document.getElementById("seasonInput");
const fetchLiveBtn = document.getElementById("fetchLiveBtn");
const calculateBtn = document.getElementById("calculateBtn");
const loadExampleBtn = document.getElementById("loadExampleBtn");
const resultsBody = document.querySelector("#resultsTable tbody");
const positionGrid = document.getElementById("positionGrid");
const errorBox = document.getElementById("errorBox");
const infoBox = document.getElementById("infoBox");
const MAX_EXACT_FIXTURES = 14;
const DEFAULT_MONTE_CARLO_SIMULATIONS = 20000;
const API_BASE_URL = "https://api.football-data.org/v4";
const PREMIER_LEAGUE_CODE = "PL";
const API_TOKEN_STORAGE_KEY = "footballDataApiToken";

const EXAMPLE_STANDINGS = `Arsenal,67,30,62
Manchester City,64,25,68
Nottingham Forest,57,12,49
Newcastle United,56,14,58
Chelsea,54,17,53
Aston Villa,54,-2,48
Brighton,51,4,47
Bournemouth,50,12,55
Fulham,48,5,43
Everton,41,-4,39
Brentford,41,0,51
Crystal Palace,40,-4,37
Manchester United,37,-3,39
Tottenham,37,12,58
West Ham,35,-18,39
Wolves,32,-18,40
Ipswich,21,-34,28
Leicester,17,-41,25
Southampton,10,-49,22`;

const EXAMPLE_FIXTURES = `Arsenal,Manchester City
Arsenal,Newcastle United
Chelsea,Arsenal
Manchester City,Brighton
Manchester City,Fulham
Manchester United,Manchester City
Nottingham Forest,Chelsea
Nottingham Forest,Fulham
Aston Villa,Nottingham Forest
Newcastle United,Bournemouth
Newcastle United,Everton
Tottenham,Newcastle United
Chelsea,Brighton
Chelsea,Leicester
Aston Villa,Chelsea
Brighton,Fulham
Brighton,West Ham
Bournemouth,Brentford
Bournemouth,Crystal Palace
Fulham,Brentford
Everton,Manchester United
Wolves,Everton
Brentford,Manchester United
Crystal Palace,Tottenham
Crystal Palace,Wolves
Manchester United,West Ham
Tottenham,Southampton
Tottenham,Aston Villa
West Ham,Leicester
Wolves,Leicester
Ipswich,Leicester
Southampton,Leicester`;

function getDefaultSeasonStartYear() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  return month >= 6 ? year : year - 1;
}

function normalizeApiTeamName(team) {
  if (!team) return "";
  return team.shortName || team.name || "";
}

function standingsToCsv(standingsTable) {
  if (!Array.isArray(standingsTable) || standingsTable.length === 0) {
    throw new Error("Live data returned no standings rows.");
  }
  return standingsTable
    .map((row) => {
      const teamName = normalizeApiTeamName(row.team);
      const goalDifference = Number(row.goalDifference);
      const goalsFor = Number(row.goalsFor);
      const points = Number(row.points);
      if (!teamName || !Number.isFinite(points) || !Number.isFinite(goalDifference) || !Number.isFinite(goalsFor)) {
        throw new Error("Live standings payload is missing required fields.");
      }
      return `${teamName},${points},${goalDifference},${goalsFor}`;
    })
    .join("\n");
}

function fixturesToCsv(matches, teamNameById) {
  if (!Array.isArray(matches)) {
    throw new Error("Live fixtures payload is invalid.");
  }

  const lines = [];
  for (const match of matches) {
    const homeId = match?.homeTeam?.id;
    const awayId = match?.awayTeam?.id;
    const home = teamNameById.get(homeId);
    const away = teamNameById.get(awayId);
    if (!home || !away || home === away) continue;
    lines.push(`${home},${away}`);
  }
  return lines.join("\n");
}

async function fetchJson(url, apiToken) {
  const response = await fetch(url, {
    headers: {
      "X-Auth-Token": apiToken
    }
  });

  if (!response.ok) {
    let details = "";
    try {
      const payload = await response.json();
      if (payload && payload.message) details = ` ${payload.message}`;
    } catch {
      // Ignore non-JSON error response.
    }
    throw new Error(`API request failed (${response.status}).${details}`);
  }

  return response.json();
}

async function fetchPremierLeagueData() {
  clearError();
  clearInfo();

  const apiToken = apiTokenInput.value.trim();
  const season = Number(seasonInput.value);
  if (!apiToken) {
    throw new Error("Please enter your football-data.org API token first.");
  }
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    throw new Error("Season must be a year between 2000 and 2100.");
  }

  localStorage.setItem(API_TOKEN_STORAGE_KEY, apiToken);
  fetchLiveBtn.disabled = true;
  const originalLabel = fetchLiveBtn.textContent;
  fetchLiveBtn.textContent = "Fetching...";

  try {
    const standingsUrl = `${API_BASE_URL}/competitions/${PREMIER_LEAGUE_CODE}/standings?season=${season}`;
    const matchesUrl = `${API_BASE_URL}/competitions/${PREMIER_LEAGUE_CODE}/matches?season=${season}&status=SCHEDULED`;

    const standingsPayload = await fetchJson(standingsUrl, apiToken);
    const matchesPayload = await fetchJson(matchesUrl, apiToken);

    const totalStandings = standingsPayload?.standings?.find((entry) => entry.type === "TOTAL");
    if (!totalStandings || !Array.isArray(totalStandings.table)) {
      throw new Error("Could not find TOTAL standings in API response.");
    }

    const teamNameById = new Map(
      totalStandings.table.map((row) => [row.team.id, normalizeApiTeamName(row.team)])
    );

    standingsInput.value = standingsToCsv(totalStandings.table);
    fixturesInput.value = fixturesToCsv(matchesPayload?.matches || [], teamNameById);

    runCalculation();
    showInfo(
      `Loaded live EPL data for ${season}/${String(season + 1).slice(-2)}. ` +
        `Fixtures imported: ${(matchesPayload?.matches || []).length}.`
    );
  } finally {
    fetchLiveBtn.disabled = false;
    fetchLiveBtn.textContent = originalLabel;
  }
}

function parseCsv(text, expectedColumns, label) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, idx) => {
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length !== expectedColumns) {
      throw new Error(`${label}: line ${idx + 1} should have ${expectedColumns} columns.`);
    }
    return cells;
  });
}

function parseStandings(text) {
  const rows = parseCsv(text, 4, "Standings");
  const teams = rows.map((row, idx) => {
    const [name, pointsText, gdText, gfText] = row;
    const points = Number(pointsText);
    const goalDifference = Number(gdText);
    const goalsFor = Number(gfText);

    if (!name) throw new Error(`Standings: line ${idx + 1} has empty team name.`);
    if (!Number.isFinite(points) || !Number.isFinite(goalDifference) || !Number.isFinite(goalsFor)) {
      throw new Error(`Standings: line ${idx + 1} has invalid number.`);
    }

    return { name, points, goalDifference, goalsFor };
  });

  const uniqueNames = new Set(teams.map((team) => team.name.toLowerCase()));
  if (uniqueNames.size !== teams.length) {
    throw new Error("Standings has duplicate team names.");
  }

  return teams;
}

function parseFixtures(text, knownTeams) {
  const rows = parseCsv(text, 2, "Fixtures");
  const names = new Set(knownTeams.map((team) => team.name.toLowerCase()));

  return rows.map((row, idx) => {
    const [home, away] = row;
    if (!home || !away) throw new Error(`Fixtures: line ${idx + 1} has missing team.`);
    if (home.toLowerCase() === away.toLowerCase()) {
      throw new Error(`Fixtures: line ${idx + 1} has same home and away team.`);
    }
    const missingTeams = [home, away].filter((teamName) => !names.has(teamName.toLowerCase()));
    if (missingTeams.length > 0) {
      throw new Error(
        `Fixtures: line ${idx + 1} contains team(s) not in standings: ${missingTeams.join(", ")}.`
      );
    }
    return { home, away };
  });
}

function calculateRanges(teams, fixtures) {
  const remainingByTeam = Object.fromEntries(teams.map((team) => [team.name, 0]));
  for (const match of fixtures) {
    remainingByTeam[match.home] += 1;
    remainingByTeam[match.away] += 1;
  }

  const enriched = teams.map((team) => {
    const matchesLeft = remainingByTeam[team.name] || 0;
    const maxPoints = team.points + matchesLeft * 3;
    const minPoints = team.points;
    return { ...team, matchesLeft, maxPoints, minPoints };
  });

  const currentSorted = [...enriched].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.name.localeCompare(b.name);
  });

  const currentPosition = new Map();
  currentSorted.forEach((team, idx) => currentPosition.set(team.name, idx + 1));

  return enriched
    .map((team) => {
      const guaranteedAboveAtBest = enriched.filter(
        (other) => other.name !== team.name && other.minPoints > team.maxPoints
      ).length;
      const guaranteedBelowAtWorst = enriched.filter(
        (other) => other.name !== team.name && other.maxPoints < team.minPoints
      ).length;

      return {
        ...team,
        current: currentPosition.get(team.name),
        highestPossible: guaranteedAboveAtBest + 1,
        lowestPossible: enriched.length - guaranteedBelowAtWorst
      };
    })
    .sort((a, b) => a.current - b.current);
}

function rankTeams(teams, pointsByTeam) {
  return [...teams].sort((a, b) => {
    const pointsDiff = pointsByTeam[b.name] - pointsByTeam[a.name];
    if (pointsDiff !== 0) return pointsDiff;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.name.localeCompare(b.name);
  });
}

function collectPositionBoundsFromPoints(teams, pointsByTeam) {
  const byPoints = new Map();
  for (const team of teams) {
    const points = pointsByTeam[team.name];
    const group = byPoints.get(points);
    if (group) {
      group.push(team.name);
    } else {
      byPoints.set(points, [team.name]);
    }
  }

  const sortedPointTotals = [...byPoints.keys()].sort((a, b) => b - a);
  const bounds = {};
  let startPos = 1;
  for (const points of sortedPointTotals) {
    const names = byPoints.get(points);
    const endPos = startPos + names.length - 1;
    for (const name of names) {
      bounds[name] = { best: startPos, worst: endPos };
    }
    startPos = endPos + 1;
  }
  return bounds;
}

function calculateExactFixtureAware(teams, fixtures) {
  if (fixtures.length > MAX_EXACT_FIXTURES) {
    throw new Error(
      `Exact mode is limited to ${MAX_EXACT_FIXTURES} fixtures (received ${fixtures.length}). ` +
      "Use fast range mode, or run exact mode on a smaller fixture subset."
    );
  }

  const remainingByTeam = Object.fromEntries(teams.map((team) => [team.name, 0]));
  for (const match of fixtures) {
    remainingByTeam[match.home] += 1;
    remainingByTeam[match.away] += 1;
  }

  const basePoints = Object.fromEntries(teams.map((team) => [team.name, team.points]));
  const currentSorted = rankTeams(teams, basePoints);
  const currentPosition = new Map();
  currentSorted.forEach((team, idx) => currentPosition.set(team.name, idx + 1));

  const best = Object.fromEntries(teams.map((team) => [team.name, Number.POSITIVE_INFINITY]));
  const worst = Object.fromEntries(teams.map((team) => [team.name, Number.NEGATIVE_INFINITY]));
  const pointsByTeam = { ...basePoints };

  let scenarioCount = 0;
  function dfs(matchIndex) {
    if (matchIndex === fixtures.length) {
      scenarioCount += 1;
      const bounds = collectPositionBoundsFromPoints(teams, pointsByTeam);
      for (const team of teams) {
        const teamBounds = bounds[team.name];
        if (teamBounds.best < best[team.name]) best[team.name] = teamBounds.best;
        if (teamBounds.worst > worst[team.name]) worst[team.name] = teamBounds.worst;
      }
      return;
    }

    const match = fixtures[matchIndex];

    pointsByTeam[match.home] += 3;
    dfs(matchIndex + 1);
    pointsByTeam[match.home] -= 3;

    pointsByTeam[match.home] += 1;
    pointsByTeam[match.away] += 1;
    dfs(matchIndex + 1);
    pointsByTeam[match.home] -= 1;
    pointsByTeam[match.away] -= 1;

    pointsByTeam[match.away] += 3;
    dfs(matchIndex + 1);
    pointsByTeam[match.away] -= 3;
  }

  dfs(0);

  const rows = teams
    .map((team) => {
      const matchesLeft = remainingByTeam[team.name] || 0;
      return {
        ...team,
        current: currentPosition.get(team.name),
        matchesLeft,
        maxPoints: team.points + matchesLeft * 3,
        highestPossible: best[team.name],
        lowestPossible: worst[team.name]
      };
    })
    .sort((a, b) => a.current - b.current);

  return { rows, scenarioCount };
}

function parseSimulationCount(valueText) {
  const value = Number(valueText);
  if (!Number.isInteger(value) || value < 100 || value > 200000) {
    throw new Error("Monte Carlo simulations must be an integer between 100 and 200000.");
  }
  return value;
}

function sampleMatchOutcome() {
  const roll = Math.random();
  if (roll < 0.45) return "home";
  if (roll < 0.72) return "draw";
  return "away";
}

function calculateMonteCarloFixtureAware(teams, fixtures, simulationCount) {
  const remainingByTeam = Object.fromEntries(teams.map((team) => [team.name, 0]));
  for (const match of fixtures) {
    remainingByTeam[match.home] += 1;
    remainingByTeam[match.away] += 1;
  }

  const basePoints = Object.fromEntries(teams.map((team) => [team.name, team.points]));
  const currentSorted = rankTeams(teams, basePoints);
  const currentPosition = new Map();
  currentSorted.forEach((team, idx) => currentPosition.set(team.name, idx + 1));

  const best = Object.fromEntries(teams.map((team) => [team.name, Number.POSITIVE_INFINITY]));
  const worst = Object.fromEntries(teams.map((team) => [team.name, Number.NEGATIVE_INFINITY]));
  const pointsByTeam = Object.fromEntries(teams.map((team) => [team.name, team.points]));

  for (let sim = 0; sim < simulationCount; sim += 1) {
    for (const team of teams) {
      pointsByTeam[team.name] = basePoints[team.name];
    }

    for (const match of fixtures) {
      const outcome = sampleMatchOutcome();
      if (outcome === "home") {
        pointsByTeam[match.home] += 3;
      } else if (outcome === "draw") {
        pointsByTeam[match.home] += 1;
        pointsByTeam[match.away] += 1;
      } else {
        pointsByTeam[match.away] += 3;
      }
    }

    const bounds = collectPositionBoundsFromPoints(teams, pointsByTeam);
    for (const team of teams) {
      const teamBounds = bounds[team.name];
      if (teamBounds.best < best[team.name]) best[team.name] = teamBounds.best;
      if (teamBounds.worst > worst[team.name]) worst[team.name] = teamBounds.worst;
    }
  }

  const rows = teams
    .map((team) => {
      const matchesLeft = remainingByTeam[team.name] || 0;
      return {
        ...team,
        current: currentPosition.get(team.name),
        matchesLeft,
        maxPoints: team.points + matchesLeft * 3,
        highestPossible: best[team.name],
        lowestPossible: worst[team.name]
      };
    })
    .sort((a, b) => a.current - b.current);

  return { rows, simulationCount };
}

function renderRows(rows) {
  resultsBody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.name}</td>
      <td>${row.current}</td>
      <td>${row.points}</td>
      <td>${row.matchesLeft}</td>
      <td>${row.maxPoints}</td>
      <td>${row.highestPossible}</td>
      <td>${row.lowestPossible}</td>
    `;
    resultsBody.appendChild(tr);
  }
}

function renderPositionGrid(rows) {
  if (!positionGrid) return;
  positionGrid.innerHTML = "";

  if (!rows.length) {
    positionGrid.textContent = "";
    return;
  }

  const teamCount = rows.length;
  const grid = document.createElement("div");
  grid.className = "grid-table";
  grid.style.gridTemplateColumns = `220px repeat(${teamCount}, minmax(28px, 1fr))`;

  const corner = document.createElement("div");
  corner.className = "grid-corner";
  corner.textContent = "Team";
  grid.appendChild(corner);

  for (let pos = 1; pos <= teamCount; pos += 1) {
    const headerCell = document.createElement("div");
    headerCell.className = "grid-col-header";
    headerCell.textContent = String(pos);
    grid.appendChild(headerCell);
  }

  for (const row of rows) {
    const teamCell = document.createElement("div");
    teamCell.className = "grid-team";
    teamCell.textContent = row.name;
    grid.appendChild(teamCell);

    for (let pos = 1; pos <= teamCount; pos += 1) {
      const cell = document.createElement("div");
      cell.className = "grid-cell";

      if (pos >= row.highestPossible && pos <= row.lowestPossible) {
        cell.classList.add("in-range");
      }
      if (pos === row.highestPossible) {
        cell.classList.add("highest-marker");
      }
      if (pos === row.current) {
        cell.classList.add("current-marker");
        cell.textContent = String(row.current);
      }
      if (pos === row.lowestPossible) {
        cell.classList.add("lowest-marker");
        if (pos !== row.current) {
          cell.textContent = String(row.lowestPossible);
        }
      }

      grid.appendChild(cell);
    }
  }

  positionGrid.appendChild(grid);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function showInfo(message) {
  infoBox.textContent = message;
  infoBox.classList.remove("hidden");
}

function clearInfo() {
  infoBox.textContent = "";
  infoBox.classList.add("hidden");
}

function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

function runCalculation() {
  clearError();
  clearInfo();
  try {
    const teams = parseStandings(standingsInput.value);
    const fixtures = parseFixtures(fixturesInput.value, teams);
    const mode = modeSelect.value;

    if (mode === "exact") {
      const result = calculateExactFixtureAware(teams, fixtures);
      renderRows(result.rows);
      renderPositionGrid(result.rows);
      showInfo(`Exact mode evaluated ${result.scenarioCount.toLocaleString()} outcome scenarios.`);
      return;
    }

    if (mode === "montecarlo") {
      const simulationCount = parseSimulationCount(simulationsInput.value);
      const result = calculateMonteCarloFixtureAware(teams, fixtures, simulationCount);
      renderRows(result.rows);
      renderPositionGrid(result.rows);
      showInfo(`Monte Carlo mode sampled ${result.simulationCount.toLocaleString()} outcome scenarios.`);
      return;
    }

    const rows = calculateRanges(teams, fixtures);
    renderRows(rows);
    renderPositionGrid(rows);
    showInfo("Fast range mode completed.");
  } catch (error) {
    showError(error.message || "Failed to calculate.");
    resultsBody.innerHTML = "";
    if (positionGrid) positionGrid.innerHTML = "";
  }
}

function loadExample() {
  standingsInput.value = EXAMPLE_STANDINGS;
  fixturesInput.value = EXAMPLE_FIXTURES;
  simulationsInput.value = String(DEFAULT_MONTE_CARLO_SIMULATIONS);
  runCalculation();
}

function initializeLiveDataControls() {
  const savedToken = localStorage.getItem(API_TOKEN_STORAGE_KEY);
  if (savedToken) {
    apiTokenInput.value = savedToken;
  }
  seasonInput.value = String(getDefaultSeasonStartYear());
}

calculateBtn.addEventListener("click", runCalculation);
loadExampleBtn.addEventListener("click", loadExample);
fetchLiveBtn.addEventListener("click", async () => {
  try {
    await fetchPremierLeagueData();
  } catch (error) {
    const base = error.message || "Failed to fetch live data.";
    const suffix = base.includes("token")
      ? " Use the API token field under Live Data above."
      : " Text areas and the table below were not updated.";
    showError(base + suffix);
  }
});

initializeLiveDataControls();
loadExample();
