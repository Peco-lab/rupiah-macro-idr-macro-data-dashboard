const { contextBridge } = require("electron");
const fs = require("fs/promises");
const path = require("path");

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

function formatCurrencySeriesPoint(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatIntSeriesPoint(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function seriesTrendLabel(series) {
  const first = series[0][1];
  const last = series[series.length - 1][1];
  const diff = last - first;
  const pct = first === 0 ? 0 : (diff / first) * 100;
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  return `${sign}${Math.abs(pct).toFixed(2)}% over sample window`;
}

async function loadDashboardData() {
  const dataPath = path.join(__dirname, "data", "dashboard.json");
  const contents = await fs.readFile(dataPath, "utf8");
  const data = JSON.parse(contents);
  const [fxMirror, ihsgMirror] = await Promise.all([
    fetchFirstAvailableSeries(SOURCE_CONFIG.fx.symbols, "1mo", "1d"),
    fetchFirstAvailableSeries(SOURCE_CONFIG.ihsg.symbols, "1mo", "1d"),
  ]);

  const sourceNotes = [];

  if (fxMirror?.series) {
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

  data.sourceNotes = sourceNotes.length > 0 ? sourceNotes : ["Live mirror sources unavailable; showing fallback data."];
  return data;
}

contextBridge.exposeInMainWorld("rupiahMacro", {
  loadDashboardData,
});
