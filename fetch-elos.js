const fs = require("fs");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const { DateTime } = require("luxon");

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const PLAYERS_FILE = "players.txt";
const INDEX_FILE = "index.html";

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

  results.sort((a, b) => b.elo - a.elo);

  const debugSha = results.find((r) => r.nickname === "sha89");
  if (debugSha) {
    console.log(`✅ sha89 hat ${debugSha.elo} ELO | Letztes Match: ${debugSha.lastMatch}`);
  }

  const updatedTime = DateTime.now().setZone("Europe/Berlin").toFormat("yyyy-MM-dd HH:mm");

  const tableBody = results
    .map(
      ({ nickname, elo, level, winrate, matches, lastMatch, faceitUrl }) => `
        <tr>
          <td class="p-2"><a href="${faceitUrl}" target="_blank" class="underline">${nickname}</a></td>
          <td class="p-2">${elo}</td>
          <td class="p-2"><img src="icons/levels/level_${level}_icon.png" alt="Level ${level}" width="24" height="24" title="Level ${level}"></td>
          <td class="p-2">${winrate}</td>
          <td class="p-2">${matches}</td>
          <td class="p-2">${lastMatch}</td>
        </tr>`
    )
    .join("\n");

  const indexHtml = fs.readFileSync(INDEX_FILE, "utf-8");
  const updatedHtml = indexHtml
    .replace("<!-- INSERT_ELO_TABLE_HERE -->", tableBody)
    .replace("<!-- INSERT_LAST_UPDATED -->", updatedTime);

  fs.writeFileSync(INDEX_FILE, updatedHtml);
})();
