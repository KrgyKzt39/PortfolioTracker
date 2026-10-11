import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartColors, useTheme } from "../lib/theme";
import { Check, Plus } from "lucide-react";
import { money, monthLabel, pct, shortDate } from "../lib/format";
import { useDividendSummary, useOpenSheet, usePrivacy } from "../lib/hooks";
import type { DividendSummary } from "../lib/types";
import { Button, Card, Empty, ErrorBox, Spinner } from "../components/ui";
import { TickerBadge } from "../components/TickerBadge";


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
        <h1 className="text-[28px] font-bold tracking-tight text-fg">Dividends</h1>
        <Button variant="secondary" className="rounded-full px-3 py-1.5 text-[13px]" onClick={() => open({ kind: "payment" })}>
          <Plus className="h-3.5 w-3.5" /> Record
        </Button>
      </div>

      <section className="rounded-[20px] bg-surface p-5 shadow-card">
        <p className="text-[15px] font-medium text-muted">Expected per year</p>
        <p className="tabular mt-1 text-[34px] font-bold leading-tight tracking-tight text-fg">{m(d.forward_annual_estimate)}</p>
        <p className="tabular text-sm text-muted">
          about {m(d.monthly_average_projected)} a month · {pct(d.portfolio_yield)} yield
        </p>
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-[12px] text-muted">Received in the last 12 months</p>
          <p className="tabular text-[20px] font-bold text-up">{m(d.t12m_net)}</p>
        </div>
      </section>

      {d.to_confirm.length > 0 && (
        <Card>
          <h2 className="px-5 pb-1 pt-4 text-[15px] font-semibold text-fg">Did these arrive?</h2>
          <ul>
            {d.to_confirm.map((e) => (
              <li key={e.id} className="flex items-center gap-3 border-t border-line px-4 py-3">
                <TickerBadge symbol={e.symbol} className="h-[28px] w-[44px]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold text-fg">{e.symbol}</span>
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
        <h2 className="px-5 pb-2 pt-4 text-[15px] font-semibold text-fg">By holding</h2>
        {d.holdings.length === 0 && <Empty title="No dividend estimates yet">Set a yearly dividend per share in a stock's settings, or add its dividends on the Calendar tab.</Empty>}
        <ul>
          {d.holdings.map((h) => (
            <li key={h.symbol} className="flex items-center gap-3 border-t border-line px-4 py-3">
              <TickerBadge symbol={h.symbol} className="h-[28px] w-[44px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold text-fg">{h.symbol}</span>
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
          <h2 className="px-5 pb-2 pt-4 text-[15px] font-semibold text-fg">Recently received</h2>
          <ul>
            {d.recent_payments.slice(0, 10).map((p) => (
              <li key={p.id} className="border-t border-line">
                <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-ink-50" onClick={() => open({ kind: "payment", payment: p })}>
                  <span className="min-w-0 flex-1">
                    <span className="text-[14px] font-semibold text-fg">{p.symbol}</span>
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
  // Received = confirmed income (green), expected = estimate (amber).
  const cc = chartColors(useTheme().dark);
  const data = d.chart.map((c) => ({ month: c.month, label: monthLabel(c.month), received: Number(c.received), expected: Number(c.expected) }));
  const has = data.some((x) => x.received || x.expected);
  return (
    <Card>
      <h2 className="px-5 pb-1 pt-4 text-[15px] font-semibold text-fg">Month by month</h2>
      <div className="flex gap-4 px-5 pb-2 text-2xs text-muted">
        <Legend color={cc.received} label="Received" />
        <Legend color={cc.expected} label="Expected" />
      </div>
      {!has ? (
        <Empty title="No dividends yet">Confirm a dividend when it arrives, or add upcoming ones on the Calendar tab.</Empty>
      ) : (
        <div className="h-52 px-2 pb-3" role="img" aria-label="Dividends received over the last 12 months and expected over the next 12 months">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke={cc.grid} />
              <XAxis dataKey="label" tick={{ fill: cc.axis, fontSize: 10 }} tickLine={false} axisLine={{ stroke: cc.grid }} interval={2} />
              <YAxis tick={{ fill: cc.axis, fontSize: 10 }} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => (hidden ? "" : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))} />
              <Tooltip
                cursor={{ fill: cc.axis, fillOpacity: 0.12 }}
                contentStyle={{ background: cc.tipBg, border: `1px solid ${cc.tipBorder}`, borderRadius: 12, fontSize: 12, color: cc.tipText, boxShadow: "0 6px 20px rgba(0,0,0,0.12)" }}
                labelStyle={{ color: cc.tipText }}
                labelFormatter={(_, p) => (p?.[0]?.payload?.month as string) ?? ""}
                formatter={(v, name) => [money(Number(v), d.base_currency, { hidden }), name === "received" ? "Received" : "Expected"]}
              />
              <Bar dataKey="received" stackId="m" fill={cc.received} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
              <Bar dataKey="expected" stackId="m" fill={cc.expected} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
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
