const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const renderer = require("../src/renderer");
const stats = require("../src/stats");

const root = path.resolve(__dirname, "..");
const template = fs.readFileSync(path.join(root, "index.template.html"), "utf8");
const generated = fs.readFileSync(path.join(root, "index.html"), "utf8");
const dashboardScript = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");

for (const marker of [
  "INSERT_ELO_TABLE_HERE",
  "INSERT_LAST_UPDATED",
  "INSERT_PLAYER_COUNT",
  "INSERT_AWARDS_SECTION",
  "INSERT_HISTORY_DATA",
  "INSERT_COMPARISON_DATA"
]) {
  assert.match(template, new RegExp(marker), `Template marker ${marker} is missing`);
  assert.doesNotMatch(generated, new RegExp(marker), `Generated page still contains ${marker}`);
}

assert.match(generated, /id="playerTableBody"/);
assert.match(generated, /class="player-row/);
assert.match(generated, /src="dashboard\.js"/);
assert.match(generated, /src="vendor\/chart\.min\.js"/);
assert.doesNotMatch(generated, /cdn\.jsdelivr\.net\/npm\/chart\.js/);
assert.match(generated, /href="dashboard\.css"/);
assert.doesNotMatch(generated, /Crew Ranking/);
assert.match(generated, />Baiter</);
assert.match(generated, /class="award-icon"/);
assert.match(generated, /Last Update:/);
assert.match(generated, /Dashboard by <a [^>]*>sha<\/a>/);
assert.equal(fs.statSync(path.join(root, "vendor", "chart.min.js")).size > 100000, true);
assert.match(dashboardScript, /toMatchSeries/);
assert.match(dashboardScript, /cubicInterpolationMode: "monotone"/);
assert.match(dashboardScript, /max: 30/);

const awardHtml = renderer.renderAwards({
  bestKD: { name: "One", value: "1.20" },
  bestHS: { name: "Two", value: "60" },
  bestADR: { name: "Three", value: "90" },
  bestWinrate: { name: "Four", value: "70" },
  longestStreak: { name: "Five", value: 5 },
  lowestDeaths: { name: "Six", value: 300 }
});
assert.match(awardHtml, /🎯/);
assert.match(awardHtml, /🛡️/);
assert.match(awardHtml, />Baiter</);
assert.doesNotMatch(awardHtml, />Survivor</);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-render-"));
const templatePath = path.join(tempDir, "template.html");
const outputPath = path.join(tempDir, "output.html");
fs.writeFileSync(
  templatePath,
  "<!-- INSERT_ELO_TABLE_HERE --><!-- INSERT_LAST_UPDATED --><!-- INSERT_PLAYER_COUNT --><!-- INSERT_AWARDS_SECTION --><!-- INSERT_HISTORY_DATA --><!-- INSERT_COMPARISON_DATA -->"
);

const maliciousName = '<script>alert("xss")</script>';
renderer.render(templatePath, outputPath, {
  players: [{
    playerId: "player-1",
    nickname: maliciousName,
    avatar: "javascript:alert(1)",
    elo: 1500,
    level: 5,
    faceitUrl: "javascript:alert(1)",
    winrate: "50%",
    matches: 10,
    lastMatch: "2026-01-01 12:00",
    lastMatchTs: 1767265200,
    stats: {
      recent: { kd: "1.00", kr: "0.70", kills: 100, deaths: 100, assists: 20, adr: "75.0", hsPercent: "50%", matches: 10 },
      teammates: [],
      streak: { count: 0, type: "none" },
      last5: [],
      mapPerformance: [],
      eloHistory: []
    }
  }],
  lastUpdated: "2026-01-01 12:00",
  historyData: { daily: [] },
  awards: {}
});

const rendered = fs.readFileSync(outputPath, "utf8");
assert.doesNotMatch(rendered, /javascript:alert/);
assert.doesNotMatch(rendered, /<script>alert/);
assert.match(rendered, /&lt;script&gt;/);
fs.rmSync(tempDir, { recursive: true, force: true });

const normalizedStats = stats.calculatePlayerStats("player-1", [], {}, [
  { date: 1767265200000, i20: "1480" },
  { date: 1767268800, elo: "1500", elo_delta: "20" },
  { created_at: 1767261600, elo: "1450" },
  { date: "invalid", elo: "9999" }
]);
assert.deepEqual(
  normalizedStats.eloHistory,
  [
    { date: 1767261600, elo: 1450, eloDiff: undefined },
    { date: 1767265200, elo: 1480, eloDiff: undefined },
    { date: 1767268800, elo: 1500, eloDiff: 20 }
  ],
  "ELO history should accept both FACEIT history formats and remain chronological"
);

console.log("Dashboard smoke tests passed.");
