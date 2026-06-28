export type Direction = 'bullish' | 'bearish' | 'range';
export type Bias = 'long' | 'short' | 'neutral';

export type Bar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  ema20?: number;
  ema50?: number;
  atr14?: number;
  swingHigh?: boolean;
  swingLow?: boolean;
  label?: string;
};

export type AnalyzerResult = {
  as_of: string;
  last_close: number;
  direction: Direction;
  confidence: number;
  trend_structure: {
    pattern: 'HH-HL' | 'LH-LL' | 'mixed';
    state: 'trending' | 'ranging';
    recent_swings: Array<{ time: string; type: string; side: 'high' | 'low'; price: number }>;
  };
  key_levels: {
    support: number[];
    resistance: number[];
    breakout_up: number;
    breakdown_down: number;
    invalidated_trend_level: number;
    previous_day_high: number;
    previous_day_low: number;
    weekly_high: number;
    weekly_low: number;
    atr14: number;
  };
  bias: Bias;
  explanation: string;
};

const cfg = {
  pivotWindow: 2,
  atrPeriod: 14,
  emaFast: 20,
  emaSlow: 50,
  atrBreakoutMult: 0.1,
  zoneAtrMult: 0.75,
  clusterAtrMult: 0.6,
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function parseCsv(text: string): Bar[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV must include a header and at least one data row.');
  const headers = splitCsvLine(lines[0]);
  const lower = new Map(headers.map((header, index) => [header.trim().toLowerCase(), index]));
  const timeIndex = ['datetime', 'timestamp', 'date', 'time'].map((key) => lower.get(key)).find((v) => v !== undefined);
  const openIndex = lower.get('open');
  const highIndex = lower.get('high');
  const lowIndex = lower.get('low');
  const closeIndex = lower.get('close');
  const volumeIndex = lower.get('volume');
  if ([timeIndex, openIndex, highIndex, lowIndex, closeIndex].some((v) => v === undefined)) {
    throw new Error('CSV must include Date/Datetime/Timestamp/Time plus Open, High, Low, Close columns.');
  }
  const bars = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const timestamp = cells[timeIndex as number];
    return {
      time: new Date(Number.isFinite(Number(timestamp)) ? Number(timestamp) * 1000 : timestamp).toISOString(),
      open: Number(cells[openIndex as number]),
      high: Number(cells[highIndex as number]),
      low: Number(cells[lowIndex as number]),
      close: Number(cells[closeIndex as number]),
      volume: volumeIndex === undefined ? 0 : Number(cells[volumeIndex] || 0),
    };
  });
  return bars
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function analyzeBars(input: Bar[]): AnalyzerResult {
  if (input.length < 60) throw new Error('At least 60 bars are recommended for EMA50, ATR, and swing analysis.');
  const bars = input.map((bar) => ({ ...bar })).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  addIndicators(bars);
  detectSwings(bars);
  const swings = labelStructure(bars);
  const latest = bars[bars.length - 1];
  const atr = latest.atr14 ?? mean(bars.slice(-14).map((bar) => bar.high - bar.low));
  const close = latest.close;
  const recentSwings = swings.slice(-12);
  const highs = recentSwings.filter((s) => s.side === 'high').map((s) => s.price);
  const lows = recentSwings.filter((s) => s.side === 'low').map((s) => s.price);
  const lastResistance = highs.at(-1) ?? Math.max(...bars.slice(-20).map((bar) => bar.high));
  const lastSupport = lows.at(-1) ?? Math.min(...bars.slice(-20).map((bar) => bar.low));
  const [previousDayHigh, previousDayLow] = previousDayHighLow(bars);
  const weeklyHigh = Math.max(...bars.map((bar) => bar.high));
  const weeklyLow = Math.min(...bars.map((bar) => bar.low));
  const support = clusterLevels([...lows.slice(-4), previousDayLow, weeklyLow], atr).filter((level) => level <= close + atr);
  const resistance = clusterLevels([...highs.slice(-4), previousDayHigh, weeklyHigh], atr).filter((level) => level >= close - atr);

  const ema20 = latest.ema20 ?? close;
  const ema50 = latest.ema50 ?? close;
  const emaUp = close > ema20 && ema20 > ema50 && (bars.at(-1)?.ema20 ?? 0) > (bars.at(-4)?.ema20 ?? 0) && (bars.at(-1)?.ema50 ?? 0) >= (bars.at(-4)?.ema50 ?? 0);
  const emaDown = close < ema20 && ema20 < ema50 && (bars.at(-1)?.ema20 ?? 0) < (bars.at(-4)?.ema20 ?? 0) && (bars.at(-1)?.ema50 ?? 0) <= (bars.at(-4)?.ema50 ?? 0);
  const labels = recentSwings.slice(-6).map((s) => s.type);
  const bullCount = labels.filter((label) => label === 'HH' || label === 'HL').length;
  const bearCount = labels.filter((label) => label === 'LH' || label === 'LL').length;
  const rangeWidth = weeklyHigh - weeklyLow;
  const rangeLike = rangeWidth <= Math.max(atr * 8, close * 0.015) || Math.abs(bullCount - bearCount) <= 1;

  let direction: Direction = 'range';
  if (bullCount >= bearCount + 2 && emaUp) direction = 'bullish';
  else if (bearCount >= bullCount + 2 && emaDown) direction = 'bearish';
  else if (!rangeLike && emaUp) direction = 'bullish';
  else if (!rangeLike && emaDown) direction = 'bearish';

  const structureScore = Math.min(35, Math.abs(bullCount - bearCount) * 10);
  const emaScore = (direction === 'bullish' && emaUp) || (direction === 'bearish' && emaDown) ? 30 : direction === 'range' ? 12 : 0;
  const levelScore = support.length && resistance.length ? 20 : 10;
  const volatilityScore = atr > 0 && rangeWidth > atr * 3 ? 15 : 5;
  let confidence = Math.max(0, Math.min(100, structureScore + emaScore + levelScore + volatilityScore));
  if (direction === 'range') confidence = Math.max(45, Math.min(75, 40 + levelScore + (rangeLike ? 15 : 0)));

  const breakoutUp = round2(lastResistance + cfg.atrBreakoutMult * atr);
  const breakdownDown = round2(lastSupport - cfg.atrBreakoutMult * atr);
  const invalidatedTrendLevel = round2(direction === 'bullish' ? lastSupport - cfg.zoneAtrMult * atr : lastResistance + cfg.zoneAtrMult * atr);
  const pattern: AnalyzerResult['trend_structure']['pattern'] = bullCount > bearCount ? 'HH-HL' : bearCount > bullCount ? 'LH-LL' : 'mixed';
  const bias: Bias = direction === 'bullish' && close > breakoutUp - atr ? 'long' : direction === 'bearish' && close < breakdownDown + atr ? 'short' : 'neutral';

  return {
    as_of: latest.time,
    last_close: round2(close),
    direction,
    confidence: Math.round(confidence),
    trend_structure: { pattern, state: direction === 'range' ? 'ranging' : 'trending', recent_swings: recentSwings.slice(-8) },
    key_levels: {
      support,
      resistance,
      breakout_up: breakoutUp,
      breakdown_down: breakdownDown,
      invalidated_trend_level: invalidatedTrendLevel,
      previous_day_high: round2(previousDayHigh),
      previous_day_low: round2(previousDayLow),
      weekly_high: round2(weeklyHigh),
      weekly_low: round2(weeklyLow),
      atr14: round2(atr),
    },
    bias,
    explanation: `Structure is ${pattern}; close is ${emaUp ? 'above rising' : emaDown ? 'below falling' : 'mixed around'} EMA20/EMA50; clustered swing, previous-day, and weekly levels define ATR-confirmed breakout thresholds. This describes current structure only, not a price prediction.`,
  };
}

function addIndicators(bars: Bar[]) {
  let ema20: number | undefined;
  let ema50: number | undefined;
  const trueRanges: number[] = [];
  let previousClose: number | undefined;
  for (const bar of bars) {
    ema20 = ema(ema20, bar.close, cfg.emaFast);
    ema50 = ema(ema50, bar.close, cfg.emaSlow);
    bar.ema20 = ema20;
    bar.ema50 = ema50;
    const tr = Math.max(bar.high - bar.low, previousClose === undefined ? 0 : Math.abs(bar.high - previousClose), previousClose === undefined ? 0 : Math.abs(bar.low - previousClose));
    trueRanges.push(tr);
    if (trueRanges.length >= cfg.atrPeriod) bar.atr14 = mean(trueRanges.slice(-cfg.atrPeriod));
    previousClose = bar.close;
  }
}

function ema(previous: number | undefined, value: number, span: number) {
  const alpha = 2 / (span + 1);
  return previous === undefined ? value : value * alpha + previous * (1 - alpha);
}

function detectSwings(bars: Bar[]) {
  for (let i = cfg.pivotWindow; i < bars.length - cfg.pivotWindow; i += 1) {
    const left = bars.slice(i - cfg.pivotWindow, i);
    const right = bars.slice(i + 1, i + cfg.pivotWindow + 1);
    bars[i].swingHigh = bars[i].high > Math.max(...left.map((b) => b.high)) && bars[i].high >= Math.max(...right.map((b) => b.high));
    bars[i].swingLow = bars[i].low < Math.min(...left.map((b) => b.low)) && bars[i].low <= Math.min(...right.map((b) => b.low));
  }
}

function labelStructure(bars: Bar[]) {
  const swings: AnalyzerResult['trend_structure']['recent_swings'] = [];
  let lastHigh: number | undefined;
  let lastLow: number | undefined;
  for (const bar of bars) {
    if (bar.swingHigh) {
      const type = lastHigh === undefined ? 'H' : bar.high > lastHigh ? 'HH' : 'LH';
      bar.label = type;
      swings.push({ time: bar.time, type, side: 'high', price: round2(bar.high) });
      lastHigh = bar.high;
    }
    if (bar.swingLow) {
      const type = lastLow === undefined ? 'L' : bar.low > lastLow ? 'HL' : 'LL';
      bar.label = type;
      swings.push({ time: bar.time, type, side: 'low', price: round2(bar.low) });
      lastLow = bar.low;
    }
  }
  return swings;
}

function clusterLevels(levels: number[], atr: number) {
  const values = levels.filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return [];
  const threshold = Math.max(atr * cfg.clusterAtrMult, 0.01);
  const clusters: number[][] = [[values[0]]];
  for (const value of values.slice(1)) {
    const last = clusters[clusters.length - 1];
    if (Math.abs(value - mean(last)) <= threshold) last.push(value);
    else clusters.push([value]);
  }
  return clusters.map((cluster) => round2(mean(cluster)));
}

function previousDayHighLow(bars: Bar[]): [number, number] {
  const dates = [...new Set(bars.map((bar) => bar.time.slice(0, 10)))].sort();
  const target = dates.length >= 2 ? dates[dates.length - 2] : dates[dates.length - 1];
  const dayBars = bars.filter((bar) => bar.time.startsWith(target));
  return [Math.max(...dayBars.map((bar) => bar.high)), Math.min(...dayBars.map((bar) => bar.low))];
}
