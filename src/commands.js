import { InlineKeyboard } from "grammy";

const API = "https://api.binance.com";

const COINS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "TRXUSDT", "TONUSDT", "LINKUSDT",
  "AVAXUSDT", "DOTUSDT", "LTCUSDT", "BCHUSDT", "SUIUSDT",
  "XLMUSDT", "HBARUSDT", "SHIBUSDT", "UNIUSDT", "AAVEUSDT",
  "NEARUSDT", "ETCUSDT", "APTUSDT", "ICPUSDT", "FILUSDT",
  "ATOMUSDT", "ARBUSDT", "OPUSDT", "INJUSDT", "RENDERUSDT"
];

async function getJSON(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

function formatPrice(value) {
  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: 8
  });
}

function calculateEMA(values, period) {
  const multiplier = 2 / (period + 1);
  let ema = values[0];

  for (let i = 1; i < values.length; i++) {
    ema = values[i] * multiplier + ema * (1 - multiplier);
  }

  return ema;
}

function calculateRSI(values, period = 14) {
  if (values.length <= period) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  if (losses === 0) return 100;

  const averageGain = gains / period;
  const averageLoss = losses / period;
  const rs = averageGain / averageLoss;

  return 100 - 100 / (1 + rs);
}

async function getTicker(symbol) {
  return getJSON(`${API}/api/v3/ticker/24hr?symbol=${symbol}`);
}

async function getCandles(symbol, interval = "1h") {
  return getJSON(
    `${API}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=100`
  );
}

async function analyzeCoin(symbol) {
  const [ticker, candles] = await Promise.all([
    getTicker(symbol),
    getCandles(symbol)
  ]);

  const closes = candles.map(c => Number(c[4]));
  const volumes = candles.map(c => Number(c[5]));

  const price = Number(ticker.lastPrice);
  const change = Number(ticker.priceChangePercent);
  const volume24 = Number(ticker.quoteVolume);

  const rsi = calculateRSI(closes);
  const ema9 = calculateEMA(closes.slice(-30), 9);
  const ema21 = calculateEMA(closes.slice(-50), 21);

  const averageVolume =
    volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;

  const volumeRatio =
    averageVolume > 0 ? volumes[volumes.length - 1] / averageVolume : 0;

  let score = 50;

  if (ema9 > ema21) score += 15;
  else score -= 15;

  if (rsi > 50 && rsi < 70) score += 10;
  if (rsi < 30) score += 10;
  if (rsi > 75) score -= 10;

  if (volumeRatio > 1.5) score += 10;
  if (change > 5) score -= 5;
  if (change < -5) score -= 5;

  score = Math.max(0, Math.min(100, score));

  let direction = "محايد";
  if (score >= 65) direction = "ميل صعودي";
  if (score <= 35) direction = "ميل هبوطي";

  return {
    symbol,
    price,
    change,
    volume24,
    rsi,
    ema9,
    ema21,
    volumeRatio,
    score,
    direction
  };
       }
