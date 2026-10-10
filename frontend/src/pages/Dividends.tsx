import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, Plus } from "lucide-react";
import { money, monthLabel, pct, shortDate } from "../lib/format";
import { useDividendSummary, useOpenSheet, usePrivacy } from "../lib/hooks";
import type { DividendSummary } from "../lib/types";
import { Button, Card, Empty, ErrorBox, Spinner } from "../components/ui";
import { TickerBadge } from "../components/TickerBadge";

// Validated against the dark card surface (#172235) with the dataviz palette checker.
const RECEIVED = "#1aa86b";
const EXPECTED = "#cc820e";

export function Dividends() {
  const s = useDividendSummary();
  const { hidden } = usePrivacy();
  const open = useOpenSheet();
  if (s.isLoading) return <Spinner label="Loading dividends" />;
  if (s.error) return <ErrorBox error={s.error} onRetry={() => s.refetch()} />;
  const d = s.data!;
  const m = (v: string | number | null) => money(v, d.base_currency, { hidden });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-2xl font-extrabold text-white">Dividends</h1>
        <Button variant="secondary" onClick={() => open({ kind: "payment" })}>
          <Plus className="h-4 w-4" /> Record
        </Button>
      </div>

      <section className="rounded-[24px] border border-hero-edge/60 bg-gradient-to-br from-hero-from via-[#17305e] to-hero-to p-5 shadow-xl shadow-black/30">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9db3dc]">Expected per year</p>
        <p className="tabular mt-1 text-[34px] font-extrabold leading-tight text-gold">{m(d.forward_annual_estimate)}</p>
        <p className="tabular text-sm text-[#a9b8d6]">
          about {m(d.monthly_average_projected)} a month · {pct(d.portfolio_yield)} yield
        </p>
        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="text-[12px] text-[#a9b8d6]">Received in the last 12 months</p>
          <p className="tabular text-[20px] font-bold text-up">{m(d.t12m_net)}</p>
        </div>
      </section>

      {d.to_confirm.length > 0 && (
        <Card>
          <h2 className="px-5 pb-1 pt-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">Did these arrive?</h2>
          <ul>
            {d.to_confirm.map((e) => (
              <li key={e.id} className="flex items-center gap-3 border-t border-white/[0.045] px-4 py-3">
                <TickerBadge symbol={e.symbol} className="h-[28px] w-[44px]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold text-white">{e.symbol}</span>
                  <span className="block text-2xs text-muted">
                    Paid {shortDate(e.pay_date)} · about {money(e.expected_net, e.currency, { hidden })}
                  </span>
                </span>
                <Button className="px-3 py-1.5 text-xs" onClick={() => open({ kind: "payment", event: e })}>
                  <Check className="h-3.5 w-3.5" /> Received
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <MonthlyChart d={d} hidden={hidden} />

      <Card>
        <h2 className="px-5 pb-2 pt-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">By holding</h2>
        {d.holdings.length === 0 && <Empty title="No dividend estimates yet">Set a yearly dividend per share in a stock's settings, or add its dividends on the Calendar tab.</Empty>}
        <ul>
          {d.holdings.map((h) => (
            <li key={h.symbol} className="flex items-center gap-3 border-t border-white/[0.045] px-4 py-3">
              <TickerBadge symbol={h.symbol} className="h-[28px] w-[44px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold text-white">{h.symbol}</span>
                <span className="block truncate text-2xs text-muted">{h.category}</span>
              </span>
              <span className="tabular text-right">
                <span className="block text-[14px] font-bold text-gold">{m(h.est_annual_net_base)}</span>
                <span className="block text-2xs text-muted">{pct(h.dividend_yield)} yield</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {d.recent_payments.length > 0 && (
        <Card>
          <h2 className="px-5 pb-2 pt-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">Recently received</h2>
          <ul>
            {d.recent_payments.slice(0, 10).map((p) => (
              <li key={p.id} className="border-t border-white/[0.045]">
                <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.02]" onClick={() => open({ kind: "payment", payment: p })}>
                  <span className="min-w-0 flex-1">
                    <span className="text-[14px] font-semibold text-white">{p.symbol}</span>
                    <span className="ml-2 text-2xs text-muted">{shortDate(p.pay_date)}</span>
                  </span>
                  <span className="tabular text-[14px] font-semibold text-up">{money(p.net, p.currency, { hidden })}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="px-2 pb-4 text-2xs leading-relaxed text-faint">Expected amounts are estimates after withholding tax, based on what you hold today. They are not guaranteed.</p>
    </div>
  );
}

function MonthlyChart({ d, hidden }: { d: DividendSummary; hidden: boolean }) {
  const data = d.chart.map((c) => ({ month: c.month, label: monthLabel(c.month), received: Number(c.received), expected: Number(c.expected) }));
  const has = data.some((x) => x.received || x.expected);
  return (
    <Card>
      <h2 className="px-5 pb-1 pt-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">Month by month</h2>
      <div className="flex gap-4 px-5 pb-2 text-2xs text-muted">
        <Legend color={RECEIVED} label="Received" />
        <Legend color={EXPECTED} label="Expected" />
      </div>
      {!has ? (
        <Empty title="No dividends yet">Confirm a dividend when it arrives, or add upcoming ones on the Calendar tab.</Empty>
      ) : (
        <div className="h-52 px-2 pb-3" role="img" aria-label="Dividends received over the last 12 months and expected over the next 12 months">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke="#ffffff" strokeOpacity={0.06} />
              <XAxis dataKey="label" tick={{ fill: "#8a97ad", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#ffffff22" }} interval={2} />
              <YAxis tick={{ fill: "#8a97ad", fontSize: 10 }} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => (hidden ? "" : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))} />
              <Tooltip
                cursor={{ fill: "#ffffff", fillOpacity: 0.04 }}
                contentStyle={{ background: "#0e1626", border: "1px solid #ffffff1a", borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: "#e6ebf5" }}
                labelFormatter={(_, p) => (p?.[0]?.payload?.month as string) ?? ""}
                formatter={(v, name) => [money(Number(v), d.base_currency, { hidden }), name === "received" ? "Received" : "Expected"]}
              />
              <Bar dataKey="received" stackId="m" fill={RECEIVED} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
              <Bar dataKey="expected" stackId="m" fill={EXPECTED} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
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
