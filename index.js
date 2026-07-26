const fs = require('fs');
const path = require('path');
const { DateTime } = require("luxon");

const api = require('./src/api');
const stats = require('./src/stats');
const renderer = require('./src/renderer');
const { normalizeMapName } = require('./src/map_utils');
const notifier = require('./src/notifier');

const PLAYERS_FILE = "players.txt";
const DATA_DIR = path.join(__dirname, "data");
const NOTIFICATION_STATE_FILE = path.join(DATA_DIR, "discord_state.json");
const HISTORY_CACHE_FILE = path.join(DATA_DIR, "history-cache.json");
const TEMPLATE_FILE = "index.template.html";
const OUTPUT_FILE = "index.html";
const MAX_MATCHES = 30;

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

function loadHistoryCache() {
    if (fs.existsSync(HISTORY_CACHE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(HISTORY_CACHE_FILE, "utf-8"));
        } catch (e) {
            console.error("⚠️ Failed to load history cache:", e.message);
        }
    }
    return {};
}

function saveHistoryCache(cache) {
    try {
        fs.writeFileSync(HISTORY_CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e) {
        console.error("⚠️ Failed to save history cache:", e.message);
    }
}

async function processPlayer(playerId, historyCache) {
    try {
        const [profile, history, playerStats, freshEloHistory] = await Promise.all([
            api.getPlayer(playerId),
            api.getPlayerHistory(playerId, 30),
            api.getPlayerStats(playerId),
            api.getEloHistory(playerId)
        ]);

        if (!profile || !profile.player_id) {
            console.error(`❌ Profile not found for ${playerId}`);
            return null;
        }

        const currentElo = profile.games?.cs2?.faceit_elo || null;
        if (!currentElo) return null;

        // --- Elo History Logic ---
        let eloHistoryData = historyCache[playerId] || [];
        
        // 2. Decide if we should try to seed/update history
        // We update if:
        // - Cache is empty (new player)
        // - Cache is short (< 30 entries)
        // - or occasionally to keep it fresh/calibrated with the internal API
        const needsSeeding = eloHistoryData.length < 100;

        if (freshEloHistory && freshEloHistory.length > 0) {
            if (needsSeeding || freshEloHistory.length >= eloHistoryData.length) {
                // For new players or if fresh history covers more ground, just use it
                eloHistoryData = freshEloHistory;
            } else {
                // Merge fresh points that we don't have yet
                const existingDates = new Set(eloHistoryData.map(h => h.date));
                const newPoints = freshEloHistory.filter(h => !existingDates.has(h.date));
                if (newPoints.length > 0) {
                    eloHistoryData = [...eloHistoryData, ...newPoints].sort((a, b) => a.date - b.date);
                }
            }
            historyCache[playerId] = eloHistoryData;
        } else if (currentElo) {
            // 3. If fresh history failed (Cloudflare block), append the current Elo to the existing cache
            const lastTs = history.items[0]?.finished_at;
            const nowTs = lastTs ? lastTs * 1000 : Date.now();
            
            const alreadyExists = eloHistoryData.some(h => Math.abs(h.date - nowTs) < 60000); // within 1 minute
            
            if (!alreadyExists) {
                eloHistoryData.push({
                    date: nowTs,
                    elo: String(currentElo)
                });
                historyCache[playerId] = eloHistoryData;
            }
            
            if (eloHistoryData.length === 1) {
                console.warn(`⚠️ Only 1 Elo data point for ${profile.nickname}. History fetch likely blocked by Cloudflare.`);
            }
        }
        
        // Keep history at reasonable size
        if (eloHistoryData.length > 300) eloHistoryData = eloHistoryData.slice(-300);
        historyCache[playerId] = eloHistoryData;

        // Fetch match stats for all matches in history
        const matchStatsMap = {};
        for (const item of history.items) {
        let ms = await api.getMatchStats(item.match_id);
            if (!ms) {
                // Fallback: Create placeholder so stats.js doesn't skip the match entirely (for Teammates logic)
                ms = { __mapName: "Unknown" };
                
                // Try to get map name from details if stats failed
                try {
                    const details = await api.getMatchDetails(item.match_id);
                    if (details && details.voting && details.voting.map && details.voting.map.pick && details.voting.map.pick.length > 0) {
                        ms.__mapName = normalizeMapName(details.voting.map.pick[0]);
                    }
                } catch (e) {
                    console.error(`Failed to fetch match details for fallback: ${item.match_id}`, e.message);
                }
            } else {
                // MS exists (it's the mapStats object from api.js)
                let mapName = ms.__mapName;
                
                if (!mapName || mapName === "Unknown") {
                     // Try fetching full match details if map is unknown
                     try {
                         const details = await api.getMatchDetails(item.match_id);
                         if (details && details.voting && details.voting.map && details.voting.map.pick && details.voting.map.pick.length > 0) {
                             mapName = details.voting.map.pick[0];
                         }
                     } catch (e) {}
                     ms.__mapName = mapName || "Unknown";
                }
                // Normalize it
                ms.__mapName = normalizeMapName(ms.__mapName);
            }
            matchStatsMap[item.match_id] = ms;
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
            elo: currentElo,
            level: profile.games?.cs2?.skill_level || 0,
            faceitUrl: url,
            winrate: playerStats.lifetime ? playerStats.lifetime["Win Rate %"] + "%" : "—",
            matches: playerStats.lifetime ? playerStats.lifetime["Matches"] : "—",
            lastMatch,
            lastMatchTs,
            latestMatchId: history.items[0]?.match_id || null,
            latestMatchResult: calculatedStats.last5[0] || null,
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
    let bestWinrate = { name: "—", value: 0 };
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
        if (r.winratePct > bestWinrate.value && r.matches > 0) {
            bestWinrate = { name: p.nickname, value: r.winratePct, avatar: p.avatar };
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
        bestWinrate,
        longestStreak,
        lowestDeaths
    };
}

(async () => {
    console.log("🚀 Starting Faceit Dashboard Update...");

    await api.init();

    // Load notification state
    let notificationState = { lastRunTs: 0, players: {} };
    let isMigration = false;
    let isBrandNew = true;

    if (fs.existsSync(NOTIFICATION_STATE_FILE)) {
        isBrandNew = false;
        try {
            const data = JSON.parse(fs.readFileSync(NOTIFICATION_STATE_FILE, "utf-8"));
            if (data.players) {
                notificationState = data;
            } else {
                // Migration from old format (only players map)
                notificationState = { lastRunTs: 0, players: data };
                isMigration = true;
            }
        } catch (e) {
            console.error("⚠️ Failed to load notification state:", e.message);
        }
    }

    const runStartTimeTs = Math.floor(Date.now() / 1000);
    let comparisonTs = notificationState.lastRunTs;

    if (isBrandNew) {
        console.log("ℹ️ Brand new installation. Using 24h fallback for initial seeding.");
        comparisonTs = runStartTimeTs - 24 * 3600; 
    } else if (isMigration || comparisonTs === 0) {
        console.log("ℹ️ Migrating to time-based tracking. Using 24h fallback for this run.");
        // Allow matches from the last 24h during migration transition
        comparisonTs = runStartTimeTs - 24 * 3600;
    }

    const lines = fs.readFileSync(PLAYERS_FILE, "utf-8")
        .trim()
        .split("\n")
        .map(l => l.split(/#|\/\//)[0].trim())
        .filter(Boolean);

    const historyCache = loadHistoryCache();

    console.log(`ℹ️ Processing ${lines.length} players...`);

    const results = [];
    for (let i = 0; i < lines.length; i++) {
        const id = lines[i];
        console.log(`  ⏳ Processing ${i + 1}/${lines.length}: ${id.substring(0, 8)}...`);
        const p = await processPlayer(id, historyCache);
        if (p) {
            results.push(p);

            // Discord Notification Logic
            const lastSavedMatchId = notificationState.players[p.playerId];
            
            // Find all new matches
            let newMatches = [];
            if (p.stats.matchHistory && p.stats.matchHistory.length > 0) {
                if (lastSavedMatchId) {
                    const lastIdx = p.stats.matchHistory.findIndex(m => m.matchId === lastSavedMatchId);
                    if (lastIdx > 0) {
                        // Matches from 0 up to lastIdx - 1 are new
                        newMatches = p.stats.matchHistory.slice(0, lastIdx);
                    } else if (lastIdx === -1) {
                        // Fallback if match fell out of history
                        newMatches = p.stats.matchHistory.filter(m => m.date > comparisonTs);
                    }
                } else {
                    newMatches = p.stats.matchHistory.filter(m => m.date > comparisonTs);
                }
            }

            if (newMatches.length > 0) {
                // Process oldest new match first for chronological notifications
                newMatches.reverse();
                
                let lastSuccessfullyHandledId = lastSavedMatchId;

                for (const matchStats of newMatches) {
                    const matchTs = matchStats.date;
                    const isAfterThreshold = matchTs > comparisonTs;
                    const ageH = Math.round((runStartTimeTs - matchTs) / 3600);

                    // We allow matches slightly older than comparisonTs if they are decidedly new (came after lastSavedMatchId) and < 24h
                    if (isAfterThreshold || (lastSavedMatchId && ageH <= 24)) {
                        console.log(`🔔 Sending notification for ${p.nickname}: ${matchStats.matchId}`);
                        
                        // Calculate Elo Diff
                        let eloDiff = undefined;
                        let matchElo = p.elo; // fallback to current Elo
                        
                        const eloHist = p.stats.eloHistory; // newest first
                        // Find the corresponding Elo entry for this exact match time (+/- 1h)
                        const closestEloEntry = eloHist.find(e => e.date >= matchTs - 3600 && e.date <= matchTs + 3600);
                        
                        if (closestEloEntry) {
                            matchElo = closestEloEntry.elo;
                            eloDiff = closestEloEntry.eloDiff;
                        }

                        // Detect Dashboard Teammates in this specific match
                        const matchDetails = await api.getMatchDetails(matchStats.matchId);
                        const dashboardTeammates = [];
                        if (matchDetails && matchDetails.teams) {
                            const allPlayersInMatch = Object.values(matchDetails.teams).flatMap(t => t.roster);
                            for (const pm of allPlayersInMatch) {
                                if (pm.nickname === p.nickname) continue;
                                // Check if this player is in our players list
                                if (lines.includes(pm.player_id)) {
                                    dashboardTeammates.push(pm.nickname);
                                }
                            }
                        }

                        await notifier.sendMatchNotification({ ...p, elo: matchElo }, {
                            ...matchStats,
                            eloDiff,
                            teammates: dashboardTeammates
                        });
                        
                        lastSuccessfullyHandledId = matchStats.matchId;
                    } else {
                        console.log(`ℹ️ Match ${matchStats.matchId} for ${p.nickname} is before threshold (${ageH}h old). Skipping.`);
                        if (ageH > 24) {
                            lastSuccessfullyHandledId = matchStats.matchId;
                        }
                    }
                }
                
                // Update final handled ID
                if (lastSuccessfullyHandledId) {
                    notificationState.players[p.playerId] = lastSuccessfullyHandledId;
                }
            }
        }
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

        // Repair & backfill: ensure all players have correct snapshot values
        const snapshotMap = new Map(dataForRange.map(d => [d.playerId, d]));
        const threshold = getPeriodStart(range);
        const thresholdTs = threshold.toSeconds();
        let changed = false;

        for (const p of results) {
            const playedInPeriod = p.lastMatchTs && p.lastMatchTs >= thresholdTs;
            const correctElo = playedInPeriod ? findEloAt(p, threshold) : p.elo;

            const existing = snapshotMap.get(p.playerId);
            if (!existing) {
                // New player — add to snapshot
                dataForRange.push({ playerId: p.playerId, elo: correctElo });
                changed = true;
            } else if (!playedInPeriod && existing.elo !== p.elo) {
                // Inactive player with stale value — fix to current ELO (GAIN = 0)
                existing.elo = p.elo;
                changed = true;
            }
        }
        if (changed) {
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

    // Update lastRunTs to the time we started processing
    notificationState.lastRunTs = runStartTimeTs;

    // Save notification state
    fs.writeFileSync(NOTIFICATION_STATE_FILE, JSON.stringify(notificationState, null, 2));

    // Save history cache
    saveHistoryCache(historyCache);

    console.log("✨ Done!");
})();
