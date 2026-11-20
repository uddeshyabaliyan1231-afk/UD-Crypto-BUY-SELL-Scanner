
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const BINANCE = "https://fapi.binance.com";

async function getSymbols() {
  const { data } = await axios.get(`${BINANCE}/fapi/v1/exchangeInfo`);
  return data.symbols
    .filter(s => s.contractType === "PERPETUAL" &&
      s.quoteAsset === "USDT" && s.status === "TRADING")
    .map(s => s.symbol);
}

async function getCandles(symbol) {
  const { data } = await axios.get(`${BINANCE}/fapi/v1/klines`, {
    params: { symbol, interval: "5m", limit: 100 }
  });
  return data.map(c => ({
    open: +c[1], high: +c[2], low: +c[3],
    close: +c[4], volume: +c[5]
  }));
}

function calculateSignal(candles) {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const last = candles.at(-1);
  const prev = candles.at(-2);

  const ema = (arr, period) => {
    const k = 2 / (period + 1);
    return arr.slice(1).reduce(
      (value, price) => price * k + value * (1 - k),
      arr[0]
    );
  };

  const ema9 = ema(closes.slice(-40), 9);
  const ema20 = ema(closes.slice(-60), 20);
  const ema50 = ema(closes.slice(-90), 50);

  const volumeMA = arr =>
    arr.slice(-20).reduce((a, b) => a + b, 0) / 20;

  const currentVolumeMA = volumeMA(volumes);
  const previousVolumeMA = volumeMA(volumes.slice(0, -1));

  const volumeRising =
    last.volume > prev.volume &&
    currentVolumeMA > previousVolumeMA;

  let buyScore = 0;
  let sellScore = 0;

  if (ema9 > ema20) buyScore += 2;
  if (ema9 < ema20) sellScore += 2;

  if (ema20 > ema50) buyScore += 2;
  if (ema20 < ema50) sellScore += 2;

  if (last.close > ema9) buyScore++;
  if (last.close < ema9) sellScore++;

  if (last.close > prev.close) buyScore++;
  if (last.close < prev.close) sellScore++;

  if (volumeRising) {
    if (last.close > last.open) buyScore += 2;
    if (last.close < last.open) sellScore += 2;
  }

  return {
    signal: buyScore >= sellScore ? "BUY" : "SELL",
    buyScore,
    sellScore,
    price: last.close,
    volumeRising
  };
}

app.get("/api/symbols", async (req, res) => {
  try {
    res.json({ symbols: await getSymbols() });
  } catch (error) {
    res.status(500).json({ error: "Unable to load symbols" });
  }
});

app.get("/api/analyze/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    if (!/^[A-Z0-9]+USDT$/.test(symbol)) {
      return res.status(400).json({ error: "Invalid USDT symbol" });
    }

    const candles = await getCandles(symbol);
    const result = calculateSignal(candles);

    res.json({
      symbol,
      timeframe: "5m",
      ...result,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Coin analysis failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`UD Scanner running on port ${PORT}`);
});
