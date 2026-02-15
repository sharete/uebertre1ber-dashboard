const fs = require('fs');

class Renderer {
  render(templatePath, outputPath, data) {
    const { players, lastUpdated, historyData, awards } = data;

    // Sort players by default (ELO desc)
    const sortedPlayers = [...players].sort((a, b) => parseInt(b.elo) - parseInt(a.elo));

    const params = {
        players: sortedPlayers,
        lastUpdated,
        historyData,
        awards
    };

    const cardsHtml = sortedPlayers.map(p => this.renderPlayerCard(p)).join('\n');
    const awardsHtml = this.renderAwards(awards);

    let template = fs.readFileSync(templatePath, 'utf-8');
    
    // Replace markers
    template = template.replace("<!-- INSERT_ELO_CARDS_HERE -->", cardsHtml);
    template = template.replace("<!-- INSERT_AWARDS_SECTION -->", awardsHtml);
    template = template.replace("<!-- INSERT_LAST_UPDATED -->", lastUpdated);
    template = template.replace("<!-- INSERT_PLAYER_COUNT -->", players.length);

    // Inject comparison chart data
    const comparisonData = players.map(p => ({
      id: p.playerId,
      nickname: p.nickname,
      avatar: p.avatar,
      history: p.stats.eloHistory || []
    }));
    const comparisonScript = `<script>window.COMPARISON_DATA = ${JSON.stringify(comparisonData)};</script>`;
    template = template.replace("<!-- INSERT_COMPARISON_DATA -->", comparisonScript);

    // Inject history data
    const historyScript = `<script>window.ELO_DATA = ${JSON.stringify(historyData)};</script>`;
    if (template.match(/<!--\s*INSERT_HISTORY_DATA\s*-->/)) {
      template = template.replace(/<!--\s*INSERT_HISTORY_DATA\s*-->/, historyScript);
    } else {
      console.error("❌ History Data marker NOT found in template!");
    }

    fs.writeFileSync(outputPath, template);
    console.log(`✅ Generated ${outputPath}`);
  }

  renderAwards(awards) {
    if (!awards || Object.keys(awards).length === 0) return "";

    const card = (emoji, title, name, value, color) => `
      <div class="glass-panel p-4 rounded-xl flex items-center gap-4 relative overflow-hidden group">
        <div class="absolute right-0 top-0 w-20 h-20 bg-${color}-500/10 rounded-full blur-2xl -mr-8 -mt-8 group-hover:bg-${color}-500/20 transition"></div>
        <div class="w-10 h-10 rounded-lg bg-${color}-500/10 flex items-center justify-center text-xl shadow-[0_0_10px_rgba(0,0,0,0.2)]">${emoji}</div>
        <div>
          <p class="text-[10px] uppercase tracking-widest text-white/40 font-bold">${title}</p>
          <p class="font-bold text-white text-sm tracking-tight group-hover:text-${color}-400 transition-colors">${name}</p>
          <p class="font-mono text-${color}-400 text-xs">${value}</p>
        </div>
      </div>`;

    return `
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 w-full">
      ${card("🎯", "Best K/D", awards.bestKD.name, awards.bestKD.value, "blue")}
      ${card("💥", "Headshot King", awards.bestHS.name, awards.bestHS.value, "yellow")}
      ${card("⚡", "Best ADR", awards.bestADR.name, awards.bestADR.value, "purple")}
      ${card("🏆", "Best Winrate", awards.bestWinrate.name, `${awards.bestWinrate.value}%`, "green")}
      ${card("🔥", "Win Streak", awards.longestStreak.name, `${awards.longestStreak.value}W`, "orange")}
      ${card("🛡️", "Survivor", awards.lowestDeaths.name, `${awards.lowestDeaths.value} Deaths`, "cyan")}
    </div>`;
  }

  renderPlayerCard(p) {
    const { recent, teammates, streak, last5, mapPerformance, eloHistory } = p.stats;
    
    // Formatting Helpers
    const formatNumber = (num) =>  num ? num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "0";
    const avatarUrl = p.avatar || "";
    const avatarHtml = avatarUrl 
        ? `<img src="${avatarUrl}" class="w-12 h-12 rounded-full object-cover border-2 border-white/5 shadow-lg group-hover:border-neon-blue/50 transition-colors" alt="${p.nickname}" loading="lazy" />`
        : `<div class="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-white/50 border-2 border-white/10">${p.nickname.charAt(0).toUpperCase()}</div>`;

    // Dynamic Border Class (Spatial UI)
    let borderClass = "";
    if (streak.count >= 2) {
        if (streak.type === "win") borderClass = "glow-border-green";
        else if (streak.type === "loss") borderClass = "glow-border-red";
    }

    // Streak Badge
    const streakBadge = streak.count > 0 
        ? (streak.type === 'win' 
            ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/20 shadow-neon-green">🔥 ${streak.count} Win Streak</span>` 
            : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/20">💀 ${streak.count} Loss Streak</span>`) 
        : "";

    // Last 5 Matrix
    const last5Html = last5.map(r => 
      `<div class="w-1.5 h-6 rounded-full ${r === 'W' ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]' : 'bg-red-500/50'}"></div>`
    ).join("");


    // Internal components for details
    const topMates = [...teammates].sort((a,b) => b.count - a.count).slice(0,3);
    const matesList = (list) => list.map(m => `
        <div class="flex justify-between items-center text-xs py-1 border-b border-white/5 last:border-0 hover:bg-white/5 px-1 rounded transition-colors cursor-pointer" onclick="window.open('${m.url}', '_blank')">
            <span class="text-white/70 hover:text-white">${m.nickname}</span>
            <span class="font-mono text-white/30">${m.count}G <span class="${parseFloat(m.winrate)>=50?'text-green-400':'text-red-400'}">${m.winrate}</span></span>
        </div>`).join("");

    const mapRows = (mapPerformance || []).slice(0, 3).map(m => `
      <div class="grid grid-cols-4 text-[10px] py-1 border-b border-white/5 last:border-0">
        <div class="text-white/70 font-medium truncate">${m.map}</div>
        <div class="text-center text-white/30 font-mono">${m.matches}</div>
        <div class="text-center font-mono ${m.winrate >= 50 ? 'text-green-400' : 'text-red-400'}">${m.winrate}%</div>
        <div class="text-center font-mono ${parseFloat(m.kd) >= 1 ? 'text-green-400' : 'text-red-400'}">${m.kd}</div>
      </div>`).join("");

    const historyJson = JSON.stringify(p.stats.eloHistory || []);

    return `
    <div class="stat-card rounded-2xl p-0 ${borderClass}" 
         data-player-id="${p.playerId}" 
         data-nickname="${p.nickname}" 
         data-elo="${p.elo}"
         data-diff="0">
        
        <!-- Header / Main Info -->
        <div class="p-5 flex flex-col gap-4 relative">
            <div class="absolute top-0 right-0 p-4 opacity-50 pointer-events-none">
                 <img src="icons/levels/level_${p.level}_icon.png" class="w-16 h-16 opacity-20 filter blur-[1px]">
            </div>

            <div class="flex items-center justify-between relative z-10">
                <div class="flex items-center gap-3">
                    ${avatarHtml}
                    <div>
                        <a href="${p.faceitUrl}" target="_blank" class="font-bold text-lg text-white hover:text-faceit transition-colors">${p.nickname}</a>
                        <div class="flex items-center gap-2 mt-0.5">
                            <span class="text-[10px] bg-white/10 px-1.5 rounded text-white/50 border border-white/5">LVL ${p.level}</span>
                           ${streakBadge}
                        </div>
                    </div>
                </div>
                <div class="text-right">
                    <div class="text-2xl font-mono font-bold text-white text-glow-blue">${formatNumber(p.elo)}</div>
                    <div class="text-xs font-mono font-bold elo-diff flex justify-end gap-1"></div>
                </div>
            </div>

            <div class="grid grid-cols-3 gap-2 mt-2">
                 <div class="bg-black/20 rounded-lg p-2 text-center border border-white/5 hover:bg-white/5 transition-colors">
                     <div class="text-[10px] uppercase text-white/30 font-bold">Matches</div>
                     <div class="font-mono text-sm text-white">${formatNumber(p.matches)}</div>
                 </div>
                 <div class="bg-black/20 rounded-lg p-2 text-center border border-white/5 hover:bg-white/5 transition-colors">
                     <div class="text-[10px] uppercase text-white/30 font-bold">Win Rate</div>
                     <div class="font-mono text-sm ${parseFloat(p.winrate) >= 50 ? 'text-green-400' : 'text-red-400'}">${p.winrate}</div>
                 </div>
                 <div class="bg-black/20 rounded-lg p-2 text-center border border-white/5 hover:bg-white/5 transition-colors">
                     <div class="text-[10px] uppercase text-white/30 font-bold">K/D (30)</div>
                     <div class="font-mono text-sm ${parseFloat(recent.kd) >= 1 ? 'text-green-400' : 'text-red-400'}">${recent.kd}</div>
                 </div>
            </div>

            <div class="flex justify-between items-end mt-1">
                 <div class="flex gap-1 items-center h-6">
                    ${last5Html}
                 </div>
                 <div class="text-[10px] text-white/30 font-mono text-right">
                    Last: ${p.lastMatch}<br>
                    <span class="text-white/20">TS: ${p.lastMatchTs || 0}</span>
                 </div>
            </div>
        </div>

        <!-- Progressive Disclosure Button -->
        <button class="toggle-details-btn col-span-full w-full py-2 bg-white/5 border-t border-white/5 flex items-center justify-center gap-2 text-xs uppercase font-bold text-white/40 hover:text-neon-blue hover:bg-white/10 transition-colors">
            <span>Details & History</span>
            <svg class="w-3 h-3 transition-transform duration-300 icon-chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
        </button>

        <!-- Hidden Details Panel -->
        <div class="card-details hidden bg-[#050510]/50 border-t border-white/5 p-4 animate-fade-in">
            <!-- Chart Section -->
            <div class="mb-5 relative h-32 w-full">
                <canvas data-history='${historyJson}'></canvas>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <!-- Advanced Stats -->
                <div>
                     <div class="text-[10px] uppercase text-white/30 font-bold mb-2">Performance (30 Matches)</div>
                     <div class="space-y-1">
                         <div class="flex justify-between text-xs"><span class="text-white/50">Avg Kills</span> <span class="text-white font-mono">${Math.round(recent.kills / (recent.matches||1))}</span></div>
                         <div class="flex justify-between text-xs"><span class="text-white/50">Headshot %</span> <span class="text-white font-mono">${recent.hsPercent}</span></div>
                         <div class="flex justify-between text-xs"><span class="text-white/50">ADR</span> <span class="text-white/80 font-mono">${recent.adr}</span></div>
                     </div>
                </div>

                <!-- Map Stats -->
                <div>
                    <div class="text-[10px] uppercase text-white/30 font-bold mb-2">Map Performance</div>
                     <div class="space-y-1">
                        ${mapRows}
                     </div>
                </div>

                <!-- Teammates -->
                <div class="col-span-2 mt-2">
                     <div class="text-[10px] uppercase text-white/30 font-bold mb-2">Frequent Duo</div>
                     <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        ${matesList(topMates)}
                     </div>
                </div>
            </div>
        </div>
    </div>`;
  }
}

module.exports = new Renderer();
