// Endpoint separado con su propio caché (24h) para no gastar la cuota
// gratuita de bitcoin-data.com (10 pedidos/hora, 15/día por IP). El resto
// del dashboard cachea 30 min; estas 4 métricas cambian poco día a día,
// así que cachearlas 24h alcanza de sobra y deja margen contra el límite.

const J = async (url) => {
  const r = await fetch(url, { headers: { "User-Agent": "btc-dashboard/1.0" } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
};

const last = (rows, field) => {
  const v = rows?.length ? rows[rows.length - 1][field] : null;
  return typeof v === "number" ? v : null;
};

module.exports = async function handler(req, res) {
  // stale-while-revalidate largo: si el refresh falla por rate limit, sigue
  // sirviendo la última respuesta cacheada en vez de romper.
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");

  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  const base = "https://api.bitcoin-data.com/v1";

  try {
    const [mvrv, z, nupl, rp] = await Promise.all([
      J(`${base}/mvrv?startday=${start}&endday=${end}`),
      J(`${base}/mvrv-zscore?startday=${start}&endday=${end}`),
      J(`${base}/nupl?startday=${start}&endday=${end}`),
      J(`${base}/realized-price?startday=${start}&endday=${end}`),
    ]);
    res.status(200).json({
      mvrv: last(mvrv, "mvrv"),
      z: last(z, "mvrvZscore"),
      nupl: last(nupl, "nupl"),
      realizedPrice: last(rp, "realizedPrice"),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(200).json({ error: e.message });
  }
};
