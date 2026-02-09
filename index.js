const fs = require('fs');
const path = require('path');
const { DateTime } = require("luxon");

const api = require('./src/api');
const stats = require('./src/stats');
const renderer = require('./src/renderer');

const PLAYERS_FILE = "players.txt";
const DATA_DIR = path.join(__dirname, "data");
const TEMPLATE_FILE = "index.template.html";
const OUTPUT_FILE = "index.html";

const RANGE_FILES = {
    daily: "elo-daily.json",
    weekly: "elo-weekly.json",
    monthly: "elo-monthly.json",
    yearly: "elo-yearly.json",
    latest: "elo-latest.json",
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function writeJson(file, data) {
    fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

function getPeriodStart(range) {
    const now = DateTime.now().setZone("Europe/Berlin");
    switch (range) {
        case "daily": return now.startOf("day");
        case "weekly": return now.startOf("week");
        case "monthly": return now.startOf("month");
        case "yearly": return now.startOf("year");
        default: return now;
    }
}

async function processPlayer(playerId) {
    try {
        const [profile, history, playerStats, eloHistoryData] = await Promise.all([
            api.getPlayer(playerId),
            api.getPlayerHistory(playerId, 30), // Get last 30 matches
            api.getPlayerStats(playerId),
            api.getEloHistory(playerId)
        ]);

        if (!profile || !profile.player_id) {
            console.error(`❌ Profile not found for ${playerId}`);
            return null;
        }

        const elo = profile.games?.cs2?.faceit_elo || null;
        if (!elo) return null; // Player has no CS2 ELO

        // Fetch match stats for all matches in history
        const matchStatsMap = {};
        for (const item of history.items) {
            const ms = await api.getMatchStats(item.match_id);
            if (ms) matchStatsMap[item.match_id] = ms;
        }

        // Calculate stats
        const calculatedStats = stats.calculatePlayerStats(playerId, history.items, matchStatsMap, eloHistoryData);

        const lastTs = history.items[0]?.finished_at;
        const lastMatch = lastTs ? DateTime.fromSeconds(lastTs).setZone("Europe/Berlin").toFormat("yyyy-MM-dd HH:mm") : "—";
        const url = (profile.faceit_url || "").replace("{lang}", "de");

        return {
            playerId: profile.player_id,
            nickname: profile.nickname,
            elo,
            level: profile.games?.cs2?.skill_level || 0,
            faceitUrl: url,
            winrate: playerStats.lifetime ? playerStats.lifetime["Win Rate %"] + "%" : "—", // Add % sign if missing pattern in original
            // Original code: playerStats.lifetime["Win Rate %"] already includes "52", not "52%"? Checked original: it is just number "52" then added later.
            // Wait, original: `lifetime["Get Win Rate %"] || "—"`
            // Let's check original `fetch-elos.js`: `lifetime["Win Rate %"]`
            // And in HTML it is just outputted.
            // In my renderer I assume it's a string with %. Let's double check.
            // `lifetime` object usually has "Win Rate %": "52".
            // So I should append %. 
            matches: playerStats.lifetime ? playerStats.lifetime["Matches"] : "—",
            lastMatch,
            stats: calculatedStats
        };

    } catch (e) {
        console.error(`❌ Error processing ${playerId}:`, e);
        return null;
    }
}

(async () => {
    console.log("🚀 Starting Faceit Dashboard Update...");

    // Init API (limit)
    await api.init();

    // Read players
    const lines = fs.readFileSync(PLAYERS_FILE, "utf-8")
        .trim()
        .split("\n")
        .map(l => l.split(/#|\/\//)[0].trim())
        .filter(Boolean);

    console.log(`ℹ️ Processing ${lines.length} players...`);

    const results = [];
    for (const id of lines) {
        const p = await processPlayer(id);
        if (p) results.push(p);
    }

    // Sort by ELO
    results.sort((a, b) => b.elo - a.elo);

    // Write latest ELO for diffs
    const latest = results.map(r => ({ playerId: r.playerId, elo: r.elo }));
    writeJson(RANGE_FILES.latest, latest);

    // Update time
    const updatedTime = DateTime.now().setZone("Europe/Berlin").toFormat("yyyy-MM-dd HH:mm");
    const now = DateTime.now().setZone("Europe/Berlin");

    // Helper to find ELO at a specific time in past
    const findEloAt = (player, dateThreshold) => {
        if (!player.stats.eloHistory || player.stats.eloHistory.length === 0) return player.elo;

        const history = player.stats.eloHistory;
        const thresholdTs = dateThreshold.toSeconds();

        // Iterate backwards (Assuming Oldest -> Newest)
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].date <= thresholdTs) {
                return history[i].elo;
            }
        }

        if (history.length > 0) {
            return history[0].elo;
        }

        return player.elo;
    };

    const snapshotData = {};

    // Rewrite snapshot logic to respect historical backfill
    for (const range of ["daily", "weekly", "monthly", "yearly"]) {
        const metaPath = path.join(DATA_DIR, `elo-${range}-meta.json`);
        let needsUpdate = true;
        let dataForRange = [];

        // Try to load existing data first so we have something to inject even if no update needed
        if (fs.existsSync(path.join(DATA_DIR, RANGE_FILES[range]))) {
            try {
                dataForRange = JSON.parse(fs.readFileSync(path.join(DATA_DIR, RANGE_FILES[range]), "utf-8"));
            } catch { }
        }

        if (fs.existsSync(metaPath)) {
            try {
                const m = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
                const start = getPeriodStart(range);
                if (DateTime.fromISO(m.lastUpdated, { zone: "Europe/Berlin" }) >= start) {
                    needsUpdate = false;
                }
            } catch { }
        } else {
            // First run: Backfill
            console.log(`ℹ️ First run for ${range}. Backfilling from history...`);

            // User requested Strict Logic:
            // Daily -> Reset at 00:00 (Today)
            // Weekly -> Reset at Monday 00:00 (This week)
            // Monthly -> Reset at 1st of Month 00:00 (This month)
            // Yearly -> Reset at 01.01. 00:00 (This year)

            let threshold;
            if (range === "daily") threshold = now.startOf("day");
            if (range === "weekly") threshold = now.startOf("week");
            if (range === "monthly") threshold = now.startOf("month");
            if (range === "yearly") threshold = now.startOf("year");

            const backfilledData = results.map(p => {
                // strict mode: if last match was BEFORE threshold, then diff should be 0 (so snapshot = current elo)
                const history = p.stats.eloHistory;
                if (history && history.length > 0) {
                    const lastMatchDate = history[history.length - 1].date;
                    if (lastMatchDate < threshold.toSeconds()) {
                        return { playerId: p.playerId, elo: p.elo };
                    }
                }

                return {
                    playerId: p.playerId,
                    elo: findEloAt(p, threshold)
                };
            });

            writeJson(RANGE_FILES[range], backfilledData);
            fs.writeFileSync(metaPath, JSON.stringify({ lastUpdated: threshold.toISODate() }, null, 2));
            needsUpdate = false;
        }
        if (needsUpdate) {
            dataForRange = latest;
            writeJson(RANGE_FILES[range], latest);
            const start = getPeriodStart(range);
            fs.writeFileSync(metaPath, JSON.stringify({ lastUpdated: start.toISODate() }, null, 2));
            console.log(`✅ ${RANGE_FILES[range]} updated.`);
        }

        snapshotData[range] = dataForRange;
    }

    // Render HTML with injected data
    renderer.render(TEMPLATE_FILE, OUTPUT_FILE, {
        players: results,
        lastUpdated: updatedTime,
        historyData: snapshotData
    });

    console.log("✨ Done!");
})();
