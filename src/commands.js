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
// ==========================================
// PART 2 - WHALE & SMART MONEY DETECTOR
// ==========================================

const FUTURES_API = "https://fapi.binance.com";

// قيمة الصفقة الكبيرة بالدولار
const WHALE_THRESHOLD = 100000;

// جلب دفتر الأوامر
async function getOrderBook(symbol) {
  return getJSON(
    `${API}/api/v3/depth?symbol=${symbol}&limit=100`
  );
}

// جلب الصفقات الأخيرة
async function getRecentTrades(symbol) {
  return getJSON(
    `${API}/api/v3/aggTrades?symbol=${symbol}&limit=1000`
  );
}

// جلب بيانات العقود الآجلة
async function getFuturesMetrics(symbol) {
  const [openInterest, funding] = await Promise.all([
    getJSON(
      `${FUTURES_API}/fapi/v1/openInterest?symbol=${symbol}`
    ),
    getJSON(
      `${FUTURES_API}/fapi/v1/premiumIndex?symbol=${symbol}`
    )
  ]);

  return {
    openInterest: Number(openInterest.openInterest),
    fundingRate: Number(funding.lastFundingRate),
    markPrice: Number(funding.markPrice)
  };
}

// تحليل ضغط الشراء والبيع
function analyzeOrderBook(book) {
  const bids = book.bids.slice(0, 20);
  const asks = book.asks.slice(0, 20);

  const buyLiquidity = bids.reduce(
    (sum, item) => sum + Number(item[0]) * Number(item[1]),
    0
  );

  const sellLiquidity = asks.reduce(
    (sum, item) => sum + Number(item[0]) * Number(item[1]),
    0
  );

  const total = buyLiquidity + sellLiquidity;

  const imbalance = total > 0
    ? ((buyLiquidity - sellLiquidity) / total) * 100
    : 0;

  let pressure = "متوازن";

  if (imbalance > 15) pressure = "ضغط شراء قوي";
  if (imbalance < -15) pressure = "ضغط بيع قوي";

  return {
    buyLiquidity,
    sellLiquidity,
    imbalance,
    pressure
  };
}

// اكتشاف الصفقات الكبيرة
function detectWhales(trades) {
  const whales = [];

  let buyVolume = 0;
  let sellVolume = 0;

  for (const trade of trades) {
    const price = Number(trade.p);
    const quantity = Number(trade.q);
    const value = price * quantity;

    if (trade.m) {
      sellVolume += value;
    } else {
      buyVolume += value;
    }

    if (value >= WHALE_THRESHOLD) {
      whales.push({
        price,
        quantity,
        value,
        side: trade.m ? "بيع كبير" : "شراء كبير",
        time: new Date(trade.T).toISOString()
      });
    }
  }

  whales.sort((a, b) => b.value - a.value);

  return {
    whales: whales.slice(0, 10),
    buyVolume,
    sellVolume,
    netFlow: buyVolume - sellVolume
  };
}

// تحليل بيانات العقود الآجلة
function analyzeFutures(metrics) {
  let sentiment = "محايد";

  if (metrics.fundingRate > 0.0005) {
    sentiment = "ازدحام مراكز الشراء";
  }

  if (metrics.fundingRate < -0.0005) {
    sentiment = "ازدحام مراكز البيع";
  }

  return {
    ...metrics,
    sentiment
  };
}

// المحرك المتقدم للعملة
async function analyzeAdvancedCoin(symbol) {
  const basic = await analyzeCoin(symbol);

  const results = await Promise.allSettled([
    getOrderBook(symbol),
    getRecentTrades(symbol),
    getFuturesMetrics(symbol)
  ]);

  const orderBook =
    results[0].status === "fulfilled"
      ? analyzeOrderBook(results[0].value)
      : null;

  const whaleData =
    results[1].status === "fulfilled"
      ? detectWhales(results[1].value)
      : null;

  const futures =
    results[2].status === "fulfilled"
      ? analyzeFutures(results[2].value)
      : null;

  let smartScore = basic.score;

  if (orderBook) {
    if (orderBook.imbalance > 15) smartScore += 10;
    if (orderBook.imbalance < -15) smartScore -= 10;
  }

  if (whaleData) {
    if (whaleData.netFlow > 100000) smartScore += 10;
    if (whaleData.netFlow < -100000) smartScore -= 10;
  }

  if (futures) {
    if (futures.fundingRate > 0.001) smartScore -= 5;
    if (futures.fundingRate < -0.001) smartScore += 5;
  }

  smartScore = Math.max(0, Math.min(100, smartScore));

  let signal = "انتظار";

  if (smartScore >= 75) signal = "فرصة صعود محتملة";
  if (smartScore <= 25) signal = "خطر هبوط محتمل";

  return {
    ...basic,
    orderBook,
    whaleData,
    futures,
    smartScore,
    signal
  };
}


// ==========================================
// PART 3 - PRICE EXPLOSION DETECTOR
// ==========================================

const EXPLOSION_CONFIG = {
  interval: "5m",
  breakoutPeriod: 20
};

async function detectExplosion(symbol) {
  const candles = await getCandles(symbol, "5m");

  if (!Array.isArray(candles) || candles.length < 30) {
    throw new Error("Insufficient candle data");
  }

  const closed = candles.slice(0, -1);
  const current = closed[closed.length - 1];

  const previous = closed.slice(
    -(EXPLOSION_CONFIG.breakoutPeriod + 1),
    -1
  );

  const open = Number(current[1]);
  const close = Number(current[4]);
  const quoteVolume = Number(current[7]);

  const averageVolume = previous.reduce(
    (sum, c) => sum + Number(c[7]), 0
  ) / previous.length;

  const volumeRatio = averageVolume > 0
    ? quoteVolume / averageVolume : 0;

  const candleChange = open > 0
    ? ((close - open) / open) * 100 : 0;

  const previousHigh = Math.max(
    ...previous.map(c => Number(c[2]))
  );

  const previousLow = Math.min(
    ...previous.map(c => Number(c[3]))
  );

  const bullishBreakout = close > previousHigh;
  const bearishBreakout = close < previousLow;

  let score = 0;

  if (volumeRatio >= 2) score += 25;
  if (volumeRatio >= 3) score += 10;
  if (Math.abs(candleChange) >= 0.7) score += 15;
  if (Math.abs(candleChange) >= 1.5) score += 15;
  if (bullishBreakout || bearishBreakout) score += 25;
  if (Math.abs(candleChange) >= 1) score += 10;

  score = Math.min(score, 100);

  let direction = "محايد";

  if (candleChange > 0 && (bullishBreakout || volumeRatio >= 2)) {
    direction = "اندفاع صعودي";
  }

  if (candleChange < 0 && (bearishBreakout || volumeRatio >= 2)) {
    direction = "اندفاع هبوطي";
  }

  let alert = "حركة طبيعية";

  if (score >= 50) alert = "حركة غير طبيعية";
  if (score >= 70) alert = "انفجار سعري محتمل";
  if (score >= 85) alert = "انفجار سعري قوي";

  return {
    symbol,
    price: close,
    candleChange,
    volumeRatio,
    previousHigh,
    previousLow,
    bullishBreakout,
    bearishBreakout,
    direction,
    score,
    alert,
    timestamp: new Date(Number(current[6])).toISOString()
  };
}

// ==========================================
// PART 4 - ATR & TRADE OPPORTUNITY ENGINE
// ==========================================

function calculateATR(candles, period = 14) {
  if (candles.length < period + 2) return 0;

  const closed = candles.slice(0, -1);
  const ranges = [];

  for (let i = 1; i < closed.length; i++) {
    const high = Number(closed[i][2]);
    const low = Number(closed[i][3]);
    const previousClose = Number(closed[i - 1][4]);

    ranges.push(Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose)
    ));
  }

  const recent = ranges.slice(-period);

  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

function buildTradePlan(price, atr, direction) {
  if (!price || !atr || atr <= 0) return null;

  const isLong = direction === "LONG";
  const riskDistance = atr * 1.5;

  const stopLoss = isLong
    ? price - riskDistance
    : price + riskDistance;

  const target1 = isLong
    ? price + riskDistance
    : price - riskDistance;

  const target2 = isLong
    ? price + riskDistance * 2
    : price - riskDistance * 2;

  const target3 = isLong
    ? price + riskDistance * 3
    : price - riskDistance * 3;

  return {
    direction,
    entry: price,
    stopLoss,
    target1,
    target2,
    target3,
    riskPercent: (riskDistance / price) * 100,
    riskReward: "1:1 / 1:2 / 1:3"
  };
}

// ==========================================
// PART 5 - COMPLETE COIN ANALYSIS
// ==========================================

async function analyzeFullCoin(symbol) {
  const [advanced, explosion, candles] = await Promise.all([
    analyzeAdvancedCoin(symbol),
    detectExplosion(symbol),
    getCandles(symbol, "1h")
  ]);

  const atr = calculateATR(candles);

  let direction = "WAIT";

  if (
    advanced.smartScore >= 65 &&
    explosion.direction !== "اندفاع هبوطي"
  ) {
    direction = "LONG";
  }

  if (
    advanced.smartScore <= 35 &&
    explosion.direction !== "اندفاع صعودي"
  ) {
    direction = "SHORT";
  }

  const tradePlan = direction === "WAIT"
    ? null
    : buildTradePlan(advanced.price, atr, direction);

  let confidence = advanced.smartScore;

  if (explosion.score >= 70) confidence += 5;

  if (
    direction === "LONG" &&
    explosion.direction === "اندفاع هبوطي"
  ) confidence -= 15;

  if (
    direction === "SHORT" &&
    explosion.direction === "اندفاع صعودي"
  ) confidence -= 15;

  confidence = Math.max(0, Math.min(100, confidence));

  return {
    ...advanced,
    explosion,
    atr,
    direction,
    tradePlan,
    confidence,
    analysisTime: new Date().toISOString()
  };
}

// ==========================================
// PART 6 - PROFESSIONAL REPORT
// ==========================================

function createCoinReport(data) {
  const plan = data.tradePlan;

  let message = `📊 تحليل ${data.symbol}\n\n`;

  message += `💰 السعر: ${formatPrice(data.price)}\n`;
  message += `📈 تغير 24 ساعة: ${data.change.toFixed(2)}%\n`;
  message += `📉 RSI: ${data.rsi.toFixed(2)}\n`;
  message += `🧠 التقييم الذكي: ${data.smartScore}/100\n`;
  message += `🎯 الثقة الفنية: ${data.confidence}/100\n\n`;

  message += `🐋 صافي تدفق الصفقات الكبيرة: ${
    data.whaleData
      ? formatPrice(data.whaleData.netFlow)
      : "غير متاح"
  }\n`;

  message += `⚡ ضغط السوق: ${
    data.orderBook
      ? data.orderBook.pressure
      : "غير متاح"
  }\n`;

  message += `🚀 الانفجار السعري: ${data.explosion.alert}\n`;
  message += `📊 اتجاه الحركة: ${data.explosion.direction}\n`;
  message += `📦 نسبة الحجم: ${data.explosion.volumeRatio.toFixed(2)}x\n\n`;

  if (plan) {
    message += `🎯 فرصة محتملة: ${plan.direction}\n`;
    message += `🟢 الدخول: ${formatPrice(plan.entry)}\n`;
    message += `🛑 وقف الخسارة: ${formatPrice(plan.stopLoss)}\n`;
    message += `🥇 الهدف الأول: ${formatPrice(plan.target1)}\n`;
    message += `🥈 الهدف الثاني: ${formatPrice(plan.target2)}\n`;
    message += `🥉 الهدف الثالث: ${formatPrice(plan.target3)}\n`;
    message += `⚖️ المخاطرة: ${plan.riskPercent.toFixed(2)}%\n`;
    message += `📐 العائد للمخاطرة: ${plan.riskReward}\n`;
  } else {
    message += "⏳ لا توجد فرصة دخول مستوفية للشروط حالياً.\n";
  }

  message += "\n⚠️ تحليل آلي وليس توصية استثمارية.";

  return message;
}

// ==========================================
// PART 7 - MARKET SCANNER
// ==========================================

async function scanMarket(options = {}) {
  const symbols = options.symbols || COINS;
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency || 3, 5)
  );

  const results = [];
  const errors = [];

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map(symbol => analyzeFullCoin(symbol))
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];

      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        errors.push({
          symbol: batch[j],
          error: result.reason?.message || "Unknown error"
        });
      }
    }
  }

  results.sort((a, b) => b.confidence - a.confidence);

  return {
    total: symbols.length,
    successful: results.length,
    failed: errors.length,
    opportunities: results.filter(
      item => item.direction !== "WAIT"
    ),
    explosions: results.filter(
      item => item.explosion.score >= 70
    ),
    results,
    errors,
    scanTime: new Date().toISOString()
  };
}

// ==========================================
// PART 8 - MARKET SUMMARY
// ==========================================

function createMarketSummary(scan) {
  let message = "🚀 تقرير السوق الذكي\n\n";

  message += `🪙 العملات المفحوصة: ${scan.total}\n`;
  message += `✅ الناجحة: ${scan.successful}\n`;
  message += `❌ الفاشلة: ${scan.failed}\n`;
  message += `🎯 الفرص المحتملة: ${scan.opportunities.length}\n`;
  message += `💥 الانفجارات السعرية: ${scan.explosions.length}\n\n`;

  message += "🏆 أفضل النتائج:\n\n";

  for (const coin of scan.results.slice(0, 10)) {
    message += `${coin.symbol}: ${coin.direction}\n`;
    message += `السعر: ${formatPrice(coin.price)}\n`;
    message += `التقييم: ${coin.confidence}/100\n`;
    message += `الحركة: ${coin.explosion.direction}\n\n`;
  }

  message += "⚠️ النتائج تحليلية وليست ضماناً للربح.";

  return message;
}

// ==========================================
// END PARTS 3 - 8
// ==========================================
      
// ==========================================
// END PART 2
// ==========================================
