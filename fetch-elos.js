// generate_dashboard.js – FINAL VERSION mit BestMates und korrektem K/R

const fs = require("fs");
const path = require("path");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const { DateTime } = require("luxon");
const pLimit = (...args) => import("p-limit").then(mod => mod.default(...args));

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const PLAYERS_FILE = "players.txt";
const TEMPLATE_FILE = "index.template.html";
const OUTPUT_FILE = "index.html";
const DATA_DIR = path.join(__dirname, "data");
const API_BASE = "https://open.faceit.com/data/v4";
const RANGE_FILES = {
  daily: "elo-daily.json",
  weekly: "elo-weekly.json",
  monthly: "elo-monthly.json",
  yearly: "elo-yearly.json",
  latest: "elo-latest.json",
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function writeJson(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
  console.log(`✅ Datei geschrieben: ${file} (${data.length} Einträge)`);
}

function getHeaders() {
  return {
    Authorization: `Bearer ${FACEIT_API_KEY}`,
    "User-Agent": "Mozilla/5.0",
    Accept: "application/json",
    Referer: "https://www.faceit.com/",
    Origin: "https://www.faceit.com",
  };
}

async function retryFetch(url, options = {}, retries = 3, delay = 1000) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, options);
    if (res.ok) return res;
    await new Promise(r => setTimeout(r, delay));
  }
  return null;
}

async function safeJson(res) {
  try {
    const txt = await res.text();
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function fetchMatchStats(matchId, playerId) {
  if (!fetchMatchStats.cache) fetchMatchStats.cache = {};
  const cache = fetchMatchStats.cache;
  if (cache[matchId]) return cache[matchId][playerId] || null;

  const res = await retryFetch(`${API_BASE}/matches/${matchId}/stats`, { headers: getHeaders() });
  if (!res) return null;
  const data = await safeJson(res);
  if (!data?.rounds) return null;
  const players = data.rounds[0].teams.flatMap(t => t.players);
  const mapStats = Object.fromEntries(players.map(p => [p.player_id, p.player_stats]));
  const score = data.rounds[0].round_stats["Score"] || "0 / 0";
  const [a, b] = score.split(" / ").map(Number);
  const roundCount = a + b;

  for (const p of players) {
    if (mapStats[p.player_id]) {
      mapStats[p.player_id].__rounds = roundCount;
    }
  }

  cache[matchId] = mapStats;
  return mapStats[playerId] || null;
}

async function fetchRecentStats(playerId) {
  const res = await retryFetch(`${API_BASE}/players/${playerId}/history?game=cs2&limit=30`, { headers: getHeaders() });
  const hist = await safeJson(res) || { items: [] };
  const statsArr = await Promise.all(
    hist.items.map(m => fetchMatchStats(m.match_id, playerId).catch(() => null))
  );

  let kills = 0, deaths = 0, assists = 0, adrTotal = 0, hs = 0, count = 0, rounds = 0;
  for (const s of statsArr) {
    if (!s) continue;
    kills += +s.Kills || 0;
    deaths += +s.Deaths || 0;
    assists += +s.Assists || 0;
    adrTotal += +s.ADR || 0;
    hs += +s.Headshots || 0;
    if (typeof s.__rounds === "number") rounds += s.__rounds;
    count++;
  }

  return {
    kills,
    assists,
    deaths,
    kd: count && deaths ? (kills / deaths).toFixed(2) : "0.00",
    adr: count ? (adrTotal / count).toFixed(1) : "0.0",
    hsPercent: kills ? Math.round((hs / kills) * 100) + "%" : "0%",
    kr: rounds ? (kills / rounds).toFixed(2) : "0.00",
  };
}

async function fetchTeammateStats(playerId) {
  const res = await retryFetch(`${API_BASE}/players/${playerId}/history?game=cs2&limit=30`, { headers: getHeaders() });
  const hist = await safeJson(res) || { items: [] };
  if (hist.items.length === 0) return [];

  const countMap = {}, winMap = {}, loseMap = {}, infoMap = {};
  for (const m of hist.items) {
    const teams = m.teams;
    const winner = m.results?.winner;
    if (!teams || !winner) continue;

    for (const [side, team] of Object.entries(teams)) {
      const members = team.players || [];
      if (!members.some(p => p.player_id === playerId)) continue;

      for (const p of members) {
        if (p.player_id === playerId) continue;
        countMap[p.player_id] = (countMap[p.player_id] || 0) + 1;
        if (side === winner) {
          winMap[p.player_id] = (winMap[p.player_id] || 0) + 1;
        } else {
          loseMap[p.player_id] = (loseMap[p.player_id] || 0) + 1;
        }
        if (!infoMap[p.player_id]) {
          infoMap[p.player_id] = {
            nickname: p.nickname,
            url: (p.faceit_url || "").replace("{lang}", "de"),
          };
        }
      }
      break;
    }
  }

  return Object.entries(countMap).map(([id, cnt]) => {
    const { nickname, url } = infoMap[id] || {};
    const wins = winMap[id] || 0;
    const losses = loseMap[id] || 0;
    return {
      playerId: id,
      nickname: nickname || "—",
      url: url || "#",
      count: cnt,
      wins,
      losses,
      winrate: cnt ? `${Math.round((wins / cnt) * 100)}%` : "—",
    };
  }).filter(p => p.nickname && p.nickname !== "—");
}

async function fetchPlayerData(playerId) {
  const headers = getHeaders();
  const [pr, hr, sr] = await Promise.all([
    retryFetch(`${API_BASE}/players/${playerId}`, { headers }),
    retryFetch(`${API_BASE}/players/${playerId}/history?game=cs2&limit=1`, { headers }),
    retryFetch(`${API_BASE}/players/${playerId}/stats/cs2`, { headers }),
  ]);

  const profile = await safeJson(pr) || {};
  const history = await safeJson(hr) || { items: [] };
  const stats = await safeJson(sr) || {};

  const elo = profile.games?.cs2?.faceit_elo || null;
  const nickname = profile.nickname || "—";
  const url = (profile.faceit_url || "").replace("{lang}", "de");
  const level = profile.games?.cs2?.skill_level || null;
  const lifetime = stats.lifetime || {};
  const lastTs = history.items[0]?.finished_at;
  const lastMatch = lastTs ? DateTime.fromSeconds(lastTs).setZone("Europe/Berlin").toFormat("yyyy-MM-dd HH:mm") : "—";

  const recentStats = await fetchRecentStats(playerId);
  const teammateStats = await fetchTeammateStats(playerId);
  const topMates = [...teammateStats].sort((a, b) => b.count - a.count).slice(0, 5);
  const worstMates = [...teammateStats].sort((a, b) => b.losses - a.losses).slice(0, 5);
  const bestMates = [...teammateStats].sort((a, b) => b.wins - a.wins).slice(0, 5);

  return {
    playerId,
    nickname,
    elo,
    lastMatch,
    faceitUrl: url,
    level,
    winrate: lifetime["Win Rate %"] || "—",
    matches: lifetime["Matches"] || "—",
    recentStats,
    topMates,
    worstMates,
    bestMates,
  };
}

function getPeriodStart(range) {
  const now = DateTime.now().setZone("Europe/Berlin");
  switch (range) {
    case "daily": return now.startOf("day");
    case "weekly": return now.startOf("week");
    case "monthly": return now.startOf("month");
    case "yearly": return now.startOf("year");
    default: return now;
  }
}

(async () => {
  if (!FACEIT_API_KEY) {
    console.error("❌ FACEIT_API_KEY fehlt!");
    process.exit(1);
  }

  const lines = fs.readFileSync(PLAYERS_FILE, "utf-8")
    .trim()
    .split("\n")
    .map(l => l.split(/#|\/\//)[0].trim())
    .filter(Boolean);

  const limit = await pLimit(5);
  const results = (
    await Promise.all(lines.map(id =>
      limit(async () => {
        try {
          const d = await fetchPlayerData(id);
          return d.elo ? d : null;
        } catch (e) {
          console.error(`❌ Fehler bei ${id}: ${e.message}`);
          return null;
        }
      })
    ))
  ).filter(Boolean);

  results.sort((a, b) => b.elo - a.elo);
  const latest = results.map(r => ({ playerId: r.playerId, elo: r.elo }));
  writeJson(RANGE_FILES.latest, latest);

  const updatedTime = DateTime.now().setZone("Europe/Berlin").toFormat("yyyy-MM-dd HH:mm");
  const rows = results.map(p => {
    const mainRow = `
<tr class="player-row" data-player-id="${p.playerId}" data-elo="${p.elo}">
  <td class="p-2">
    <span class="toggle-details cursor-pointer select-none">▸</span>
    <a href="${p.faceitUrl}" target="_blank" class="nickname-link ml-1">${p.nickname}</a>
  </td>
  <td class="p-2 elo-now">${p.elo}</td>
  <td class="p-2 elo-diff">-</td>
  <td class="p-2">
    <img src="icons/levels/level_${p.level}_icon.png" width="24" height="24" title="Level ${p.level}">
  </td>
  <td class="p-2">${p.winrate}</td>
  <td class="p-2">${p.matches}</td>
  <td class="p-2">${p.lastMatch}</td>
</tr>`.trim();

    const statBlock = `
<div class="mb-2">
  <div class="font-semibold text-white/80 mb-1">📊 Stats aus den letzten 30 Matches:</div>
  <div class="text-sm text-white/90">
    Kills: ${p.recentStats.kills} | Assists: ${p.recentStats.assists} | Deaths: ${p.recentStats.deaths}<br/>
    K/D: ${p.recentStats.kd} | K/R: ${p.recentStats.kr} | ADR: ${p.recentStats.adr} | HS%: ${p.recentStats.hsPercent}
  </div>
</div>`;

    const topMatesBlock = `
<div class="mb-2">
  <div class="font-semibold text-white/80 mb-1">👥 Häufigste Mitspieler:</div>
  <ul class="list-disc list-inside text-sm text-white/90">
    ${p.topMates.map(m => `<li><a href="${m.url}" target="_blank" class="nickname-link">${m.nickname}</a> – ${m.count} Matches – Winrate: ${m.winrate}</li>`).join("\n")}
  </ul>
</div>`;

    const worstMatesBlock = `
<div class="mb-2">
  <div class="font-semibold text-white/80 mb-1">💀 Meiste Niederlagen mit:</div>
  <ul class="list-disc list-inside text-sm text-white/90">
    ${p.worstMates.map(m => `<li><a href="${m.url}" target="_blank" class="nickname-link">${m.nickname}</a> – ${m.losses} Niederlagen</li>`).join("\n")}
  </ul>
</div>`;

    const bestMatesBlock = `
<div class="mb-2">
  <div class="font-semibold text-white/80 mb-1">🏆 Meiste Wins mit:</div>
  <ul class="list-disc list-inside text-sm text-white/90">
    ${p.bestMates.map(m => `<li><a href="${m.url}" target="_blank" class="nickname-link">${m.nickname}</a> – ${m.wins} Wins</li>`).join("\n")}
  </ul>
</div>`;


    const detailRow = `
<tr class="details-row hidden" data-player-id="${p.playerId}">
  <td colspan="7" class="p-4 bg-white/5 rounded-b-xl">
    ${statBlock + topMatesBlock + worstMatesBlock + bestMatesBlock}
  </td>
</tr>`.trim();

    return mainRow + "\n" + detailRow;
  }).join("\n");

  const template = fs.readFileSync(TEMPLATE_FILE, "utf-8");
  fs.writeFileSync(OUTPUT_FILE,
    template
      .replace("<!-- INSERT_ELO_TABLE_HERE -->", rows)
      .replace("<!-- INSERT_LAST_UPDATED -->", updatedTime)
  );
  console.log(`✅ Dashboard aktualisiert: ${OUTPUT_FILE}`);

  for (const range of ["daily", "weekly", "monthly", "yearly"]) {
    const metaPath = path.join(DATA_DIR, `elo-${range}-meta.json`);
    const start = getPeriodStart(range);
    let doUpdate = true;
    if (fs.existsSync(metaPath)) {
      try {
        const m = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        if (DateTime.fromISO(m.lastUpdated, { zone: "Europe/Berlin" }) >= start) {
          doUpdate = false;
        }
      } catch {}
    }
    if (doUpdate) {
      writeJson(RANGE_FILES[range], latest);
      fs.writeFileSync(metaPath, JSON.stringify({ lastUpdated: start.toISODate() }, null, 2));
      console.log(`✅ ${RANGE_FILES[range]} wurde aktualisiert.`);
    }
  }
})();