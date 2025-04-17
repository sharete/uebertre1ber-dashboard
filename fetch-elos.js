const fs = require("fs");
const path = require("path");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const { DateTime } = require("luxon");

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const PLAYERS_FILE   = "players.txt";
const TEMPLATE_FILE  = "index.template.html";
const OUTPUT_FILE    = "index.html";
const DATA_DIR       = path.join(__dirname, "data");

const RANGE_FILES = {
  daily:   "elo-daily.json",
  weekly:  "elo-weekly.json",
  monthly: "elo-monthly.json",
  yearly:  "elo-yearly.json",
  latest:  "elo-latest.json"
};

// Data‑Verzeichnis anlegen
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function writeJson(file, data) {
  const fullPath = path.join(DATA_DIR, file);
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
  console.log(`✅ Datei geschrieben: ${file} (${data.length} Einträge)`);
}

const matchCache = {};
function getHeaders() {
  return {
    Authorization: `Bearer ${FACEIT_API_KEY}`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    Accept: "application/json"
  };
}

async function fetchMatchStats(matchId, playerId) {
  if (matchCache[matchId]) return matchCache[matchId][playerId] || null;
  const res  = await fetch(`https://open.faceit.com/data/v4/matches/${matchId}/stats`, { headers: getHeaders() });
  const json = await res.json();
  const players = json.rounds[0].teams.flatMap(t => t.players);
  const statsMap = Object.fromEntries(players.map(p => [p.player_id, p.player_stats]));
  matchCache[matchId] = statsMap;
  return statsMap[playerId] || null;
}

async function fetchRecentStats(playerId) {
  const res   = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&limit=30`, { headers: getHeaders() });
  const { items } = await res.json();

  let kills = 0, deaths = 0, assists = 0, adrTotal = 0, hs = 0, count = 0;
  for (const m of items) {
    const s = await fetchMatchStats(m.match_id, playerId);
    if (!s) continue;
    kills    += parseInt(s.Kills     || 0, 10);
    deaths   += parseInt(s.Deaths    || 0, 10);
    assists  += parseInt(s.Assists   || 0, 10);
    adrTotal += parseFloat(s.ADR     || 0);
    hs       += parseInt(s.Headshots || 0, 10);
    count++;
  }

  return {
    kills,
    assists,
    deaths,
    kd:        count && deaths ? (kills / deaths).toFixed(2) : "0.00",
    adr:       count ? (adrTotal / count).toFixed(1) : "0.0",
    hsPercent: kills ? Math.round((hs / kills) * 100) + "%" : "0%"
  };
}

async function fetchPlayerData(playerId) {
  const headers = getHeaders();
  const [pr, hr, sr] = await Promise.all([
    fetch(`https://open.faceit.com/data/v4/players/${playerId}`, { headers }),
    fetch(`https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&limit=1`, { headers }),
    fetch(`https://open.faceit.com/data/v4/players/${playerId}/stats/cs2`, { headers })
  ]);

  const profile = await pr.json();
  const history = await hr.json();
  const stats   = await sr.json();

  const elo      = profile.games?.cs2?.faceit_elo || null;
  const nickname = profile.nickname;
  const url      = profile.faceit_url.replace("{lang}", "de");
  const level    = profile.games?.cs2?.skill_level || null;
  const life     = stats.lifetime || {};

  const lastTs = history.items?.[0]?.finished_at;
  const lastMatch = lastTs
    ? DateTime.fromSeconds(lastTs).setZone("Europe/Berlin").toFormat("yyyy-MM-dd HH:mm")
    : "—";

  const recentStats = await fetchRecentStats(playerId);

  return {
    playerId,
    nickname,
    elo,
    lastMatch,
    faceitUrl: url,
    level,
    winrate: life["Win Rate %"] || "—",
    matches: life["Matches"]    || "—",
    recentStats
  };
}

function getPeriodStart(range) {
  const now = DateTime.now().setZone("Europe/Berlin");
  switch (range) {
    case "daily":   return now.startOf("day");
    case "weekly":  return now.startOf("week");
    case "monthly": return now.startOf("month");
    case "yearly":  return now.startOf("year");
    default:        return now;
  }
}

(async () => {
  if (!FACEIT_API_KEY) {
    console.error("❌ FACEIT_API_KEY fehlt!");
    process.exit(1);
  }

  const lines = fs.readFileSync(PLAYERS_FILE, "utf-8").trim().split("\n");
  const results = [];

  for (const l of lines) {
    const playerId = l.split(/#|\/\//)[0].trim();
    try {
      const data = await fetchPlayerData(playerId);
      if (data.elo) results.push(data);
    } catch (e) {
      console.error(`❌ Fehler bei ${playerId}: ${e.message}`);
    }
  }

  results.sort((a, b) => b.elo - a.elo);

  // Latest Snapshot
  const latestSnapshot = results.map(r => ({ playerId: r.playerId, elo: r.elo }));
  writeJson(RANGE_FILES.latest, latestSnapshot);

  // HTML generieren
  const updatedTime = DateTime.now().setZone("Europe/Berlin").toFormat("yyyy-MM-dd HH:mm");
  const rows = results.map(p => {
    const tip = `<div class="tooltip">
      <a href="${p.faceitUrl}" target="_blank" class="nickname-link">${p.nickname}</a>
      <div class="tooltip-content">
        Letzten 30 Matches:<br/>
        Kills ${p.recentStats.kills} / Assists ${p.recentStats.assists} / Deaths ${p.recentStats.deaths}<br/>
        K/D ${p.recentStats.kd} – ADR ${p.recentStats.adr} – HS% ${p.recentStats.hsPercent}
      </div>
    </div>`;
    return `
      <tr data-player-id="${p.playerId}" data-elo="${p.elo}">
        <td class="p-2">${tip}</td>
        <td class="p-2 elo-now">${p.elo}</td>
        <td class="p-2 elo-diff">-</td>
        <td class="p-2"><img src="icons/levels/level_${p.level}_icon.png" alt="Level ${p.level}" width="24" height="24" title="Level ${p.level}"></td>
        <td class="p-2">${p.winrate}</td>
        <td class="p-2">${p.matches}</td>
        <td class="p-2">${p.lastMatch}</td>
      </tr>`;
  }).join("\n");

  const tpl = fs.readFileSync(TEMPLATE_FILE, "utf-8");
  const out = tpl
    .replace("<!-- INSERT_ELO_TABLE_HERE -->", rows)
    .replace("<!-- INSERT_LAST_UPDATED -->", updatedTime);
  fs.writeFileSync(OUTPUT_FILE, out);
  console.log(`✅ Dashboard aktualisiert: ${OUTPUT_FILE}`);

  // Periodische Snapshots
  for (const range of ["daily", "weekly", "monthly", "yearly"]) {
    const metaPath = path.join(DATA_DIR, `elo-${range}-meta.json`);
    const start    = getPeriodStart(range);
    let update     = true;

    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        const last = DateTime.fromISO(meta.lastUpdated, { zone: "Europe/Berlin" });
        if (last >= start) update = false;
      } catch {}
    }

    if (update) {
      writeJson(RANGE_FILES[range], latestSnapshot);
      fs.writeFileSync(metaPath, JSON.stringify({ lastUpdated: start.toISODate() }, null, 2));
      console.log(`✅ ${RANGE_FILES[range]} wurde aktualisiert.`);
    }
  }
})();
