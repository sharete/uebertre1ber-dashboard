// Use native fetch in Node 25
const fetch = globalThis.fetch;
const pLimit = (...args) => import("p-limit").then(mod => mod.default(...args));
const cache = require('./cache');

const FACEIT_API_KEY = (process.env.FACEIT_API_KEY || "").trim();
const API_BASE = "https://open.faceit.com/data/v4";

function getHeaders() {
    if (!FACEIT_API_KEY) {
        console.error("❌ Stats: FACEIT_API_KEY is missing/empty!");
    }
    return {
        "Authorization": `Bearer ${FACEIT_API_KEY}`,
        "User-Agent": "FaceitDashboard/1.0",
        "Accept": "application/json",
    };
}

async function retryFetch(url, options = {}, retries = 3, delay = 1000) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, options);
            if (res.ok) return res;

            const errorText = await res.text();
            console.log(`⚠️ API Error ${res.status} for ${url}`); // Debug Log
            console.log(`Body: ${errorText}`); // Log body!

            if (res.status === 404) return null; // Don't retry 404s
            if (res.status === 401 || res.status === 403) {
                console.error("❌ Authentication Error! Check your API Key.");
                return null;
            }

            if (res.status === 429) { // Rate limited
                const retryAfter = res.headers.get('Retry-After');
                const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay * (i + 1);
                console.log(`⏳ Rate limited, waiting ${waitTime}ms...`);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }
        } catch (e) {
            console.error(`Fetch error for ${url}:`, e.message);
        }
        await new Promise(r => setTimeout(r, delay));
    }
    return null;
}

async function safeJson(res) {
    if (!res) return null;
    try {
        const txt = await res.text();
        return JSON.parse(txt);
    } catch {
        return null;
    }
}

class FaceitAPI {
    constructor() {
        this.limit = null;
    }

    async init() {
        this.limit = await pLimit(5);
        if (FACEIT_API_KEY) {
            console.log(`🔑 API Key loaded: ${FACEIT_API_KEY.substring(0, 4)}... (Length: ${FACEIT_API_KEY.length})`);
        } else {
            console.error("❌ NO API KEY FOUND!");
        }
    }

    async getPlayer(nicknameOrId) {
        // Try to determine if it's a UUID or nickname
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nicknameOrId);
        const endpoint = isUUID ? `players/${nicknameOrId}` : `players?nickname=${nicknameOrId}`;

        // console.log(`🔍 Fetching ${endpoint}...`); // Debug Log
        const res = await retryFetch(`${API_BASE}/${endpoint}`, { headers: getHeaders() });
        return safeJson(res);
    }

    async getPlayerHistory(playerId, limit = 30) {
        const res = await retryFetch(`${API_BASE}/players/${playerId}/history?game=cs2&limit=${limit}`, { headers: getHeaders() });
        return safeJson(res) || { items: [] };
    }

    async getPlayerStats(playerId) {
        const res = await retryFetch(`${API_BASE}/players/${playerId}/stats/cs2`, { headers: getHeaders() });
        return safeJson(res) || {};
    }

    async getEloHistory(playerId) {
        // Use internal API for ELO history graph
        // increased size to 100 to allow better backfilling of weekly/monthly stats
        const url = `https://api.faceit.com/stats/v1/stats/time/users/${playerId}/games/cs2?size=100`;
        try {
            const res = await fetch(url); // No headers needed for public internal API usually, or simple headers
            if (res.ok) {
                const data = await res.json();
                // Data format: [ { date: timestamp, elo: number, ... }, ... ]
                return data || [];
            }
        } catch (e) {
            console.error(`Failed to fetch ELO history for ${playerId}:`, e.message);
        }
        return [];
    }

    async getMatchStats(matchId) {
        // Check cache first
        cache.load();
        const cached = cache.data[matchId];
        if (cached) return cached;

        const res = await retryFetch(`${API_BASE}/matches/${matchId}/stats`, { headers: getHeaders() });
        if (!res) return null;

        const data = await safeJson(res);
        if (!data?.rounds) return null;

        // Process and cache the match data
        // We only need the player stats and the score
        const players = data.rounds[0].teams.flatMap(t => t.players);
        const mapStats = {};

        const score = data.rounds[0].round_stats["Score"] || "0 / 0";
        const [a, b] = score.split(" / ").map(Number);
        const roundCount = a + b;

        for (const p of players) {
            mapStats[p.player_id] = {
                ...p.player_stats,
                __rounds: roundCount,
                nickname: p.nickname // Store nickname for display even if they change it
            };
        }

        cache.set(matchId, mapStats);
        cache.save(); // Save immediately or debounced
        return mapStats;
    }

    async getMatchDetails(matchId) {
        // Only needed if we want more details like map, winner team etc that are not in /stats
        // For now getMatchStats seems sufficient for personal stats
        return this.getMatchStats(matchId);
    }
}

module.exports = new FaceitAPI();
