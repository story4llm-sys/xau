'use client';

import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { analyzeBars, AnalyzerResult, Bar, parseCsv } from '@/lib/analyzer';

const sampleUrl = '/sample_xau_1h.csv';

export default function Home() {
  const [bars, setBars] = useState<Bar[]>([]);
  const [result, setResult] = useState<AnalyzerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState('sample CSV');

  useEffect(() => {
    void loadSample();
  }, []);

  async function loadSample() {
    setError(null);
    const text = await fetch(sampleUrl).then((response) => response.text());
    const parsed = parseCsv(text);
    setBars(parsed);
    setResult(analyzeBars(parsed));
    setSource('included sample CSV');
  }

  async function handleFile(file?: File) {
    if (!file) return;
    try {
      setError(null);
      const text = await file.text();
      const parsed = parseCsv(text);
      setBars(parsed);
      setResult(analyzeBars(parsed));
      setSource(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse uploaded CSV.');
    }
  }

  const chartData = useMemo(() => {
    let ema20: number | undefined;
    let ema50: number | undefined;
    const updateEma = (previous: number | undefined, value: number, span: number) => {
      const alpha = 2 / (span + 1);
      return previous === undefined ? value : value * alpha + previous * (1 - alpha);
    };
    return bars.map((bar) => {
      ema20 = updateEma(ema20, bar.close, 20);
      ema50 = updateEma(ema50, bar.close, 50);
      return {
        time: new Date(bar.time).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit' }),
        close: bar.close,
        high: bar.high,
        low: bar.low,
        ema20,
        ema50,
      };
    });
  }, [bars]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(248,197,73,0.18),_transparent_34rem),linear-gradient(135deg,_#020617,_#0f172a_55%,_#111827)] px-4 py-8 sm:px-6 lg:px-10">
      <section className="mx-auto max-w-7xl space-y-6">
        <header className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr] lg:items-end">
          <div>
            <p className="mb-3 inline-flex rounded-full border border-gold-400/40 bg-gold-400/10 px-4 py-1 text-sm font-semibold text-gold-100">XAU/USD · 15m / 1H / 4H structure</p>
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-6xl">Gold market-structure dashboard</h1>
            <p className="mt-4 max-w-3xl text-lg text-slate-300">Explainable short-term analyzer for Gold. It classifies the current regime, clusters key levels, and shows ATR-confirmed breakout thresholds without predicting exact price movement.</p>
          </div>
          <div className="card p-5">
            <label className="block text-sm font-semibold text-slate-200">Upload OHLCV CSV</label>
            <input className="mt-3 block w-full cursor-pointer rounded-xl border border-white/10 bg-slate-900/80 p-3 text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-gold-400 file:px-4 file:py-2 file:font-semibold file:text-slate-950" type="file" accept=".csv,text/csv" onChange={(event) => void handleFile(event.target.files?.[0])} />
            <button onClick={() => void loadSample()} className="mt-3 w-full rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20">Reload sample data</button>
            <p className="mt-3 text-xs text-slate-400">Current source: {source}. For Cloudflare static hosting, use CSV upload or replace the sample file during deployment.</p>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-red-100">{error}</div> : null}

        {result ? (
          <>
            <section className="grid gap-4 md:grid-cols-4">
              <Metric title="Direction" value={result.direction} tone={result.direction === 'bullish' ? 'text-emerald-300' : result.direction === 'bearish' ? 'text-red-300' : 'text-gold-100'} />
              <Metric title="Confidence" value={`${result.confidence}/100`} tone="text-white" />
              <Metric title="Bias" value={result.bias} tone={result.bias === 'long' ? 'text-emerald-300' : result.bias === 'short' ? 'text-red-300' : 'text-slate-200'} />
              <Metric title="Last close" value={result.last_close.toFixed(2)} tone="text-white" />
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
              <div className="card p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-white">Price structure</h2>
                    <p className="text-sm text-slate-400">Close with EMA20 / EMA50 and breakout reference lines.</p>
                  </div>
                  <span className="badge border-white/10 bg-white/5 text-slate-200">As of {new Date(result.as_of).toLocaleString()}</span>
                </div>
                <div className="h-[420px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.09)" />
                      <XAxis dataKey="time" minTickGap={34} stroke="#94a3b8" tick={{ fontSize: 12 }} />
                      <YAxis domain={['dataMin - 8', 'dataMax + 8']} stroke="#94a3b8" tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }} />
                      <Line type="monotone" dataKey="close" dot={false} stroke="#f8c549" strokeWidth={2.4} />
                      <Line type="monotone" dataKey="ema20" dot={false} stroke="#60a5fa" strokeWidth={1.5} />
                      <Line type="monotone" dataKey="ema50" dot={false} stroke="#c084fc" strokeWidth={1.5} />
                      <ReferenceLine y={result.key_levels.breakout_up} stroke="#34d399" strokeDasharray="4 4" label="breakout" />
                      <ReferenceLine y={result.key_levels.breakdown_down} stroke="#fb7185" strokeDasharray="4 4" label="breakdown" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-6">
                <div className="card p-5">
                  <h2 className="text-xl font-bold text-white">Trend structure</h2>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Pill label="Pattern" value={result.trend_structure.pattern} />
                    <Pill label="State" value={result.trend_structure.state} />
                  </div>
                  <div className="mt-5 space-y-2">
                    {result.trend_structure.recent_swings.map((swing) => (
                      <div key={`${swing.time}-${swing.type}-${swing.price}`} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-sm">
                        <span className={swing.type.includes('H') ? 'font-bold text-emerald-200' : 'font-bold text-red-200'}>{swing.type}</span>
                        <span className="text-slate-300">{swing.price.toFixed(2)}</span>
                        <span className="text-xs text-slate-500">{new Date(swing.time).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card p-5">
                  <h2 className="text-xl font-bold text-white">Key levels</h2>
                  <LevelList title="Support" levels={result.key_levels.support} tone="text-emerald-200" />
                  <LevelList title="Resistance" levels={result.key_levels.resistance} tone="text-red-200" />
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <Pill label="Breakout up" value={result.key_levels.breakout_up.toFixed(2)} />
                    <Pill label="Breakdown" value={result.key_levels.breakdown_down.toFixed(2)} />
                    <Pill label="Invalidation" value={result.key_levels.invalidated_trend_level.toFixed(2)} />
                    <Pill label="ATR(14)" value={result.key_levels.atr14.toFixed(2)} />
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="card p-5">
                <h2 className="text-xl font-bold text-white">Range map</h2>
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                      <defs>
                        <linearGradient id="goldArea" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="5%" stopColor="#f8c549" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="#f8c549" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="time" hide />
                      <YAxis hide domain={['dataMin - 10', 'dataMax + 10']} />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }} />
                      <Area type="monotone" dataKey="close" stroke="#f8c549" fill="url(#goldArea)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="card p-5">
                <h2 className="text-xl font-bold text-white">Explanation</h2>
                <p className="mt-3 text-slate-300">{result.explanation}</p>
                <pre className="mt-4 max-h-72 overflow-auto rounded-xl bg-slate-950/80 p-4 text-xs text-slate-300">{JSON.stringify(result, null, 2)}</pre>
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}

function Metric({ title, value, tone }: { title: string; value: string; tone: string }) {
  return (
    <div className="card p-5">
      <p className="text-sm text-slate-400">{title}</p>
      <p className={`mt-2 text-3xl font-black capitalize ${tone}`}>{value}</p>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-bold text-white">{value}</p>
    </div>
  );
}

function LevelList({ title, levels, tone }: { title: string; levels: number[]; tone: string }) {
  return (
    <div className="mt-4">
      <p className="text-sm font-semibold text-slate-300">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {levels.map((level) => (
          <span key={`${title}-${level}`} className={`rounded-full bg-white/10 px-3 py-1 text-sm font-bold ${tone}`}>
            {level.toFixed(2)}
          </span>
        ))}
      </div>
    </div>
  );
}
