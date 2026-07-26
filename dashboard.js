(() => {
  "use strict";

  const state = {
    range: "daily",
    sort: { key: "elo", direction: "desc" },
    selectedPlayers: new Set(),
    comparisonChart: null,
    detailCharts: new Map(),
    historyCachePromise: null,
    comparisonRenderId: 0
  };

  const colors = ["#ff6a2b", "#64e6a4", "#69a9ff", "#a98dff", "#ff6e7b"];
  const tableBody = document.getElementById("playerTableBody");
  const searchInput = document.getElementById("searchInput");
  const emptyState = document.getElementById("emptyState");
  const visibleCount = document.getElementById("visible-player-count");
  const filterButtons = [...document.querySelectorAll(".time-filter")];
  const sortButtons = [...document.querySelectorAll("[data-sort]")];
  const formSort = document.getElementById("formSort");

  if (!tableBody || !searchInput) return;

  const playerRows = () => [...tableBody.querySelectorAll(".player-row")];
  const pairedDetailRow = row => tableBody.querySelector(`.details-row[data-player-id="${CSS.escape(row.dataset.playerId || "")}"]`);

  const number = (value, fallback = 0) => {
    const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const text = value => String(value ?? "").trim();

  const relativeTime = timestamp => {
    const seconds = Number(timestamp);
    if (!seconds) return "Keine Aktivität";
    const diff = Math.max(0, Math.floor(Date.now() / 1000 - seconds));
    const formatter = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
    if (diff < 60) return "gerade eben";
    if (diff < 3600) return formatter.format(-Math.floor(diff / 60), "minute");
    if (diff < 86400) return formatter.format(-Math.floor(diff / 3600), "hour");
    if (diff < 604800) return formatter.format(-Math.floor(diff / 86400), "day");
    if (diff < 2592000) return formatter.format(-Math.floor(diff / 604800), "week");
    if (diff < 31536000) return formatter.format(-Math.floor(diff / 2592000), "month");
    return formatter.format(-Math.floor(diff / 31536000), "year");
  };

  const getSnapshot = row => {
    const records = window.ELO_DATA?.[state.range];
    if (!Array.isArray(records)) return null;
    return records.find(item => item.playerId === row.dataset.playerId) || null;
  };

  const updateDiffs = () => {
    playerRows().forEach(row => {
      const current = number(row.dataset.elo);
      const snapshot = getSnapshot(row);
      const diff = snapshot ? current - number(snapshot.elo, current) : 0;
      row.dataset.diff = String(diff);
      const cell = row.querySelector(".elo-diff");
      if (!cell) return;
      cell.textContent = `${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${Math.abs(diff)}`;
      cell.classList.toggle("positive", diff > 0);
      cell.classList.toggle("negative", diff < 0);
    });
    updateSummary();
    renderGlobalInsights();
  };

  const updateSummary = () => {
    const rows = playerRows();
    if (!rows.length) return;
    const ranked = [...rows].sort((a, b) => number(b.dataset.elo) - number(a.dataset.elo));
    const climbers = [...rows].sort((a, b) => number(b.dataset.diff) - number(a.dataset.diff));
    const leader = ranked[0];
    const mvp = climbers[0];
    const drop = climbers[climbers.length - 1];
    const avg = Math.round(rows.reduce((sum, row) => sum + number(row.dataset.elo), 0) / rows.length);

    setText("hero-king-name", leader.dataset.nickname || "—");
    setText("hero-king-elo", `${Math.round(number(leader.dataset.elo)).toLocaleString("de-DE")} ELO`);
    setText("hero-king-level", leader.dataset.level || "—");
    setText("hero-mvp-name", mvp.dataset.nickname || "—");
    setSignedText("hero-mvp-diff", number(mvp.dataset.diff));
    const dropValue = number(drop.dataset.diff);
    setText("hero-down-name", dropValue < 0 ? (drop.dataset.nickname || "—") : "Alle im Plus 💪");
    setSignedText("hero-down-diff", Math.min(0, dropValue));
    setText("crew-average", avg.toLocaleString("de-DE"));
    setSignedText("hero-king-diff", number(leader.dataset.diff));

    const progress = document.getElementById("hero-king-progress");
    if (progress) progress.style.width = `${Math.max(8, Math.min(100, (number(leader.dataset.elo) % 1000) / 10))}%`;

    const avatar = document.getElementById("hero-king-avatar");
    const rowAvatar = leader.querySelector("img:not(.level-badge)");
    if (avatar) {
      avatar.replaceChildren();
      if (rowAvatar?.src) {
        const img = document.createElement("img");
        img.src = rowAvatar.src;
        img.alt = "";
        avatar.append(img);
      } else {
        const initials = document.createElement("span");
        initials.textContent = (leader.dataset.nickname || "U").slice(0, 2).toUpperCase();
        avatar.append(initials);
      }
    }
  };

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };

  const setSignedText = (id, value, suffix = "") => {
    const element = document.getElementById(id);
    if (!element) return;
    const numeric = number(value);
    element.textContent = `${numeric > 0 ? "+" : numeric < 0 ? "−" : "±"}${Math.abs(numeric)}${suffix}`;
    element.classList.toggle("positive", numeric > 0);
    element.classList.toggle("negative", numeric < 0);
  };

  const applyRanks = () => {
    playerRows().filter(row => row.style.display !== "none").forEach((row, index) => {
      row.dataset.rank = String(index + 1).padStart(2, "0");
    });
  };

  const filterRows = () => {
    const query = searchInput.value.trim().toLocaleLowerCase("de");
    let count = 0;
    playerRows().forEach(row => {
      const visible = !query || (row.dataset.nickname || "").toLocaleLowerCase("de").includes(query);
      row.style.display = visible ? "" : "none";
      const details = pairedDetailRow(row);
      if (details && !visible) {
        details.classList.add("hidden");
        row.setAttribute("aria-expanded", "false");
      }
      if (visible) count += 1;
    });
    if (visibleCount) visibleCount.textContent = String(count);
    if (emptyState) emptyState.hidden = count !== 0;
    applyRanks();
  };

  const valueForSort = (row, key) => {
    if (key === "nickname") return (row.dataset.nickname || "").toLocaleLowerCase("de");
    if (key === "last") return number(row.dataset.lastTs);
    return number(row.dataset[key] ?? row.dataset.elo);
  };

  const sortRows = () => {
    const pairs = playerRows().map(row => ({ row, details: pairedDetailRow(row) }));
    const multiplier = state.sort.direction === "asc" ? 1 : -1;
    pairs.sort((a, b) => {
      const first = valueForSort(a.row, state.sort.key);
      const second = valueForSort(b.row, state.sort.key);
      if (typeof first === "string") return first.localeCompare(second, "de") * multiplier;
      return (first - second) * multiplier;
    });
    const fragment = document.createDocumentFragment();
    pairs.forEach(({ row, details }) => {
      fragment.append(row);
      if (details) fragment.append(details);
    });
    tableBody.append(fragment);
    sortButtons.forEach(button => {
      const active = button.dataset.sort === state.sort.key;
      button.classList.toggle("active", active);
      button.dataset.direction = active ? state.sort.direction : "";
    });
    filterRows();
  };

  const chartAvailable = () => typeof window.Chart === "function";

  const chartDefaults = () => {
    if (!chartAvailable()) return;
    Chart.defaults.color = "#77818e";
    Chart.defaults.font.family = '"DM Sans", system-ui, sans-serif';
    Chart.defaults.borderColor = "rgba(255,255,255,.06)";
  };

  const parseJSONAttribute = (element, name) => {
    try {
      return JSON.parse(element?.dataset?.[name] || "[]");
    } catch {
      return [];
    }
  };

  const renderGlobalInsights = () => {
    const container = document.getElementById("global-insights");
    if (!container) return;
    const items = [];
    for (const row of playerRows()) {
      const name = row.dataset.nickname || "Spieler";
      const streakCount = number(row.dataset.streak);
      if (row.dataset.streakType === "loss" && streakCount >= 3) items.push({ tone: "warning", icon: "↘", title: name, text: `${streakCount} Niederlagen in Folge` });
      else if (row.dataset.streakType === "win" && streakCount >= 3) items.push({ tone: "positive", icon: "↗", title: name, text: `${streakCount} Siege in Folge` });
      const gap = number(row.dataset.peak) - number(row.dataset.elo);
      if (gap >= 0 && gap <= 5) items.push({ tone: "peak", icon: "◆", title: name, text: "spielt am persönlichen Peak" });
      if (number(row.dataset.diff) >= 75) items.push({ tone: "positive", icon: "↑", title: name, text: `+${number(row.dataset.diff)} ELO im Zeitraum` });
    }
    const unique = items.filter((item, index) => items.findIndex(candidate => candidate.title === item.title && candidate.text === item.text) === index).slice(0, 4);
    container.replaceChildren();
    unique.forEach(item => {
      const article = document.createElement("article");
      article.className = `global-insight insight-${item.tone}`;
      const icon = document.createElement("span");
      icon.textContent = item.icon;
      icon.setAttribute("aria-hidden", "true");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      title.textContent = item.title;
      detail.textContent = item.text;
      copy.append(title, detail);
      article.append(icon, copy);
      container.append(article);
    });
    container.hidden = !unique.length;
  };

  const normalizeHistory = (rawHistory, limit = 100) => {
    if (!Array.isArray(rawHistory)) return [];
    const normalized = rawHistory
      .map(item => {
        const rawDate = number(item?.date ?? item?.created_at ?? item?.updated_at, NaN);
        const elo = number(item?.elo ?? item?.i20, NaN);
        const date = rawDate > 1e12 ? rawDate : rawDate * 1000;
        const rawResult = item?.result ?? item?.i10;
        const rawDiff = item?.eloDiff ?? item?.elo_delta;
        const matchId = text(item?.matchId ?? item?.match_id);
        const rawMap = text(item?.map ?? item?.i1).replace(/^de_/i, "");
        return {
          x: date,
          y: elo,
          eloDiff: Number.isFinite(number(rawDiff, NaN)) ? number(rawDiff) : null,
          matchId,
          matchUrl: matchId ? `https://www.faceit.com/de/cs2/room/${encodeURIComponent(matchId)}` : "",
          map: rawMap ? rawMap.charAt(0).toUpperCase() + rawMap.slice(1) : "",
          score: text(item?.score ?? item?.i18),
          result: rawResult === "W" || rawResult === "L" ? rawResult : String(rawResult) === "1" ? "W" : String(rawResult) === "0" ? "L" : ""
        };
      })
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
      .sort((a, b) => a.x - b.x)
      .filter((point, index, points) => index === 0 || point.x !== points[index - 1].x);
    return normalized.slice(-limit);
  };

  const loadHistoryCache = async () => {
    if (!state.historyCachePromise) {
      state.historyCachePromise = fetch("data/history-cache.json", { cache: "no-store" })
        .then(response => response.ok ? response.json() : {})
        .catch(() => ({}));
    }
    return state.historyCachePromise;
  };

  const resolveHistory = async (playerId, embeddedHistory, limit) => {
    const embedded = normalizeHistory(embeddedHistory, limit);
    const cache = await loadHistoryCache();
    const cached = normalizeHistory(cache?.[playerId], limit);
    const cachedMetadata = cached.filter(point => point.matchId || point.map || point.result).length;
    if (cached.length >= 2 && (cachedMetadata || embedded.length < 2)) return cached;
    return embedded;
  };

  const toMatchSeries = (history, limit = 30) => history
    .slice(-limit)
    .map((point, index) => ({
      x: index + 1,
      y: point.y,
      date: point.x,
      eloDiff: point.eloDiff,
      matchId: point.matchId,
      matchUrl: point.matchUrl,
      map: point.map,
      score: point.score,
      result: point.result
    }));

  const formatChartDate = timestamp => timestamp
    ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "2-digit" }).format(new Date(timestamp))
    : "";

  const matchTooltipCallbacks = {
    title: items => items.length ? `Match ${items[0].parsed.x} / ${items[0].dataset.data.length}` : "",
    label: context => {
      const point = context.raw || {};
      const delta = Number.isFinite(point.eloDiff) ? ` · ${point.eloDiff > 0 ? "+" : ""}${point.eloDiff}` : "";
      const prefix = context.dataset.label ? ` ${context.dataset.label}: ` : "";
      return `${prefix}${context.parsed.y} ELO${delta}`;
    },
    afterLabel: context => {
      const point = context.raw || {};
      return [
        [point.result, point.map, point.score].filter(Boolean).join(" · "),
        formatChartDate(point.date)
      ].filter(Boolean);
    },
    footer: items => items.some(item => item.raw?.matchUrl) ? "Klicken, um das FACEIT-Match zu öffnen" : ""
  };

  const openChartMatch = (event, elements, chart) => {
    const element = elements[0];
    const point = element ? chart.data.datasets[element.datasetIndex]?.data?.[element.index] : null;
    if (point?.matchUrl) window.open(point.matchUrl, "_blank", "noopener,noreferrer");
  };

  const showDetailFallback = (canvas, message) => {
    if (!canvas) return;
    canvas.hidden = true;
    const parent = canvas.parentElement;
    if (!parent) return;
    let fallback = parent.querySelector(".detail-chart-fallback");
    if (!fallback) {
      fallback = document.createElement("p");
      fallback.className = "detail-chart-fallback";
      parent.append(fallback);
    }
    fallback.textContent = message;
  };

  const renderDetailCharts = async details => {
    if (!chartAvailable() || !details) return;

    const lineCanvas = details.querySelector(".elo-chart");
    if (lineCanvas && !state.detailCharts.has(lineCanvas)) {
      const history = toMatchSeries(await resolveHistory(
        details.dataset.playerId,
        parseJSONAttribute(lineCanvas, "history"),
        30
      ));
      if (history.length >= 2) {
        lineCanvas.hidden = false;
        lineCanvas.dataset.pointCount = String(history.length);
        lineCanvas.dataset.axisMode = "match";
        state.detailCharts.set(lineCanvas, new Chart(lineCanvas, {
          type: "line",
          data: {
            datasets: [{
              data: history,
              borderColor: "#ff6a2b",
              backgroundColor: "rgba(255,106,43,.08)",
              fill: true,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4,
              tension: .34,
              cubicInterpolationMode: "monotone"
            }]
          },
          options: detailChartOptions()
        }));
      } else {
        showDetailFallback(lineCanvas, "Noch nicht genügend ELO-Verlaufsdaten vorhanden.");
      }
    }

    const radarCanvas = details.querySelector(".radar-chart");
    if (radarCanvas && !state.detailCharts.has(radarCanvas)) {
      const radar = parseJSONAttribute(radarCanvas, "radar");
      if (Array.isArray(radar.labels) && radar.labels.length) {
        state.detailCharts.set(radarCanvas, new Chart(radarCanvas, {
          type: "radar",
          data: {
            labels: radar.labels,
            datasets: [{
              data: radar.data,
              borderColor: "#69a9ff",
              backgroundColor: "rgba(105,169,255,.12)",
              borderWidth: 2,
              pointRadius: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                displayColors: false,
                callbacks: { label: context => `${context.formattedValue}% Winrate` }
              }
            },
            scales: {
              r: {
                min: 0, max: 100,
                angleLines: { color: "rgba(255,255,255,.06)" },
                grid: { color: "rgba(255,255,255,.06)" },
                pointLabels: { color: "#8993a0", font: { size: 9 } },
                ticks: { display: false }
              }
            }
          }
        }));
      }
    }
  };

  const detailChartOptions = () => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          ...matchTooltipCallbacks
        }
      }
    },
    onClick: openChartMatch,
    scales: {
      x: { type: "linear", min: 1, max: 30, display: false },
      y: { grid: { color: "rgba(255,255,255,.055)" }, ticks: { maxTicksLimit: 5, font: { size: 9 } } }
    }
  });

  const toggleDetails = row => {
    const details = pairedDetailRow(row);
    if (!details) return;
    const opening = details.classList.contains("hidden");
    playerRows().forEach(other => {
      if (other === row) return;
      other.setAttribute("aria-expanded", "false");
      pairedDetailRow(other)?.classList.add("hidden");
    });
    details.classList.toggle("hidden", !opening);
    row.setAttribute("aria-expanded", String(opening));
    if (opening) requestAnimationFrame(() => void renderDetailCharts(details));
  };

  const normalizeStreakDisplay = row => {
    const formLine = row.querySelector(".player-form")
      || row.querySelector(".nickname-link")?.closest(".flex-col")?.querySelector(".mt-1");
    if (!formLine) return;

    row.querySelectorAll(".streak-indicator").forEach(indicator => indicator.remove());
    const nicknameLine = row.querySelector(".nickname-link")?.parentElement;
    [...(nicknameLine?.children || [])].forEach(child => {
      if (child !== row.querySelector(".nickname-link") && child.tagName === "SPAN") child.remove();
    });

    const count = Math.max(0, Number.parseInt(row.dataset.streak) || 0);
    const type = row.dataset.streakType;
    if (count < 2 || (type !== "win" && type !== "loss")) return;

    const indicator = document.createElement("span");
    indicator.className = `streak-indicator ${type === "win" ? "streak-win" : "streak-loss"}`;
    indicator.textContent = `${count}${type === "win" ? "W" : "L"}`;
    indicator.title = `${count} ${type === "win" ? "Siege" : "Niederlagen"} in Folge`;
    formLine.append(indicator);
  };

  const playerData = playerId => (Array.isArray(window.COMPARISON_DATA) ? window.COMPARISON_DATA : [])
    .find(player => player.id === playerId);

  const calculateBestThirty = history => {
    const points = normalizeHistory(history, 100);
    let gain = 0;
    points.forEach((point, index) => {
      const end = points[Math.min(index + 29, points.length - 1)];
      gain = Math.max(gain, end.y - point.y);
    });
    return gain;
  };

  const enhancePlayerAnalytics = row => {
    const details = pairedDetailRow(row);
    if (!details || details.querySelector(".player-analytics")) return;
    const player = playerData(row.dataset.playerId) || {};
    const history = player.history || [];
    const peak = Math.max(number(row.dataset.peak), ...normalizeHistory(history).map(point => point.y));
    const bestGain = calculateBestThirty(history);
    const status = number(row.dataset.lastTs) && Date.now() / 1000 - number(row.dataset.lastTs) < 72 * 3600 ? "fresh" : "stale";
    const label = status === "fresh" ? "Aktuell" : "Veraltet";
    const analytics = document.createElement("div");
    analytics.className = "player-analytics";
    analytics.innerHTML = `
      <div class="player-analytics-head">
        <div><span class="data-status status-${status}"><i></i>${label}</span><small>${normalizeHistory(history).length} ELO-Werte geprüft</small></div>
        <button type="button" class="share-player" data-share-player="${row.dataset.playerId}">Ansicht teilen <span aria-hidden="true">↗</span></button>
      </div>
      <div class="personal-bests">
        <article><span>Peak ELO</span><strong>${peak || number(row.dataset.elo)}</strong></article>
        <article><span>Aktuelle Serie</span><strong>${text(row.dataset.streak) || "—"}</strong></article>
        <article><span>Form · letzte 5</span><strong>${number(row.dataset.form)}%</strong></article>
        <article><span>Beste 30er-Phase</span><strong>${bestGain > 0 ? "+" : ""}${bestGain}</strong><small>ELO</small></article>
      </div>
      <div class="insight-grid"></div>`;
    const primaryColumn = [...(details.querySelector("td > div")?.children || [])]
      .find(element => element.querySelector(".elo-chart"));
    primaryColumn?.prepend(analytics);
  };

  const toast = message => {
    const element = document.getElementById("dashboard-toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => element.classList.remove("show"), 2800);
  };

  const sharePlayer = async playerId => {
    const row = playerRows().find(candidate => candidate.dataset.playerId === playerId);
    const url = new URL(window.location.href);
    url.searchParams.set("player", playerId);
    url.hash = "leaderboard";
    const payload = {
      title: `${row?.dataset.nickname || "Spieler"} · Uebertr1eber Dashboard`,
      text: `${row?.dataset.nickname || "Spieler"}: ${row?.dataset.elo || "—"} ELO im Uebertr1eber Dashboard`,
      url: url.href
    };
    try {
      if (navigator.share) await navigator.share(payload);
      else {
        await navigator.clipboard.writeText(url.href);
        toast("Spieleransicht wurde in die Zwischenablage kopiert.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") toast("Teilen war nicht möglich. Bitte URL kopieren.");
    }
  };

  const setupRows = () => {
    document.querySelectorAll(".last-match-cell").forEach(cell => {
      const absolute = cell.textContent.trim();
      cell.textContent = relativeTime(cell.dataset.ts);
      cell.title = absolute;
    });
    playerRows().forEach(row => {
      if (!row.dataset.form) {
        const wins = row.querySelectorAll(".player-form .bg-green-400").length;
        const total = row.querySelectorAll(".player-form > div").length;
        row.dataset.form = String(total ? Math.round(wins / total * 100) : 0);
      }
      normalizeStreakDisplay(row);
      enhancePlayerAnalytics(row);
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-expanded", "false");
      row.setAttribute("aria-label", `${row.dataset.nickname || "Spieler"}: Details öffnen`);
      row.addEventListener("click", event => {
        if (event.target.closest("a, button")) return;
        toggleDetails(row);
      });
      row.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleDetails(row);
        }
      });
      row.querySelectorAll("a[target='_blank']").forEach(link => link.rel = "noopener noreferrer");
    });
    tableBody.addEventListener("click", event => {
      const button = event.target.closest("[data-share-player]");
      if (button) void sharePlayer(button.dataset.sharePlayer);
    });
  };

  const setupFilters = () => {
    filterButtons.forEach(button => button.addEventListener("click", () => {
      state.range = button.dataset.val || "daily";
      filterButtons.forEach(item => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      updateDiffs();
      if (state.sort.key === "diff") sortRows();
    }));
    searchInput.addEventListener("input", filterRows);
    document.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.focus();
      }
      if (event.key === "Escape" && document.activeElement === searchInput) {
        searchInput.value = "";
        filterRows();
        searchInput.blur();
      }
    });
  };

  const setupSorting = () => {
    sortButtons.forEach(button => button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (!key) return;
      if (state.sort.key === key) {
        state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
      } else {
        state.sort.key = key;
        state.sort.direction = key === "nickname" ? "asc" : "desc";
      }
      sortRows();
    }));
    formSort?.addEventListener("change", () => {
      state.sort.key = formSort.value;
      state.sort.direction = "desc";
      sortRows();
    });
  };

  const createComparisonChips = () => {
    const container = document.getElementById("comparison-chips");
    const data = Array.isArray(window.COMPARISON_DATA) ? window.COMPARISON_DATA : [];
    if (!container || !data.length) return;
    data.forEach((player, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "comparison-chip";
      button.dataset.playerId = player.id;
      button.style.setProperty("--chip-color", colors[index % colors.length]);
      button.setAttribute("aria-pressed", "false");

      if (player.avatar) {
        const img = document.createElement("img");
        img.src = player.avatar;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", () => img.remove());
        button.append(img);
      } else {
        const avatar = document.createElement("span");
        avatar.className = "chip-avatar";
        avatar.textContent = text(player.nickname).slice(0, 1).toUpperCase();
        button.append(avatar);
      }
      const label = document.createElement("span");
      label.textContent = player.nickname;
      button.append(label);
      button.addEventListener("click", () => {
        const id = player.id;
        if (state.selectedPlayers.has(id)) state.selectedPlayers.delete(id);
        else if (state.selectedPlayers.size < 5) state.selectedPlayers.add(id);
        button.classList.toggle("active", state.selectedPlayers.has(id));
        button.setAttribute("aria-pressed", String(state.selectedPlayers.has(id)));
        void renderComparison();
      });
      container.append(button);
      if (index < 3) {
        state.selectedPlayers.add(player.id);
        button.classList.add("active");
        button.setAttribute("aria-pressed", "true");
      }
    });
  };

  const comparisonValue = (player, key) => {
    const row = playerRows().find(candidate => candidate.dataset.playerId === player.id);
    if (key === "elo") return number(player.elo, number(row?.dataset.elo));
    if (key === "winrate") return number(player.winrate, number(row?.dataset.winrate));
    if (key === "kd") return number(player.recent?.kd, number(row?.dataset.kd));
    if (key === "adr") return number(player.recent?.adr, number(row?.dataset.adr));
    if (key === "form") return number(row?.dataset.form, (player.last5 || []).filter(result => result === "W").length * 20);
    return 0;
  };

  const commonMatches = (first, second) => {
    const ids = new Set((first.matchHistory || []).map(match => match.matchId).filter(Boolean));
    return (second.matchHistory || []).filter(match => ids.has(match.matchId)).length;
  };

  const renderComparisonMetrics = selected => {
    const container = document.getElementById("comparison-metrics");
    if (!container) return;
    container.replaceChildren();
    if (!selected.length) return;
    const table = document.createElement("table");
    table.innerHTML = `<thead><tr><th>Spieler</th><th>ELO</th><th>Winrate</th><th>K/D</th><th>ADR</th><th>Form</th><th>Gemeinsame Matches</th></tr></thead>`;
    const body = document.createElement("tbody");
    selected.forEach(player => {
      const shared = Math.max(...selected.filter(other => other.id !== player.id).map(other => commonMatches(player, other)), 0);
      const row = document.createElement("tr");
      const values = [
        player.nickname,
        Math.round(comparisonValue(player, "elo")).toLocaleString("de-DE"),
        `${comparisonValue(player, "winrate").toFixed(0)}%`,
        comparisonValue(player, "kd").toFixed(2),
        comparisonValue(player, "adr").toFixed(1),
        `${comparisonValue(player, "form").toFixed(0)}%`,
        String(shared)
      ];
      values.forEach((value, index) => {
        const cell = document.createElement(index ? "td" : "th");
        cell.textContent = value;
        if (!index) cell.scope = "row";
        row.append(cell);
      });
      body.append(row);
    });
    table.append(body);
    container.append(table);
  };

  const renderComparison = async () => {
    const canvas = document.getElementById("comparison-chart");
    const fallback = document.getElementById("chartFallback");
    const data = Array.isArray(window.COMPARISON_DATA) ? window.COMPARISON_DATA : [];
    const selectedPlayers = data.filter(player => state.selectedPlayers.has(player.id));
    renderComparisonMetrics(selectedPlayers);
    const renderId = ++state.comparisonRenderId;
    state.comparisonChart?.destroy();
    state.comparisonChart = null;

    if (!canvas || !selectedPlayers.length || !chartAvailable()) {
      if (canvas) canvas.hidden = true;
      if (fallback) {
        fallback.hidden = false;
        fallback.textContent = chartAvailable()
          ? "Für den Vergleich sind noch keine Verlaufsdaten verfügbar."
          : "Das Diagramm konnte nicht geladen werden. Die Ranking-Daten bleiben vollständig verfügbar.";
      }
      return;
    }

    canvas.hidden = true;
    if (fallback) {
      fallback.hidden = false;
      fallback.textContent = "Verlaufsdaten werden geladen …";
    }

    const selected = (await Promise.all(selectedPlayers.map(async player => ({
      ...player,
      points: toMatchSeries(await resolveHistory(player.id, player.history, 30))
    })))).filter(player => player.points.length >= 2);
    if (renderId !== state.comparisonRenderId) return;

    if (!selected.length) {
      if (fallback) fallback.textContent = "Für den Vergleich sind noch keine Verlaufsdaten verfügbar.";
      return;
    }

    canvas.hidden = false;
    canvas.dataset.pointCounts = selected.map(player => player.points.length).join(",");
    canvas.dataset.axisMode = "match";
    if (fallback) fallback.hidden = true;
    state.comparisonChart = new Chart(canvas, {
      type: "line",
      data: {
        datasets: selected.map((player, index) => ({
          label: player.nickname,
          data: player.points,
          borderColor: colors[index % colors.length],
          backgroundColor: colors[index % colors.length],
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: .34,
          cubicInterpolationMode: "monotone"
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        plugins: {
          legend: { position: "top", align: "start", labels: { usePointStyle: true, boxWidth: 7, boxHeight: 7, padding: 18, font: { size: 10 } } },
          tooltip: {
            displayColors: true,
            callbacks: matchTooltipCallbacks
          }
        },
        onClick: openChartMatch,
        scales: {
          x: {
            type: "linear",
            min: 1,
            max: 30,
            grid: { color: "rgba(255,255,255,.035)" },
            title: { display: true, text: "Letzte 30 Matches →", color: "#606a78", font: { size: 9 } },
            ticks: { maxTicksLimit: 10, precision: 0, font: { size: 9 } }
          },
          y: { grid: { color: "rgba(255,255,255,.055)" }, ticks: { maxTicksLimit: 6, font: { size: 9 } } }
        }
      }
    });
  };

  const renderSynergies = () => {
    const container = document.getElementById("synergy-grid");
    if (!container) return;
    let synergies = Array.isArray(window.DASHBOARD_ANALYTICS?.synergies)
      ? window.DASHBOARD_ANALYTICS.synergies
      : [];
    if (!synergies.length) {
      const byName = new Map(playerRows().map(row => [row.dataset.nickname, row]));
      const seen = new Set();
      synergies = [];
      document.querySelectorAll(".details-row").forEach(details => {
        const playerRow = playerRows().find(row => row.dataset.playerId === details.dataset.playerId);
        const firstList = details.querySelector("ul");
        firstList?.querySelectorAll("li").forEach(item => {
          const mateName = item.querySelector("a")?.textContent?.trim();
          if (!mateName || !byName.has(mateName)) return;
          const pair = [playerRow?.dataset.nickname, mateName].sort();
          const key = pair.join(":");
          if (seen.has(key)) return;
          seen.add(key);
          const copy = item.querySelector("span")?.textContent || "";
          synergies.push({
            players: pair,
            matches: number(copy),
            winrate: number(copy.match(/(\d+)%/)?.[1])
          });
        });
      });
    }
    container.replaceChildren();
    synergies.slice(0, 6).forEach((synergy, index) => {
      const article = document.createElement("article");
      article.className = "synergy-card";
      article.innerHTML = `
        <span class="synergy-rank">${String(index + 1).padStart(2, "0")}</span>
        <div><strong></strong><small></small></div>
        <span class="synergy-rate"></span>`;
      article.querySelector("strong").textContent = (synergy.players || []).join(" + ");
      article.querySelector("small").textContent = `${number(synergy.matches)} gemeinsame Matches`;
      article.querySelector(".synergy-rate").textContent = `${number(synergy.winrate)}% WR`;
      container.append(article);
    });
    if (!container.children.length) {
      const empty = document.createElement("p");
      empty.className = "analytics-empty";
      empty.textContent = "Noch keine gemeinsamen Matches zwischen getrackten Spielern.";
      container.append(empty);
    }
  };

  const waitForCharts = (attempt = 0) => {
    if (chartAvailable()) {
      chartDefaults();
      void renderComparison();
      return;
    }
    if (attempt < 30) window.setTimeout(() => waitForCharts(attempt + 1), 100);
    else void renderComparison();
  };

  setupRows();
  setupFilters();
  setupSorting();
  updateDiffs();
  sortRows();
  createComparisonChips();
  renderSynergies();
  waitForCharts();

  const sharedPlayerId = new URLSearchParams(window.location.search).get("player");
  if (sharedPlayerId) {
    const row = playerRows().find(candidate => candidate.dataset.playerId === sharedPlayerId);
    if (row) {
      window.setTimeout(() => {
        toggleDetails(row);
        row.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
    }
  }
})();
