// Use native fetch in Node 18+
const fetch = globalThis.fetch;
const pLimit = (...args) => import("p-limit").then(mod => mod.default(...args));
const cache = require('./cache');

const FACEIT_API_KEY = (process.env.FACEIT_API_KEY || "").trim();
const API_BASE = "https://open.faceit.com/data/v4";
const REQUEST_TIMEOUT_MS = 15000;

/** @returns {object} HTTP headers with authorization */
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

/**
 * Fetch with retry logic, rate limiting, and timeout.
 * @param {string} url - Request URL
 * @param {object} options - Fetch options
 * @param {number} retries - Max retry count
 * @param {number} delay - Base delay between retries (ms)
 * @returns {Promise<Response|null>}
 */
async function retryFetch(url, options = {}, retries = 3, delay = 1000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    options.signal = controller.signal;

    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, options);
            clearTimeout(timeout);
            if (res.ok) return res;

            if (res.status === 404) return null;
            if (res.status === 401 || res.status === 403) {
                console.error("❌ Authentication Error! Check your API Key.");
                return null;
            }

            if (res.status === 429) {
                const retryAfter = res.headers.get('Retry-After');
                const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay * (i + 1);
                console.log(`⏳ Rate limited, waiting ${waitTime}ms...`);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                console.error(`⏱️ Request timeout for ${url}`);
            } else {
                console.error(`Fetch error for ${url}:`, e.message);
            }
        }
        await new Promise(r => setTimeout(r, delay));
    }
    clearTimeout(timeout);
    return null;
}

/**
 * Safely parses JSON from a response.
 * @param {Response|null} res - Fetch response
 * @returns {Promise<object|null>}
 */
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
        /** @type {Function|null} */
        this.limit = null;
    }

    /** Initializes concurrency limiter and validates API key */
    async init() {
        this.limit = await pLimit(5);
        if (FACEIT_API_KEY) {
            console.log(`🔑 API Key loaded: ${FACEIT_API_KEY.substring(0, 4)}... (Length: ${FACEIT_API_KEY.length})`);
        } else {
            console.error("❌ NO API KEY FOUND!");
        }
    }

    /**
     * Fetches a player profile by nickname or UUID.
     * @param {string} nicknameOrId - FACEIT nickname or player UUID
     * @returns {Promise<object|null>}
     */
    async getPlayer(nicknameOrId) {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nicknameOrId);
        const endpoint = isUUID ? `players/${nicknameOrId}` : `players?nickname=${nicknameOrId}`;
        const res = await retryFetch(`${API_BASE}/${endpoint}`, { headers: getHeaders() });
        return safeJson(res);
    }

    /**
     * Fetches player match history.
     * @param {string} playerId - Player UUID
     * @param {number} limit - Max matches to fetch
     * @returns {Promise<object>}
     */
    async getPlayerHistory(playerId, limit = 30) {
        const res = await retryFetch(`${API_BASE}/players/${playerId}/history?game=cs2&limit=${limit}`, { headers: getHeaders() });
        return safeJson(res) || { items: [] };
    }

    /**
     * Fetches full match details.
     * @param {string} matchId - Match UUID
     * @returns {Promise<object|null>}
     */
    async getMatchDetails(matchId) {
        const res = await retryFetch(`${API_BASE}/matches/${matchId}`, { headers: getHeaders() });
        return safeJson(res);
    }

    /**
     * Fetches lifetime player stats for CS2.
     * @param {string} playerId - Player UUID
     * @returns {Promise<object>}
     */
    async getPlayerStats(playerId) {
        const res = await retryFetch(`${API_BASE}/players/${playerId}/stats/cs2`, { headers: getHeaders() });
        return safeJson(res) || {};
    }

    /**
     * Fetches ELO history from the FACEIT stats API.
     * Uses curl to bypass Cloudflare protection if fetch is blocked.
     * @param {string} playerId - Player UUID
     * @returns {Promise<Array>}
     */
    async getEloHistory(playerId) {
        const url = `https://api.faceit.com/stats/v1/stats/time/users/${playerId}/games/cs2?size=100`;
        const { execSync } = require('child_process');
        
        try {
            // We use curl because native node-fetch/undici is often blocked by Cloudflare JA3 fingerprinting
            // In GitHub Actions, we use browser-like headers. 
            // NOTE: We do NOT use the Developer API key here as this is the internal stats API.
            const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
            
            const command = `curl -s -L --compressed \
                -H "User-Agent: ${browserUA}" \
                -H "Accept: application/json, text/plain, */*" \
                -H "Accept-Language: en-US,en;q=0.9" \
                -H "Referer: https://www.faceit.com/en/players/${playerId}/stats/cs2" \
                -H "Origin: https://www.faceit.com" \
                -H "Sec-Fetch-Dest: empty" \
                -H "Sec-Fetch-Mode: cors" \
                -H "Sec-Fetch-Site: same-site" \
                "${url}"`;
            
            const output = execSync(command, { encoding: 'utf8' }).trim();
            if (!output) return [];
            
            // Validate if it's actually JSON before parsing
            if (!output.startsWith('[') && !output.startsWith('{')) {
                if (output.includes("Just a moment")) {
                    console.warn(`⚠️ Cloudflare challenge detected for ${playerId}.`);
                } else {
                    console.error(`❌ Received non-JSON response for ${playerId}. First 100 chars: ${output.substring(0, 100)}`);
                }
                return [];
            }

            const data = JSON.parse(output);
            if (Array.isArray(data) && data.length > 0) {
                console.log(`✅ Fetched ${data.length} Elo history items for ${playerId}`);
            }
            return data || [];
        } catch (e) {
            console.error(`❌ Failed to fetch ELO history for ${playerId} via curl:`, e.message);
        }
        return [];
    }

    /**
     * Fetches and caches match stats (per-player stats + map name).
     * @param {string} matchId - Match UUID
     * @returns {Promise<object|null>}
     */
    async getMatchStats(matchId) {
        // Check cache first
        cache.load();
        const cached = cache.data[matchId];
        if (cached) return cached;

        const res = await retryFetch(`${API_BASE}/matches/${matchId}/stats`, { headers: getHeaders() });
        if (!res) return null;

        const data = await safeJson(res);
        if (!data?.rounds) return null;

        const round = data.rounds[0];
        const players = round.teams.flatMap(t => t.players);
        const mapStats = {};

        const score = round.round_stats["Score"] || "0 / 0";
        const [a, b] = score.split(" / ").map(Number);
        const roundCount = a + b;
        const mapName = round.round_stats["Map"] || "Unknown";

        for (const p of players) {
            mapStats[p.player_id] = {
                ...p.player_stats,
                __rounds: roundCount,
                nickname: p.nickname
            };
        }

        // Store map name and score at top level so stats.js can access it
        mapStats.__mapName = mapName;
        mapStats.__score = score;

        cache.set(matchId, mapStats);
        cache.save();
        return mapStats;
    }
}

module.exports = new FaceitAPI();
