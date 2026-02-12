const fs = require('fs');

class Renderer {
  render(templatePath, outputPath, data) {
    const { players, lastUpdated, historyData, awards } = data;

    const rows = players.map(p => this.renderPlayer(p)).join('\n');

    let template = fs.readFileSync(templatePath, 'utf-8');
    template = template.replace("<!-- INSERT_ELO_TABLE_HERE -->", rows);
    template = template.replace("<!-- INSERT_LAST_UPDATED -->", lastUpdated);
    template = template.replace("<!-- INSERT_PLAYER_COUNT -->", players.length);

    // Inject awards section
    const awardsHtml = this.renderAwards(awards);
    template = template.replace("<!-- INSERT_AWARDS_SECTION -->", awardsHtml);

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
        <div class="w-10 h-10 rounded-lg bg-${color}-500/10 flex items-center justify-center text-xl">${emoji}</div>
        <div>
          <p class="text-[10px] uppercase tracking-widest text-white/40 font-bold">${title}</p>
          <p class="font-bold text-white text-sm tracking-tight">${name}</p>
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

  renderPlayer(p) {
    const { recent, teammates, streak, last5, mapPerformance } = p.stats;
    const topMates = [...teammates].sort((a, b) => b.count - a.count).slice(0, 5);
    const worstMates = [...teammates].sort((a, b) => b.losses - a.losses).slice(0, 5);
    const bestMates = [...teammates].sort((a, b) => b.wins - a.wins).slice(0, 5);

    // Streak badge
    const streakBadge = streak.count >= 2
      ? (streak.type === "win"
        ? `<span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/20">🔥${streak.count}W</span>`
        : `<span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/20">💀${streak.count}L</span>`)
      : "";

    // Last 5 dots
    const last5Html = last5.map(r =>
      `<div class="w-2 h-2 rounded-full ${r === 'W' ? 'bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.6)]' : 'bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.6)]'}"></div>`
    ).join("");

    // Avatar
    const avatarHtml = p.avatar
      ? `<img src="${p.avatar}" class="w-8 h-8 rounded-full object-cover border border-white/10" alt="${p.nickname}" loading="lazy" />`
      : `<div class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/50">${p.nickname.charAt(0).toUpperCase()}</div>`;

    const mainRow = `
<tr class="player-row glass-card relative group cursor-pointer transition-transform duration-300 hover:scale-[1.01]"
    data-player-id="${p.playerId}"
    data-elo="${p.elo}"
    data-nickname="${p.nickname}"
    data-winrate="${parseFloat(p.winrate) || 0}"
    data-matches="${parseInt(p.matches.toString().replace(/,/g, '')) || 0}"
    data-level="${p.level}"
    data-last="${p.lastMatch}"
    data-last-ts="${p.lastMatchTs || 0}">
  <td class="p-4">
    <div class="flex items-center gap-3">
        <div class="w-1 h-8 bg-faceit rounded-full opacity-0 group-hover:opacity-100 transition-opacity absolute left-2"></div>
        <span class="toggle-details select-none text-white/30 group-hover:text-neon-blue transition-colors text-xs transform transition-transform duration-300">▸</span>
        ${avatarHtml}
        <div class="flex flex-col">
            <div class="flex items-center gap-1">
                <a href="${p.faceitUrl}" target="_blank" class="nickname-link font-bold text-white text-base tracking-wide hover:text-faceit transition-colors z-10">${p.nickname}</a>
                ${streakBadge}
            </div>
            <div class="flex items-center gap-1 mt-1">${last5Html}</div>
        </div>
    </div>
  </td>
  <td class="p-4 font-mono font-bold text-lg text-white text-glow-blue elo-now">${p.elo}</td>
  <td class="p-4 font-mono elo-diff flex items-center justify-center min-h-[60px]">-</td>
  <td class="p-4 text-center">
    <div class="relative inline-block group/badge">
       <div class="absolute inset-0 bg-orange-500/20 blur-md rounded-full opacity-0 group-hover/badge:opacity-100 transition-opacity"></div>
       <img src="icons/levels/level_${p.level}_icon.png" width="28" height="28" title="Level ${p.level}" class="relative drop-shadow-md level-badge">
    </div>
  </td>
  <td class="p-4">
    <div class="flex flex-col gap-1 w-24">
        <div class="flex justify-between text-[10px] text-white/50 uppercase font-bold tracking-wider">
            <span>Winrate</span>
            <span class="${parseFloat(p.winrate) >= 50 ? 'text-green-400' : 'text-red-400'}">${p.winrate}</span>
        </div>
        <div class="w-full h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/5">
            <div class="h-full bg-gradient-to-r from-blue-600 to-neon-blue shadow-[0_0_10px_rgba(0,242,255,0.5)]" style="width: ${p.winrate}"></div>
        </div>
    </div>
  </td>
  <td class="p-4 text-right font-mono text-white/70 text-sm">${p.matches}</td>
  <td class="p-4 text-xs text-white/40 font-mono text-right last-match-cell" data-ts="${p.lastMatchTs || 0}">${p.lastMatch}</td>
</tr>`.trim();

    // Map Performance Table
    const mapRows = (mapPerformance || []).slice(0, 5).map(m => `
      <tr class="border-b border-white/5 last:border-0">
        <td class="py-2 px-3 text-white/80 text-xs font-medium">${m.map}</td>
        <td class="py-2 px-3 text-center text-xs font-mono text-white/50">${m.matches}</td>
        <td class="py-2 px-3 text-center text-xs font-mono ${m.winrate >= 50 ? 'text-green-400' : 'text-red-400'}">${m.winrate}%</td>
        <td class="py-2 px-3 text-center text-xs font-mono ${parseFloat(m.kd) >= 1 ? 'text-green-400' : 'text-red-400'}">${m.kd}</td>
      </tr>`).join("");

    const mapBlock = mapPerformance && mapPerformance.length > 0 ? `
<div class="mb-4">
  <div class="font-bold text-white/60 mb-3 text-[10px] uppercase tracking-widest pl-1">🗺️ Map Performance</div>
  <div class="bg-[#0a0a14] border border-white/5 rounded-xl overflow-hidden">
    <table class="w-full" style="border-spacing:0">
      <thead><tr class="border-b border-white/10">
        <th class="py-2 px-3 text-left text-[10px] uppercase text-white/30 font-bold tracking-wider">Map</th>
        <th class="py-2 px-3 text-center text-[10px] uppercase text-white/30 font-bold tracking-wider">Games</th>
        <th class="py-2 px-3 text-center text-[10px] uppercase text-white/30 font-bold tracking-wider">Win%</th>
        <th class="py-2 px-3 text-center text-[10px] uppercase text-white/30 font-bold tracking-wider">K/D</th>
      </tr></thead>
      <tbody>${mapRows}</tbody>
    </table>
  </div>
</div>` : "";

    const statBlock = `
<div class="mb-4">
  <div class="font-bold text-neon-blue mb-3 flex items-center gap-2 text-xs uppercase tracking-widest">
    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" /></svg>
    Performance (Last 30)
  </div>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 bg-[#0a0a14] border border-white/5 p-4 rounded-xl shadow-inner">
    <div><span class="text-white/30 block text-[10px] uppercase font-bold tracking-wider mb-1">K/D</span> <span class="font-mono text-xl font-bold ${parseFloat(recent.kd) >= 1 ? 'text-green-400' : 'text-red-400'}">${recent.kd}</span></div>
    <div><span class="text-white/30 block text-[10px] uppercase font-bold tracking-wider mb-1">K/R</span> <span class="font-mono text-xl font-bold text-white">${recent.kr}</span></div>
    <div><span class="text-white/30 block text-[10px] uppercase font-bold tracking-wider mb-1">Avg Kills</span> <span class="font-mono text-xl font-bold text-white">${recent.matches > 0 ? Math.round(recent.kills / recent.matches) : 0}</span></div>
    <div><span class="text-white/30 block text-[10px] uppercase font-bold tracking-wider mb-1">HS %</span> <span class="font-mono text-xl font-bold text-white">${recent.hsPercent}</span></div>

    <div class="col-span-2 md:col-span-4 border-t border-white/5 pt-3 mt-1 flex flex-wrap gap-6 text-xs font-mono text-white/50">
        <span class="flex items-center gap-2"><div class="w-1.5 h-1.5 rounded-full bg-blue-500"></div> K: <b class="text-white">${recent.kills}</b></span>
        <span class="flex items-center gap-2"><div class="w-1.5 h-1.5 rounded-full bg-purple-500"></div> A: <b class="text-white">${recent.assists}</b></span>
        <span class="flex items-center gap-2"><div class="w-1.5 h-1.5 rounded-full bg-red-500"></div> D: <b class="text-white">${recent.deaths}</b></span>
        <span class="flex items-center gap-2"><div class="w-1.5 h-1.5 rounded-full bg-yellow-500"></div> ADR: <b class="text-white text-glow-orange">${recent.adr}</b></span>
    </div>
  </div>
</div>`;

    const matesList = (list) => list.map(m => `
        <li class="flex justify-between items-center py-2 border-b border-white/5 last:border-0 hover:bg-white/5 px-2 rounded transition-colors group/mate">
            <a href="${m.url}" target="_blank" class="nickname-link text-white/70 font-medium hover:text-neon-blue transition-colors text-xs">${m.nickname}</a>
            <span class="text-[10px] text-white/40 font-mono">${m.count} G <span class="ml-2 px-1.5 py-0.5 rounded font-bold ${parseFloat(m.winrate) >= 50 ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}">${m.winrate}</span></span>
        </li>`).join("");

    const topMatesBlock = `
<div class="mb-4">
  <div class="font-bold text-white/60 mb-3 text-[10px] uppercase tracking-widest pl-1">👥 Frequent Duo</div>
  <ul class="bg-[#0a0a14] border border-white/5 rounded-xl p-1">
    ${matesList(topMates)}
  </ul>
</div>`;

    const bestMatesBlock = `
<div class="mb-4">
  <div class="font-bold text-green-400/60 mb-3 text-[10px] uppercase tracking-widest pl-1">🏆 Best Synergy</div>
  <ul class="bg-[#0a0a14] border border-white/5 rounded-xl p-1">
    ${matesList(bestMates)}
  </ul>
</div>`;

    const worstMatesBlock = `
<div class="mb-4">
  <div class="font-bold text-red-400/60 mb-3 text-[10px] uppercase tracking-widest pl-1">💀 Cursed Duo</div>
  <ul class="bg-[#0a0a14] border border-white/5 rounded-xl p-1">
     ${matesList(worstMates)}
  </ul>
</div>`;

    const historyJson = JSON.stringify(p.stats.eloHistory || []);

    const chartBlock = `
<div class="mt-6 bg-[#0a0a14] border border-white/5 p-4 rounded-xl shadow-inner relative overflow-hidden group/chart">
    <div class="absolute inset-0 bg-blue-500/5 blur-xl group-hover/chart:bg-blue-500/10 transition-colors"></div>
    <div class="font-bold text-white/60 mb-4 text-[10px] uppercase tracking-widest relative z-10">
        📈 ELO Trend (Last 30 Matches)
    </div>
    <div class="h-48 w-full relative z-10">
        <canvas id="chart-${p.playerId}" class="elo-chart" data-history='${historyJson}'></canvas>
    </div>
</div>
`;

    const detailRow = `
<tr class="details-row hidden" data-player-id="${p.playerId}">
  <td colspan="7" class="p-0 border-none">
    <div class="mx-2 mb-4 p-6 glass-panel rounded-b-xl border-t-0 grid grid-cols-1 md:grid-cols-2 gap-8 animate-fade-in relative shadow-neon-blue">
         <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-gray-700 to-transparent opacity-50"></div>
        <div class="col-span-1 md:col-span-2">
            ${statBlock}
            ${mapBlock}
            ${chartBlock}
        </div>
        <div>
             ${topMatesBlock}
        </div>
        <div class="space-y-0">
             ${bestMatesBlock}
             ${worstMatesBlock}
        </div>
    </div>
  </td>
</tr>`.trim();

    return mainRow + "\n" + detailRow;
  }
}

module.exports = new Renderer();
