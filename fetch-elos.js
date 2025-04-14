const fs = require("fs");
const puppeteer = require("puppeteer");

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const PLAYERS_FILE = "players.txt";
const INDEX_FILE = "index.html";
const TABLE_PLACEHOLDER = "<!-- INSERT_ELO_TABLE_HERE -->";

async function fetchPlayerData(playerId) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
    });      
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    Authorization: `Bearer ${FACEIT_API_KEY}`,
  });

  const playerRes = await page.goto(
    `https://open.faceit.com/data/v4/players/${playerId}`,
    { waitUntil: "networkidle0" }
  );
  const playerJson = await playerRes.json();

  const matchRes = await page.goto(
    `https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&limit=1`,
    { waitUntil: "networkidle0" }
  );
  const matchJson = await matchRes.json();

  await browser.close();

  const elo = playerJson.games?.cs2?.faceit_elo ?? null;
  const nickname = playerJson.nickname;
  const lastMatch = matchJson.items?.[0]?.started_at
    ? new Date(matchJson.items[0].started_at * 1000).toISOString().replace("T", " ").slice(0, 16)
    : "—";

  return { nickname, elo, lastMatch };
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
      console.error(`Fehler bei ${nickname}: ${e.message}`);
    }
  }

  results.sort((a, b) => b.elo - a.elo);

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
  const updated = indexHtml.replace(
    /<div class="table-wrapper">[\s\S]*?<\/div>/,
    html
  );
  fs.writeFileSync(INDEX_FILE, updated);
})();
