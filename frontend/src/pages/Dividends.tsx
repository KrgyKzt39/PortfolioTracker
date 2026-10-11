import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartColors, useTheme } from "../lib/theme";
import { Check, ChevronRight, Plus } from "lucide-react";
import { cn, money, monthLabel, pct, shortDate } from "../lib/format";
import { useDividendSummary, useOpenSheet, usePrivacy } from "../lib/hooks";
import type { DividendSummary } from "../lib/types";
import { Button, Card, Empty, ErrorBox, IconButton, PageHeader, SectionTitle, Spinner } from "../components/ui";
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
    <div className="space-y-5">
      <div className="space-y-2">
        <PageHeader title="Dividends">
          <IconButton label="Record a dividend" onClick={() => open({ kind: "payment" })}>
            <Plus className="h-[24px] w-[24px]" strokeWidth={2} />
          </IconButton>
        </PageHeader>
        <section aria-label="Dividend summary" className="px-1">
          <h2 className="text-[15px] text-muted">Expected per year</h2>
          <p className="tabular text-[40px] font-semibold leading-[1.15] tracking-[-0.03em] text-fg">{m(d.forward_annual_estimate)}</p>
          <p className="tabular text-[15px] text-muted">
            about {m(d.monthly_average_projected)} a month · {pct(d.portfolio_yield)} yield
          </p>
          <p className="tabular mt-1 text-[15px] text-muted">
            <span className="font-semibold text-up">{m(d.t12m_net)}</span> received in the last 12 months
          </p>
        </section>
      </div>

      {d.to_confirm.length > 0 && (
        <section>
          <SectionTitle>Did these arrive?</SectionTitle>
          <Card>
            <ul>
              {d.to_confirm.map((e, i) => (
                <li key={e.id} className="flex items-center gap-3 pl-4">
                  <TickerBadge symbol={e.symbol} />
                  <span className={cn("flex min-w-0 flex-1 items-center gap-3 py-[11px] pr-4", i < d.to_confirm.length - 1 && "hairline")}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[17px] font-semibold leading-snug text-fg">{e.symbol}</span>
                      <span className="block text-[13px] text-muted">
                        Paid {shortDate(e.pay_date)} · about {money(e.expected_net, e.currency, { hidden })}
                      </span>
                    </span>
                    <Button className="rounded-full px-3.5 py-1.5 text-[15px]" onClick={() => open({ kind: "payment", event: e })}>
                      <Check className="h-4 w-4" strokeWidth={2.5} /> Received
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <MonthlyChart d={d} hidden={hidden} />

      <section>
        <SectionTitle>By holding</SectionTitle>
        <Card>
          {d.holdings.length === 0 && <Empty title="No dividend estimates yet">Set a yearly dividend per share in a stock's settings, or add its dividends on the Calendar tab.</Empty>}
          <ul>
            {d.holdings.map((h, i) => (
              <li key={h.symbol} className="flex items-center gap-3 pl-4">
                <TickerBadge symbol={h.symbol} />
                <span className={cn("flex min-w-0 flex-1 items-center gap-3 py-[11px] pr-4", i < d.holdings.length - 1 && "hairline")}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] font-semibold leading-snug text-fg">{h.symbol}</span>
                    <span className="block truncate text-[13px] text-muted">{h.category}</span>
                  </span>
                  <span className="tabular text-right">
                    <span className="block text-[17px] leading-snug text-fg">{m(h.est_annual_net_base)}</span>
                    <span className="block text-[13px] text-muted">{pct(h.dividend_yield)} yield</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {d.recent_payments.length > 0 && (
        <section>
          <SectionTitle>Recently received</SectionTitle>
          <Card>
            <ul>
              {d.recent_payments.slice(0, 10).map((p, i, arr) => (
                <li key={p.id}>
                  <button className="flex w-full items-center pl-4 text-left active:bg-fill/[0.08]" onClick={() => open({ kind: "payment", payment: p })}>
                    <span className={cn("flex min-w-0 flex-1 items-center gap-3 py-3 pr-4", i < arr.length - 1 && "hairline")}>
                      <span className="min-w-0 flex-1 text-[17px] text-fg">
                        {p.symbol}
                        <span className="ml-2 text-[15px] text-muted">{shortDate(p.pay_date)}</span>
                      </span>
                      <span className="tabular text-[17px] text-up">{money(p.net, p.currency, { hidden })}</span>
                      <ChevronRight className="h-4 w-4 text-faint" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <p className="px-1 pb-4 text-[13px] leading-relaxed text-muted">Expected amounts are estimates after withholding tax, based on what you hold today. They are not guaranteed.</p>
    </div>
  );
}

function MonthlyChart({ d, hidden }: { d: DividendSummary; hidden: boolean }) {
  // Received = confirmed income (green), expected = estimate (amber).
  const cc = chartColors(useTheme().dark);
  const data = d.chart.map((c) => ({ month: c.month, label: monthLabel(c.month), received: Number(c.received), expected: Number(c.expected) }));
  const has = data.some((x) => x.received || x.expected);
  return (
    <section>
      <SectionTitle>Month by month</SectionTitle>
    <Card>
      <div className="flex gap-4 px-4 pb-2 pt-3.5 text-[13px] text-muted">
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
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {label}
    </span>
  );
}
