const { DateTime } = require("luxon");

class StatsCalculator {
    calculatePlayerStats(playerId, history, matchStatsMap, externalEloHistory) {
        let kills = 0, deaths = 0, assists = 0, adrTotal = 0, hs = 0, count = 0, rounds = 0;

        // For teammates analysis
        const teammateCounts = {};
        const teammateWins = {};
        const teammateLosses = {};
        const teammateInfo = {};

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

            // Teammate Stats
            // We need the match details from history to see who was in the team
            // The /stats endpoint gives us all players in the server, but not grouped by team in the simplified map we cached.
            // Wait, the history endpoint `teams` object has the lineup.
            const teams = match.teams;
            const winner = match.results?.winner;
            if (!teams || !winner) continue;

            for (const [side, team] of Object.entries(teams)) {
                const members = team.players || [];
                // Check if our player is in this team
                if (!members.some(p => p.player_id === playerId)) continue;

                // This is our team
                const won = (side === winner);

                for (const p of members) {
                    if (p.player_id === playerId) continue;

                    teammateCounts[p.player_id] = (teammateCounts[p.player_id] || 0) + 1;
                    if (won) {
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
                break; // Found our team, stop checking
            }
        }

        // Aggregate Personal Stats
        const recentStats = {
            kills,
            assists,
            deaths,
            kd: count && deaths ? (kills / deaths).toFixed(2) : "0.00",
            adr: count ? (adrTotal / count).toFixed(1) : "0.0",
            hsPercent: kills ? Math.round((hs / kills) * 100) + "%" : "0%",
            kr: rounds ? (kills / rounds).toFixed(2) : "0.00",
            matches: count
        };

        // ELO History
        // Use the data fetched from internal API
        // Format of internal API: [{ date: 17...000, elo: "2500", ... }]
        const eloHistory = (externalEloHistory || [])
            .map(item => ({
                date: Math.floor(item.date / 1000),
                elo: parseInt(item.elo)
            }))
            .filter(item => !isNaN(item.date) && !isNaN(item.elo))
            .reverse();
        // Actually api.faceit.com/stats/v1/stats/time/users/... returns array.
        // Let's assume input is correct.
        // Verify format: data is array of objects.

        // Use external data if available, otherwise empty (fallback failed previously)



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
            teammates: teammates,
            eloHistory: eloHistory
        };
    }
}

module.exports = new StatsCalculator();
