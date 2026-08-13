// Vercel Serverless Function — corre en el servidor, nunca en el navegador.
// Por eso no hay problema de CORS: cada fuente se llama desde acá, y el
// frontend solo le pide datos a /api/data (mismo dominio).

// MVRV, Z-Score, NUPL y Realized Price quedaron detrás de planes pagos en
// todos los proveedores con API (Coin Metrics, bitcoin-data.com, CoinGlass) —
// requieren indexar el Realized Cap de toda la blockchain. Mientras no se
// pague uno, se usan estos valores cargados a mano desde un gráfico público
// (CoinGlass / LookIntoBitcoin), editando este archivo cada tanto.
const manualOnchain = require("./manual-onchain.json");

const J = async (url, opts) => {
  const r = await fetch(url, { ...opts, headers: { "User-Agent": "btc-dashboard/1.0", ...(opts?.headers||{}) } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
};

const sma = (arr, n, i) => {
  i = i ?? arr.length - 1;
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += arr[k];
  return s / n;
};

async function getBinance() {
  const kd = await J("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000");
  const closes = kd.map((k) => +k[4]);
  const price = closes.at(-1);
  const prevClose = +kd.at(-2)[4];
  const chg24h = (price / prevClose - 1) * 100;
  const s200 = sma(closes, 200);
  const mayer = price / s200;

  const kw = await J("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=520");
  const wc = kw.map((k) => +k[4]);
  const w200 = sma(wc, Math.min(200, wc.length));
  const wmaDist = (price / w200 - 1) * 100;

  let ag = 0, al = 0;
  for (let i = 1; i <= 14; i++) { const d = wc[i] - wc[i - 1]; d > 0 ? (ag += d) : (al -= d); }
  ag /= 14; al /= 14;
  for (let i = 15; i < wc.length; i++) {
    const d = wc[i] - wc[i - 1];
    ag = (ag * 13 + Math.max(d, 0)) / 14;
    al = (al * 13 + Math.max(-d, 0)) / 14;
  }
  const rsi = al === 0 ? 100 : 100 - 100 / (1 + ag / al);

  // serie para el sparkline (365 días: precio vs SMA200)
  const win = 365;
  const cs = closes.slice(-win);
  const smas = [];
  for (let i = closes.length - win; i < closes.length; i++) smas.push(sma(closes, 200, i));

  return { price, chg24h, mayer, sma200: s200, wmaDist, wma200: w200, rsi, spark: { cs, smas } };
}

async function getFutures(price) {
  const pi = await J("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT");
  const oi = await J("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT");
  const fundingPct = +pi.lastFundingRate * 100;
  const oiBtc = +oi.openInterest;
  const oiUsd = oiBtc * price;
  const mcApprox = price * 19.92e6;
  const oiPctOfMc = (oiUsd / mcApprox) * 100;
  return { fundingPct, oiBtc, oiUsd, oiPctOfMc };
}

// Recompensa por bloque: calendario de halvings, público y determinístico
// (no depende de ningún proveedor). Próximo halving ~abril 2028, estimado.
const HALVINGS = [
  { date: new Date("2009-01-03"), reward: 50 },
  { date: new Date("2012-11-28"), reward: 25 },
  { date: new Date("2016-07-09"), reward: 12.5 },
  { date: new Date("2020-05-11"), reward: 6.25 },
  { date: new Date("2024-04-20"), reward: 3.125 },
  { date: new Date("2028-04-01"), reward: 1.5625 },
];
const rewardAt = (date) => {
  let r = 50;
  for (const h of HALVINGS) if (date >= h.date) r = h.reward;
  return r;
};

// Puell Multiple original (David Puell): valor de la emisión diaria vs su
// media de 365 días. La emisión (bloques/día × recompensa) es pública y
// determinística, y el precio ya viene de Binance — no requiere Coin Metrics.
function computePuell(spark) {
  const cs = spark.cs;
  const n = cs.length;
  const today = new Date();
  const issuance = cs.map((price, idx) => {
    const daysAgo = n - 1 - idx;
    const d = new Date(today.getTime() - daysAgo * 86400000);
    return 144 * rewardAt(d) * price; // ~144 bloques/día promedio
  });
  const avg365 = issuance.reduce((a, b) => a + b, 0) / issuance.length;
  return issuance.at(-1) / avg365;
}

async function getCoinMetrics() {
  // CapRealUSD quedó detrás del plan pago de Coin Metrics — el resto sigue
  // gratis. Se pide por separado para que ese metric pago no tumbe los demás.
  const free = "CapMrktCurUSD,HashRate,SplyCur";
  const freeUrl =
    "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc" +
    `&metrics=${free}&frequency=1d&start_time=2016-01-01&page_size=10000`;
  const j = await J(freeUrl);
  const d = j.data || [];
  if (!d.length) throw new Error("Coin Metrics: sin datos");
  const MC = d.map((r) => +r.CapMrktCurUSD);
  const HR = d.map((r) => +r.HashRate);
  const SP = d.map((r) => +r.SplyCur);
  const i = d.length - 1;

  const h30 = sma(HR, 30), h60 = sma(HR, 60);
  const h30p = sma(HR, 30, i - 7), h60p = sma(HR, 60, i - 7);
  const above = h30 > h60;
  const crossUp = above && h30p <= h60p;
  const hashState = crossUp ? "cross" : above ? "up" : "cap";

  const out = { hashState, hashrate: HR[i], mvrv: null, z: null, nupl: null, realizedPrice: null, puell: null, paywalled: [] };

  try {
    const paidUrl =
      "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc" +
      "&metrics=CapRealUSD&frequency=1d&start_time=2016-01-01&page_size=10000";
    const jp = await J(paidUrl);
    const dp = jp.data || [];
    const RC = dp.map((r) => +r.CapRealUSD);
    const ip = dp.length - 1;

    out.mvrv = MC[i] / RC[ip];
    out.nupl = (MC[i] - RC[ip]) / MC[i];
    const diffs = MC.map((m, k) => m - RC[k]);
    const mean = MC.reduce((a, b) => a + b, 0) / MC.length;
    const sd = Math.sqrt(MC.reduce((a, b) => a + (b - mean) ** 2, 0) / MC.length);
    out.z = diffs[ip] / sd;
    out.realizedPrice = RC[ip] / SP[ip];
  } catch (e) {
    const hasManual = ["mvrv", "z", "nupl", "realizedPrice"].some((k) => manualOnchain[k] != null);
    if (hasManual) {
      out.mvrv = manualOnchain.mvrv;
      out.z = manualOnchain.z;
      out.nupl = manualOnchain.nupl;
      out.realizedPrice = manualOnchain.realizedPrice;
      out.manualDate = manualOnchain.updatedAt;
      out.manualSource = manualOnchain.source;
    } else {
      out.paywalled = ["mvrv", "z", "nupl", "realizedPrice"];
    }
  }

  return out;
}

async function getDeribit() {
  const now = Date.now();
  const vol = await J(
    `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&resolution=3600&start_timestamp=${now - 172800000}&end_timestamp=${now}`
  );
  const rows = vol.result?.data || [];
  const dvol = rows.length ? rows.at(-1)[4] : null;

  const book = await J("https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option");
  let p = 0, c = 0;
  (book.result || []).forEach((o) => {
    if (o.instrument_name.endsWith("-P")) p += o.open_interest;
    else if (o.instrument_name.endsWith("-C")) c += o.open_interest;
  });
  const putCall = c ? p / c : null;
  return { dvol, putCall };
}

async function getFearGreed() {
  const j = await J("https://api.alternative.me/fng/?limit=1");
  return { value: +j.data[0].value, label: j.data[0].value_classification };
}

async function getFRED(key) {
  if (!key) throw new Error("Falta FRED_API_KEY");
  const one = async (series) => {
    const j = await J(
      `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&sort_order=desc&limit=1&file_type=json&api_key=${key}`
    );
    const obs = j.observations?.[0];
    return obs && obs.value !== "." ? +obs.value : null;
  };
  const [us10y, ffr, dxyProxy] = await Promise.all([one("DGS10"), one("DFF"), one("DTWEXBGS")]);
  // DTWEXBGS = índice ponderado de comercio del USD (Fed) — proxy oficial del DXY, no es el ticker ICE.
  return { us10y, ffr, dxyProxy };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600"); // cache 30min en el edge de Vercel
  const out = { updatedAt: new Date().toISOString(), sources: {} };

  const safe = async (key, fn) => {
    try {
      out[key] = await fn();
      out.sources[key] = "ok";
    } catch (e) {
      out.sources[key] = "error: " + e.message;
    }
  };

  await safe("market", getBinance);
  await safe("futures", () => getFutures(out.market?.price));
  await safe("onchain", getCoinMetrics);
  if (out.onchain && out.market?.spark) {
    try { out.onchain.puell = computePuell(out.market.spark); } catch (e) {}
  }
  if (out.sources.onchain === "ok" && out.onchain?.paywalled?.length) {
    out.sources.onchain = "parcial: MVRV/Z-Score/NUPL/Realized Price requieren plan pago de Coin Metrics";
  } else if (out.sources.onchain === "ok" && out.onchain?.manualDate) {
    out.sources.onchain = `parcial: MVRV/Z-Score/NUPL/Realized Price son manuales (${out.onchain.manualDate})`;
  }
  await safe("derivs", getDeribit);
  await safe("fng", getFearGreed);
  await safe("macro", () => getFRED(process.env.FRED_API_KEY));

  res.status(200).json(out);
}
