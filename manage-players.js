#!/usr/bin/env node
// manage-players.js — Add, remove, or list FACEIT players by nickname
// Usage:
//   FACEIT_API_KEY=xxx node manage-players.js add <nickname>
//   FACEIT_API_KEY=xxx node manage-players.js remove <nickname>
//   node manage-players.js list

const fs = require("fs");
const path = require("path");

const PLAYERS_FILE = path.join(__dirname, "players.txt");
const API_BASE = "https://open.faceit.com/data/v4";
const API_KEY = (process.env.FACEIT_API_KEY || "").trim();

// ─── Helpers ───────────────────────────────────────────────

function getHeaders() {
    return {
        Authorization: `Bearer ${API_KEY}`,
        "User-Agent": "FaceitDashboard/1.0",
        Accept: "application/json",
    };
}

async function fetchPlayer(nickname) {
    const url = `${API_BASE}/players?nickname=${encodeURIComponent(nickname)}`;
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) return null;
    return res.json();
}

function readPlayers() {
    if (!fs.existsSync(PLAYERS_FILE)) return [];
    return fs
        .readFileSync(PLAYERS_FILE, "utf-8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
            const [id, ...rest] = line.split("#");
            return {
                id: id.trim(),
                comment: rest.join("#").trim(),
                raw: line,
            };
        });
}

function writePlayers(players) {
    const content = players.map((p) => `${p.id} # ${p.comment}`).join("\n") + "\n";
    fs.writeFileSync(PLAYERS_FILE, content, "utf-8");
}

// ─── Commands ──────────────────────────────────────────────

async function addPlayer(nickname) {
    if (!API_KEY) {
        console.error("❌ FACEIT_API_KEY ist nicht gesetzt!");
        console.error("   Nutzung: FACEIT_API_KEY=xxx node manage-players.js add <nickname>");
        process.exit(1);
    }

    console.log(`🔍 Suche Spieler "${nickname}" auf FACEIT...`);

    const player = await fetchPlayer(nickname);
    if (!player || !player.player_id) {
        console.error(`❌ Spieler "${nickname}" wurde auf FACEIT nicht gefunden.`);
        process.exit(1);
    }

    const { player_id, nickname: realNick, games, country } = player;
    const cs2 = games?.cs2;

    console.log(`✅ Gefunden: ${realNick}`);
    console.log(`   🆔 ID:      ${player_id}`);
    console.log(`   🌍 Land:    ${country?.toUpperCase() || "?"}`);
    if (cs2) {
        console.log(`   🎮 CS2:     Level ${cs2.skill_level} — ${cs2.faceit_elo} ELO`);
    } else {
        console.log(`   ⚠️  Kein CS2-Profil gefunden (wird trotzdem hinzugefügt)`);
    }

    // Check for duplicates
    const existing = readPlayers();
    const dup = existing.find((p) => p.id === player_id);
    if (dup) {
        console.log(`\n⚠️  "${realNick}" ist bereits im Dashboard! (${dup.comment})`);
        process.exit(0);
    }

    // Add player
    existing.push({ id: player_id, comment: realNick });
    writePlayers(existing);

    console.log(`\n🎉 "${realNick}" wurde zum Dashboard hinzugefügt!`);
    console.log(`   📄 ${PLAYERS_FILE}`);
    console.log(`   → Insgesamt ${existing.length} Spieler im Dashboard`);
}

async function removePlayer(nickname) {
    const existing = readPlayers();
    const lower = nickname.toLowerCase();

    // 1. Try local match by comment or UUID
    let idx = existing.findIndex(
        (p) =>
            p.comment.toLowerCase() === lower ||
            p.id.toLowerCase() === lower
    );

    // 2. If not found locally, try resolving via API (handles renamed players)
    if (idx === -1 && API_KEY) {
        console.log(`🔍 Lokal nicht gefunden, suche "${nickname}" auf FACEIT...`);
        const player = await fetchPlayer(nickname);
        if (player && player.player_id) {
            idx = existing.findIndex((p) => p.id === player.player_id);
            if (idx !== -1) {
                console.log(`✅ Gefunden! Spieler hat sich umbenannt: ${existing[idx].comment} → ${player.nickname}`);
            }
        }
    }

    if (idx === -1) {
        console.error(`❌ Spieler "${nickname}" nicht im Dashboard gefunden.`);
        console.log("\n📋 Aktuelle Spieler:");
        existing.forEach((p) => console.log(`   • ${p.comment} (${p.id})`));
        process.exit(1);
    }

    const removed = existing.splice(idx, 1)[0];
    writePlayers(existing);

    console.log(`🗑️  "${removed.comment}" wurde aus dem Dashboard entfernt.`);
    console.log(`   🆔 ${removed.id}`);
    console.log(`   → Verbleibend: ${existing.length} Spieler`);
}

async function listPlayers(sync = false) {
    const players = readPlayers();

    if (players.length === 0) {
        console.log("📋 Keine Spieler im Dashboard.");
        return;
    }

    // Sync nicknames via API if requested
    if (sync) {
        if (!API_KEY) {
            console.error("❌ FACEIT_API_KEY wird für --sync benötigt!");
            process.exit(1);
        }
        console.log(`🔄 Synchronisiere Nicknames für ${players.length} Spieler...\n`);
        let updated = 0;
        for (const p of players) {
            try {
                const url = `${API_BASE}/players/${p.id}`;
                const res = await fetch(url, { headers: getHeaders() });
                if (res.ok) {
                    const data = await res.json();
                    if (data.nickname && data.nickname !== p.comment) {
                        console.log(`   🔄 ${p.comment} → ${data.nickname}`);
                        p.comment = data.nickname;
                        updated++;
                    }
                }
            } catch { /* skip */ }
        }
        if (updated > 0) {
            writePlayers(players);
            console.log(`\n✅ ${updated} Nickname(s) aktualisiert!\n`);
        } else {
            console.log(`   ✅ Alle Nicknames sind aktuell!\n`);
        }
    }

    console.log(`📋 Dashboard Spieler (${players.length}):\n`);
    console.log("   #  Nickname            UUID");
    console.log("   ─  ──────────────────  ────────────────────────────────────");
    players.forEach((p, i) => {
        const num = String(i + 1).padStart(2, " ");
        const nick = (p.comment || "???").padEnd(18, " ");
        console.log(`   ${num}  ${nick}  ${p.id}`);
    });
    console.log("");
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
    const [, , action, ...args] = process.argv;
    const nickname = args.join(" ");

    switch (action) {
        case "add":
            if (!nickname) {
                console.error("❌ Nutzung: node manage-players.js add <nickname>");
                process.exit(1);
            }
            await addPlayer(nickname);
            break;

        case "remove":
        case "rm":
        case "delete":
            if (!nickname) {
                console.error("❌ Nutzung: node manage-players.js remove <nickname>");
                process.exit(1);
            }
            await removePlayer(nickname);
            break;

        case "list":
        case "ls":
            await listPlayers(process.argv.includes("--sync"));
            break;

        default:
            console.log(`
🎮 FACEIT Dashboard — Spielerverwaltung

Befehle:
  node manage-players.js add <nickname>      Spieler hinzufügen
  node manage-players.js remove <nickname>   Spieler entfernen
  node manage-players.js list                Alle Spieler anzeigen
  node manage-players.js list --sync         Nicknames mit FACEIT abgleichen

Umgebungsvariablen:
  FACEIT_API_KEY    Benötigt für 'add' (FACEIT Data API v4)

Beispiel:
  FACEIT_API_KEY=xxx node manage-players.js add noxq
      `);
            break;
    }
}

main().catch((err) => {
    console.error("❌ Fehler:", err.message);
    process.exit(1);
});
