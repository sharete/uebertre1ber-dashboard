const fs = require('fs');

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const normalizeUrl = (value) => {
  try {
    const url = new URL(String(value ?? ''));
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
};
const safeUrl = (value) => escapeHtml(normalizeUrl(value));

const serializeForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

const iconSvg = (name, className = 'ui-icon') => {
  const paths = {
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
    burst: '<path d="m12 2 1.8 6.2L20 6l-3.7 5 5.7 3-6.6.2.6 6.8-4-5.4L8 21l.6-6.8L2 14l5.7-3L4 6l6.2 2.2L12 2Z"/>',
    bolt: '<path d="M13 2 5 13h6l-1 9 9-13h-6V2Z"/>',
    trophy: '<path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 6H4v1a4 4 0 0 0 4 4m8-5h4v1a4 4 0 0 1-4 4M12 12v5m-4 3h8m-6-3h4"/>',
    flame: '<path d="M13 2s1 4-2 6c-2 1-3 3-3 5a4 4 0 0 0 8 0c0-2-1-4-3-6 0 2-1 3-2 4 0-4 2-6 2-9Z"/>',
    shield: '<path d="M12 3 5 6v5c0 4.8 2.8 8 7 10 4.2-2 7-5.2 7-10V6l-7-3Z"/>',
    map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15m6-12v15"/>',
    users: '<path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M17 11a4 4 0 0 1 4 4v2m-5-14a4 4 0 0 1 0 8"/>',
    skull: '<path d="M8 18v3m4-3v3m4-3v3M5 14a8 8 0 1 1 14 0l-3 4H8l-3-4Z"/><circle cx="9" cy="11" r="1"/><circle cx="15" cy="11" r="1"/>',
    trend: '<path d="M3 17 9 11l4 4 8-9"/><path d="M15 6h6v6"/>'
  };
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.trend}</svg>`;
};

class Renderer {
  render(templatePath, outputPath, data) {
    const { players, lastUpdated, historyData, awards } = data;

    const rows = players.map(p => this.renderPlayer(p)).join('\n');

    let template = fs.readFileSync(templatePath, 'utf-8');
    template = template.replace("<!-- INSERT_ELO_TABLE_HERE -->", rows);
    template = template.replaceAll("<!-- INSERT_LAST_UPDATED -->", lastUpdated);
    template = template.replaceAll("<!-- INSERT_PLAYER_COUNT -->", players.length);

    // Inject awards section
    const awardsHtml = this.renderAwards(awards);
    template = template.replace("<!-- INSERT_AWARDS_SECTION -->", awardsHtml);

    // Inject comparison chart data
    const comparisonData = players.map(p => ({
      id: p.playerId,
      nickname: p.nickname,
      avatar: normalizeUrl(p.avatar),
      faceitUrl: normalizeUrl(p.faceitUrl),
      elo: Number.parseInt(p.elo) || 0,
      winrate: Number.parseFloat(p.winrate) || 0,
      level: Number.parseInt(p.level) || 0,
      recent: p.stats.recent || {},
      last5: p.stats.last5 || [],
      matchHistory: p.stats.matchHistory || [],
      personalBests: p.stats.personalBests || {},
      dataQuality: p.stats.dataQuality || {},
      insights: p.stats.insights || [],
      teammates: p.stats.teammates || [],
      history: (p.stats.eloHistory || []).slice(-100)
    }));
    const trackedIds = new Set(players.map(player => player.playerId));
    const synergies = [];
    const seenPairs = new Set();
    for (const player of comparisonData) {
      for (const mate of player.teammates) {
        if (!trackedIds.has(mate.playerId)) continue;
        const pairKey = [player.id, mate.playerId].sort().join(":");
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        const other = comparisonData.find(candidate => candidate.id === mate.playerId);
        synergies.push({
          ids: [player.id, mate.playerId],
          players: [player.nickname, other?.nickname || mate.nickname],
          matches: Number(mate.count) || 0,
          wins: Number(mate.wins) || 0,
          winrate: Number(mate.winratePct) || 0
        });
      }
    }
    synergies.sort((a, b) => b.matches - a.matches || b.winrate - a.winrate);
    const comparisonScript = `<script>window.COMPARISON_DATA = ${serializeForScript(comparisonData)};window.DASHBOARD_ANALYTICS = ${serializeForScript({ lastUpdated, synergies })};</script>`;
    template = template.replace("<!-- INSERT_COMPARISON_DATA -->", comparisonScript);

    // Inject history data
    const historyScript = `<script>window.ELO_DATA = ${serializeForScript(historyData)};</script>`;
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

    const card = (title, name, value, icon, accent) => `
      <article class="award-card award-${accent}">
        <span class="award-icon" aria-hidden="true">${iconSvg(icon, 'award-svg')}</span>
        <div class="award-copy">
          <p class="text-[10px] uppercase tracking-widest text-white/40 font-bold">${escapeHtml(title)}</p>
          <p class="font-bold text-white text-sm tracking-tight">${escapeHtml(name)}</p>
          <p class="font-mono text-xs">${escapeHtml(value)}</p>
        </div>
      </article>`;

    return `
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 w-full">
      ${card("Best K/D", awards.bestKD.name, awards.bestKD.value, "target", "blue")}
      ${card("Headshot King", awards.bestHS.name, awards.bestHS.value, "burst", "yellow")}
      ${card("Best ADR", awards.bestADR.name, awards.bestADR.value, "bolt", "violet")}
      ${card("Best Winrate", awards.bestWinrate.name, `${awards.bestWinrate.value}%`, "trophy", "green")}
      ${card("Win Streak", awards.longestStreak.name, `${awards.longestStreak.value}W`, "flame", "orange")}
      ${card("Baiter", awards.lowestDeaths.name, `${Number.isFinite(awards.lowestDeaths.value) ? awards.lowestDeaths.value : 0} Deaths`, "shield", "cyan")}
    </div>`;
  }

  renderPlayer(p) {
    const { recent, teammates, streak, last5, mapPerformance, eloHistory } = p.stats;
    const personalBests = p.stats.personalBests || {};
    const dataQuality = p.stats.dataQuality || { status: "partial", label: "Teilweise", matchCoverage: 0, eloSamples: 0 };
    const insights = p.stats.insights || [];
    const recentFormWins = last5.filter(result => result === 'W').length;
    const recentFormPercent = last5.length ? Math.round(recentFormWins / last5.length * 100) : 0;
    const nickname = escapeHtml(p.nickname);
    const playerId = escapeHtml(p.playerId);

    // Radar Chart Data Preparation
    const validMaps = (mapPerformance || []).filter(m => m.map !== "Unknown");
    const radarLabels = validMaps.map(m => m.map);
    const radarData = validMaps.map(m => m.winrate);
    const radarJson = escapeHtml(JSON.stringify({ labels: radarLabels, data: radarData }));

    const topMates = [...teammates].sort((a, b) => b.count - a.count).slice(0, 5);
    const worstMates = [...teammates].sort((a, b) => b.losses - a.losses).slice(0, 5);
    const bestMates = [...teammates].sort((a, b) => b.wins - a.wins).slice(0, 5);

    // Calculate Peak ELO (max of history + current)
    const historyMax = eloHistory && eloHistory.length ? Math.max(...eloHistory.map(h => h.elo)) : 0;
    const peakElo = Math.max(historyMax, parseInt(p.elo));

    // Format Streak
    const streakStr = streak.count > 0 ? `${streak.count}${streak.type === 'win' ? 'W' : 'L'}` : '—';
    // Keep streak information on the form line so it never shifts the ELO column.
    const streakBadge = streak.count >= 2
      ? (streak.type === "win"
        ? `<span class="streak-indicator streak-win" title="${streak.count} Siege in Folge">${streak.count}W</span>`
        : `<span class="streak-indicator streak-loss" title="${streak.count} Niederlagen in Folge">${streak.count}L</span>`)
      : "";

    // Last 5 dots
    const last5Html = last5.map(r =>
      `<div class="w-2 h-2 rounded-full ${r === 'W' ? 'bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.6)]' : 'bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.6)]'}"></div>`
    ).join("");

    // Avatar
    const initial = escapeHtml(String(p.nickname || '?').charAt(0).toUpperCase());
    const avatarHtml = p.avatar
      ? `<div class="relative w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/50 overflow-hidden"><span>${initial}</span><img src="${safeUrl(p.avatar)}" class="absolute inset-0 w-full h-full object-cover border border-white/10" alt="" loading="lazy" onerror="this.remove()" /></div>`
      : `<div class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/50">${initial}</div>`;

    const mainRow = `
<tr class="player-row glass-card relative group cursor-pointer transition-transform duration-300 hover:scale-[1.01]"
    data-player-id="${playerId}"
    data-elo="${p.elo}"
    data-nickname="${nickname}"
    data-winrate="${parseFloat(p.winrate) || 0}"
    data-matches="${parseInt(p.matches.toString().replace(/,/g, '')) || 0}"
    data-level="${p.level}"
    data-last="${escapeHtml(p.lastMatch)}"
    data-last-ts="${p.lastMatchTs || 0}"
    data-kd="${parseFloat(recent.kd) || 0}"
    data-adr="${parseFloat(recent.adr) || 0}"
    data-form="${recentFormPercent}"
    data-quality="${escapeHtml(dataQuality.status)}"
    data-peak="${peakElo}"
    data-streak="${streakStr}"
    data-streak-type="${streak.type}">
  <td class="p-4">
    <div class="flex items-center gap-3">
        <div class="w-1 h-8 bg-faceit rounded-full opacity-0 group-hover:opacity-100 transition-opacity absolute left-2"></div>
        <span class="toggle-details select-none text-white/30 group-hover:text-neon-blue transition-colors text-xs transform transition-transform duration-300">▸</span>
        ${avatarHtml}
        <div class="flex flex-col">
            <div class="flex items-center gap-1">
                <a href="${safeUrl(p.faceitUrl)}" target="_blank" rel="noopener noreferrer" class="nickname-link font-bold text-white text-base tracking-wide hover:text-faceit transition-colors z-10">${nickname}</a>
            </div>
            <div class="player-form flex items-center gap-1 mt-1">${last5Html}${streakBadge}</div>
        </div>
    </div>
  </td>
  <td class="p-4 font-mono font-bold text-lg text-white text-glow-blue elo-now">${p.elo}</td>
  <td class="p-4 font-mono elo-diff flex items-center justify-center min-h-[60px]">-</td>
  <td class="p-4 text-center">
    <div class="relative inline-block group/badge">
       <div class="absolute inset-0 bg-orange-500/20 blur-md rounded-full opacity-0 group-hover/badge:opacity-100 transition-opacity"></div>
        <img src="icons/levels/level_${Math.max(1, Math.min(10, Number.parseInt(p.level) || 1))}_icon.png" width="28" height="28" alt="FACEIT Level ${escapeHtml(p.level)}" class="relative drop-shadow-md level-badge">
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
  <td class="p-4 text-xs text-white/40 font-mono text-right last-match-cell" data-ts="${p.lastMatchTs || 0}">${escapeHtml(p.lastMatch)}</td>
</tr>`.trim();

    // Map Performance Table
    const mapRows = (mapPerformance || []).map(m => `
      <tr class="border-b border-white/5 last:border-0">
        <td class="py-2 px-3 text-white/80 text-xs font-medium">${escapeHtml(m.map)}</td>
        <td class="py-2 px-3 text-center text-xs font-mono text-white/50">${m.matches}</td>
        <td class="py-2 px-3 text-center text-xs font-mono ${m.winrate >= 50 ? 'text-green-400' : 'text-red-400'}">${m.winrate}%</td>
        <td class="py-2 px-3 text-center text-xs font-mono ${parseFloat(m.kd) >= 1 ? 'text-green-400' : 'text-red-400'}">${m.kd}</td>
      </tr>`).join("");

    const mapBlock = mapPerformance && mapPerformance.length > 0 ? `
<div class="mb-4">
  <div class="detail-heading detail-map font-bold text-white/60 mb-3 text-[10px] uppercase tracking-widest pl-1">${iconSvg('map', 'heading-svg')}<span>Map Performance</span></div>
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
  
  <div class="mt-4 bg-[#0a0a14] border border-white/5 p-4 rounded-xl shadow-inner relative overflow-hidden">
      <div class="font-bold text-white/60 mb-2 text-[10px] uppercase tracking-widest pl-1">Map-Profil</div>
      <div class="relative h-48 w-full">
         <canvas class="radar-chart" data-radar='${radarJson}'></canvas>
      </div>
  </div>
</div>`;

    const matesList = (list, valueKey = 'count', suffix = 'G', isLossRate = false) => list.map(m => {
        let percentage = parseFloat(m.winrate) || 0;
        let displayPct = percentage;
        let colorClass = percentage >= 50 ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20';

        if (isLossRate) {
            displayPct = 100 - percentage;
            // Invert colors: High Loss Rate = Bad (Red), Low Loss Rate = Good (Green)
            colorClass = displayPct >= 50 ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20';
        }

        return `
        <li class="flex justify-between items-center py-2 border-b border-white/5 last:border-0 hover:bg-white/5 px-2 rounded transition-colors group/mate">
            <a href="${safeUrl(m.url)}" target="_blank" rel="noopener noreferrer" class="nickname-link text-white/70 font-medium hover:text-neon-blue transition-colors text-xs">${escapeHtml(m.nickname)}</a>
            <span class="text-[10px] text-white/40 font-mono">${m[valueKey]} ${suffix} <span class="ml-2 px-1.5 py-0.5 rounded font-bold ${colorClass}">${displayPct}%</span></span>
        </li>`;
    }).join("");

    const topMatesBlock = `
<div class="mb-4">
  <div class="detail-heading detail-mates font-bold text-white/60 mb-3 text-[10px] uppercase tracking-widest pl-1">${iconSvg('users', 'heading-svg')}<span>Most played with</span></div>
  <ul class="bg-[#0a0a14] border border-white/5 rounded-xl p-1">
    ${matesList(topMates, 'count', 'G')}
  </ul>
</div>`;

    const bestMatesBlock = `
<div class="mb-4">
  <div class="detail-heading detail-wins font-bold text-green-400/60 mb-3 text-[10px] uppercase tracking-widest pl-1">${iconSvg('trophy', 'heading-svg')}<span>Most wins with</span></div>
  <ul class="bg-[#0a0a14] border border-white/5 rounded-xl p-1">
    ${matesList(bestMates, 'wins', 'W')}
  </ul>
</div>`;

    const worstMatesBlock = `
<div class="mb-4">
  <div class="detail-heading detail-losses font-bold text-red-400/60 mb-3 text-[10px] uppercase tracking-widest pl-1">${iconSvg('skull', 'heading-svg')}<span>Most losses with</span></div>
  <ul class="bg-[#0a0a14] border border-white/5 rounded-xl p-1">
     ${matesList(worstMates, 'losses', 'L', true)}
  </ul>
</div>`;

    const historyJson = escapeHtml(JSON.stringify((p.stats.eloHistory || []).slice(-30)));

    const chartBlock = `
<div class="mt-6 bg-[#0a0a14] border border-white/5 p-4 rounded-xl shadow-inner relative overflow-hidden group/chart">
    <div class="detail-heading detail-trend font-bold text-white/60 mb-4 text-[10px] uppercase tracking-widest relative z-10">
        ${iconSvg('trend', 'heading-svg')}<span>ELO-Trend · letzte 30 Matches</span>
    </div>
    <div class="h-48 w-full relative z-10">
        <canvas id="chart-${playerId}" class="elo-chart" data-history='${historyJson}'></canvas>
    </div>
</div>
`;

    const bestMap = personalBests.bestMap;
    const insightHtml = insights.length
      ? insights.slice(0, 4).map(item => `
        <article class="player-insight insight-${escapeHtml(item.type)}">
          <span aria-hidden="true">${escapeHtml(item.icon)}</span>
          <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.text)}</small></div>
        </article>`).join("")
      : `<p class="analytics-empty">Noch keine belastbare Auffälligkeit in den letzten Matches.</p>`;
    const analyticsBlock = `
<div class="player-analytics">
  <div class="player-analytics-head">
    <div>
      <span class="data-status status-${escapeHtml(dataQuality.status)}"><i></i>${escapeHtml(dataQuality.label)}</span>
      <small>${Number(dataQuality.matchCoverage) || 0}% Match-Abdeckung · ${Number(dataQuality.eloSamples) || 0} ELO-Werte</small>
    </div>
    <button type="button" class="share-player" data-share-player="${playerId}">Ansicht teilen <span aria-hidden="true">↗</span></button>
  </div>
  <div class="personal-bests" aria-label="Persönliche Bestwerte">
    <article><span>Peak ELO</span><strong>${Number(personalBests.peakElo) || peakElo}</strong></article>
    <article><span>Längste Serie</span><strong>${Number(personalBests.longestWinStreak) || 0}W</strong></article>
    <article><span>Beste Map</span><strong>${escapeHtml(bestMap?.map || "—")}</strong><small>${bestMap ? `${bestMap.winrate}% WR` : "Noch offen"}</small></article>
    <article><span>Beste 30er-Phase</span><strong>${Number(personalBests.bestThirtyGain) > 0 ? "+" : ""}${Number(personalBests.bestThirtyGain) || 0}</strong><small>ELO</small></article>
    <article data-form-card><span>Letzte 5 Matches</span><strong>${last5.length ? `${recentFormWins}/${last5.length}` : "—"}</strong><small>${last5.length ? `${recentFormPercent}% Siege` : "Keine Daten"}</small></article>
  </div>
  <div class="insight-grid">${insightHtml}</div>
</div>`;

    const detailRow = `
<tr class="details-row hidden" data-player-id="${playerId}">
  <td colspan="7" class="p-0 border-none">
    <div class="mx-2 mb-4 p-6 glass-panel rounded-b-xl border-t-0 grid grid-cols-1 md:grid-cols-2 gap-8 animate-fade-in relative shadow-neon-blue">
         <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-gray-700 to-transparent opacity-50"></div>
        <div class="col-span-1 md:col-span-2">
            ${analyticsBlock}
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
