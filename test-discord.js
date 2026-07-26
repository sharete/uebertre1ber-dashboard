const notifier = require('./src/notifier');

async function test() {
    console.log("🚀 Testing Discord Notifier...");
    
    if (!process.env.DISCORD_WEBHOOK_URL) {
        console.error("❌ DISCORD_WEBHOOK_URL is not set in environment!");
        process.exit(1);
    }

    const dummyPlayer = {
        nickname: "TestPlayer",
        faceitUrl: "https://www.faceit.com/en/players/TestPlayer",
        avatar: "https://corporate.faceit.com/wp-content/uploads/icon-faceit-300x300.png",
        elo: 1337
    };

    const dummyMatch = {
        matchId: "1-abc-123",
        result: "W",
        map: "de_mirage",
        score: "13:10",
        kd: "1.50",
        kills: 25,
        deaths: 16,
        assists: 5,
        adr: 95.5,
        hsPercent: 52,
        mvps: 4,
        eloDiff: 25,
        date: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        teammates: ["-rolan_", "SaN"]
    };

    console.log("⏳ Sending test notification...");
    const success = await notifier.sendMatchNotification(dummyPlayer, dummyMatch);

    if (success) {
        console.log("✅ Test notification sent successfully!");
    } else {
        console.error("❌ Failed to send test notification.");
    }
}

test();
