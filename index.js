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
            api.getPlayerHistory(playerId, 30),
            api.getPlayerStats(playerId),
            api.getEloHistory(playerId)
        ]);

        if (!profile || !profile.player_id) {
            console.error(`❌ Profile not found for ${playerId}`);
            return null;
        }

        const elo = profile.games?.cs2?.faceit_elo || null;
        if (!elo) return null;

        // Fetch match stats for all matches in history
        const matchStatsMap = {};
        for (const item of history.items) {
            const ms = await api.getMatchStats(item.match_id);
            if (ms) matchStatsMap[item.match_id] = ms;
        }

        // Calculate stats (now includes streak, last5, mapPerformance)
        const calculatedStats = stats.calculatePlayerStats(playerId, history.items, matchStatsMap, eloHistoryData);

        const lastTs = history.items[0]?.finished_at;
        const lastMatch = lastTs ? DateTime.fromSeconds(lastTs).setZone("Europe/Berlin").toFormat("yyyy-MM-dd HH:mm") : "—";
        const lastMatchTs = lastTs || 0;
        const url = (profile.faceit_url || "").replace("{lang}", "de");

        return {
            playerId: profile.player_id,
            nickname: profile.nickname,
            avatar: profile.avatar || "",
            elo,
            level: profile.games?.cs2?.skill_level || 0,
            faceitUrl: url,
            winrate: playerStats.lifetime ? playerStats.lifetime["Win Rate %"] + "%" : "—",
            matches: playerStats.lifetime ? playerStats.lifetime["Matches"] : "—",
            lastMatch,
            lastMatchTs,
            stats: calculatedStats
        };

    } catch (e) {
        console.error(`❌ Error processing ${playerId}:`, e);
        return null;
    }
}

function calculateAwards(results) {
    if (results.length === 0) return {};

    let bestKD = { name: "—", value: "0.00" };
    let bestHS = { name: "—", value: "0%" };
    let bestADR = { name: "—", value: "0.0" };
    let mostMatches = { name: "—", value: 0 };
    let longestStreak = { name: "—", value: 0, type: "win" };
    let lowestDeaths = { name: "—", value: Infinity };

    for (const p of results) {
        const r = p.stats.recent;

        if (parseFloat(r.kd) > parseFloat(bestKD.value)) {
            bestKD = { name: p.nickname, value: r.kd, avatar: p.avatar };
        }
        if (parseInt(r.hsPercent) > parseInt(bestHS.value)) {
            bestHS = { name: p.nickname, value: r.hsPercent, avatar: p.avatar };
        }
        if (parseFloat(r.adr) > parseFloat(bestADR.value)) {
            bestADR = { name: p.nickname, value: r.adr, avatar: p.avatar };
        }
        if (r.matches > mostMatches.value) {
            mostMatches = { name: p.nickname, value: r.matches, avatar: p.avatar };
        }
        if (r.deaths < lowestDeaths.value && r.matches > 0) {
            lowestDeaths = { name: p.nickname, value: r.deaths, avatar: p.avatar };
        }
        if (p.stats.streak.type === "win" && p.stats.streak.count > longestStreak.value) {
            longestStreak = { name: p.nickname, value: p.stats.streak.count, type: "win", avatar: p.avatar };
        }
    }

    return {
        bestKD,
        bestHS,
        bestADR,
        mostMatches,
        longestStreak,
        lowestDeaths
    };
}

(async () => {
    console.log("🚀 Starting Faceit Dashboard Update...");

    await api.init();

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

    results.sort((a, b) => b.elo - a.elo);

    const latest = results.map(r => ({ playerId: r.playerId, elo: r.elo }));
    writeJson(RANGE_FILES.latest, latest);

    const updatedTime = DateTime.now().setZone("Europe/Berlin").toFormat("yyyy-MM-dd HH:mm");
    const now = DateTime.now().setZone("Europe/Berlin");

    const findEloAt = (player, dateThreshold) => {
        if (!player.stats.eloHistory || player.stats.eloHistory.length === 0) return player.elo;
        const history = player.stats.eloHistory;
        const thresholdTs = dateThreshold.toSeconds();
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].date <= thresholdTs) {
                return history[i].elo;
            }
        }
        if (history.length > 0) return history[0].elo;
        return player.elo;
    };

    const snapshotData = {};

    for (const range of ["daily", "weekly", "monthly", "yearly"]) {
        const metaPath = path.join(DATA_DIR, `elo-${range}-meta.json`);
        let needsUpdate = true;
        let dataForRange = [];

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
            console.log(`ℹ️ First run for ${range}. Backfilling from history...`);
            let threshold;
            if (range === "daily") threshold = now.startOf("day");
            if (range === "weekly") threshold = now.startOf("week");
            if (range === "monthly") threshold = now.startOf("month");
            if (range === "yearly") threshold = now.startOf("year");

            const backfilledData = results.map(p => {
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

        // Backfill new players missing from this snapshot
        const existingIds = new Set(dataForRange.map(d => d.playerId));
        let backfilled = 0;
        for (const p of results) {
            if (!existingIds.has(p.playerId)) {
                const threshold = getPeriodStart(range);
                const thresholdTs = threshold.toSeconds();
                // If player hasn't played in this period, use current ELO (GAIN = 0)
                // Only use historical ELO if they actually played during this period
                const eloAtStart = (p.lastMatchTs && p.lastMatchTs >= thresholdTs)
                    ? findEloAt(p, threshold)
                    : p.elo;
                dataForRange.push({ playerId: p.playerId, elo: eloAtStart });
                backfilled++;
            }
        }
        if (backfilled > 0) {
            writeJson(RANGE_FILES[range], dataForRange);
        }

        snapshotData[range] = dataForRange;
    }

    // Calculate awards
    const awards = calculateAwards(results);

    // Render HTML with all data
    renderer.render(TEMPLATE_FILE, OUTPUT_FILE, {
        players: results,
        lastUpdated: updatedTime,
        historyData: snapshotData,
        awards
    });

    console.log("✨ Done!");
})();
