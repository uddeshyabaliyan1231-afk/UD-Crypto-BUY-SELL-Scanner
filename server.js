
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const BINANCE_HOSTS = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
  "https://fapi3.binance.com",
  "https://fapi4.binance.com"
];

const http = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent": "Mozilla/5.0 UD-Crypto-Scanner"
  }
});

async function binanceRequest(path, params = {}) {
  let lastError;

  for (const host of BINANCE_HOSTS) {
    try {
      const response = await http.get(host + path, { params });
      return response.data;
    } catch (error) {
      lastError = error;

      console.error("BINANCE REQUEST FAILED:", {
        host,
        path,
        status: error.response?.status,
        message: error.message,
        response: error.response?.data
      });
    }
  }

  const status = lastError?.response?.status;
  const responseData = lastError?.response?.data;

  throw new Error(
    responseData?.msg ||
    responseData?.message ||
    `All Binance endpoints failed. HTTP ${status || "connection error"}: ${lastError?.message || "Unknown error"}`
  );
}

// GET ALL USDT PERPETUAL COINS

async function getSymbols() {
  const data = await binanceRequest("/fapi/v1/exchangeInfo");

  if (!Array.isArray(data.symbols)) {
    throw new Error("Invalid Binance exchange information");
  }

  return data.symbols
    .filter(coin =>
      coin.contractType === "PERPETUAL" &&
      coin.quoteAsset === "USDT" &&
      coin.status === "TRADING"
    )
    .map(coin => coin.symbol);
}

// GET 5 MINUTE CANDLES

async function getCandles(symbol) {
  const data = await binanceRequest("/fapi/v1/klines", {
    symbol,
    interval: "5m",
    limit: 100
  });

  if (!Array.isArray(data) || data.length < 60) {
    throw new Error("Insufficient candle data for " + symbol);
  }

  return data.map(candle => ({
    open: Number(candle[1]),
    high: Number(candle[2]),
    low: Number(candle[3]),
    close: Number(candle[4]),
    volume: Number(candle[5])
  }));
}

// EMA CALCULATION

function calculateEMA(values, period) {
  const multiplier = 2 / (period + 1);

  let ema = values[0];

  for (let i = 1; i < values.length; i++) {
    ema = values[i] * multiplier +
      ema * (1 - multiplier);
  }

  return ema;
}

// BUY / SELL ANALYSIS

function calculateSignal(candles) {
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

  // EMA TREND

  if (ema9 > ema20) buyScore += 2;
  else sellScore += 2;

  if (ema20 > ema50) buyScore += 2;
  else sellScore += 2;

  // PRICE POSITION

  if (last.close > ema9) buyScore++;
  else sellScore++;

  // PRICE MOMENTUM

  if (last.close > previous.close) buyScore++;
  else sellScore++;

  // VOLUME CONFIRMATION

  if (volumeRising) {
    if (last.close > last.open) buyScore += 2;
    else if (last.close < last.open) sellScore += 2;
  }

  // FINAL DIRECTION: ONLY BUY OR SELL

  const signal =
    buyScore >= sellScore ? "BUY" : "SELL";

  return {
    signal,
    buyScore,
    sellScore,
    price: last.close,
    volumeRising,
    ema9,
    ema20,
    ema50
  };
}

// HEALTH CHECK

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    scanner: "UD Crypto Intelligence",
    timeframe: "5m"
  });
});

// SYMBOL LIST API

app.get("/api/symbols", async (req, res) => {
  try {
    const symbols = await getSymbols();

    res.json({
      count: symbols.length,
      symbols
    });

  } catch (error) {
    console.error("SYMBOLS API ERROR:", error.message);

    res.status(502).json({
      error: error.message
    });
  }
});

// COIN ANALYSIS API

app.get("/api/analyze/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    if (!/^[A-Z0-9]+USDT$/.test(symbol)) {
      return res.status(400).json({
        error: "Enter a valid USDT coin symbol"
      });
    }

    const candles = await getCandles(symbol);

    const analysis = calculateSignal(candles);

    res.json({
      symbol,
      timeframe: "5m",
      ...analysis,
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error("ANALYSIS API ERROR:", error.message);

    res.status(502).json({
      error: error.message
    });
  }
});

// SERVER START

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("UD CRYPTO BUY-SELL SCANNER RUNNING");
  console.log("PORT:", PORT);
});
