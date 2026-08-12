# BTC Cycle Terminal — Despliegue en Vercel

## Por qué esta versión sí funciona (y la anterior no)

El archivo `.html` suelto que te pasé antes hacía `fetch()` directo desde tu
navegador a Binance, Coin Metrics y Deribit. Varias de esas APIs no habilitan
CORS para todos sus endpoints — el navegador bloquea la respuesta aunque el
servidor la haya devuelto bien. Y el botón de "traer macro con IA" solo puede
funcionar dentro de un Artifact de Claude, no en un archivo que abrís por tu
cuenta.

Esta versión soluciona ambos problemas: `api/data.js` es una función que corre
en el servidor de Vercel (no en tu navegador), llama a cada fuente sin
restricción de CORS, y le devuelve todo ya calculado a `index.html` en un solo
pedido a `/api/data` (mismo dominio → sin bloqueos).

## Paso 1 — API key de FRED ✅ ya la tenés

`aa8c6badc5c27d516c761ce4243e27ca`

Ya está guardada en `.env.local` (solo para probar en tu computadora — ese
archivo nunca se sube a git ni a Vercel, mirá el `.gitignore`). Para que
funcione en la web pública, la tenés que cargar en el panel de Vercel: eso es
el Paso 3.

Dato de seguridad simple: si esta key alguna vez queda expuesta (la pegaste en
un chat, un repo público, etc.), la podés revocar y pedir una nueva gratis en
el mismo link de FRED — no tiene costo ni trámite:
https://fred.stlouisfed.org/docs/api/api_key.html

## Paso 2 — Subir el proyecto

Ya tenés cuenta de Vercel (usaste `neto-web`). Dos formas:

**Opción A — Arrastrar y soltar (más simple):**
1. Andá a https://vercel.com/new
2. "Deploy" → arrastrá esta carpeta completa (`btc-dashboard`)

**Opción B — Con git (recomendado si después querés editar):**
```bash
cd btc-dashboard
git init
git add .
git commit -m "BTC Cycle Terminal"
# subilo a un repo de GitHub y conectalo desde vercel.com/new
```

## Paso 3 — Agregar la API key en Vercel

1. En el proyecto ya creado → **Settings → Environment Variables**
2. Agregá: `FRED_API_KEY` = *(la key que conseguiste en el paso 1)*
3. Save → luego **Deployments → ⋯ → Redeploy** para que tome la variable.

## Paso 4 — Listo

Tu dashboard va a estar en algo como `https://btc-dashboard-tuusuario.vercel.app`.
Abrilo, mirá la fila **"Estado de fuentes"** arriba de todo: cada punto verde
confirma que esa fuente respondió bien; si alguno queda rojo, te dice el error
exacto (no una tarjeta vacía sin explicación).

## Qué se actualiza automático y qué no

| Dato | Automático | Fuente |
|---|---|---|
| Precio, Mayer, 200WMA, RSI semanal | ✅ | Binance |
| Funding, Open Interest | ✅ | Binance Futures |
| MVRV, Z-Score, NUPL, Realized Price, Puell, Hash Ribbon | ✅ | Coin Metrics |
| DVOL, Put/Call | ✅ | Deribit |
| Fear & Greed | ✅ | Alternative.me |
| US10Y, FFR, índice del dólar (proxy DXY) | ✅ | FRED (Reserva Federal) |
| Net Liquidity Index, ETF Flows, Coinbase Premium, mapa de liquidaciones | ❌ manual | Sin API gratuita confiable — quedan como links directos en la página |

Los últimos cuatro no tienen fuente gratuita y en vivo que se pueda automatizar
con seriedad — cualquier "solución" gratuita para eso sería un dato inventado
o desactualizado, y preferí ser honesto en vez de simular que funciona.

## Cache

Cada carga de `/api/data` se cachea 30 minutos en el servidor de Vercel
(`Cache-Control: s-maxage=1800`) para no saturar las APIs gratuitas. El botón
"↻ Actualizar" y el auto-refresh cada 3 horas respetan ese cache.
