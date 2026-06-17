const SAMPLE_DATA = {
  updatedAt: "2026-06-16",
  snapshot: [
    { label: "USD / IDR", value: "16,315", note: "Close" },
    { label: "BI rate", value: "6.25%", note: "Latest decision" },
    { label: "IHSG", value: "7,214", note: "Index level" },
    { label: "Inflation", value: "2.84%", note: "YoY" },
  ],
  metrics: [
    {
      label: "USD / IDR",
      value: "16,315",
      delta: "-1.4% MoM",
      tone: "down",
    },
    {
      label: "BI rate",
      value: "6.25%",
      delta: "Flat vs prior meeting",
      tone: "flat",
    },
    {
      label: "IHSG",
      value: "7,214",
      delta: "+2.1% MoM",
      tone: "up",
    },
    {
      label: "Inflation",
      value: "2.84%",
      delta: "Inside target band",
      tone: "up",
    },
  ],
  series: {
    fx: [
      ["2026-01-02", 16240],
      ["2026-02-02", 16395],
      ["2026-03-03", 16420],
      ["2026-04-01", 16335],
      ["2026-05-01", 16195],
      ["2026-06-16", 16315],
    ],
    rate: [
      ["2026-01-01", 6.25],
      ["2026-02-01", 6.25],
      ["2026-03-01", 6.25],
      ["2026-04-01", 6.25],
      ["2026-05-01", 6.25],
      ["2026-06-01", 6.25],
    ],
    ihsg: [
      ["2026-01-02", 7110],
      ["2026-02-02", 7044],
      ["2026-03-03", 7188],
      ["2026-04-01", 7058],
      ["2026-05-01", 7069],
      ["2026-06-16", 7214],
    ],
    inflation: [
      ["2026-01-01", 2.61],
      ["2026-02-01", 2.48],
      ["2026-03-01", 2.73],
      ["2026-04-01", 2.66],
      ["2026-05-01", 2.79],
      ["2026-06-01", 2.84],
    ],
  },
  insights: [
    "Rupiah stayed broadly stable, with the latest move still contained inside the recent trading range.",
    "Policy remains on hold, which keeps the market focused on inflation surprises and U.S. rate expectations.",
    "IHSG recovered into mid-June after a softer early-quarter patch, suggesting a modest risk-on tone.",
    "Inflation is still comfortably inside the target band, reducing immediate pressure on BI to tighten again.",
  ],
};

const SOURCE_CONFIG = {
  fx: {
    symbols: ["USDIDR=X", "IDR=X"],
    label: "Yahoo Finance mirror",
  },
  ihsg: {
    symbols: ["^JKSE"],
    label: "Yahoo Finance mirror",
  },
};

const formatters = {
  currency: new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }),
  percent: new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};

const FX_RANGE_MAP = {
  "1w": 7,
  "1m": 31,
  "3m": 93,
  "1y": 366,
};

// Maps each UI range to the actual Yahoo Finance query params needed to pull
// that much real history. Without this, every range button just re-filtered
// whatever fixed "1mo" window was already fetched, so 3M/1Y never showed
// more data than 1M did.
const YAHOO_RANGE_MAP = {
  "1w": { range: "5d", interval: "1d" },
  "1m": { range: "1mo", interval: "1d" },
  "3m": { range: "3mo", interval: "1d" },
  "1y": { range: "1y", interval: "1d" },
};

let currentFxRange = "1m";
let currentFxSymbol = null;
const fxRangeCache = new Map();
let priceAlertThreshold = null;
let priceAlertNotified = false;
let latestDashboardData = null;

function parseYahooChartResponse(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const series = [];

  timestamps.forEach((timestamp, index) => {
    const close = closes[index];
    if (typeof close !== "number") {
      return;
    }
    series.push([new Date(timestamp * 1000).toISOString().slice(0, 10), close]);
  });

  return series;
}

async function fetchYahooSeries(symbol, range = "1mo", interval = "1d") {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", range);
  url.searchParams.set("interval", interval);
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");
  url.searchParams.set("corsDomain", "finance.yahoo.com");

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Yahoo fetch failed for ${symbol}`);
  }

  const payload = await response.json();
  const series = parseYahooChartResponse(payload);
  if (series.length === 0) {
    throw new Error(`Yahoo series empty for ${symbol}`);
  }

  return series;
}

async function fetchFirstAvailableSeries(symbols, range, interval) {
  for (const symbol of symbols) {
    try {
      const series = await fetchYahooSeries(symbol, range, interval);
      return { symbol, series };
    } catch (error) {
      console.warn(`Mirror source unavailable for ${symbol}`, error);
    }
  }

  return null;
}

// Fetches BI rate historical data. For now, returns null to trigger fallback.
// Future: integrate with maintained BI rate source or curated reference table.
async function fetchBiRateSeries() {
  try {
    const endpoint = SOURCE_CONFIG.rate?.endpoint;
    if (!endpoint || endpoint.includes("example.com")) {
      return null; // Placeholder endpoint, skip fetch
    }
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("BI rate fetch failed");
    }
    const data = await response.json();
    return data.series || null;
  } catch (error) {
    console.warn("BI rate live fetch unavailable, using sample data", error);
    return null;
  }
}

// Fetches inflation historical data. For now, returns null to trigger fallback.
// Future: integrate with BPS data or maintained inflation source.
async function fetchInflationSeries() {
  try {
    const endpoint = SOURCE_CONFIG.inflation?.endpoint;
    if (!endpoint || endpoint.includes("example.com")) {
      return null; // Placeholder endpoint, skip fetch
    }
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Inflation fetch failed");
    }
    const data = await response.json();
    return data.series || null;
  } catch (error) {
    console.warn("Inflation live fetch unavailable, using sample data", error);
    return null;
  }
}

async function loadDashboardData() {
  const electronLoader = globalThis.rupiahMacro?.loadDashboardData;
  if (typeof electronLoader === "function") {
    try {
      return await electronLoader();
    } catch (error) {
      console.warn("Electron data bridge failed, falling back to fetch", error);
    }
  }

  try {
    const response = await fetch("./data/dashboard.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("sample data unavailable");
    }

    const data = await response.json();
    const fxParams = YAHOO_RANGE_MAP[currentFxRange] || YAHOO_RANGE_MAP["1m"];
    const [fxMirror, ihsgMirror, biRateLive, inflationLive] = await Promise.all([
      fetchFirstAvailableSeries(SOURCE_CONFIG.fx.symbols, fxParams.range, fxParams.interval),
      fetchFirstAvailableSeries(SOURCE_CONFIG.ihsg.symbols, "1mo", "1d"),
      fetchBiRateSeries(),
      fetchInflationSeries(),
    ]);

    const sourceNotes = [];

    if (fxMirror?.series) {
      currentFxSymbol = fxMirror.symbol;
      fxRangeCache.set(currentFxRange, fxMirror.series);
      data.series.fx = fxMirror.series;
      data.snapshot[0] = {
        ...data.snapshot[0],
        value: formatCurrencySeriesPoint(fxMirror.series.at(-1)[1]),
        note: `${SOURCE_CONFIG.fx.label} ${fxMirror.symbol}`,
      };
      data.metrics[0] = {
        ...data.metrics[0],
        value: formatCurrencySeriesPoint(fxMirror.series.at(-1)[1]),
        delta: seriesTrendLabel(fxMirror.series),
      };
      sourceNotes.push(`FX live from ${fxMirror.symbol}`);
    }

    if (biRateLive?.length > 0) {
      data.series.rate = biRateLive;
      data.snapshot[1] = {
        ...data.snapshot[1],
        value: formatters.percent.format(biRateLive.at(-1)[1]) + "%",
        note: `${SOURCE_CONFIG.rate.label}`,
      };
      data.metrics[1] = {
        ...data.metrics[1],
        value: formatters.percent.format(biRateLive.at(-1)[1]) + "%",
        delta: seriesTrendLabel(biRateLive),
      };
      sourceNotes.push(`BI rate live from ${SOURCE_CONFIG.rate.label}`);
    }

    if (ihsgMirror?.series) {
      data.series.ihsg = ihsgMirror.series;
      data.snapshot[2] = {
        ...data.snapshot[2],
        value: formatIntSeriesPoint(ihsgMirror.series.at(-1)[1]),
        note: `${SOURCE_CONFIG.ihsg.label} ${ihsgMirror.symbol}`,
      };
      data.metrics[2] = {
        ...data.metrics[2],
        value: formatIntSeriesPoint(ihsgMirror.series.at(-1)[1]),
        delta: seriesTrendLabel(ihsgMirror.series),
      };
      sourceNotes.push(`IHSG live from ${ihsgMirror.symbol}`);
    }

    if (inflationLive?.length > 0) {
      data.series.inflation = inflationLive;
      data.snapshot[3] = {
        ...data.snapshot[3],
        value: formatters.percent.format(inflationLive.at(-1)[1]) + "%",
        note: `${SOURCE_CONFIG.inflation.label}`,
      };
      data.metrics[3] = {
        ...data.metrics[3],
        value: formatters.percent.format(inflationLive.at(-1)[1]) + "%",
        delta: seriesTrendLabel(inflationLive),
      };
      sourceNotes.push(`Inflation live from ${SOURCE_CONFIG.inflation.label}`);
    }

    data.sourceNotes = sourceNotes.length > 0 ? sourceNotes : ["Live mirror sources unavailable; showing fallback data."];
    return data;
  } catch {
    return {
      ...SAMPLE_DATA,
      sourceNotes: ["Live mirror sources unavailable; showing fallback data."],
    };
  }
}

function formatCurrencySeriesPoint(value) {
  return formatters.currency.format(value);
}

function formatIntSeriesPoint(value) {
  return formatters.currency.format(Math.round(value));
}

function seriesTrendLabel(series) {
  const first = series[0][1];
  const last = series[series.length - 1][1];
  const diff = last - first;
  const pct = first === 0 ? 0 : (diff / first) * 100;
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  return `${sign}${formatters.percent.format(Math.abs(pct))}% over sample window`;
}

function createMetricCard(metric) {
  const card = document.createElement("article");
  card.className = "metric-card";

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = metric.label;

  const value = document.createElement("div");
  value.className = "value";
  value.textContent = metric.value;

  const delta = document.createElement("div");
  delta.className = `delta ${metric.tone || "flat"}`;
  delta.textContent = metric.delta;

  card.append(label, value, delta);
  return card;
}

function createSnapshotItem(item) {
  const row = document.createElement("div");
  row.className = "snapshot-item";

  const left = document.createElement("strong");
  left.textContent = item.label;

  const right = document.createElement("span");
  right.textContent = `${item.value}\n${item.note}`;

  row.append(left, right);
  return row;
}

function seriesBounds(points) {
  const values = points.map(([, value]) => value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = (max - min) * 0.16 || max * 0.08 || 1;
  return {
    min: min - padding,
    max: max + padding,
  };
}

function formatDateLabel(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  });
}

function renderSparkline(target, series, options) {
  const width = 640;
  const height = 260;
  const padding = { top: 22, right: 18, bottom: 34, left: 56 };
  const bounds = seriesBounds(series);
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const x = (index) =>
    padding.left + (series.length === 1 ? innerWidth / 2 : (index / (series.length - 1)) * innerWidth);
  const y = (value) =>
    padding.top +
    innerHeight -
    ((value - bounds.min) / (bounds.max - bounds.min || 1)) * innerHeight;

  const linePoints = series.map(([date, value], index) => `${x(index)},${y(value)}`).join(" ");
  const areaPath = `M ${padding.left},${padding.top + innerHeight} ${series
    .map(([date, value], index) => `L ${x(index)} ${y(value)}`)
    .join(" ")} L ${padding.left + innerWidth},${padding.top + innerHeight} Z`;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", options.ariaLabel);

  for (let i = 0; i < 5; i += 1) {
    const gridY = padding.top + (innerHeight / 4) * i;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", padding.left);
    line.setAttribute("x2", width - padding.right);
    line.setAttribute("y1", gridY);
    line.setAttribute("y2", gridY);
    line.setAttribute("class", "grid-line");
    svg.appendChild(line);
  }

  const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  axis.setAttribute("x1", padding.left);
  axis.setAttribute("x2", width - padding.right);
  axis.setAttribute("y1", height - padding.bottom);
  axis.setAttribute("y2", height - padding.bottom);
  axis.setAttribute("class", "axis");
  svg.appendChild(axis);

  const fill = document.createElementNS("http://www.w3.org/2000/svg", "path");
  fill.setAttribute("d", areaPath);
  fill.setAttribute("fill", options.fill);
  fill.setAttribute("class", "fill");
  svg.appendChild(fill);

  const seriesPath = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  seriesPath.setAttribute("points", linePoints);
  seriesPath.setAttribute("class", "series");
  seriesPath.setAttribute("stroke", options.stroke);
  svg.appendChild(seriesPath);

  series.forEach((point, index) => {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", x(index));
    dot.setAttribute("cy", y(point[1]));
    dot.setAttribute("r", 5);
    dot.setAttribute("class", "point");
    dot.setAttribute("stroke", options.stroke);
    svg.appendChild(dot);
  });

  const minLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
  minLabel.setAttribute("x", 0);
  minLabel.setAttribute("y", height - 10);
  minLabel.setAttribute("class", "label");
  minLabel.textContent = options.formatValue(bounds.min);
  svg.appendChild(minLabel);

  const maxLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
  maxLabel.setAttribute("x", 0);
  maxLabel.setAttribute("y", padding.top + 10);
  maxLabel.setAttribute("class", "label");
  maxLabel.textContent = options.formatValue(bounds.max);
  svg.appendChild(maxLabel);

  const firstDate = document.createElementNS("http://www.w3.org/2000/svg", "text");
  firstDate.setAttribute("x", padding.left);
  firstDate.setAttribute("y", height - 10);
  firstDate.setAttribute("class", "label");
  firstDate.textContent = formatDateLabel(series[0][0]);
  svg.appendChild(firstDate);

  const lastDate = document.createElementNS("http://www.w3.org/2000/svg", "text");
  lastDate.setAttribute("x", width - padding.right - 52);
  lastDate.setAttribute("y", height - 10);
  lastDate.setAttribute("class", "label");
  lastDate.textContent = formatDateLabel(series[series.length - 1][0]);
  svg.appendChild(lastDate);

  target.innerHTML = "";
  target.appendChild(svg);
}

function renderInsights(target, insights) {
  target.innerHTML = "";
  insights.forEach((insight) => {
    const li = document.createElement("li");
    li.textContent = insight;
    target.appendChild(li);
  });
}

function seriesMeta(series) {
  const first = series[0][1];
  const last = series[series.length - 1][1];
  const diff = last - first;
  const pct = first === 0 ? 0 : (diff / first) * 100;
  const direction = Math.abs(diff) < 0.0001 ? "flat" : diff > 0 ? "up" : "down";
  const label =
    direction === "flat"
      ? "Flat over sample window"
      : `${direction === "up" ? "+" : ""}${formatters.percent.format(pct)}% over sample window`;
  return {
    text: label,
    direction,
  };
}

function renderMeta(target, series, formatter) {
  const meta = seriesMeta(series);
  target.textContent = meta.text;
  target.dataset.direction = meta.direction;
  if (meta.direction === "up") {
    target.style.color = "var(--accent-3)";
  } else if (meta.direction === "down") {
    target.style.color = "var(--accent)";
  } else {
    target.style.color = "var(--muted)";
  }
}

function filterSeriesByRange(series, range) {
  const days = FX_RANGE_MAP[range] || FX_RANGE_MAP["1m"];
  const lastDate = new Date(`${series.at(-1)[0]}T00:00:00`);
  const cutoff = new Date(lastDate);
  cutoff.setDate(lastDate.getDate() - days);
  const filtered = series.filter(([dateString]) => {
    const pointDate = new Date(`${dateString}T00:00:00`);
    return pointDate >= cutoff;
  });
  return filtered.length > 1 ? filtered : series.slice(-Math.min(series.length, 3));
}

// Used when the user clicks a range button. Tries to pull real history for
// that exact window from the live mirror first (cached after the first
// fetch); only falls back to day-filtering the in-memory series (sample data
// or whatever was last fetched) if a live fetch isn't available.
async function fetchFxSeriesForRange(range) {
  if (fxRangeCache.has(range)) {
    return fxRangeCache.get(range);
  }

  const params = YAHOO_RANGE_MAP[range] || YAHOO_RANGE_MAP["1m"];
  const symbolsToTry = currentFxSymbol
    ? [currentFxSymbol, ...SOURCE_CONFIG.fx.symbols]
    : SOURCE_CONFIG.fx.symbols;

  const mirror = await fetchFirstAvailableSeries(symbolsToTry, params.range, params.interval);
  if (mirror?.series) {
    currentFxSymbol = mirror.symbol;
    fxRangeCache.set(range, mirror.series);
    return mirror.series;
  }

  return null;
}

function updateRangeButtons() {
  document.querySelectorAll("#range-selector .range-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.range === currentFxRange);
  });
}

function setPriceAlertStatus(message, statusClass = "") {
  const status = document.getElementById("price-alert-status");
  if (!status) {
    return;
  }
  status.textContent = message;
  status.className = `price-alert-status ${statusClass}`.trim();
}

function ensureNotificationPermission() {
  if (typeof Notification === "undefined") {
    return;
  }
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// Fires a real notification the moment the alert flips from "not triggered"
// to "triggered", instead of just relying on someone reading the status
// text on the page. Only fires once per crossing so it doesn't spam every
// 60s refresh while the price stays above the threshold.
function maybeNotifyPriceAlert(triggered) {
  if (!triggered) {
    priceAlertNotified = false;
    return;
  }

  if (priceAlertNotified) {
    return;
  }
  priceAlertNotified = true;

  const message = `USD/IDR reached your alert level of IDR ${formatters.currency.format(priceAlertThreshold)}.`;

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification("rupiah-macro price alert", { body: message });
  }

  const status = document.getElementById("price-alert-status");
  if (status) {
    status.classList.add("flash");
    setTimeout(() => status.classList.remove("flash"), 4000);
  }
}

function savePriceAlert(threshold) {
  priceAlertThreshold = threshold;
  window.localStorage.setItem("fxPriceAlertThreshold", String(threshold));
}

function clearPriceAlertValue() {
  priceAlertThreshold = null;
  priceAlertNotified = false;
  window.localStorage.removeItem("fxPriceAlertThreshold");
  const input = document.getElementById("price-alert-input");
  if (input) {
    input.value = "";
  }
  setPriceAlertStatus("No alert set.");
}

function loadSavedPriceAlert() {
  const saved = window.localStorage.getItem("fxPriceAlertThreshold");
  if (saved && !Number.isNaN(Number(saved))) {
    priceAlertThreshold = Number(saved);
    const input = document.getElementById("price-alert-input");
    if (input) {
      input.value = String(priceAlertThreshold);
    }
  }
}

function updatePriceAlertStatus(latestPrice) {
  if (!priceAlertThreshold) {
    setPriceAlertStatus("No alert set.");
    priceAlertNotified = false;
    return;
  }

  const formattedThreshold = formatters.currency.format(priceAlertThreshold);
  const formattedPrice = formatters.currency.format(latestPrice);
  const triggered = latestPrice >= priceAlertThreshold;
  maybeNotifyPriceAlert(triggered);
  if (triggered) {
    setPriceAlertStatus(`Alert triggered at IDR ${formattedPrice} (threshold IDR ${formattedThreshold})`, "triggered");
  } else {
    setPriceAlertStatus(`Alert set at IDR ${formattedThreshold}. Current IDR ${formattedPrice}.`);
  }
}

function renderFxChart(target, series, options) {
  const filteredSeries = filterSeriesByRange(series, currentFxRange);
  renderSparkline(target, filteredSeries, options);
}

function formatMetricValue(metric) {
  if (metric.label === "USD / IDR" || metric.label === "IHSG") {
    return metric.value;
  }
  return metric.value;
}

const REFRESH_INTERVAL_MS = 60_000; // poll mirrors every 60s

let consecutiveFailures = 0;
let refreshTimer = null;

function setLiveStatus(state, { timestamp, failures } = {}) {
  const wrapper = document.getElementById("live-status");
  const text = document.getElementById("live-text");
  if (!wrapper || !text) {
    return;
  }

  wrapper.dataset.state = state;

  const timeLabel = timestamp
    ? timestamp.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null;

  if (state === "live") {
    text.textContent = `Live · updated ${timeLabel}`;
  } else if (state === "stale") {
    text.textContent = `Fallback data · checked ${timeLabel}`;
  } else if (state === "error") {
    text.textContent = failures > 1 ? `Connection lost · retry ${failures}` : "Refresh failed · retrying";
  } else {
    text.textContent = "Connecting…";
  }
}

function renderDashboard(data) {
  document.title = `rupiah-macro | ${data.updatedAt}`;

  const panelNote = document.getElementById("panel-note");
  if (panelNote) {
    panelNote.textContent = data.sourceNotes?.join(" | ") || "Sample data loaded from local JSON";
  }

  const snapshot = document.getElementById("snapshot");
  snapshot.innerHTML = "";
  data.snapshot.forEach((item) => snapshot.appendChild(createSnapshotItem(item)));

  const metricGrid = document.getElementById("metric-grid");
  metricGrid.innerHTML = "";
  data.metrics.forEach((metric) => {
    const card = createMetricCard({
      ...metric,
      value: formatMetricValue(metric),
    });
    metricGrid.appendChild(card);
  });

  updateRangeButtons();
  loadSavedPriceAlert();
  updatePriceAlertStatus(data.series.fx.at(-1)[1]);

  renderFxChart(document.getElementById("fx-chart"), data.series.fx, {
    ariaLabel: "IDR to USD exchange rate series",
    stroke: "#b35c2e",
    fill: "rgba(179, 92, 46, 0.45)",
    formatValue: (value) => `IDR ${formatters.currency.format(value)}`,
  });

  renderSparkline(document.getElementById("rate-chart"), data.series.rate, {
    ariaLabel: "BI policy rate series",
    stroke: "#1d6f91",
    fill: "rgba(29, 111, 145, 0.45)",
    formatValue: (value) => `${formatters.percent.format(value)}%`,
  });

  renderSparkline(document.getElementById("idx-chart"), data.series.ihsg, {
    ariaLabel: "IHSG index series",
    stroke: "#2f6f4d",
    fill: "rgba(47, 111, 77, 0.45)",
    formatValue: (value) => formatters.currency.format(value),
  });

  renderSparkline(document.getElementById("infl-chart"), data.series.inflation, {
    ariaLabel: "Inflation series",
    stroke: "#8c6b13",
    fill: "rgba(140, 107, 19, 0.45)",
    formatValue: (value) => `${formatters.percent.format(value)}%`,
  });

  renderMeta(document.getElementById("fx-meta"), data.series.fx);
  renderMeta(document.getElementById("rate-meta"), data.series.rate);
  renderMeta(document.getElementById("idx-meta"), data.series.ihsg);
  renderMeta(document.getElementById("infl-meta"), data.series.inflation);

  renderInsights(document.getElementById("insight-list"), data.insights);
}

async function refreshDashboard() {
  if (document.hidden) {
    return; // don't burn requests on a backgrounded tab
  }

  fxRangeCache.clear();

  let data;
  try {
    data = await loadDashboardData();
  } catch (error) {
    console.error("Dashboard refresh failed", error);
    consecutiveFailures += 1;
    setLiveStatus("error", { failures: consecutiveFailures });
    return;
  }

  consecutiveFailures = 0;
  latestDashboardData = data;
  renderDashboard(data);

  const isLive = Boolean(data.sourceNotes?.some((note) => note.includes("live from")));
  setLiveStatus(isLive ? "live" : "stale", { timestamp: new Date() });
}

function startAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  refreshTimer = setInterval(refreshDashboard, REFRESH_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshDashboard();
    }
  });
}

function wireDashboardControls() {
  document.querySelectorAll("#range-selector .range-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const range = button.dataset.range;
      if (!range || range === currentFxRange) {
        return;
      }
      currentFxRange = range;
      updateRangeButtons();

      const fxChartEl = document.getElementById("fx-chart");
      const fxOptions = {
        ariaLabel: "IDR to USD exchange rate series",
        stroke: "#b35c2e",
        fill: "rgba(179, 92, 46, 0.45)",
        formatValue: (value) => `IDR ${formatters.currency.format(value)}`,
      };

      let seriesForRange = null;
      try {
        seriesForRange = await fetchFxSeriesForRange(range);
      } catch (error) {
        console.warn("Live range fetch failed, falling back to cached series", error);
      }

      if (seriesForRange) {
        renderSparkline(fxChartEl, seriesForRange, fxOptions);
        renderMeta(document.getElementById("fx-meta"), seriesForRange);
        updatePriceAlertStatus(seriesForRange.at(-1)[1]);
      } else if (latestDashboardData) {
        renderFxChart(fxChartEl, latestDashboardData.series.fx, fxOptions);
      }
    });
  });

  const form = document.getElementById("price-alert-form");
  const clearButton = document.getElementById("clear-price-alert");

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.getElementById("price-alert-input");
      const value = input ? Number(input.value) : NaN;
      if (!Number.isFinite(value) || value <= 0) {
        setPriceAlertStatus("Enter a valid alert price.");
        return;
      }
      savePriceAlert(value);
      priceAlertNotified = false;
      ensureNotificationPermission();
      if (latestDashboardData) {
        updatePriceAlertStatus(latestDashboardData.series.fx.at(-1)[1]);
      }
    });
  }

  if (clearButton) {
    clearButton.addEventListener("click", () => {
      clearPriceAlertValue();
    });
  }
}

async function main() {
  setLiveStatus("loading");
  await refreshDashboard();
  wireDashboardControls();
  startAutoRefresh();
}

main().catch((error) => {
  console.error("Failed to boot dashboard", error);
  setLiveStatus("error", { failures: 1 });
  const fallback = document.createElement("p");
  fallback.textContent = "Dashboard failed to load.";
  document.body.appendChild(fallback);
});
