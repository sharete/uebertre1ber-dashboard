const fs = require("fs");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const { DateTime } = require("luxon");

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const PLAYERS_FILE = "players.txt";
const INDEX_FILE = "index.html";
const TABLE_PLACEHOLDER = "<!-- INSERT_ELO_TABLE_HERE -->";

async function fetchPlayerData(playerId) {
  const headers = { Authorization: `Bearer ${FACEIT_API_KEY}` };

  const playerRes = await fetch(`https://open.faceit.com/data/v4/players/${playerId}`, { headers });
  const playerJson = await playerRes.json();

  const matchRes = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&limit=1`, { headers });
  const matchJson = await matchRes.json();

  const stats = playerJson.games?.cs2?.statistics || {};
  const elo = playerJson.games?.cs2?.faceit_elo ?? null;
  const nickname = playerJson.nickname;
  const faceitUrl = playerJson.faceit_url.replace("{lang}", "de");
  const level = playerJson.games?.cs2?.skill_level ?? null;
  const kd = stats["K/D Ratio"] ?? "—";
  const winrate = stats["Win Rate %"] ?? "—";
  const matches = stats["Matches"] ?? "—";

  const lastMatchTimestamp = matchJson.items?.[0]?.finished_at;
  const lastMatchFormatted = lastMatchTimestamp
    ? DateTime.fromSeconds(lastMatchTimestamp)
        .setZone("Europe/Berlin")
        .toFormat("yyyy-MM-dd HH:mm")
    : "—";

  return { nickname, elo, lastMatch: lastMatchFormatted, faceitUrl, level, kd, winrate, matches };
}

(async () => {
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

  const html = `
<div class="table-wrapper">
  <table class="alt">
    <thead>
      <tr>
        <th>Nickname</th>
        <th>ELO</th>
        <th>Level</th>
        <th>K/D</th>
        <th>Winrate</th>
        <th>Matches</th>
        <th>Letztes Match</th>
      </tr>
    </thead>
    <tbody>
      ${results
        .map(
          ({ nickname, elo, level, kd, winrate, matches, lastMatch, faceitUrl }) => `
          <tr>
            <td><a href="${faceitUrl}" target="_blank">${nickname}</a></td>
            <td>${elo}</td>
            <td><img src="https://cdn.faceit.com/core/img/skill-icons/skill_level_${level}_svg.svg" alt="Level ${level}" width="24" height="24"></td>
            <td>${kd}</td>
            <td>${winrate}%</td>
            <td>${matches}</td>
            <td>${lastMatch}</td>
          </tr>`
        )
        .join("\n")}
    </tbody>
  </table>
</div>
`.trim();

  const indexHtml = fs.readFileSync(INDEX_FILE, "utf-8");
  const updated = indexHtml.replace(/<div class="table-wrapper">[\s\S]*?<\/div>/, html);
  fs.writeFileSync(INDEX_FILE, updated);
})();
