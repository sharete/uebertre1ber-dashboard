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

// 🛠 Erstelle data-Ordner, wenn er fehlt
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

  return { nickname, elo, lastMatch: lastMatchFormatted, faceitUrl, level, winrate, matches };
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

  const comparisonRange = "daily";
  const previousSnapshot = readJson(RANGE_FILES[comparisonRange]);

  function getDiff(nickname, currentElo) {
    const prev = previousSnapshot.find(p => p.nickname === nickname);
    return prev ? currentElo - prev.elo : null;
  }

  const tableBody = results
    .map(({ nickname, elo, level, winrate, matches, lastMatch, faceitUrl }) => {
      const diff = getDiff(nickname, elo);
      const diffHtml = diff === null
        ? ""
        : `<span class="${diff >= 0 ? 'text-green-400' : 'text-red-400'} text-xs">(${diff >= 0 ? '+' : ''}${diff})</span>`;

      return `
        <tr>
          <td class="p-2"><a href="${faceitUrl}" target="_blank" class="nickname-link">${nickname}</a></td>
          <td class="p-2">${elo} ${diffHtml}</td>
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

  // 📦 Schreibe immer elo-latest.json
  const latestSnapshot = results.map(({ nickname, elo }) => ({ nickname, elo }));
  writeJson(RANGE_FILES.latest, latestSnapshot);

  // 📆 Nur einmal pro Tag elo-daily.json aktualisieren
  const metaFile = path.join(DATA_DIR, "elo-daily-meta.json");
  const today = DateTime.now().toISODate();
  let lastUpdated = null;

  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
    lastUpdated = meta.lastUpdated;
  } catch {
    lastUpdated = null;
  }

  if (lastUpdated !== today) {
    writeJson(RANGE_FILES.daily, latestSnapshot);
    fs.writeFileSync(metaFile, JSON.stringify({ lastUpdated: today }, null, 2));
    console.log("✅ elo-daily.json wurde aktualisiert.");
  } else {
    console.log("ℹ️ elo-daily.json ist bereits aktuell.");
  }
    console.log("📊 Anzahl Spieler:", results.length);
    console.log("📂 Arbeitsverzeichnis:", __dirname);
    console.log("📝 Ziel-Datei:", path.join(DATA_DIR, RANGE_FILES.latest));
})();


