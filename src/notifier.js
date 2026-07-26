const fetch = globalThis.fetch;

class DiscordNotifier {
    constructor() {
        this.webhookUrl = (process.env.DISCORD_WEBHOOK_URL || "").trim();
        this.token = (process.env.DISCORD_TOKEN || "").trim();
        this.channelId = (process.env.DISCORD_CHANNEL_ID || "").trim();
    }

    /**
     * Sends a notification to Discord.
     * @param {object} player - Player profile data
     * @param {object} match - Match details/stats
     * @returns {Promise<boolean>}
     */
    async sendMatchNotification(player, match) {
        if (!this.webhookUrl && (!this.token || !this.channelId)) {
            console.warn("⚠️ Discord Notifier: No credentials found (WebHook or Token/ChannelID). Skipping notification.");
            return false;
        }

        const embed = this._formatMatchEmbed(player, match);

        if (this.webhookUrl) {
            return this._sendViaWebhook(embed);
        } else {
            return this._sendViaBot(embed);
        }
    }

    /**
     * Formats the match result into a Discord embed.
     * @private
     */
    _formatMatchEmbed(player, match) {
        const isWin = match.result === "W";
        const color = isWin ? 0x00FF00 : 0xFF0000; // Green for win, Red for loss
        
        // Match Link
        const matchUrl = `https://www.faceit.com/en/cs2/room/${match.matchId}`;
        
        // Elo Diff
        const eloDiff = match.eloDiff !== undefined ? (match.eloDiff >= 0 ? ` (+${match.eloDiff})` : ` (${match.eloDiff})`) : "";
        
        let formattedScore = match.score || "—";
        if (formattedScore !== "—") {
            const [s1, s2] = formattedScore.split(" / ").map(Number);
            if (!isNaN(s1) && !isNaN(s2)) {
                formattedScore = isWin 
                    ? `${Math.max(s1, s2)} / ${Math.min(s1, s2)}` 
                    : `${Math.min(s1, s2)} / ${Math.max(s1, s2)}`;
            }
        }

        let title = isWin ? "🏆 Sieg für " + player.nickname : "💀 Niederlage für " + player.nickname;
        if (formattedScore !== "—") title += ` (${formattedScore})`;

        const fields = [
            { name: "Map", value: match.map || "Unknown", inline: true },
            { name: "Score", value: formattedScore, inline: true },
            { name: "Elo", value: `${player.elo}${eloDiff}`, inline: true },
            { name: "K/D", value: match.kd || "0.00", inline: true },
            { name: "Kills", value: `${match.kills}/${match.deaths}${match.assists ? " (" + match.assists + ")" : ""}`, inline: true },
            { name: "ADR", value: match.adr ? match.adr.toFixed(1) : "—", inline: true },
            { name: "HS %", value: match.hsPercent ? match.hsPercent + "%" : "—", inline: true },
            { name: "MVPs", value: match.mvps?.toString() || "0", inline: true },
            { name: "Match Link", value: `[Room](${matchUrl})`, inline: true }
        ];

        if (match.teammates && match.teammates.length > 0) {
            fields.push({ name: "Dashboard Teammates", value: match.teammates.join(", "), inline: false });
        }

        const timestamp = match.date ? match.date * 1000 : Date.now();
        const footerDate = new Date(timestamp).toLocaleString("de-DE");

        return {
            title: title,
            url: player.faceitUrl,
            color: color,
            thumbnail: { url: player.avatar || "https://corporate.faceit.com/wp-content/uploads/icon-faceit-300x300.png" },
            fields: fields,
            footer: { text: "Match-Zeitpunkt • " + footerDate }
        };
    }

    /** @private */
    async _sendViaWebhook(embed) {
        const urls = this.webhookUrl.split(",").map(u => u.trim()).filter(u => u.length > 0);
        
        if (urls.length === 0) return false;

        const results = await Promise.all(urls.map(async (url) => {
            try {
                const res = await fetch(url.trim(), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ embeds: [embed] })
                });
                return res.ok;
            } catch (e) {
                console.error(`❌ Discord Webhook Error (${url}):`, e.message);
                return false;
            }
        }));

        return results.some(r => r === true);
    }

    /** @private */
    async _sendViaBot(embed) {
        try {
            const res = await fetch(`https://discord.com/api/v10/channels/${this.channelId}/messages`, {
                method: "POST",
                headers: {
                    "Authorization": `Bot ${this.token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ embeds: [embed] })
            });
            return res.ok;
        } catch (e) {
            console.error("❌ Discord Bot Error:", e.message);
            return false;
        }
    }
}

module.exports = new DiscordNotifier();
