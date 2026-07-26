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
                    matchUrl: `https://www.faceit.com/de/cs2/room/${encodeURIComponent(matchId)}`,
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
                const normalized = {
                    date,
                    elo,
                    eloDiff: rawDiff !== undefined && rawDiff !== "" ? parseInt(rawDiff) : undefined
                };
                const matchId = item.matchId ?? item.match_id;
                const map = item.map ?? item.i1;
                const score = item.score ?? item.i18;
                const rawResult = item.result ?? item.i10;
                if (matchId) {
                    normalized.matchId = String(matchId);
                    normalized.matchUrl = `https://www.faceit.com/de/cs2/room/${encodeURIComponent(matchId)}`;
                }
                if (map) normalized.map = String(map).replace(/^de_/i, "").replace(/\b\w/g, letter => letter.toUpperCase());
                if (score) normalized.score = String(score);
                if (rawResult === "W" || rawResult === "L") normalized.result = rawResult;
                else if (String(rawResult) === "1") normalized.result = "W";
                else if (String(rawResult) === "0") normalized.result = "L";
                return normalized;
            })
            .filter(item => Number.isFinite(item.date) && Number.isFinite(item.elo))
            .sort((a, b) => a.date - b.date)
            .filter((item, index, items) => index === 0 || item.date !== items[index - 1].date)
            .slice(-300);

        // Match the detailed statistics with the closest ELO sample. FACEIT's two
        // endpoints do not always use the exact same second for a completed match.
        for (const match of detailedHistory) {
            const matchDate = Number(match.date);
            const closest = eloHistory.reduce((best, point) => {
                const distance = Math.abs(point.date - matchDate);
                return !best || distance < best.distance ? { point, distance } : best;
            }, null);
            if (closest && closest.distance <= 12 * 60 * 60) {
                match.elo = closest.point.elo;
                match.eloDiff = closest.point.eloDiff;
            }
        }

        let longestWinStreak = 0;
        let currentWinStreak = 0;
        for (const result of [...matchResults].reverse()) {
            currentWinStreak = result === "W" ? currentWinStreak + 1 : 0;
            longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
        }
        const peakPoint = eloHistory.reduce((best, point) => !best || point.elo > best.elo ? point : best, null);
        const currentElo = eloHistory.at(-1)?.elo || 0;
        const bestMap = mapPerformance
            .filter(map => map.map !== "Unknown" && map.matches >= 2)
            .sort((a, b) => b.winrate - a.winrate || parseFloat(b.kd) - parseFloat(a.kd) || b.matches - a.matches)[0] || null;
        let bestThirtyGain = 0;
        for (let index = 0; index < eloHistory.length; index++) {
            const end = eloHistory[Math.min(index + 29, eloHistory.length - 1)];
            bestThirtyGain = Math.max(bestThirtyGain, end.elo - eloHistory[index].elo);
        }

        const personalBests = {
            peakElo: peakPoint?.elo || currentElo,
            peakEloDate: peakPoint?.date || null,
            longestWinStreak,
            bestMap,
            bestThirtyGain
        };

        const expectedMatches = Math.min(MAX_MATCHES, history.length);
        const matchCoverage = expectedMatches ? Math.round((count / expectedMatches) * 100) : 0;
        const latestTimestamp = Math.max(
            Number(history[0]?.finished_at) || 0,
            Number(eloHistory.at(-1)?.date) || 0
        );
        const ageHours = latestTimestamp ? (Date.now() / 1000 - latestTimestamp) / 3600 : Infinity;
        const status = matchCoverage < 70 || eloHistory.length < 2 ? "partial" : ageHours > 72 ? "stale" : "fresh";
        const dataQuality = {
            status,
            label: status === "fresh" ? "Aktuell" : status === "stale" ? "Veraltet" : "Teilweise",
            matchCoverage,
            eloSamples: eloHistory.length,
            latestTimestamp
        };

        const recentElo = eloHistory.slice(-10);
        const recentGain = recentElo.length >= 2 ? recentElo.at(-1).elo - recentElo[0].elo : 0;
        const insights = [];
        if (streak.type === "loss" && streak.count >= 3) insights.push({ type: "warning", icon: "↘", title: "Negativserie", text: `${streak.count} Niederlagen in Folge` });
        if (streak.type === "win" && streak.count >= 3) insights.push({ type: "positive", icon: "↗", title: "Heißer Lauf", text: `${streak.count} Siege in Folge` });
        if (currentElo && personalBests.peakElo - currentElo <= 5) insights.push({ type: "peak", icon: "◆", title: "Peak-Alarm", text: `${currentElo} ELO · persönlicher Bestwert` });
        if (recentGain >= 80) insights.push({ type: "positive", icon: "↑", title: "Starker Trend", text: `+${recentGain} ELO in 10 Matches` });
        if (recentGain <= -80) insights.push({ type: "warning", icon: "↓", title: "Formtief", text: `${recentGain} ELO in 10 Matches` });
        if (bestMap) insights.push({ type: "map", icon: "⌖", title: "Beste Map", text: `${bestMap.map} · ${bestMap.winrate}% Winrate` });

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
            mapPerformance,
            personalBests,
            dataQuality,
            insights
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
            mapPerformance: [],
            personalBests: { peakElo: 0, peakEloDate: null, longestWinStreak: 0, bestMap: null, bestThirtyGain: 0 },
            dataQuality: { status: "partial", label: "Teilweise", matchCoverage: 0, eloSamples: 0, latestTimestamp: 0 },
            insights: []
        };
    }
}

module.exports = new StatsCalculator();
