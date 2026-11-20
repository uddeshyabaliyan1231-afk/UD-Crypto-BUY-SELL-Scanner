
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const API = "https://api.coindcx.com";
const PUBLIC_API = "https://public.coindcx.com";

const http = axios.create({
  timeout: 20000,
  headers: { "User-Agent": "UD-Crypto-Scanner/1.0" }
});

let cachedPairs = [];
let cacheTime = 0;

async function getInstruments() {
  if (cachedPairs.length && Date.now() - cacheTime < 300000) {
    return cachedPairs;
  }

  const response = await http.get(
    API + "/exchange/v1/derivatives/futures/data/active_instruments",
    { params: { "margin_currency_short_name[]": "USDT" } }
  );

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid CoinDCX instruments response");
  }

  cachedPairs = response.data.filter(
    p => typeof p === "string" && p.endsWith("_USDT")
  );

  cacheTime = Date.now();

  if (!cachedPairs.length) {
    throw new Error("No active USDT futures pairs found");
  }

  return cachedPairs;
}

function displaySymbol(pair) {
  return pair.replace(/^B-/, "").replace(/_/g, "");
}

async function getSymbols() {
  const pairs = await getInstruments();
  return pairs.map(displaySymbol).sort();
}

async function getCandles(symbol) {
  const pairs = await getInstruments();

  const pair = pairs.find(
    p => displaySymbol(p).toUpperCase() === symbol.toUpperCase()
  );

  if (!pair) {
    throw new Error(symbol + " is not an active CoinDCX USDT futures pair");
  }

  const now = Math.floor(Date.now() / 1000);
  const from = now - 36000;

  const response = await http.get(
    PUBLIC_API + "/market_data/candlesticks",
    {
      params: {
        pair,
        from,
        to: now,
        resolution: "5",
        pcode: "f"
      }
    }
  );

  const rows = Array.isArray(response.data)
    ? response.data
    : response.data?.data;

  if (!Array.isArray(rows) || rows.length < 60) {
    throw new Error("Insufficient 5-minute candle data for " + symbol);
  }

  return rows.map(c => ({
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
    time: Number(c.time)
  }))
  .filter(c =>
    Number.isFinite(c.close) &&
    Number.isFinite(c.open) &&
    Number.isFinite(c.volume)
  )
  .sort((a, b) => a.time - b.time);
}

function calculateEMA(values, period) {
  const multiplier = 2 / (period + 1);
  let ema = values[0];

  for (let i = 1; i < values.length; i++) {
    ema = values[i] * multiplier +
      ema * (1 - multiplier);
  }

  return ema;
}

function calculateSignal(candles) {
  if (candles.length < 60) {
    throw new Error("At least 60 candles required");
  }

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2];

  const ema9 = calculateEMA(closes.slice(-40), 9);
  const ema20 = calculateEMA(closes.slice(-60), 20);
  const ema50 = calculateEMA(closes.slice(-90), 50);

  const currentVolumeMA =
    volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;

  const previousVolumeMA =
    volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;

  const volumeRising =
    last.volume > previous.volume &&
    currentVolumeMA > previousVolumeMA;

  let buyScore = 0;
  let sellScore = 0;

  if (ema9 > ema20) buyScore += 2;
  else sellScore += 2;

  if (ema20 > ema50) buyScore += 2;
  else sellScore += 2;

  if (last.close > ema9) buyScore++;
  else sellScore++;

  if (last.close > previous.close) buyScore++;
  else sellScore++;

  if (volumeRising) {
    if (last.close > last.open) buyScore += 2;
    else if (last.close < last.open) sellScore += 2;
  }

  return {
    signal: buyScore >= sellScore ? "BUY" : "SELL",
    buyScore,
    sellScore,
    price: last.close,
    volumeRising,
    ema9,
    ema20,
    ema50
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    exchange: "CoinDCX Futures",
    timeframe: "5m"
  });
});

app.get("/api/symbols", async (req, res) => {
  try {
    const symbols = await getSymbols();
    res.json({ count: symbols.length, symbols });
  } catch (error) {
    console.error("SYMBOLS ERROR:", error.response?.status, error.response?.data || error.message);
    res.status(502).json({
      error: error.response?.data?.message || error.message
    });
  }
});

app.get("/api/analyze/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    if (!/^[A-Z0-9]+USDT$/.test(symbol)) {
      return res.status(400).json({
        error: "Enter a valid USDT coin symbol"
      });
    }

    const candles = await getCandles(symbol);
    const result = calculateSignal(candles);

    res.json({
      symbol,
      exchange: "CoinDCX",
      timeframe: "5m",
      ...result,
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error("ANALYSIS ERROR:", error.response?.status, error.response?.data || error.message);
    res.status(502).json({
      error: error.response?.data?.message || error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("UD CRYPTO BUY-SELL SCANNER RUNNING");
  console.log("Exchange: CoinDCX Futures");
  console.log("Timeframe: 5m");
  console.log("Port:", PORT);
});
