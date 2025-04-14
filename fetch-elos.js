const fs = require("fs");
const puppeteer = require("puppeteer");

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const PLAYERS_FILE = "players.txt";
const INDEX_FILE = "index.html";

async function fetchPlayerData(playerId) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.goto("https://example.com"); // Seite notwendig für JS-Kontext

  const data = await page.evaluate(async (playerId, apiKey) => {
    const headers = {
      Authorization: `Bearer ${apiKey}`
    };

    try {
      // Spieler-Daten holen
      const playerRes = await fetch(`https://open.faceit.com/data/v4/players/${playerId}`, { headers });
      const playerJson = await playerRes.json();

      // Match-Historie (mehrere Matches zur Sicherheit)
      const matchRes = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&limit=5`, { headers });
      const matchJson = await matchRes.json();

      const timestamps = matchJson.items?.map((item) => item.started_at) || [];
      const maxStartTime = timestamps.length ? Math.max(...timestamps) : null;

      return {
        nickname: playerJson.nickname,
        elo: playerJson.games?.cs2?.faceit_elo ?? null,
        lastMatch: maxStartTime
      };
    } catch (error) {
      return { error: error.message };
    }
  }, playerId, FACEIT_API_KEY);

  await browser.close();

  if (data.error) throw new Error(data.error);

  // Lokale Berliner Zeit berechnen
  const lastMatchFormatted = data.lastMatch
    ? new Date(
        new Date(data.lastMatch * 1000).toLocaleString("en-US", {
          timeZone: "Europe/Berlin"
        })
      )
        .toISOString()
        .replace("T", " ")
        .slice(0, 16)
    : "—";

  return {
    nickname: data.nickname,
    elo: data.elo,
    lastMatch: lastMatchFormatted
  };
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
      console.error(`Fehler bei ${nickname || playerId}: ${e.message}`);
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
