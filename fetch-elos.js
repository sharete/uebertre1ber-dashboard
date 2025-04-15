const fs = require("fs");
const path = require("path");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const { DateTime } = require("luxon");

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const PLAYERS_FILE = "players.txt";
const TEMPLATE_FILE = "index.template.html";
const OUTPUT_FILE = "index.html";
const DATA_DIR = path.join(__dirname, "data");

const RANGE_FILES = {
  daily: "elo-daily.json",
  weekly: "elo-weekly.json",
  monthly: "elo-monthly.json",
  yearly: "elo-yearly.json",
  latest: "elo-latest.json"
};

const RANGE_DATES = {
  daily: DateTime.now().minus({ days: 1 }),
  weekly: DateTime.now().startOf("week"),
  monthly: DateTime.now().startOf("month"),
  yearly: DateTime.fromISO("2025-01-01")
};

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
  } catch {
    return [];
  }
}

function writeJson(file, data) {
  const fullPath = path.join(DATA_DIR, file);
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
  console.log(`✅ Datei geschrieben: ${file} (${data.length} Einträge)`);
}

async function fetchMatchStats(matchId, nickname, headers) {
  const matchRes = await fetch(`https://open.faceit.com/data/v4/matches/${matchId}/stats`, { headers });
  const matchData = await matchRes.json();
  const players = matchData.rounds[0].teams.flatMap(team => team.players);
  return players.find(p => p.nickname.toLowerCase() === nickname.toLowerCase())?.stats || null;
}

async function fetchRecentStats(playerId, nickname, headers) {
  const matchRes = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&limit=30`, { headers });
  const matchJson = await matchRes.json();
  const matchIds = matchJson.items.map(m => m.match_id);

  let totalKills = 0, totalDeaths = 0, totalAssists = 0, totalAdr = 0, totalHs = 0, totalRounds = 0, matchCount = 0;

  for (const matchId of matchIds) {
    const stats = await fetchMatchStats(matchId, nickname, headers);
    if (!stats) continue;
    totalKills += parseInt(stats.Kills || 0);
    totalDeaths += parseInt(stats.Deaths || 0);
    totalAssists += parseInt(stats.Assists || 0);
    totalAdr += parseFloat(stats.ADR || 0);
    totalHs += parseInt(stats.Headshots || 0);
    totalRounds += parseInt(stats['Rounds'] || 0);
    matchCount++;
  }

  const kd = totalDeaths ? (totalKills / totalDeaths).toFixed(2) : "0.00";
  const kr = totalRounds ? (totalKills / totalRounds).toFixed(2) : "0.00";
  const adr = matchCount ? (totalAdr / matchCount).toFixed(1) : "0.0";
  const hsPercent = totalKills ? ((totalHs / totalKills) * 100).toFixed(0) + "%" : "0%";

  return {
    kad: `${totalKills} / ${totalAssists} / ${totalDeaths}`,
    kd,
    kr,
    adr,
    hsPercent
  };
}

async function fetchPlayerData(playerId) {
  const headers = { Authorization: `Bearer ${FACEIT_API_KEY}` };

  const profileRes = await fetch(`https://open.faceit.com/data/v4/players/${playerId}`, { headers });
  const profile = await profileRes.json();

  const matchRes = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&limit=1`, { headers });
  const matchJson = await matchRes.json();

  const statsRes = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/stats/cs2`, { headers });
  const statsJson = await statsRes.json();
  const lifetime = statsJson.lifetime || {};

  const elo = profile.games?.cs2?.faceit_elo ?? null;
  const nickname = profile.nickname;
  const faceitUrl = profile.faceit_url.replace("{lang}", "de");
  const level = profile.games?.cs2?.skill_level ?? null;

  const winrate = lifetime["Win Rate %"] ?? "—";
  const matches = lifetime["Matches"] ?? "—";

  const lastMatchTimestamp = matchJson.items?.[0]?.finished_at;
  const lastMatchFormatted = lastMatchTimestamp
    ? DateTime.fromSeconds(lastMatchTimestamp).setZone("Europe/Berlin").toFormat("yyyy-MM-dd HH:mm")
    : "—";

  const recentStats = await fetchRecentStats(playerId, nickname, headers);

  return { nickname, elo, lastMatch: lastMatchFormatted, faceitUrl, level, winrate, matches, recentStats };
}

(async () => {
  if (!FACEIT_API_KEY) {
    console.error("❌ FACEIT_API_KEY fehlt!");
    process.exit(1);
  }

  const lines = fs.readFileSync(PLAYERS_FILE, "utf-8").trim().split("\n");
  const results = [];

  for (const line of lines) {
    const [playerId, , nickname] = line.split(/#|\/\//).map((x) => x.trim());
    try {
      const data = await fetchPlayerData(playerId);
      if (data.elo) results.push(data);
    } catch (e) {
      console.error(`❌ Fehler bei ${nickname || playerId}: ${e.message}`);
    }
  }

  if (results.length === 0) {
    console.warn("⚠️ Keine Spieler wurden gefunden oder geladen.");
  }

  results.sort((a, b) => b.elo - a.elo);
  const updatedTime = DateTime.now().setZone("Europe/Berlin").toFormat("yyyy-MM-dd HH:mm");

  const latestSnapshot = results.map(({ nickname, elo }) => ({ nickname, elo }));
  writeJson(RANGE_FILES.latest, latestSnapshot);

  const tableBody = results
    .map(({ nickname, elo, level, winrate, matches, lastMatch, faceitUrl, recentStats }) => {
      const statsLine = recentStats
        ? `<div class="text-xs text-white/70 leading-tight mt-1">${recentStats.kad} – K/D ${recentStats.kd} – K/R ${recentStats.kr} – ADR ${recentStats.adr} – HS% ${recentStats.hsPercent}</div>`
        : "";

      return `
        <tr data-nickname="${nickname}" data-elo="${elo}">
          <td class="p-2">
            <a href="${faceitUrl}" target="_blank" class="nickname-link">${nickname}</a>
            ${statsLine}
          </td>
          <td class="p-2 elo-now">${elo}</td>
          <td class="p-2 elo-diff">-</td>
          <td class="p-2"><img src="icons/levels/level_${level}_icon.png" alt="Level ${level}" width="24" height="24" title="Level ${level}"></td>
          <td class="p-2">${winrate}</td>
          <td class="p-2">${matches}</td>
          <td class="p-2">${lastMatch}</td>
        </tr>`;
    })
    .join("\n");

  const templateHtml = fs.readFileSync(TEMPLATE_FILE, "utf-8");
  const updatedHtml = templateHtml
    .replace("<!-- INSERT_ELO_TABLE_HERE -->", tableBody)
    .replace("<!-- INSERT_LAST_UPDATED -->", updatedTime);

  fs.writeFileSync(OUTPUT_FILE, updatedHtml);
  console.log(`✅ Dashboard aktualisiert: ${OUTPUT_FILE}`);

  const now = DateTime.now();

  for (const range of ["daily", "weekly", "monthly", "yearly"]) {
    const filePath = path.join(DATA_DIR, RANGE_FILES[range]);
    if (!fs.existsSync(filePath)) {
      writeJson(RANGE_FILES[range], latestSnapshot);
      fs.writeFileSync(path.join(DATA_DIR, `elo-${range}-meta.json`), JSON.stringify({ lastUpdated: now.toISODate() }, null, 2));
      console.log(`✅ ${RANGE_FILES[range]} wurde einmalig erstellt.`);
    } else {
      console.log(`ℹ️ ${RANGE_FILES[range]} existiert bereits und wird nicht überschrieben.`);
    }
  }

  console.log("📊 Anzahl Spieler:", results.length);
  console.log("📂 Arbeitsverzeichnis:", __dirname);
  console.log("📝 Ziel-Datei:", path.join(DATA_DIR, RANGE_FILES.latest));
})();