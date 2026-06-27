"use client";

import { useEffect, useMemo, useState } from "react";

// ---- types (mirror lib/strategy.ts) ----------------------------------------
interface Etf { id: string; name: string; description: string; count: number }
interface Trade { ticker: string; entryDate: string; entryPrice: number; exitDate: string | null; exitPrice: number | null; returnPct: number | null; pnl: number | null; exitReason: string | null }
interface EquityPoint { date: string; equity: number; benchmark: number }
interface RankedRow { ticker: string; rank: number; score: number; g4d: number; g4w: number; analyst: number; recKey: string | null; dayReturnPct: number | null; upDays: number; upWeeks: number; allocated: number; status: "BUY" | "HELD" | "SKIPPED" }
interface DayAction { ticker: string; type: "BUY" | "SELL" | "HOLD"; shares: number; price: number; allocated: number; pnl: number | null; returnPct: number | null; reason: string | null }
interface HoldingRow { ticker: string; shares: number; entryDate: string; entryPrice: number; price: number; value: number; unrealizedPct: number }
interface DailyRecord { date: string; ranked: RankedRow[]; actions: DayAction[]; holdings: HoldingRow[]; cash: number; invested: number; equity: number; dayPnl: number; cumReturnPct: number }
interface Result {
  startDate: string; endDate: string; endEquity: number; totalReturnPct: number; benchmarkReturnPct: number;
  maxDrawdownPct: number; numTrades: number; winRate: number; avgTradeReturnPct: number;
  trades: Trade[]; equityCurve: EquityPoint[]; openPositionsAtEnd: HoldingRow[]; bullishCount: number;
  dates: string[]; tickers: string[]; returnsMatrix: (number | null)[][]; statusMatrix: number[][]; days: DailyRecord[];
}
interface ApiResponse { etf: { name: string }; params: Record<string, number>; tickersWithData: number; requestedTickers: number; analystCovered: number; result: Result }

// ---- helpers ---------------------------------------------------------------
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(2)}%`);
const money = (x: number) => x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const money0 = (x: number) => x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const cls = (x: number | null | undefined) => (x === null || x === undefined ? "" : x >= 0 ? "pos" : "neg");
const shortDate = (d: string) => d.slice(5); // MM-DD
const sp = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`); // signed %

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
  const buys = day.actions.filter((a) => a.type === "BUY");
  const sells = day.actions.filter((a) => a.type === "SELL");
  const holds = day.actions.filter((a) => a.type === "HOLD");

  return (
    <div>
      <div className="day-totals">
        <div className="dt"><span>Equity</span><b className={cls(day.cumReturnPct)}>{money(day.equity)}</b></div>
        <div className="dt"><span>Cash idle</span><b>{money(day.cash)}</b></div>
        <div className="dt"><span>Invested</span><b>{money(day.invested)}</b></div>
        <div className="dt"><span>This day&rsquo;s P&amp;L</span><b className={cls(day.dayPnl)}>{day.dayPnl >= 0 ? "+" : ""}{money(day.dayPnl)}</b></div>
        <div className="dt"><span>Cumulative</span><b className={cls(day.cumReturnPct)}>{pct(day.cumReturnPct)}</b></div>
        <div className="dt"><span>Positions held</span><b>{day.holdings.length} / {20}</b></div>
      </div>

      {/* What the strategy DID on this day: enter / exit / hold */}
      <div className="eeh">
        <div className="eeh-col enter">
          <div className="eeh-head">🟢 ENTERING — {buys.length} buy{buys.length !== 1 ? "s" : ""}</div>
          {buys.length === 0 ? <div className="eeh-empty">No new entries today.</div> : (
            <table className="mini">
              <thead><tr><th>Ticker</th><th>Why</th><th>Shares</th><th>Price</th><th>Spent</th></tr></thead>
              <tbody>{buys.map((a, i) => (
                <tr key={i}><td><b>{a.ticker}</b></td><td className="muted left">{a.reason}</td><td>{a.shares.toFixed(2)}</td><td>{money(a.price)}</td><td>{money0(a.allocated)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>

        <div className="eeh-col exit">
          <div className="eeh-head">🔴 EXITING — {sells.length} sell{sells.length !== 1 ? "s" : ""}</div>
          {sells.length === 0 ? <div className="eeh-empty">No exits today.</div> : (
            <table className="mini">
              <thead><tr><th>Ticker</th><th>Sold @</th><th>P&amp;L</th><th>Return</th><th>Reason</th></tr></thead>
              <tbody>{sells.map((a, i) => (
                <tr key={i}><td><b>{a.ticker}</b></td><td>{money(a.price)}</td><td className={cls(a.pnl)}>{a.pnl! >= 0 ? "+" : ""}{money(a.pnl!)}</td><td className={cls(a.returnPct)}>{sp(a.returnPct)}</td><td className="muted left">{a.reason}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>

        <div className="eeh-col hold">
          <div className="eeh-head">🔵 HOLDING — {holds.length} kept</div>
          {holds.length === 0 ? <div className="eeh-empty">Nothing carried over.</div> : (
            <table className="mini">
              <thead><tr><th>Ticker</th><th>Now</th><th>Unreal. P&amp;L</th><th>Return</th></tr></thead>
              <tbody>{holds.map((a, i) => (
                <tr key={i}><td><b>{a.ticker}</b></td><td>{money(a.price)}</td><td className={cls(a.pnl)}>{a.pnl! >= 0 ? "+" : ""}{money(a.pnl!)}</td><td className={cls(a.returnPct)}>{sp(a.returnPct)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      {/* The ranking that produced those decisions */}
      <div className="section-title sm">
        Top stocks scored this day — only those passing the entry signal (4 up-days + 4 up-weeks + analyst Buy), ranked by the 3-factor score.
        The top {20} fillable slots are bought ($500 each); ties beyond 20 or empty cash are skipped. ({day.ranked.length} eligible)
      </div>
      <div className="tablewrap short">
        <table>
          <thead><tr>
            <th>Rank</th><th>Ticker</th>
            <th title="Factor 1: price growth over the last 4 days">4-day ↑</th>
            <th title="Factor 2: price growth over the last 4 weeks">4-week ↑</th>
            <th title="Factor 3: analyst mean price-target upside">Analyst ↑</th>
            <th title="Equal-weight average of the 3 factors">SCORE</th>
            <th>Rating</th><th>Decision</th><th>Allocated</th>
          </tr></thead>
          <tbody>
            {day.ranked.map((c) => (
              <tr key={c.ticker} className={c.rank <= 20 ? (c.status === "BUY" ? "row-buy" : c.status === "HELD" ? "row-held" : "") : "row-dim"}>
                <td>#{c.rank}</td>
                <td><b>{c.ticker}</b></td>
                <td className={cls(c.g4d)}>{sp(c.g4d)}</td>
                <td className={cls(c.g4w)}>{sp(c.g4w)}</td>
                <td className={cls(c.analyst)}>{sp(c.analyst)}</td>
                <td><b className={cls(c.score)}>{sp(c.score)}</b></td>
                <td className="muted">{c.recKey ? c.recKey.replace("_", " ") : "—"}</td>
                <td><span className={`tag ${c.status.toLowerCase()}`}>{c.status === "BUY" ? "BOUGHT" : c.status === "HELD" ? "ALREADY HELD" : "no slot/cash"}</span></td>
                <td>{c.allocated > 0 ? money0(c.allocated) : "—"}</td>
              </tr>
            ))}
            {day.ranked.length === 0 && <tr><td colSpan={9} className="muted center">No stock passed the entry signal on this day — strategy stays put.</td></tr>}
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
        Daily end-of-day momentum backtester. Entry requires <b>4 consecutive up days AND 4 consecutive up weeks AND analysts rating it Buy/Strong&nbsp;Buy</b>.
        Eligible stocks are scored on exactly three factors — <b>4-day growth, 4-week growth, and analyst price-target upside</b> (equal-weight average) —
        ranked, and the top ranks are bought with a $10,000 budget split into 20 equal $500 slots. Positions are re-evaluated daily and sold on two down
        days or a rapid drop. Everything below is the actual audited ledger.
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
        <b>Data &amp; methodology:</b> split/dividend-adjusted daily prices and <b>real analyst ratings &amp; mean price targets</b> from Yahoo Finance, cached on disk.
        One honest limitation: analyst ratings are <i>current</i> (Yahoo doesn&rsquo;t expose historical targets for free), so the same rating is applied
        across the backtest window — a mild look-ahead on factor&nbsp;3. Research/education only — not investment advice.
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
            <div className="section-title">Equity curve — {data.etf.name} · {r.startDate} → {r.endDate} <span className="badge">{data.tickersWithData}/{data.requestedTickers} price · {data.analystCovered} analyst-rated · {r.bullishCount} bullish</span></div>
            <EquityChart curve={r.equityCurve} />
          </div>

          <div className="panel rules-box">
            <div className="section-title">How a stock turns 🟢 GREEN (enter) or 🔴 RED (exit)</div>
            <div className="rules2">
              <div className="rule-card green">
                <div className="rc-head">🟢 GREEN = ENTER (all 3 required, same day)</div>
                <ul>
                  <li><b>{data.params.consecutiveUpDays} consecutive up days</b> — close higher than the prior close, {data.params.consecutiveUpDays} days running</li>
                  <li><b>{data.params.consecutiveUpWeeks} consecutive up weeks</b> — the last {data.params.consecutiveUpWeeks} weekly closes each higher than the one before</li>
                  <li><b>Analysts bullish</b> — Yahoo consensus rating is Buy or Strong&nbsp;Buy</li>
                </ul>
                <div className="rc-foot">Green stocks are scored on the 3 factors, ranked, and the top fill the 20 × $500 slots.</div>
              </div>
              <div className="rule-card red">
                <div className="rc-head">🔴 RED = EXIT a held stock (either one)</div>
                <ul>
                  <li><b>{data.params.consecutiveDownDays} consecutive down days</b> — close lower than the prior close, {data.params.consecutiveDownDays} days in a row</li>
                  <li><b>Rapid drop ≥ {(data.params.rapidDropPct * 100).toFixed(0)}%</b> — a single day that falls {(data.params.rapidDropPct * 100).toFixed(0)}% or more</li>
                </ul>
                <div className="rc-foot">A <i>single</i> down day does <b>not</b> sell — you hold through one red day and only exit on two in a row (or the rapid drop).</div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              Note: individual heatmap cells are shaded green/red by that <i>one</i> day&rsquo;s % move — a colored cell is just a single day, not a trade. The <b>B</b>/<b>S</b> letters are the actual buys/sells.
            </div>
          </div>

          <div className="panel">
            <div className="section-title">① Pick a day — click any column in the grid, or use the slider/arrows below</div>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Each row is a stock, each column a trading day. Cell color = that day&rsquo;s % move (green up / red down); letters mark what the
              strategy did (<b>B</b>uy, <b>S</b>ell, · hold). The highlighted column is the selected day shown in full below.
            </p>
            <Heatmap r={r} selected={selDay} onSelect={setSelDay} />
            <input
              className="day-slider"
              type="range"
              min={0}
              max={r.dates.length - 1}
              value={selDay}
              onChange={(e) => setSelDay(Number(e.target.value))}
              aria-label="Select trading day"
            />
            <div className="day-nav center-nav">
              <button onClick={() => setSelDay(0)} disabled={selDay === 0}>⏮ First</button>
              <button onClick={() => setSelDay(Math.max(0, selDay - 1))} disabled={selDay === 0}>‹ Prev</button>
              <select value={selDay} onChange={(e) => setSelDay(Number(e.target.value))}>
                {r.dates.map((d, i) => <option key={d} value={i}>Day {i + 1} — {d}</option>)}
              </select>
              <button onClick={() => setSelDay(Math.min(r.dates.length - 1, selDay + 1))} disabled={selDay === r.dates.length - 1}>Next ›</button>
              <button onClick={() => setSelDay(r.dates.length - 1)} disabled={selDay === r.dates.length - 1}>Last ⏭</button>
            </div>
          </div>

          {day && (
            <div className="panel">
              <div className="section-title">② Day {selDay + 1} of {r.dates.length} · <span className="pos">{day.date}</span> — everything the strategy saw &amp; did</div>
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
