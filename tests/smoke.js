const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const renderer = require("../src/renderer");

const root = path.resolve(__dirname, "..");
const template = fs.readFileSync(path.join(root, "index.template.html"), "utf8");
const generated = fs.readFileSync(path.join(root, "index.html"), "utf8");

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
assert.match(generated, /href="dashboard\.css"/);

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

console.log("Dashboard smoke tests passed.");
