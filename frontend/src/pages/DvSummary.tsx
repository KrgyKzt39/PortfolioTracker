import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn, money, monthLabel, pct } from "../lib/format";
import { useDividendSummary, usePrivacy } from "../lib/hooks";
import type { DividendSummary } from "../lib/types";
import { Card, Empty, ErrorBox, Segmented, Spinner } from "../components/ui";
import { TickerBadge } from "../components/TickerBadge";

// Validated against the dark card surface (#172235) with the dataviz palette checker.
const RECEIVED = "#1aa86b";
const FORECAST = "#cc820e";

export function DvSummary() {
  const s = useDividendSummary();
  const { hidden } = usePrivacy();
  if (s.isLoading) return <Spinner label="Loading dividends" />;
  if (s.error) return <ErrorBox error={s.error} onRetry={() => s.refetch()} />;
  const d = s.data!;
  const b = d.base_currency;
  const m = (v: string | number | null) => money(v, b, { hidden });

  return (
    <div className="space-y-4">
      <h1 className="px-1 text-2xl font-extrabold text-white">Dividend summary</h1>

      <section className="rounded-[24px] border border-hero-edge/60 bg-gradient-to-br from-hero-from via-[#17305e] to-hero-to p-5 shadow-xl shadow-black/30">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9db3dc]">Est. annual dividends · net</p>
        <p className="tabular mt-1 text-[34px] font-extrabold leading-tight text-gold">{m(d.forward_annual_estimate)}</p>
        <p className="text-xs text-[#a9b8d6]">
          Gross {m(d.forward_annual_estimate_gross)} · estimate, not guaranteed
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <Stat label="Avg monthly (projected)" value={m(d.monthly_average_projected)} cls="text-gold" />
          <Stat label="Trailing 12m received" value={m(d.t12m_net)} cls="text-up" sub={`gross ${m(d.t12m_gross)} · tax ${m(d.t12m_tax)}`} />
          <Stat label="Portfolio yield (net)" value={pct(d.portfolio_yield)} />
          <Stat label="Yield on cost (net)" value={pct(d.yield_on_cost)} />
        </dl>
      </section>

      <MonthlyChart d={d} hidden={hidden} />

      <Contribution d={d} hidden={hidden} />

      <Card>
        <h2 className="px-5 pb-2 pt-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">By account</h2>
        <Table head={["Account", "T12M received", "Forward est."]} rows={d.by_account.map((a) => [a.account, m(a.t12m_net), m(a.forward_net)])} />
      </Card>

      <Card>
        <h2 className="px-5 pb-2 pt-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">By currency (native)</h2>
        <Table head={["Currency", "T12M received", "Forward est."]} rows={d.by_currency.map((c) => [c.currency, money(c.t12m_net, c.currency, { hidden }), money(c.forward_net, c.currency, { hidden })])} />
      </Card>

      <Card>
        <h2 className="px-5 pb-2 pt-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">Year by year (received, net)</h2>
        {d.by_year.length === 0 ? (
          <Empty title="No dividends received yet" />
        ) : (
          <Table
            head={["Year", "Received", "Change"]}
            rows={d.by_year.map((y, i) => {
              const prev = i > 0 ? Number(d.by_year[i - 1].net) : null;
              const chg = prev ? ((Number(y.net) - prev) / prev) * 100 : null;
              return [y.year, m(y.net), chg === null ? "—" : pct(chg, { signed: true })];
            })}
          />
        )}
        <p className="px-5 pb-4 text-2xs text-faint">The current year is partial.</p>
      </Card>

      <p className="px-2 pb-4 text-2xs leading-relaxed text-faint">
        {d.notes.estimates} Received amounts convert at the FX rate on the payment date when stored{d.notes.fx_fallback ? "; some use the latest rate because no historical rate was stored" : ""}.
        {d.notes.unconverted_transactions.length > 0 && ` ${d.notes.unconverted_transactions.length} dividend(s) excluded: missing FX rate.`}
      </p>
    </div>
  );
}

function Stat({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div>
      <dt className="text-2xs text-[#a9b8d6]">{label}</dt>
      <dd className={cn("tabular text-[17px] font-bold text-white", cls)}>{value}</dd>
      {sub && <dd className="text-2xs text-[#8ea0c4]">{sub}</dd>}
    </div>
  );
}

function MonthlyChart({ d, hidden }: { d: DividendSummary; hidden: boolean }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const data = d.chart.map((c) => ({ ...c, label: monthLabel(c.month), received: Number(c.received), forecast: Number(c.forecast), run_rate: Number(c.run_rate) }));
  const runRate = Number(d.monthly_average_projected);
  const has = data.some((x) => x.received || x.forecast);
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 px-5 pb-1 pt-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">Monthly dividends</h2>
        <div className="w-36">
          <Segmented label="Chart view" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-2 text-2xs text-muted">
        <Legend color={RECEIVED} label="Received (last 12m)" />
        <Legend color={FORECAST} label="Expected from events (next 12m)" />
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dashed border-slate-400" /> Avg monthly estimate
        </span>
      </div>
      {!has ? (
        <Empty title="No dividend data yet">Record dividends or add announced events on the Dividends tab.</Empty>
      ) : view === "chart" ? (
        <div className="h-56 px-2 pb-3" role="img" aria-label="Monthly dividends: received over the last 12 months and expected over the next 12 months">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke="#ffffff" strokeOpacity={0.06} />
              <XAxis dataKey="label" tick={{ fill: "#8a97ad", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#ffffff22" }} interval={1} />
              <YAxis tick={{ fill: "#8a97ad", fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => (hidden ? "" : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))} />
              <Tooltip
                cursor={{ fill: "#ffffff", fillOpacity: 0.04 }}
                contentStyle={{ background: "#0e1626", border: "1px solid #ffffff1a", borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: "#e6ebf5" }}
                labelFormatter={(_, p) => (p?.[0]?.payload?.month as string) ?? ""}
                formatter={(v, name) => [money(Number(v), d.base_currency, { hidden }), name === "received" ? "Received" : "Expected"]}
              />
              {runRate > 0 && <ReferenceLine y={runRate} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1.5} />}
              <Bar dataKey="received" stackId="m" fill={RECEIVED} radius={[4, 4, 0, 0]} maxBarSize={14} />
              <Bar dataKey="forecast" stackId="m" fill={FORECAST} radius={[4, 4, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Table head={["Month", "Received", "Expected"]} rows={data.filter((x) => x.received || x.forecast).map((x) => [x.month, money(x.received, d.base_currency, { hidden }), money(x.forecast, d.base_currency, { hidden })])} />
      )}
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {label}
    </span>
  );
}

function Contribution({ d, hidden }: { d: DividendSummary; hidden: boolean }) {
  const b = d.base_currency;
  return (
    <Card>
      <h2 className="px-5 pb-1 pt-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">Contribution by holding</h2>
      <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-1 border-y border-white/5 bg-ink-850 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
        <span className="pl-[58px]">Stock</span>
        <span className="whitespace-nowrap text-center">Est/yr net</span>
        <span className="whitespace-nowrap text-center">Yield/YoC</span>
      </div>
      {d.holdings.length === 0 && <Empty title="No holdings" />}
      <ul>
        {d.holdings.map((h) => (
          <li key={`${h.account}-${h.symbol}`} className="grid grid-cols-[1.4fr_1fr_1fr] items-center gap-1 border-b border-white/[0.045] px-4 py-2.5 last:border-b-0">
            <span className="flex min-w-0 items-center gap-2">
              <TickerBadge symbol={h.symbol} />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-bold text-white">{h.symbol}</span>
                <span className="block truncate text-2xs text-muted">{h.account}</span>
              </span>
            </span>
            <span className="tabular text-center">
              <span className="block text-[13px] font-bold text-gold">{money(h.est_annual_net_base, b, { hidden })}</span>
              <span className="block text-2xs text-muted">{h.share_pct ? `${pct(h.share_pct, { dp: 1 })} of total` : h.dps_source ? "" : "no estimate"}</span>
            </span>
            <span className="tabular text-center">
              <span className="block text-[13px] font-semibold text-white">{pct(h.dividend_yield)}</span>
              <span className="block text-2xs text-muted">{pct(h.yield_on_cost)} YoC</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="px-5 py-3 text-2xs text-faint">Yields are gross (before withholding tax). Estimates use your forward DPS if set, otherwise trailing 12-month dividends.</p>
    </Card>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-y border-white/5 bg-ink-850 text-[11px] uppercase tracking-[0.1em] text-faint">
          {head.map((h, i) => (
            <th key={h} className={cn("px-5 py-2 font-semibold", i === 0 ? "text-left" : "text-right")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-white/[0.045] last:border-b-0">
            {r.map((c, j) => (
              <td key={j} className={cn("tabular px-5 py-2.5", j === 0 ? "text-left font-semibold text-white" : "text-right text-slate-200")}>
                {c}
              </td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={head.length} className="px-5 py-4 text-center text-xs text-faint">
              No data
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
