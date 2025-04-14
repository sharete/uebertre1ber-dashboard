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

  const elo = playerJson.games?.cs2?.faceit_elo ?? null;
  const nickname = playerJson.nickname;

  const lastMatchTimestamp = matchJson.items?.[0]?.finished_at;
  const lastMatchFormatted = lastMatchTimestamp
    ? DateTime.fromSeconds(lastMatchTimestamp)
        .setZone("Europe/Berlin")
        .toFormat("yyyy-MM-dd HH:mm")
    : "—";

  return { nickname, elo, lastMatch: lastMatchFormatted };
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
    <thead><tr><th>Nickname</th><th>ELO</th><th>Letztes Match</th></tr></thead>
    <tbody>
      ${results
        .map(
          ({ nickname, elo, lastMatch }) =>
            `<tr><td>${nickname}</td><td>${elo}</td><td>${lastMatch}</td></tr>`
        )
        .join("\n")}
    </tbody>
  </table>
</div>
`.trim();

  const indexHtml = fs.readFileSync(INDEX_FILE, "utf-8");
  const updated = indexHtml.replace(TABLE_PLACEHOLDER, `${TABLE_PLACEHOLDER}\n${html}`);
  fs.writeFileSync(INDEX_FILE, updated);
})();
