#!/usr/bin/env python3
"""Short-term XAU/USD market-structure analyzer using explainable rules.

The tool can download Yahoo Finance chart data (GC=F by default) or read OHLCV
CSV. It avoids lookahead in its final signal by using pivots that require right
side confirmation and by analyzing only completed bars in the supplied history.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class Bar:
    time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0
    ema20: float | None = None
    ema50: float | None = None
    atr14: float | None = None
    swing_high: bool = False
    swing_low: bool = False
    label: str = ""


@dataclass(frozen=True)
class AnalyzerConfig:
    pivot_window: int = 2
    atr_period: int = 14
    ema_fast: int = 20
    ema_slow: int = 50
    atr_breakout_mult: float = 0.10
    zone_atr_mult: float = 0.75
    cluster_atr_mult: float = 0.60


def fetch_yahoo_chart(symbol: str = "GC=F", interval: str = "1h", range_: str = "7d") -> list[Bar]:
    """Fetch OHLCV bars from Yahoo Finance's public chart endpoint."""
    encoded = urllib.parse.quote(symbol, safe="")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?interval={interval}&range={range_}"
    with urllib.request.urlopen(url, timeout=20) as response:  # nosec: user-selected finance endpoint
        payload = json.loads(response.read().decode("utf-8"))
    result = payload.get("chart", {}).get("result") or []
    if not result:
        raise RuntimeError(f"No Yahoo Finance data returned for {symbol} {interval} {range_}")
    timestamps = result[0].get("timestamp") or []
    quote = (result[0].get("indicators", {}).get("quote") or [{}])[0]
    bars: list[Bar] = []
    for ts, o, h, l, c, v in zip(
        timestamps,
        quote.get("open", []),
        quote.get("high", []),
        quote.get("low", []),
        quote.get("close", []),
        quote.get("volume", []),
    ):
        if None in (o, h, l, c):
            continue
        bars.append(Bar(datetime.fromtimestamp(ts, timezone.utc), float(o), float(h), float(l), float(c), float(v or 0)))
    if len(bars) < 60:
        raise ValueError("At least 60 bars are recommended for EMA50/ATR/pivot analysis")
    return bars


def load_csv(path: str | Path) -> list[Bar]:
    """Load an OHLCV CSV with columns such as Date/Open/High/Low/Close/Volume."""
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    if not rows:
        raise ValueError("CSV is empty")
    lower = {name.lower(): name for name in rows[0]}
    time_key = next((lower[k] for k in ("datetime", "timestamp", "date", "time") if k in lower), None)
    required = {k: lower.get(k) for k in ("open", "high", "low", "close")}
    if not time_key or any(v is None for v in required.values()):
        raise ValueError("CSV must include a time column plus Open, High, Low, Close")
    volume_key = lower.get("volume")
    bars: list[Bar] = []
    for row in rows:
        ts_raw = row[time_key]
        try:
            ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        except ValueError:
            ts = datetime.fromtimestamp(float(ts_raw), timezone.utc)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        bars.append(
            Bar(
                ts.astimezone(timezone.utc),
                float(row[required["open"]]),
                float(row[required["high"]]),
                float(row[required["low"]]),
                float(row[required["close"]]),
                float(row[volume_key]) if volume_key and row.get(volume_key) else 0.0,
            )
        )
    bars.sort(key=lambda b: b.time)
    if len(bars) < 60:
        raise ValueError("At least 60 bars are recommended for EMA50/ATR/pivot analysis")
    return bars


def add_indicators(bars: list[Bar], cfg: AnalyzerConfig) -> None:
    def ema(prev: float | None, value: float, span: int) -> float:
        alpha = 2 / (span + 1)
        return value if prev is None else value * alpha + prev * (1 - alpha)

    ema20 = ema50 = None
    true_ranges: list[float] = []
    prev_close = None
    for bar in bars:
        ema20 = ema(ema20, bar.close, cfg.ema_fast)
        ema50 = ema(ema50, bar.close, cfg.ema_slow)
        bar.ema20, bar.ema50 = ema20, ema50
        tr = max(bar.high - bar.low, abs(bar.high - prev_close) if prev_close else 0, abs(bar.low - prev_close) if prev_close else 0)
        true_ranges.append(tr)
        if len(true_ranges) >= cfg.atr_period:
            bar.atr14 = statistics.fmean(true_ranges[-cfg.atr_period :])
        prev_close = bar.close


def detect_swings(bars: list[Bar], window: int) -> None:
    for i in range(window, len(bars) - window):
        bar = bars[i]
        left = bars[i - window : i]
        right = bars[i + 1 : i + window + 1]
        bar.swing_high = bar.high > max(b.high for b in left) and bar.high >= max(b.high for b in right)
        bar.swing_low = bar.low < min(b.low for b in left) and bar.low <= min(b.low for b in right)


def label_structure(bars: list[Bar]) -> list[dict]:
    swings: list[dict] = []
    last_high = last_low = None
    for bar in bars:
        if bar.swing_high:
            bar.label = "HH" if last_high is not None and bar.high > last_high else "LH" if last_high is not None else "H"
            swings.append({"time": bar.time.isoformat(), "type": bar.label, "side": "high", "price": round(bar.high, 2)})
            last_high = bar.high
        if bar.swing_low:
            bar.label = "HL" if last_low is not None and bar.low > last_low else "LL" if last_low is not None else "L"
            swings.append({"time": bar.time.isoformat(), "type": bar.label, "side": "low", "price": round(bar.low, 2)})
            last_low = bar.low
    return swings


def cluster_levels(levels: list[float], atr: float, mult: float) -> list[float]:
    vals = sorted(v for v in levels if math.isfinite(v))
    if not vals:
        return []
    threshold = max(atr * mult, 0.01)
    clusters = [[vals[0]]]
    for val in vals[1:]:
        if abs(val - statistics.fmean(clusters[-1])) <= threshold:
            clusters[-1].append(val)
        else:
            clusters.append([val])
    return [round(statistics.fmean(c), 2) for c in clusters]


def previous_day_high_low(bars: list[Bar]) -> tuple[float, float]:
    days = sorted({b.time.date() for b in bars})
    target = days[-2] if len(days) >= 2 else days[-1]
    day_bars = [b for b in bars if b.time.date() == target]
    return max(b.high for b in day_bars), min(b.low for b in day_bars)


def analyze(bars: list[Bar], cfg: AnalyzerConfig | None = None) -> dict:
    cfg = cfg or AnalyzerConfig()
    bars = [Bar(**vars(b)) for b in bars]
    add_indicators(bars, cfg)
    detect_swings(bars, cfg.pivot_window)
    swings = label_structure(bars)
    latest = bars[-1]
    atr = latest.atr14 or statistics.fmean([b.high - b.low for b in bars[-14:]])
    close = latest.close
    recent_swings = swings[-12:]
    highs = [s["price"] for s in recent_swings if s["side"] == "high"]
    lows = [s["price"] for s in recent_swings if s["side"] == "low"]
    last_resistance = highs[-1] if highs else max(b.high for b in bars[-20:])
    last_support = lows[-1] if lows else min(b.low for b in bars[-20:])
    prev_high, prev_low = previous_day_high_low(bars)
    weekly_high, weekly_low = max(b.high for b in bars), min(b.low for b in bars)
    supports = [x for x in cluster_levels([*lows[-4:], prev_low, weekly_low], atr, cfg.cluster_atr_mult) if x <= close + atr]
    resistances = [x for x in cluster_levels([*highs[-4:], prev_high, weekly_high], atr, cfg.cluster_atr_mult) if x >= close - atr]
    ema_up = close > latest.ema20 > latest.ema50 and bars[-1].ema20 > bars[-4].ema20 and bars[-1].ema50 >= bars[-4].ema50
    ema_down = close < latest.ema20 < latest.ema50 and bars[-1].ema20 < bars[-4].ema20 and bars[-1].ema50 <= bars[-4].ema50
    labels = [s["type"] for s in recent_swings[-6:]]
    bull_count = labels.count("HH") + labels.count("HL")
    bear_count = labels.count("LH") + labels.count("LL")
    range_width = weekly_high - weekly_low
    range_like = range_width <= max(atr * 8, close * 0.015) or abs(bull_count - bear_count) <= 1
    if bull_count >= bear_count + 2 and ema_up:
        direction = "bullish"
    elif bear_count >= bull_count + 2 and ema_down:
        direction = "bearish"
    elif not range_like and ema_up:
        direction = "bullish"
    elif not range_like and ema_down:
        direction = "bearish"
    else:
        direction = "range"
    structure_score = min(35, abs(bull_count - bear_count) * 10)
    ema_score = 30 if (direction == "bullish" and ema_up) or (direction == "bearish" and ema_down) else 12 if direction == "range" else 0
    level_score = 20 if supports and resistances else 10
    volatility_score = 15 if atr > 0 and range_width > atr * 3 else 5
    confidence = max(0, min(100, structure_score + ema_score + level_score + volatility_score))
    if direction == "range":
        confidence = max(45, min(75, 40 + level_score + (15 if range_like else 0)))
    breakout_up = round(last_resistance + cfg.atr_breakout_mult * atr, 2)
    breakdown_down = round(last_support - cfg.atr_breakout_mult * atr, 2)
    stop_level = round((last_support - cfg.zone_atr_mult * atr) if direction == "bullish" else (last_resistance + cfg.zone_atr_mult * atr), 2)
    pattern = "HH-HL" if bull_count > bear_count else "LH-LL" if bear_count > bull_count else "mixed"
    bias = "long" if direction == "bullish" and close > breakout_up - atr else "short" if direction == "bearish" and close < breakdown_down + atr else "neutral"
    return {
        "as_of": latest.time.isoformat(),
        "last_close": round(close, 2),
        "direction": direction,
        "confidence": int(confidence),
        "trend_structure": {"pattern": pattern, "state": "ranging" if direction == "range" else "trending", "recent_swings": recent_swings[-8:]},
        "key_levels": {
            "support": supports,
            "resistance": resistances,
            "breakout_up": breakout_up,
            "breakdown_down": breakdown_down,
            "invalidated_trend_level": stop_level,
            "previous_day_high": round(prev_high, 2),
            "previous_day_low": round(prev_low, 2),
            "weekly_high": round(weekly_high, 2),
            "weekly_low": round(weekly_low, 2),
            "atr14": round(atr, 2),
        },
        "bias": bias,
        "explanation": f"Structure is {pattern}; close is {'above rising' if ema_up else 'below falling' if ema_down else 'mixed around'} EMA20/EMA50; clustered swing, previous-day, and weekly levels define ATR-confirmed breakout thresholds. This describes current structure only, not a price prediction.",
    }


def plot_analysis(bars: list[Bar], output: str | Path) -> None:
    """Optional visualization. Requires matplotlib in the runtime environment."""
    import matplotlib.pyplot as plt

    cfg = AnalyzerConfig()
    bars = [Bar(**vars(b)) for b in bars]
    add_indicators(bars, cfg)
    detect_swings(bars, cfg.pivot_window)
    result = analyze(bars, cfg)
    x = list(range(len(bars)))
    fig, ax = plt.subplots(figsize=(14, 7))
    for i, bar in enumerate(bars):
        color = "#16825d" if bar.close >= bar.open else "#b23b3b"
        ax.vlines(i, bar.low, bar.high, color=color, linewidth=1)
        ax.vlines(i, bar.open, bar.close, color=color, linewidth=4)
    ax.plot(x, [b.ema20 for b in bars], label="EMA20")
    ax.plot(x, [b.ema50 for b in bars], label="EMA50")
    atr = result["key_levels"]["atr14"]
    for level in result["key_levels"]["support"]:
        ax.axhspan(level - 0.5 * atr, level + 0.5 * atr, color="green", alpha=0.08)
    for level in result["key_levels"]["resistance"]:
        ax.axhspan(level - 0.5 * atr, level + 0.5 * atr, color="red", alpha=0.08)
    for i, bar in enumerate(bars):
        if bar.swing_high or bar.swing_low:
            y = bar.high if bar.swing_high else bar.low
            ax.scatter(i, y, color="black", s=18)
            ax.text(i, y, bar.label, fontsize=8)
    ax.set_title(f"XAU/USD Structure Analyzer: {result['direction']} ({result['confidence']}%)")
    ax.legend(); ax.grid(alpha=0.2); fig.tight_layout(); fig.savefig(output, dpi=150); plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze short-term XAU/USD market structure")
    parser.add_argument("--symbol", default="GC=F", help="Yahoo symbol, e.g. GC=F or XAUUSD=X")
    parser.add_argument("--interval", default="1h", choices=["15m", "1h", "4h"])
    parser.add_argument("--period", default="7d")
    parser.add_argument("--csv", help="Optional OHLCV CSV path instead of Yahoo Finance")
    parser.add_argument("--plot", help="Optional chart output path; requires matplotlib")
    args = parser.parse_args()
    bars = load_csv(args.csv) if args.csv else fetch_yahoo_chart(args.symbol, args.interval, args.period)
    print(json.dumps(analyze(bars), indent=2))
    if args.plot:
        plot_analysis(bars, args.plot)


if __name__ == "__main__":
    main()
