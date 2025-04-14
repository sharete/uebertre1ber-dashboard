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

  const updatedTime = DateTime.now().setZone("Europe/Berlin").toFormat("yyyy-MM-dd HH:mm");

  const html = `
<div class="table-container">
  <table class="sortable" id="elo-table">
    <thead>
      <tr>
        <th data-sort="string">Nickname</th>
        <th data-sort="number">ELO</th>
        <th data-sort="number">Level</th>
        <th data-sort="number">Winrate</th>
        <th data-sort="number">Matches</th>
        <th data-sort="date">Letztes Match</th>
      </tr>
    </thead>
    <tbody>
      ${results
        .map(
          ({ nickname, elo, level, winrate, matches, lastMatch, faceitUrl }) => `
          <tr>
            <td><a href="${faceitUrl}" target="_blank">${nickname}</a></td>
            <td>${elo}</td>
            <td><img src="icons/levels/level_${level}_icon.png" alt="Level ${level}" width="24" height="24" title="Level ${level}"></td>
            <td>${winrate}</td>
            <td>${matches}</td>
            <td>${lastMatch}</td>
          </tr>`
        )
        .join("\n")}
    </tbody>
  </table>
  <p class="updated">Zuletzt aktualisiert: ${updatedTime}</p>
</div>

<script>
document.querySelectorAll("th").forEach((header, columnIndex) => {
  header.style.cursor = "pointer";
  header.addEventListener("click", () => {
    const table = header.closest("table");
    const tbody = table.querySelector("tbody");
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const type = header.dataset.sort;
    const asc = !header.classList.contains("asc");

    rows.sort((a, b) => {
      const getText = (row) => row.children[columnIndex].textContent.trim();
      let aVal = getText(a);
      let bVal = getText(b);

      if (type === "number") {
        aVal = parseFloat(aVal.replace("%", "")) || 0;
        bVal = parseFloat(bVal.replace("%", "")) || 0;
      } else if (type === "date") {
        aVal = new Date(aVal);
        bVal = new Date(bVal);
      } else {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      return asc ? aVal > bVal ? 1 : -1 : aVal < bVal ? 1 : -1;
    });

    table.querySelectorAll("th").forEach(th => th.classList.remove("asc", "desc"));
    header.classList.add(asc ? "asc" : "desc");
    rows.forEach(row => tbody.appendChild(row));
  });
});
</script>

<style>
body {
  background: linear-gradient(135deg, #1b1333, #2a1b47);
  font-family: "Segoe UI", sans-serif;
  color: #ddd;
}
.table-container {
  backdrop-filter: blur(10px);
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  padding: 2rem;
  box-shadow: 0 0 20px rgba(0,0,0,0.4);
}
table {
  width: 100%;
  border-collapse: collapse;
}
thead {
  background-color: rgba(255, 255, 255, 0.05);
}
th, td {
  padding: 12px;
  text-align: center;
}
th {
  color: #fff;
}
tr:hover {
  background-color: rgba(255, 255, 255, 0.05);
}
.updated {
  text-align: right;
  font-size: 0.9em;
  margin-top: 1em;
  color: #aaa;
}
th.asc::after { content: " ▲"; font-size: 0.8em; }
th.desc::after { content: " ▼"; font-size: 0.8em; }
</style>
`.trim();

  const indexHtml = fs.readFileSync(INDEX_FILE, "utf-8");
  const updated = indexHtml.replace(/<div class="table-container">[\s\S]*?<\/style>/, html);
  fs.writeFileSync(INDEX_FILE, updated);
})();
