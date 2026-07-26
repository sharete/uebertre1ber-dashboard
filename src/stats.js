const { DateTime } = require("luxon");

/** Maximum number of matches to analyze for stats */
const MAX_MATCHES = 30;

class StatsCalculator {
    /**
     * Calculates comprehensive stats for a player from their match history.
     * @param {string} playerId - FACEIT player UUID
     * @param {Array} history - Array of match history items (newest first)
     * @param {object} matchStatsMap - Map of matchId → per-player stats
     * @param {Array} externalEloHistory - Raw ELO history from FACEIT API
     * @returns {object} Calculated stats: recent, teammates, eloHistory, matchHistory, streak, last5, mapPerformance
     */
    calculatePlayerStats(playerId, history, matchStatsMap, externalEloHistory) {
        if (!playerId || !history || !matchStatsMap) {
            return this._emptyStats();
        }
        let kills = 0, deaths = 0, assists = 0, adrTotal = 0, hs = 0, count = 0, rounds = 0;

        // For teammates analysis
        const teammateCounts = {};
        const teammateWins = {};
        const teammateLosses = {};
        const teammateInfo = {};

        // For map performance
        const mapData = {};

        // For last 5 results & streak
        const matchResults = []; // ordered newest → oldest
        const detailedHistory = []; // For Heatmap

        for (const match of history) {
            const matchId = match.match_id;
            const stats = matchStatsMap[matchId];
            if (!stats) continue;

            const playerStats = stats[playerId];

            // Personal Stats
            if (playerStats) {
                kills += +playerStats.Kills || 0;
                deaths += +playerStats.Deaths || 0;
                assists += +playerStats.Assists || 0;
                adrTotal += +playerStats.ADR || 0;
                hs += +playerStats.Headshots || 0;
                if (typeof playerStats.__rounds === "number") rounds += playerStats.__rounds;
                count++;
            }

            // Map Performance
            const mapName = stats.__mapName || "Unknown";
            if (!mapData[mapName]) {
                mapData[mapName] = { wins: 0, losses: 0, kills: 0, deaths: 0, matches: 0 };
            }

            // Determine win/loss for this match
            const teams = match.teams;
            const winner = match.results?.winner;
            let didWin = false;

            if (teams && winner) {
                for (const [side, team] of Object.entries(teams)) {
                    const members = team.players || [];
                    if (!members.some(p => p.player_id === playerId)) continue;
                    didWin = (side === winner);

                    // Teammate Stats
                    for (const p of members) {
                        if (p.player_id === playerId) continue;

                        teammateCounts[p.player_id] = (teammateCounts[p.player_id] || 0) + 1;
                        if (didWin) {
                            teammateWins[p.player_id] = (teammateWins[p.player_id] || 0) + 1;
                        } else {
                            teammateLosses[p.player_id] = (teammateLosses[p.player_id] || 0) + 1;
                        }

                        if (!teammateInfo[p.player_id]) {
                            teammateInfo[p.player_id] = {
                                nickname: p.nickname,
                                url: (p.faceit_url || "").replace("{lang}", "de"),
                                avatar: p.avatar
                            };
                        }
                    }
                    break;
                }
            }

            // Track match result
            matchResults.push(didWin ? "W" : "L");

            // Track detailed match history for Heatmap
            if (playerStats) {
                const mKills = +playerStats.Kills || 0;
                const mDeaths = +playerStats.Deaths || 0;
                const mKD = mDeaths ? (mKills / mDeaths).toFixed(2) : (mKills > 0 ? "10.0" : "0.00");
                
                detailedHistory.push({
                    matchId: matchId,
                    date: match.finished_at,
                    kd: mKD,
                    result: didWin ? "W" : "L",
                    map: mapName,
                    score: stats.__score || "0 - 0",
                    kills: mKills,
                    deaths: mDeaths,
                    assists: +playerStats.Assists || 0,
                    adr: +playerStats.ADR || 0,
                    hsPercent: playerStats["Headshots %"] || (mKills ? Math.round((+playerStats.Headshots || 0) / mKills * 100) : 0),
                    mvps: +playerStats.MVPs || 0
                });
            }

            // Map stats accumulation
            // We now include "Unknown" maps so the total match count in the table sums up to 30 (or whatever the history limit is)
            mapData[mapName].matches++;
            if (didWin) mapData[mapName].wins++;
            else mapData[mapName].losses++;
            
            if (playerStats) {
                mapData[mapName].kills += +playerStats.Kills || 0;
                mapData[mapName].deaths += +playerStats.Deaths || 0;
            }
        }

        // Aggregate Personal Stats
        const wins = matchResults.filter(r => r === "W").length;
        const recentStats = {
            kills,
            assists,
            deaths,
            wins,
            kd: count && deaths ? (kills / deaths).toFixed(2) : "0.00",
            adr: count ? (adrTotal / count).toFixed(1) : "0.0",
            hsPercent: kills ? Math.round((hs / kills) * 100) + "%" : "0%",
            kr: rounds ? (kills / rounds).toFixed(2) : "0.00",
            matches: count,
            winratePct: count ? Math.round((wins / count) * 100) : 0
        };

        // Win/Loss Streak (from most recent match)
        let streak = { type: "none", count: 0 };
        if (matchResults.length > 0) {
            const first = matchResults[0];
            let streakCount = 0;
            for (const r of matchResults) {
                if (r === first) streakCount++;
                else break;
            }
            streak = { type: first === "W" ? "win" : "loss", count: streakCount };
        }

        // Last 5 results
        const last5 = matchResults.slice(0, 5);

        // Map Performance (sorted by matches played, descending)
        const mapPerformance = Object.entries(mapData)
            .map(([map, d]) => ({
                map,
                wins: d.wins,
                losses: d.losses,
                matches: d.matches,
                winrate: d.matches ? Math.round((d.wins / d.matches) * 100) : 0,
                kd: d.deaths ? (d.kills / d.deaths).toFixed(2) : "0.00"
            }))
            .sort((a, b) => b.matches - a.matches);

        // ELO History
        const eloHistory = (externalEloHistory || [])
            .map(item => {
                const rawDate = Number(item.date ?? item.created_at ?? item.updated_at);
                const date = rawDate > 1e12 ? Math.floor(rawDate / 1000) : Math.floor(rawDate);
                const elo = parseInt(item.elo ?? item.i20);
                const rawDiff = item.elo_delta ?? item.eloDiff;
                return {
                    date,
                    elo,
                    eloDiff: rawDiff !== undefined && rawDiff !== "" ? parseInt(rawDiff) : undefined
                };
            })
            .filter(item => Number.isFinite(item.date) && Number.isFinite(item.elo))
            .sort((a, b) => a.date - b.date)
            .filter((item, index, items) => index === 0 || item.date !== items[index - 1].date)
            .slice(-300);

        // Aggregate Teammate Stats
        const teammates = Object.entries(teammateCounts).map(([id, cnt]) => {
            const { nickname, url, avatar } = teammateInfo[id] || {};
            const wins = teammateWins[id] || 0;
            const losses = teammateLosses[id] || 0;
            return {
                playerId: id,
                nickname: nickname || "—",
                url: url || "#",
                avatar,
                count: cnt,
                wins,
                losses,
                winratePct: cnt ? Math.round((wins / cnt) * 100) : 0,
                winrate: cnt ? `${Math.round((wins / cnt) * 100)}%` : "—",
            };
        }).filter(p => p.nickname && p.nickname !== "—");

        return {
            recent: recentStats,
            teammates,
            eloHistory,
            matchHistory: detailedHistory, // Heatmap Data
            streak,
            last5,
            mapPerformance
        };
    }

    /** Returns an empty stats object for error/edge cases */
    _emptyStats() {
        return {
            recent: { kills: 0, assists: 0, deaths: 0, wins: 0, kd: "0.00", adr: "0.0", hsPercent: "0%", kr: "0.00", matches: 0, winratePct: 0 },
            teammates: [],
            eloHistory: [],
            matchHistory: [],
            streak: { type: "none", count: 0 },
            last5: [],
            mapPerformance: []
        };
    }
}

module.exports = new StatsCalculator();
