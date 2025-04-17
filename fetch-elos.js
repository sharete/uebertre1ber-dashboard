const fs = require("fs");
const path = require("path");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const { DateTime } = require("luxon");

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const PLAYERS_FILE   = "players.txt";
const TEMPLATE_FILE  = "index.template.html";
const OUTPUT_FILE    = "index.html";
const DATA_DIR       = path.join(__dirname, "data");
const API_BASE       = "https://api.faceit.com/data/v4";

const RANGE_FILES = {
  daily:   "elo-daily.json",
  weekly:  "elo-weekly.json",
  monthly: "elo-monthly.json",
  yearly:  "elo-yearly.json",
  latest:  "elo-latest.json"
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function writeJson(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
  console.log(`✅ Datei geschrieben: ${file} (${data.length} Einträge)`);
}

function getHeaders() {
  return {
    Authorization: `Bearer ${FACEIT_API_KEY}`,
    "User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    Accept:         "application/json",
    Referer:        "https://www.faceit.com/",
    Origin:         "https://www.faceit.com"
  };
}

const matchCache = {};
async function fetchMatchStats(matchId, playerId) {
  if (matchCache[matchId]) {
    return matchCache[matchId][playerId] || null;
  }
  const res       = await fetch(`${API_BASE}/matches/${matchId}/stats`, { headers: getHeaders() });
  if (!res.ok) return null;
  const matchData = await res.json();
  const players   = matchData.rounds[0].teams.flatMap(t => t.players);
  const mapStats  = Object.fromEntries(players.map(p => [p.player_id, p.player_stats]));
  matchCache[matchId] = mapStats;
  return mapStats[playerId] || null;
}

async function fetchRecentStats(playerId) {
  const res       = await fetch(`${API_BASE}/players/${playerId}/history?game=cs2&limit=30`, { headers: getHeaders() });
  const { items } = await res.json();

  // parallel stat requests
  const statsArr = await Promise.all(
    items.map(m => fetchMatchStats(m.match_id, playerId).catch(() => null))
  );

  let kills=0, deaths=0, assists=0, adrTotal=0, hs=0, count=0;
  for (const s of statsArr) {
    if (!s) continue;
    kills    += +s.Kills     || 0;
    deaths   += +s.Deaths    || 0;
    assists  += +s.Assists   || 0;
    adrTotal += +s.ADR       || 0;
    hs       += +s.Headshots || 0;
    count++;
  }

  return {
    kills,
    assists,
    deaths,
    kd:        count && deaths ? (kills/deaths).toFixed(2) : "0.00",
    adr:       count ? (adrTotal/count).toFixed(1) : "0.0",
    hsPercent: kills ? Math.round((hs/kills)*100) + "%" : "0%"
  };
}

async function fetchTeammateStats(playerId) {
  const res        = await fetch(`${API_BASE}/players/${playerId}/history?game=cs2&limit=30`, { headers: getHeaders() });
  const { items }  = await res.json();

  // parallel match details
  const matchesArr = await Promise.all(
    items.map(m =>
      fetch(`${API_BASE}/matches/${m.match_id}`, { headers: getHeaders() })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    )
  );

  const countMap = {}, winMap = {};
  for (const sumJson of matchesArr) {
    if (!sumJson?.teams) continue;
    const s1     = sumJson.results?.["1"] || 0;
    const s2     = sumJson.results?.["2"] || 0;
    const winner = s1 > s2 ? "1" : s2 > s1 ? "2" : null;

    for (const side of Object.keys(sumJson.teams)) {
      const team    = sumJson.teams[side];
      const members = team.players ?? team.roster?.members ?? [];
      if (!members.some(p => p.player_id === playerId)) continue;

      for (const p of members) {
        if (p.player_id === playerId) continue;
        countMap[p.player_id] = (countMap[p.player_id] || 0) + 1;
        if (side === winner) {
          winMap[p.player_id] = (winMap[p.player_id] || 0) + 1;
        }
      }
      break;
    }
  }

  return Object.entries(countMap)
    .map(([id, cnt]) => ({
      playerId: id,
      count:    cnt,
      wins:     winMap[id] || 0,
      winrate:  Math.round(((winMap[id]||0)/cnt)*100) + "%"
    }))
    .sort((a,b) => b.count - a.count);
}

async function fetchPlayerData(playerId) {
  const headers = getHeaders();
  const [pr, hr, sr] = await Promise.all([
    fetch(`${API_BASE}/players/${playerId}`, { headers }),
    fetch(`${API_BASE}/players/${playerId}/history?game=cs2&limit=1`, { headers }),
    fetch(`${API_BASE}/players/${playerId}/stats/cs2`, { headers })
  ]);

  const profile = await pr.json();
  const history = await hr.json();
  const stats   = await sr.json();

  const elo      = profile.games?.cs2?.faceit_elo || null;
  const nickname = profile.nickname;
  const url      = profile.faceit_url.replace("{lang}","de");
  const level    = profile.games?.cs2?.skill_level || null;
  const life     = stats.lifetime || {};

  const lastTs   = history.items?.[0]?.finished_at;
  const lastMatch= lastTs
    ? DateTime.fromSeconds(lastTs).setZone("Europe/Berlin").toFormat("yyyy-MM-dd HH:mm")
    : "—";

  const recentStats   = await fetchRecentStats(playerId);
  const teammateStats = await fetchTeammateStats(playerId);
  const topTeammate   = teammateStats[0] || {};

  let pNick="", pUrl="", pWR="—";
  if (topTeammate.playerId) {
    pWR = topTeammate.winrate;
    const pj = await fetch(`${API_BASE}/players/${topTeammate.playerId}`, { headers }).then(r => r.json());
    pNick = pj.nickname;
    pUrl  = pj.faceit_url.replace("{lang}","de");
  }

  return {
    playerId, nickname, elo, lastMatch, faceitUrl: url,
    level, winrate: life["Win Rate %"]||"—", matches: life["Matches"]||"—",
    recentStats, partnerNickname: pNick, partnerUrl: pUrl, partnerWinrate: pWR
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

(async()=>{
  if (!FACEIT_API_KEY) {
    console.error("❌ FACEIT_API_KEY fehlt!");
    process.exit(1);
  }

  const lines = fs.readFileSync(PLAYERS_FILE,"utf-8").trim().split("\n");
  const results = (await Promise.all(
    lines.map(async l=>{
      const id = l.split(/#|\/\//)[0].trim();
      try {
        const d = await fetchPlayerData(id);
        return d.elo ? d : null;
      } catch(e){
        console.error(`❌ Fehler bei ${id}: ${e.message}`);
        return null;
      }
    })
  )).filter(Boolean);

  results.sort((a,b)=>b.elo-a.elo);
  const latest = results.map(r=>({playerId:r.playerId,elo:r.elo}));
  writeJson(RANGE_FILES.latest, latest);

  const updatedTime = DateTime.now().setZone("Europe/Berlin").toFormat("yyyy-MM-dd HH:mm");
  const rows = results.map(p=>{
    const {
      playerId,nickname,elo,level,winrate,matches,lastMatch,
      faceitUrl,recentStats,partnerNickname,partnerUrl,partnerWinrate
    } = p;
    const tip = `<div class="tooltip">
      <a href="${faceitUrl}" target="_blank" class="nickname-link">${nickname}</a>
      <div class="tooltip-content">
        Letzten 30 Matches:<br/>
        Kills ${recentStats.kills} / Assists ${recentStats.assists} / Deaths ${recentStats.deaths}<br/>
        K/D ${recentStats.kd} – ADR ${recentStats.adr} – HS% ${recentStats.hsPercent}
      </div>
    </div>`;
    return `
      <tr data-player-id="${playerId}" data-elo="${elo}">
        <td class="p-2">${tip}</td>
        <td class="p-2 elo-now">${elo}</td>
        <td class="p-2 elo-diff">-</td>
        <td class="p-2">${partnerNickname
          ? `<a href="${partnerUrl}" target="_blank" class="nickname-link">${partnerNickname}</a>`
          : "—"}</td>
        <td class="p-2">${partnerWinrate}</td>
        <td class="p-2"><img src="icons/levels/level_${level}_icon.png" width="24" height="24" title="Level ${level}"></td>
        <td class="p-2">${winrate}</td>
        <td class="p-2">${matches}</td>
        <td class="p-2">${lastMatch}</td>
      </tr>`;
  }).join("\n");

  const tpl = fs.readFileSync(TEMPLATE_FILE,"utf-8");
  fs.writeFileSync(OUTPUT_FILE, tpl
    .replace("<!-- INSERT_ELO_TABLE_HERE -->", rows)
    .replace("<!-- INSERT_LAST_UPDATED -->", updatedTime)
  );
  console.log(`✅ Dashboard aktualisiert: ${OUTPUT_FILE}`);

  for (const r of ["daily","weekly","monthly","yearly"]) {
    const meta = path.join(DATA_DIR,`elo-${r}-meta.json`);
    const start = getPeriodStart(r);
    let upd = true;
    if (fs.existsSync(meta)) {
      try {
        const m = JSON.parse(fs.readFileSync(meta,"utf-8"));
        if (DateTime.fromISO(m.lastUpdated,{zone:"Europe/Berlin"}) >= start) upd=false;
      } catch{}
    }
    if (upd) {
      writeJson(RANGE_FILES[r], latest);
      fs.writeFileSync(meta, JSON.stringify({lastUpdated:start.toISODate()},null,2));
      console.log(`✅ ${RANGE_FILES[r]} aktualisiert.`);
    }
  }
})();
