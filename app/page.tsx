"use client";

import { useEffect, useMemo, useState } from "react";

// ---- types (mirror lib/strategy.ts) ----------------------------------------
interface Etf { id: string; name: string; description: string; count: number }
interface Trade { ticker: string; entryDate: string; entryPrice: number; exitDate: string | null; exitPrice: number | null; returnPct: number | null; pnl: number | null; exitReason: string | null }
interface EquityPoint { date: string; equity: number; benchmark: number }
interface RankedRow { ticker: string; rank: number; score: number; dayReturnPct: number | null; upDays: number; upWeeks: number; allocated: number; status: "BUY" | "HELD" | "SKIPPED" }
interface DayAction { ticker: string; type: "BUY" | "SELL" | "HOLD"; shares: number; price: number; allocated: number; pnl: number | null; returnPct: number | null; reason: string | null }
interface HoldingRow { ticker: string; shares: number; entryDate: string; entryPrice: number; price: number; value: number; unrealizedPct: number }
interface DailyRecord { date: string; ranked: RankedRow[]; actions: DayAction[]; holdings: HoldingRow[]; cash: number; invested: number; equity: number; dayPnl: number; cumReturnPct: number }
interface Result {
  startDate: string; endDate: string; endEquity: number; totalReturnPct: number; benchmarkReturnPct: number;
  maxDrawdownPct: number; numTrades: number; winRate: number; avgTradeReturnPct: number;
  trades: Trade[]; equityCurve: EquityPoint[]; openPositionsAtEnd: HoldingRow[];
  dates: string[]; tickers: string[]; returnsMatrix: (number | null)[][]; statusMatrix: number[][]; days: DailyRecord[];
}
interface ApiResponse { etf: { name: string }; params: Record<string, number>; tickersWithData: number; requestedTickers: number; result: Result }

// ---- helpers ---------------------------------------------------------------
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(2)}%`);
const money = (x: number) => x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const money0 = (x: number) => x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const cls = (x: number | null | undefined) => (x === null || x === undefined ? "" : x >= 0 ? "pos" : "neg");
const shortDate = (d: string) => d.slice(5); // MM-DD

// daily-return cell color (green up / red down), intensity clamped at ±4%
function heatColor(v: number | null): string {
  if (v === null) return "transparent";
  const m = Math.min(Math.abs(v) / 4, 1);
  const a = 0.12 + m * 0.78;
  return v >= 0 ? `rgba(46,204,113,${a.toFixed(2)})` : `rgba(255,93,108,${a.toFixed(2)})`;
}

function EquityChart({ curve }: { curve: EquityPoint[] }) {
  const W = 1040, H = 240, P = 36;
  const { stratPath, benchPath, yMin, yMax } = useMemo(() => {
    if (curve.length === 0) return { stratPath: "", benchPath: "", yMin: 0, yMax: 1 };
    const vals = curve.flatMap((p) => [p.equity, p.benchmark]).filter((v) => v > 0);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.08 || hi * 0.05; lo -= pad; hi += pad;
    const x = (i: number) => P + (i / (curve.length - 1 || 1)) * (W - 2 * P);
    const y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
    const toPath = (k: "equity" | "benchmark") => curve.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
    return { stratPath: toPath("equity"), benchPath: toPath("benchmark"), yMin: lo, yMax: hi };
  }, [curve]);
  if (curve.length === 0) return null;
  const gridY = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Equity curve">
        {gridY.map((gv, i) => {
          const yy = H - P - ((gv - yMin) / (yMax - yMin || 1)) * (H - 2 * P);
          return (<g key={i}><line x1={P} y1={yy} x2={W - P} y2={yy} stroke="#263043" /><text x={6} y={yy + 4} fill="#8b97aa" fontSize={11}>{money0(gv)}</text></g>);
        })}
        <path d={benchPath} fill="none" stroke="#8b97aa" strokeWidth={1.5} opacity={0.8} />
        <path d={stratPath} fill="none" stroke="#4f9dff" strokeWidth={2.5} />
      </svg>
      <div className="legend"><span className="strat">Strategy</span><span className="bench">Benchmark (equal-weight buy &amp; hold)</span></div>
    </div>
  );
}

// ---- the daily heatmap spreadsheet -----------------------------------------
function Heatmap({ r, selected, onSelect }: { r: Result; selected: number; onSelect: (i: number) => void }) {
  const [tradedOnly, setTradedOnly] = useState(true);
  const rows = useMemo(() => {
    const idxs = r.tickers.map((_, i) => i);
    if (!tradedOnly) return idxs;
    return idxs.filter((ti) => r.statusMatrix[ti].some((s) => s === 1 || s === 2 || s === 3));
  }, [r, tradedOnly]);

  const marker = (s: number) => (s === 2 ? "B" : s === 3 ? "S" : s === 1 ? "·" : s === 4 ? "○" : "");
  const markerCls = (s: number) => (s === 2 ? "mk-buy" : s === 3 ? "mk-sell" : s === 1 ? "mk-hold" : s === 4 ? "mk-skip" : "");

  return (
    <div>
      <div className="hm-toolbar">
        <label className="inline">
          <input type="checkbox" checked={tradedOnly} onChange={(e) => setTradedOnly(e.target.checked)} /> Only stocks that were traded ({rows.length} rows)
        </label>
        <div className="hm-legend">
          <span><i className="sw" style={{ background: "rgba(46,204,113,0.8)" }} /> up day</span>
          <span><i className="sw" style={{ background: "rgba(255,93,108,0.8)" }} /> down day</span>
          <span className="mk-buy">B buy</span>
          <span className="mk-sell">S sell</span>
          <span className="mk-hold">· hold</span>
          <span className="mk-skip">○ signal, no slot</span>
        </div>
      </div>
      <div className="hm-wrap">
        <table className="hm">
          <thead>
            <tr>
              <th className="hm-corner">Stock \ Day</th>
              {r.dates.map((d, di) => (
                <th key={d} className={`hm-date ${di === selected ? "sel" : ""}`} onClick={() => onSelect(di)} title={d}>
                  <span>{shortDate(d)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((ti) => (
              <tr key={r.tickers[ti]}>
                <th className="hm-ticker">{r.tickers[ti]}</th>
                {r.dates.map((d, di) => {
                  const v = r.returnsMatrix[ti][di];
                  const st = r.statusMatrix[ti][di];
                  return (
                    <td
                      key={d}
                      className={`hm-cell ${di === selected ? "sel" : ""} ${st === 2 ? "b-buy" : st === 3 ? "b-sell" : st === 1 ? "b-hold" : ""}`}
                      style={{ background: heatColor(v) }}
                      onClick={() => onSelect(di)}
                      title={`${r.tickers[ti]} ${d}\nday: ${v === null ? "n/a" : v + "%"}${st ? "\n" + (st === 2 ? "BUY" : st === 3 ? "SELL" : st === 1 ? "HELD" : "signalled") : ""}`}
                    >
                      {st ? <span className={markerCls(st)}>{marker(st)}</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- detail for one trading day --------------------------------------------
function DayDetail({ day }: { day: DailyRecord }) {
  return (
    <div>
      <div className="day-totals">
        <div className="dt"><span>Equity</span><b className={cls(day.cumReturnPct)}>{money(day.equity)}</b></div>
        <div className="dt"><span>Cash idle</span><b>{money(day.cash)}</b></div>
        <div className="dt"><span>Invested</span><b>{money(day.invested)}</b></div>
        <div className="dt"><span>Day P&amp;L</span><b className={cls(day.dayPnl)}>{day.dayPnl >= 0 ? "+" : ""}{money(day.dayPnl)}</b></div>
        <div className="dt"><span>Cumulative</span><b className={cls(day.cumReturnPct)}>{pct(day.cumReturnPct)}</b></div>
        <div className="dt"><span>Positions</span><b>{day.holdings.length}</b></div>
      </div>

      <div className="day-grid">
        <div>
          <div className="section-title sm">Scored &amp; ranked candidates — both 4 up-days &amp; 4 up-weeks &amp; bullish ({day.ranked.length})</div>
          <div className="tablewrap short">
            <table>
              <thead><tr><th>Rank</th><th>Ticker</th><th>Score</th><th>Day %</th><th>↑Days</th><th>↑Wks</th><th>Action</th><th>Allocated</th></tr></thead>
              <tbody>
                {day.ranked.map((c) => (
                  <tr key={c.ticker} className={c.status === "BUY" ? "row-buy" : c.status === "HELD" ? "row-held" : ""}>
                    <td>#{c.rank}</td>
                    <td>{c.ticker}</td>
                    <td>{c.score.toFixed(3)}</td>
                    <td className={cls(c.dayReturnPct)}>{c.dayReturnPct === null ? "—" : `${c.dayReturnPct >= 0 ? "+" : ""}${(c.dayReturnPct * 100).toFixed(2)}%`}</td>
                    <td>{c.upDays}</td>
                    <td>{c.upWeeks}</td>
                    <td><span className={`tag ${c.status.toLowerCase()}`}>{c.status === "SKIPPED" ? "no slot" : c.status}</span></td>
                    <td>{c.allocated > 0 ? money(c.allocated) : "—"}</td>
                  </tr>
                ))}
                {day.ranked.length === 0 && <tr><td colSpan={8} className="muted center">No entry signals this day.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="section-title sm">Decisions executed today ({day.actions.length})</div>
          <div className="tablewrap short">
            <table>
              <thead><tr><th>Action</th><th>Ticker</th><th>Shares</th><th>Price</th><th>Value</th><th>P&amp;L</th><th>Reason</th></tr></thead>
              <tbody>
                {day.actions.map((a, i) => (
                  <tr key={i}>
                    <td><span className={`tag ${a.type.toLowerCase()}`}>{a.type}</span></td>
                    <td>{a.ticker}</td>
                    <td>{a.shares.toFixed(3)}</td>
                    <td>{money(a.price)}</td>
                    <td>{money(a.allocated)}</td>
                    <td className={cls(a.pnl)}>{a.pnl === null ? "—" : `${a.pnl >= 0 ? "+" : ""}${money(a.pnl)}`}{a.returnPct !== null ? ` (${(a.returnPct * 100).toFixed(1)}%)` : ""}</td>
                    <td className="muted left">{a.reason ?? (a.type === "HOLD" ? "still trending" : "—")}</td>
                  </tr>
                ))}
                {day.actions.length === 0 && <tr><td colSpan={7} className="muted center">No trades — fully in cash.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="section-title sm">Portfolio at end of {day.date} — {money(day.invested)} across {day.holdings.length} positions + {money(day.cash)} cash</div>
      <div className="tablewrap short">
        <table>
          <thead><tr><th>Ticker</th><th>Shares</th><th>Entry date</th><th>Entry</th><th>Now</th><th>Value</th><th>Unrealized</th></tr></thead>
          <tbody>
            {day.holdings.map((h) => (
              <tr key={h.ticker}>
                <td>{h.ticker}</td><td>{h.shares.toFixed(3)}</td><td>{h.entryDate}</td><td>{money(h.entryPrice)}</td><td>{money(h.price)}</td><td>{money(h.value)}</td>
                <td className={cls(h.unrealizedPct)}>{pct(h.unrealizedPct)}</td>
              </tr>
            ))}
            {day.holdings.length === 0 && <tr><td colSpan={7} className="muted center">Flat — no open positions.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Home() {
  const [etfs, setEtfs] = useState<Etf[]>([]);
  const [etfId, setEtfId] = useState("nasdaq100");
  const [years, setYears] = useState(2);
  const [monthsBack, setMonthsBack] = useState(6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [selDay, setSelDay] = useState(0);

  useEffect(() => { fetch("/api/etfs").then((r) => r.json()).then(setEtfs).catch(() => {}); }, []);

  async function run() {
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch("/api/backtest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ etfId, years, monthsBack }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
      setSelDay((json.result.dates?.length ?? 1) - 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally { setLoading(false); }
  }

  const r = data?.result;
  const day = r && r.days[selDay] ? r.days[selDay] : null;

  return (
    <div className="wrap">
      <h1 className="title">SimpleTrade</h1>
      <p className="subtitle">
        Daily end-of-day momentum backtester. Every trading day it scores the ETF&rsquo;s stocks, ranks those that fired the entry signal
        (<b>4 consecutive up days AND 4 consecutive up weeks AND a bullish trend</b>), buys the top ranks with a $10,000 budget split into
        20 equal $500 slots, then re-evaluates daily — holding or selling on two down days / a rapid drop. Everything below is the actual audited ledger.
      </p>

      <div className="panel">
        <div className="controls">
          <div><label>ETF / Index</label>
            <select value={etfId} onChange={(e) => setEtfId(e.target.value)}>{etfs.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.count} stocks)</option>)}</select>
          </div>
          <div><label>History (years)</label><input type="number" min={1} max={10} value={years} onChange={(e) => setYears(Number(e.target.value))} /></div>
          <div><label>Backtest window (months)</label><input type="number" min={1} max={24} value={monthsBack} onChange={(e) => setMonthsBack(Number(e.target.value))} /></div>
          <button className="run" onClick={run} disabled={loading}>{loading && <span className="spinner" />}{loading ? "Running…" : "Run backtest"}</button>
        </div>
      </div>

      <div className="note">
        <b>Data &amp; methodology:</b> split/dividend-adjusted daily prices from Yahoo Finance, cached on disk. Real analyst-rating feeds are paid, so
        &ldquo;analyst bullish on fundamentals&rdquo; is a transparent proxy: price above its 200-day average <i>and</i> a positive 6-month return.
        Research/education only — not investment advice.
      </div>

      {error && <div className="error">⚠ {error}</div>}
      {loading && !data && <div className="panel">Fetching constituents &amp; running the simulation… first run may take ~30–60s while the price cache fills.</div>}

      {r && data && (
        <>
          <div className="panel">
            <div className="cards">
              <div className="card"><div className="k">Final equity</div><div className={`v ${cls(r.totalReturnPct)}`}>{money0(r.endEquity)}</div></div>
              <div className="card"><div className="k">Strategy return</div><div className={`v ${cls(r.totalReturnPct)}`}>{pct(r.totalReturnPct)}</div></div>
              <div className="card"><div className="k">Benchmark return</div><div className={`v ${cls(r.benchmarkReturnPct)}`}>{pct(r.benchmarkReturnPct)}</div></div>
              <div className="card"><div className="k">Max drawdown</div><div className="v neg">-{pct(r.maxDrawdownPct).replace("-", "")}</div></div>
              <div className="card"><div className="k">Closed trades</div><div className="v">{r.numTrades}</div></div>
              <div className="card"><div className="k">Win rate</div><div className="v">{pct(r.winRate)}</div></div>
              <div className="card"><div className="k">Avg trade return</div><div className={`v ${cls(r.avgTradeReturnPct)}`}>{pct(r.avgTradeReturnPct)}</div></div>
              <div className="card"><div className="k">Open at end</div><div className="v">{r.openPositionsAtEnd.length}</div></div>
            </div>
          </div>

          <div className="panel">
            <div className="section-title">Equity curve — {data.etf.name} · {r.startDate} → {r.endDate} <span className="badge">{data.tickersWithData}/{data.requestedTickers} tickers with data</span></div>
            <EquityChart curve={r.equityCurve} />
          </div>

          <div className="panel">
            <div className="section-title">Daily move heatmap — green/red = each stock&rsquo;s % change per day, markers = strategy decisions. Click any day to inspect it below.</div>
            <Heatmap r={r} selected={selDay} onSelect={setSelDay} />
          </div>

          {day && (
            <div className="panel">
              <div className="day-head">
                <div className="section-title" style={{ margin: 0 }}>Day {selDay + 1} of {r.dates.length} — {day.date}</div>
                <div className="day-nav">
                  <button onClick={() => setSelDay(Math.max(0, selDay - 1))} disabled={selDay === 0}>‹ Prev</button>
                  <select value={selDay} onChange={(e) => setSelDay(Number(e.target.value))}>
                    {r.dates.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                  <button onClick={() => setSelDay(Math.min(r.dates.length - 1, selDay + 1))} disabled={selDay === r.dates.length - 1}>Next ›</button>
                </div>
              </div>
              <DayDetail day={day} />
            </div>
          )}

          <div className="panel">
            <div className="section-title">Full trade log ({r.trades.length})</div>
            <div className="tablewrap">
              <table>
                <thead><tr><th>Ticker</th><th>Entry date</th><th>Entry</th><th>Exit date</th><th>Exit</th><th>Return</th><th>P&amp;L</th><th>Exit reason</th></tr></thead>
                <tbody>
                  {r.trades.map((t, i) => (
                    <tr key={i}>
                      <td>{t.ticker}</td><td>{t.entryDate}</td><td>{money(t.entryPrice)}</td><td>{t.exitDate ?? <span className="badge">open</span>}</td>
                      <td>{t.exitPrice !== null ? money(t.exitPrice) : "—"}</td><td className={cls(t.returnPct)}>{pct(t.returnPct)}</td>
                      <td className={cls(t.pnl)}>{t.pnl !== null ? money(t.pnl) : "—"}</td><td className="muted left">{t.exitReason ?? "—"}</td>
                    </tr>
                  ))}
                  {r.trades.length === 0 && <tr><td colSpan={8} className="muted center">No trades triggered in this window.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
