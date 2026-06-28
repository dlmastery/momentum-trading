"use client";

import { useEffect, useMemo, useState } from "react";

// ---- types (mirror lib/strategy.ts) ----------------------------------------
interface Etf { id: string; name: string; description: string; count: number }
interface Trade { ticker: string; entryDate: string; entryPrice: number; exitDate: string | null; exitPrice: number | null; returnPct: number | null; pnl: number | null; exitReason: string | null; scoreAtEntry: number }
interface EquityPoint { date: string; equity: number; benchmark: number }
interface RankedRow { ticker: string; rank: number; score: number; g4d: number; g4w: number; analyst: number; recKey: string | null; dayReturnPct: number | null; upDays: number; upWeeks: number; allocated: number; status: "BUY" | "HELD" | "SKIPPED" }
interface DayAction { ticker: string; type: "BUY" | "SELL" | "HOLD"; shares: number; price: number; allocated: number; pnl: number | null; returnPct: number | null; reason: string | null }
interface HoldingRow { ticker: string; shares: number; entryDate: string; entryPrice: number; price: number; value: number; unrealizedPct: number }
interface ScanRow { ticker: string; rank: number; close: number; dayReturnPct: number | null; upDays: number; upWeeks: number; last4days: (boolean | null)[]; last4weeks: (boolean | null)[]; recKey: string | null; g4d: number | null; g4w: number | null; analyst: number | null; score: number; eligible: boolean; inTrade: boolean; status: "BUY" | "SELL" | "HELD" | "SKIPPED" | "—"; fail: string }
interface Funnel { total: number; upToday: number; up4days: number; up4daysWeeks: number; eligible: number; bought: number; held: number; sold: number }
interface DailyRecord { date: string; ranked: RankedRow[]; actions: DayAction[]; holdings: HoldingRow[]; scan: ScanRow[]; funnel: Funnel; cash: number; invested: number; equity: number; dayPnl: number; cumReturnPct: number }
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

      {/* Funnel — why this many names qualified */}
      <div className="funnel">
        <div className="fn"><b>{day.funnel.total}</b><span>stocks today</span></div>
        <div className="fn-arrow">→</div>
        <div className="fn"><b>{day.funnel.upToday}</b><span>closed up</span></div>
        <div className="fn-arrow">→</div>
        <div className="fn"><b>{day.funnel.up4days}</b><span>4 up-days</span></div>
        <div className="fn-arrow">→</div>
        <div className="fn"><b>{day.funnel.up4daysWeeks}</b><span>+4 up-weeks</span></div>
        <div className="fn-arrow">→</div>
        <div className="fn hot"><b>{day.funnel.eligible}</b><span>+analyst Buy = eligible</span></div>
        <div className="fn-arrow">⇒</div>
        <div className="fn act"><b>{day.funnel.bought}</b><span>bought</span></div>
        <div className="fn act"><b>{day.funnel.held}</b><span>held</span></div>
        <div className="fn act"><b>{day.funnel.sold}</b><span>sold</span></div>
      </div>

      <UniverseScan scan={day.scan} />
    </div>
  );
}

// 4 small red/green squares for a sequence of up/down moves (old → new)
function Squares({ seq }: { seq: (boolean | null)[] }) {
  return (
    <span className="sq-row">
      {seq.map((v, i) => (
        <i key={i} className={`sq ${v === null ? "na" : v ? "up" : "dn"}`} title={v === null ? "n/a" : v ? "up" : "down"} />
      ))}
    </span>
  );
}

function UniverseScan({ scan }: { scan: ScanRow[] }) {
  const [filter, setFilter] = useState<"all" | "intrade" | "eligible" | "up">("all");
  const rows = scan.filter((s) =>
    filter === "all" ? true
    : filter === "intrade" ? s.inTrade || s.status === "SELL"
    : filter === "eligible" ? s.eligible || s.inTrade || s.status === "SELL"
    : (s.dayReturnPct ?? 0) > 0
  );
  const decisionTag = (s: ScanRow) =>
    s.status === "BUY" ? <span className="tag buy">BOUGHT today</span>
    : s.status === "SELL" ? <span className="tag sell">SOLD today</span>
    : s.status === "HELD" ? <span className="tag held">holding</span>
    : s.eligible ? <span className="tag skipped">eligible · no slot/cash</span>
    : <span className="muted left" style={{ fontSize: 12 }}>{s.fail}</span>;

  return (
    <div>
      <div className="day-head">
        <div className="section-title sm" style={{ margin: 0 }}>
          Every stock in the index, ranked by 3-factor score — with its last 4 days &amp; 4 weeks (🟩 up / 🟥 down), streaks, and whether we&rsquo;re in the trade ({rows.length} shown)
        </div>
        <div className="seg">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All ranked</button>
          <button className={filter === "intrade" ? "on" : ""} onClick={() => setFilter("intrade")}>In trade</button>
          <button className={filter === "eligible" ? "on" : ""} onClick={() => setFilter("eligible")}>Eligible</button>
          <button className={filter === "up" ? "on" : ""} onClick={() => setFilter("up")}>Up today</button>
        </div>
      </div>
      <div className="tablewrap">
        <table className="scan">
          <thead><tr>
            <th title="Rank across the whole index by score">#</th>
            <th>Ticker</th>
            <th title="Are we currently holding this stock?">In&nbsp;trade</th>
            <th>Close</th><th>Day %</th>
            <th title="Each of the last 4 days: green=up, red=down">Last 4 days</th>
            <th title="Consecutive up days (need 4)">↑d</th>
            <th title="Each of the last 4 weeks: green=up vs prior week, red=down">Last 4 weeks</th>
            <th title="Consecutive up weeks (need 4)">↑w</th>
            <th>Analyst</th>
            <th title="Factor 1: 4-day growth">4d</th>
            <th title="Factor 2: 4-week growth">4w</th>
            <th title="Factor 3: analyst upside">An</th>
            <th title="Equal-weight average of the 3 factors — only when the entry criteria are met, else 0">SCORE</th>
            <th>Decision / why not traded</th>
          </tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.ticker} className={s.status === "BUY" ? "row-buy" : s.inTrade ? "row-held" : s.eligible ? "" : "row-dim"}>
                <td>#{s.rank}</td>
                <td><b>{s.ticker}</b></td>
                <td>{s.inTrade ? <span className="tag held">IN</span> : <span className="muted">—</span>}</td>
                <td>{money(s.close)}</td>
                <td className={cls(s.dayReturnPct)}>{sp(s.dayReturnPct)}</td>
                <td><Squares seq={s.last4days} /></td>
                <td className={s.upDays >= 4 ? "pos" : ""}>{s.upDays}{s.upDays >= 4 ? "✓" : ""}</td>
                <td><Squares seq={s.last4weeks} /></td>
                <td className={s.upWeeks >= 4 ? "pos" : ""}>{s.upWeeks}{s.upWeeks >= 4 ? "✓" : ""}</td>
                <td className="muted">{s.recKey ? s.recKey.replace("_", " ") : "—"}</td>
                <td className={cls(s.g4d)}>{sp(s.g4d)}</td>
                <td className={cls(s.g4w)}>{sp(s.g4w)}</td>
                <td className={cls(s.analyst)}>{sp(s.analyst)}</td>
                <td>{s.eligible ? <b className="pos">{sp(s.score)}</b> : <span className="muted">0</span>}</td>
                <td className="left">{decisionTag(s)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={15} className="muted center">Nothing matches this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TradeLog({ trades, dates }: { trades: Trade[]; dates: string[] }) {
  const idx = useMemo(() => new Map(dates.map((d, i) => [d, i])), [dates]);
  const lastIdx = dates.length - 1;
  const daysHeld = (t: Trade) => {
    const e = idx.get(t.entryDate);
    if (e === undefined) return null;
    const x = t.exitDate ? idx.get(t.exitDate) ?? lastIdx : lastIdx;
    return x - e;
  };
  const closed = trades.filter((t) => t.exitDate);
  const open = trades.filter((t) => !t.exitDate);
  const held = trades.map(daysHeld).filter((d): d is number => d !== null);
  const avgHeld = held.length ? held.reduce((a, b) => a + b, 0) / held.length : 0;
  const maxHeld = held.length ? Math.max(...held) : 0;
  const wins = closed.filter((t) => (t.returnPct ?? 0) > 0).length;

  return (
    <div className="panel">
      <div className="section-title">Every trade taken ({trades.length}) — entry trigger, holding period &amp; exit reason</div>
      <div className="day-totals" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
        <div className="dt"><span>Closed</span><b>{closed.length}</b></div>
        <div className="dt"><span>Still open</span><b>{open.length}</b></div>
        <div className="dt"><span>Win rate (closed)</span><b>{closed.length ? ((wins / closed.length) * 100).toFixed(0) : 0}%</b></div>
        <div className="dt"><span>Avg days held</span><b>{avgHeld.toFixed(1)}</b></div>
        <div className="dt"><span>Longest hold</span><b>{maxHeld} d</b></div>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr>
            <th>Ticker</th>
            <th title="Why we entered: passed the GREEN gate (4 up-days + 4 up-weeks + analyst Buy), ranked by score">Entry reason</th>
            <th>Entry date</th><th>Entry $</th>
            <th title="Trading days the position was held">Days held</th>
            <th>Exit date</th><th>Exit $</th>
            <th>Return</th><th>P&amp;L</th>
            <th title="Why we exited: 2 down days or a rapid drop">Exit reason</th>
          </tr></thead>
          <tbody>
            {trades.map((t, i) => (
              <tr key={i}>
                <td><b>{t.ticker}</b></td>
                <td className="left" style={{ fontSize: 12 }}>
                  <span className="tag held">GREEN</span> <span className="muted">score {sp(t.scoreAtEntry)}</span>
                </td>
                <td>{t.entryDate}</td>
                <td>{money(t.entryPrice)}</td>
                <td>{daysHeld(t) ?? "—"}{!t.exitDate ? <span className="muted"> (open)</span> : ""}</td>
                <td>{t.exitDate ?? <span className="badge">open</span>}</td>
                <td>{t.exitPrice !== null ? money(t.exitPrice) : "—"}</td>
                <td className={cls(t.returnPct)}>{pct(t.returnPct)}</td>
                <td className={cls(t.pnl)}>{t.pnl !== null ? money(t.pnl) : "—"}</td>
                <td className="muted left">{t.exitReason ?? (t.exitDate ? "—" : "still held (trend intact)")}</td>
              </tr>
            ))}
            {trades.length === 0 && <tr><td colSpan={10} className="muted center">No trades triggered in this window.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Methodology() {
  return (
    <details className="doc" open>
      <summary>📘 Methodology — the strategy in Wall&nbsp;Street terms (read me first)</summary>
      <div className="doc-body">
        <p className="doc-lead">
          In professional language this is a <b>long-only, cross-sectional price-momentum strategy with a trend-following
          entry trigger, a sell-side analyst (fundamental) overlay, equal-weight position sizing, and a rules-based stop</b>.
          Plainly: buy stocks that are trending up on more than one timeframe <i>and</i> that Wall&nbsp;Street analysts rate a
          Buy, hold the strongest of them, and cut a name the moment its trend breaks.
        </p>

        <h4>1. The factor stack (what drives every decision)</h4>
        <ul>
          <li><b>Price momentum / trend confirmation</b> — the stock must be rising on two horizons at once: <b>4 consecutive
            higher daily closes</b> and <b>4 consecutive higher weekly closes</b>. Requiring agreement across timeframes is a
            classic trend-confirmation filter.</li>
          <li><b>Fundamental / sentiment overlay</b> — the sell-side <b>analyst consensus must be Buy or Strong&nbsp;Buy</b>
            (Yahoo <code>recommendationKey</code>). This is the &ldquo;quality / fundamentals&rdquo; gate that keeps the
            strategy out of purely technical pops in names the Street dislikes.</li>
          <li><b>Return-potential score</b> — among names that clear the gate, rank by expected upside.</li>
        </ul>

        <h4>2. Entry — the &ldquo;GREEN&rdquo; signal</h4>
        <p>A stock is eligible to buy only when <b>all three</b> are true on the same end-of-day:
          4 up days <b>AND</b> 4 up weeks <b>AND</b> analyst Buy/Strong&nbsp;Buy. Miss any one and it is not a candidate.</p>

        <h4>3. Scoring &amp; selection (&ldquo;return potential&rdquo;)</h4>
        <p>Each eligible stock is scored as the <b>equal-weight average of three percentages</b>:</p>
        <pre>score = ( 4-day price growth  +  4-week price growth  +  analyst mean price-target upside ) / 3</pre>
        <p>All three are in the same unit (%), so a simple average is unbiased. <b>A stock that fails the entry gate scores
          0</b> — it is shown for transparency but cannot be selected. Eligible names are sorted highest-score-first and the
          top ranks fill the open slots.</p>

        <h4>4. Position sizing &amp; budget</h4>
        <p><b>$10,000</b> is split into <b>20 equal slots of $500</b> (equal-dollar weighting). The strategy holds at most
          20 names; it buys the highest-scoring eligible stocks until slots or cash run out, so on quiet days it may sit
          partly in cash.</p>

        <h4>5. Exit — the &ldquo;RED&rdquo; signal (trend-following stop)</h4>
        <p>A held position is sold at the close when <b>either</b>: <b>2 consecutive lower daily closes</b>, or a
          <b> single-day drop of ≥ 20%</b>. A single down day does <i>not</i> sell. Freed capital is recycled into the next
          best eligible names. Each position is re-evaluated <b>every end-of-day</b>.</p>

        <h4>6. Benchmark</h4>
        <p>The equity curve is compared to an <b>equal-weight buy-and-hold</b> of the same universe over the same window —
          a simple &ldquo;did the timing add anything?&rdquo; yardstick.</p>

        <h4>Where this sits in the literature</h4>
        <ul>
          <li><b>Momentum</b> is one of the most documented anomalies in finance (Jegadeesh &amp; Titman, 1993). <b>Trend
            following / time-series momentum</b> underpins managed futures &amp; CTAs (Moskowitz, Ooi &amp; Pedersen, 2012; AQR).</li>
          <li>Pairing momentum with <b>quality/fundamentals</b> echoes O&rsquo;Neil&rsquo;s <b>CAN&nbsp;SLIM</b> and AQR&rsquo;s
            <b> Quality-Minus-Junk</b>; analyst <b>recommendation changes</b> carry information (Womack, 1996).</li>
          <li><b>Cutting losers with a stop</b> is core trend-following risk management — O&rsquo;Neil&rsquo;s famous 7–8% stop.</li>
        </ul>

        <h4 className="warn">⚠️ What a skeptical analyst would flag (read before trusting any number)</h4>
        <ul>
          <li><b>Short-horizon trigger vs. short-term reversal:</b> 4-day / 4-week streaks live in the window where the
            evidence shows <i>mean reversion</i>, not continuation (Jegadeesh 1990; Lehmann 1990). Canonical momentum uses a
            <b> 6–12 month</b> formation window and skips the most recent month.</li>
          <li><b>Analyst rating <i>levels</i> are weak/lagging</b> versus <i>revisions</i> (upgrades, rising targets).</li>
          <li><b>Survivorship bias</b> — constituents are <i>current</i> index members; dropped names are absent.</li>
          <li><b>Look-ahead on analyst data</b> — current ratings/targets are applied across the whole backtest.</li>
          <li><b>Same-close execution</b> — signal and fill both at the day&rsquo;s close; a realistic test trades next open.</li>
          <li><b>No costs</b> — no commissions, spread or slippage; fractional shares assumed. <b>Tiny sample</b> (6 months).</li>
        </ul>
        <p className="doc-foot"><b>Bottom line:</b> the framework is legitimate and institutionally used, but these specific
          parameters are textbook-naïve and the backtest is optimistic. Treat this as an <b>educational tool, not a proven edge</b> —
          not investment advice.</p>
      </div>
    </details>
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
        A daily end-of-day momentum + trend-following backtester with a sell-side analyst overlay. The methodology below explains
        the technique in Wall&nbsp;Street terms; everything further down is the actual audited, day-by-day ledger.
      </p>

      <Methodology />

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

          <TradeLog trades={r.trades} dates={r.dates} />
        </>
      )}
    </div>
  );
}
