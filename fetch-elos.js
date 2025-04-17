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

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function writeJson(file, data) {
  const fullPath = path.join(DATA_DIR, file);
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
  console.log(`✅ Datei geschrieben: ${file} (${data.length} Einträge)`);
}

function getHeaders() {
  return {
    Authorization: `Bearer ${FACEIT_API_KEY}`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    Accept: "application/json"
  };
}

const matchCache = {};
async function fetchMatchStats(matchId, playerId) {
  if (matchCache[matchId]) {
    return matchCache[matchId][playerId] || null;
  }
  const res  = await fetch(`https://open.faceit.com/data/v4/matches/${matchId}/stats`, { headers: getHeaders() });
  const json = await res.json();
  const players = json.rounds[0].teams.flatMap(t => t.players);
  const statsMap = Object.fromEntries(players.map(p => [p.player_id, p.player_stats]));
  matchCache[matchId] = statsMap;
  return statsMap[playerId] || null;
}

async function fetchRecentStats(playerId) {
  const res   = await fetch(
    `https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&limit=30`,
    { headers: getHeaders() }
  );
  const { items } = await res.json();

  let kills = 0, deaths = 0, assists = 0, adrTotal = 0, hs = 0, count = 0;
  for (const m of items) {
    const stats = await fetchMatchStats(m.match_id, playerId);
    if (!stats) continue;
    kills    += parseInt(stats.Kills     || 0, 10);
    deaths   += parseInt(stats.Deaths    || 0, 10);
    assists  += parseInt(stats.Assists   || 0, 10);
    adrTotal += parseFloat(stats.ADR     || 0);
    hs       += parseInt(stats.Headshots || 0, 10);
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

async function fetchTeammateStats(playerId) {
  // Ermittelt die letzten 30 Matches, zählt Mitspieler und Erfolge gemeinsam.
  const res = await fetch(
    `https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&limit=30`,
    { headers: getHeaders() }
  );
  const { items } = await res.json();
  const countMap = {};
  const winMap   = {};

  for (const m of items) {
    // 1) Match-Zusammenfassung holen
    const sumRes = await fetch(`https://open.faceit.com/data/v4/matches/${m.match_id}`, {
      headers: getHeaders()
    });
    const sumJson = await sumRes.json();

    // 2) Scores vergleichen
    const score1 = sumJson.results["1"] || 0;
    const score2 = sumJson.results["2"] || 0;
    const winner = score1 > score2 ? "1" : score2 > score1 ? "2" : null;

    // 3) Finden, in welchem Side unser Spieler war
    for (const side of Object.keys(sumJson.teams)) {
      const team = sumJson.teams[side];
      if (team.players.some(p => p.player_id === playerId)) {
        // 4) alle Mitspieler zählen
        for (const p of team.players) {
          if (p.player_id === playerId) continue;
          countMap[p.player_id] = (countMap[p.player_id] || 0) + 1;
          if (side === winner) {
            winMap[p.player_id] = (winMap[p.player_id] || 0) + 1;
          }
        }
        break;
      }
    }
  }

  // 5) Array erzeugen und sortieren
  const arr = Object.keys(countMap).map(id => ({
    playerId: id,
    count:    countMap[id],
    wins:     winMap[id] || 0,
    winrate:  Math.round(((winMap[id] || 0) / countMap[id]) * 100) + "%"
  }));
  arr.sort((a, b) => b.count - a.count);
  return arr;
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

  const recentStats   = await fetchRecentStats(playerId);
  const teammateStats = await fetchTeammateStats(playerId);
  let partnerId       = null;
  let partnerWinrate  = "—";
  if (teammateStats.length > 0) {
    partnerId      = teammateStats[0].playerId;
    partnerWinrate = teammateStats[0].winrate;
  }

  let partnerNickname = "";
  let partnerUrl      = "";
  if (partnerId) {
    const pRes = await fetch(
      `https://open.faceit.com/data/v4/players/${partnerId}`,
      { headers }
    );
    const pJson = await pRes.json();
    partnerNickname = pJson.nickname;
    partnerUrl      = pJson.faceit_url.replace("{lang}", "de");
  }

  return {
    playerId,
    nickname,
    elo,
    lastMatch,
    faceitUrl:    url,
    level,
    winrate:      life["Win Rate %"] || "—",
    matches:      life["Matches"]    || "—",
    recentStats,
    partnerNickname,
    partnerUrl,
    partnerWinrate
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
    const { playerId, nickname, elo, level, winrate, matches, lastMatch, faceitUrl, recentStats, partnerNickname, partnerUrl, partnerWinrate } = p;
    const tooltip = `<div class="tooltip">
      <a href="${faceitUrl}" target="_blank" class="nickname-link">${nickname}</a>
      <div class="tooltip-content">
        Letzten 30 Matches:<br/>
        Kills ${recentStats.kills} / Assists ${recentStats.assists} / Deaths ${recentStats.deaths}<br/>
        K/D ${recentStats.kd} – ADR ${recentStats.adr} – HS% ${recentStats.hsPercent}
      </div>
    </div>`;

    return `
      <tr data-player-id="${playerId}" data-elo="${elo}">
        <td class="p-2">${tooltip}</td>
        <td class="p-2 elo-now">${elo}</td>
        <td class="p-2 elo-diff">-</td>
        <td class="p-2">
          ${partnerNickname
            ? `<a href="${partnerUrl}" target="_blank" class="nickname-link">${partnerNickname}</a>`
            : "—"}
        </td>
        <td class="p-2">${partnerWinrate}</td>
        <td class="p-2"><img src="icons/levels/level_${level}_icon.png" alt="Level ${level}" width="24" height="24" title="Level ${level}"></td>
        <td class="p-2">${winrate}</td>
        <td class="p-2">${matches}</td>
        <td class="p-2">${lastMatch}</td>
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
