# XAU/USD Short-Term Structure Analyzer

Python analytical system for short-term Gold (XAU/USD or GC futures) trading structure. The analyzer is **not a prediction tool**; it reports the current regime, confidence, key levels, and trading bias from recent OHLCV structure.

## Features

- Yahoo Finance download (`GC=F` default, `XAUUSD=X` supported when available) or CSV input.
- Primary intervals: `15m`, `1h`; context interval: `4h`.
- Lookback: ~5-7 trading days via `--period 7d`.
- Fractal swing high/low detection with delayed confirmation to avoid live lookahead bias.
- HH/HL and LH/LL market-structure labeling.
- EMA20/EMA50 trend filter with slope checks.
- ATR(14) volatility filter.
- Clustered support/resistance from recent swings, previous-day high/low, and weekly high/low.
- ATR-confirmed breakout/breakdown thresholds.
- Optional matplotlib candlestick-style chart with EMAs, zones, and swing labels.

## Usage

```bash
python xau_structure_analyzer.py --symbol GC=F --interval 1h --period 7d
python xau_structure_analyzer.py --symbol XAUUSD=X --interval 15m --period 7d
python xau_structure_analyzer.py --csv data/xau_1h.csv
python xau_structure_analyzer.py --symbol GC=F --interval 1h --period 7d --plot xau_chart.png
```

The script uses only the Python standard library for data ingestion and analysis. Plotting is optional and requires `matplotlib`.

## CSV Format

CSV files must include a timestamp column named `Date`, `Datetime`, `Timestamp`, or `Time`, plus `Open`, `High`, `Low`, and `Close`. `Volume` is optional.

## JSON Output

The output follows the requested structure and includes extra audit fields (`as_of`, `last_close`, ATR, previous-day and weekly levels):

```json
{
  "direction": "bullish/bearish/range",
  "confidence": 0,
  "trend_structure": {
    "pattern": "HH-HL / LH-LL / mixed",
    "state": "trending / ranging"
  },
  "key_levels": {
    "support": [],
    "resistance": [],
    "breakout_up": 0.0,
    "breakdown_down": 0.0
  },
  "bias": "long/short/neutral",
  "explanation": "reasoning based on structure + EMA + levels"
}
```

## Logic Summary

1. Compute EMA20, EMA50, and ATR(14) on chronological bars.
2. Confirm fractal pivots only after `pivot_window` bars, so the latest completed output does not assume future candles.
3. Label pivots as HH/HL/LH/LL against prior confirmed swings.
4. Classify bullish/bearish/range from structure counts plus EMA location and slope.
5. Build support/resistance zones by clustering recent swing levels, previous-day high/low, and weekly high/low using ATR-scaled proximity.
6. Set breakout/breakdown levels as nearest swing resistance/support plus/minus ATR confirmation.

## Web Dashboard (Next.js + Tailwind CSS)

This repository now also includes a simple visual dashboard designed for Cloudflare Pages. The dashboard runs the same explainable structure logic in TypeScript in the browser, loads the included sample CSV by default, and lets users upload their own OHLCV CSV without requiring a backend.

### Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000` to view the dashboard.

### Cloudflare Pages Deployment

Recommended Pages settings:

- **Framework preset:** Next.js
- **Build command:** `npm run build`
- **Output directory:** `out`
- **Node.js version:** 22 or newer

Because `next.config.mjs` uses `output: 'export'`, the app is emitted as static assets and can run directly on Cloudflare Pages. If you later need server-side scheduled data refreshes, add a Cloudflare Worker or Pages Function to write a fresh CSV/JSON artifact and keep this dashboard as the static viewer.

### GitHub Actions Deployment

The repository includes `.github/workflows/deploy-cloudflare.yml`, which builds the static Next.js export and deploys the `out` directory to Cloudflare Pages on pushes to `main`, pull requests, or manual workflow dispatch.

Configure these GitHub repository settings before running the workflow:

- **Secrets**
  - `CLOUDFLARE_API_TOKEN`: Cloudflare API token with Cloudflare Pages edit/deploy permissions.
  - `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID.
- **Variables**
  - `CLOUDFLARE_PROJECT_NAME` optional: The Cloudflare Pages project name to deploy to. If it is not configured, the workflow derives a Cloudflare-safe project name from the GitHub repository name.

The workflow uses Node.js 22, runs `npm install`, builds with `npm run build`, resolves a project name, attempts `wrangler pages project create` so a missing Pages project can be created automatically, and deploys `out` via `cloudflare/wrangler-action`. For example, if `CLOUDFLARE_PROJECT_NAME` is set to `xau` and there is no Cloudflare Pages project named `xau`, the workflow attempts to create the `xau` Pages project before running `pages deploy`.

### Dashboard Capabilities

- Direction, confidence, bias, and last close summary cards.
- Close-price chart with EMA20/EMA50 plus breakout and breakdown reference lines.
- Recent HH/HL/LH/LL swing table.
- Clustered support/resistance levels, ATR, and invalidation level.
- Full JSON output panel for automation/debugging.
