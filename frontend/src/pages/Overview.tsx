import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import { cn, money, pct, shortDate, tone } from "../lib/format";
import { useMeta, usePortfolio, usePrivacy, useSettings } from "../lib/hooks";
import { MessageCircle } from "lucide-react";
import { AskSheet } from "../components/AskSheet";
import type { Portfolio } from "../lib/types";
import { Card, Empty, ErrorBox, Segmented, Spinner } from "../components/ui";

type Range = "1M" | "3M" | "6M" | "1Y" | "All";
const DAYS: Record<Range, number> = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, All: 100000 };
type By = "category" | "currency" | "broker";
const LINE = "#3b82f6";

export function Overview() {
  const settings = useSettings();
  const base = settings.data?.base_currency;
  const pf = usePortfolio(base);
  const meta = useMeta();
  const [asking, setAsking] = useState(false);
  const history = useQuery({
    queryKey: ["snapshots", base],
    queryFn: () => api<{ date: string; value: string; pl: string }[]>(`/snapshots${base ? `?base=${base}` : ""}`),
    enabled: !!base,
  });
  if (pf.isLoading || settings.isLoading) return <Spinner label="Loading" />;
  if (pf.error) return <ErrorBox error={pf.error} onRetry={() => pf.refetch()} />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <h1 className="text-2xl font-extrabold text-white">Dashboard</h1>
        {!!meta.data?.ai_providers?.length && (
          <button type="button" onClick={() => setAsking(true)} className="flex items-center gap-1.5 rounded-full bg-ink-800 px-3 py-1.5 text-sm font-semibold text-slate-100 hover:bg-ink-700">
            <MessageCircle className="h-4 w-4" /> Ask
          </button>
        )}
      </div>
      {asking && <AskSheet onClose={() => setAsking(false)} />}
      <ValueChart data={pf.data!} history={history.data ?? []} loading={history.isLoading} />
      <Breakdown data={pf.data!} />
    </div>
  );
}

function ValueChart({ data, history, loading }: { data: Portfolio; history: { date: string; value: string; pl: string }[]; loading: boolean }) {
  const { hidden } = usePrivacy();
  const [range, setRange] = useState<Range>("6M");
  const base = data.base_currency;
  const points = useMemo(() => {
    const cutoff = Date.now() - DAYS[range] * 86400e3;
    return history.filter((h) => new Date(`${h.date}T00:00:00`).getTime() >= cutoff).map((h) => ({ date: h.date, value: Number(h.value) }));
  }, [history, range]);
  const first = points[0]?.value;
  const last = points[points.length - 1]?.value;
  const change = first !== undefined && last !== undefined ? last - first : null;
  const changePct = change !== null && first ? (change / first) * 100 : null;

  return (
    <Card>
      <div className="px-5 pb-2 pt-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">Value over time</h2>
        <p className="tabular mt-1 text-[24px] font-extrabold text-white">{money(data.totals.value, base, { hidden })}</p>
        {change !== null && points.length > 1 && (
          <p className={cn("tabular text-sm font-semibold", tone(change))}>
            {money(change, base, { signed: true, hidden })} ({pct(changePct, { signed: true })}) since {shortDate(points[0].date)}
          </p>
        )}
      </div>
      <div className="px-4 pb-2">
        <Segmented label="Period" value={range} onChange={setRange} options={(["1M", "3M", "6M", "1Y", "All"] as Range[]).map((r) => ({ value: r, label: r }))} />
      </div>
      {loading ? (
        <Spinner />
      ) : points.length < 2 ? (
        <Empty title="History builds up from today">The app saves your total once a day when you open it. Come back in a few days to see the line.</Empty>
      ) : (
        <div className="h-52 px-1 pb-3" role="img" aria-label={`Portfolio value from ${points[0].date} to ${points[points.length - 1].date}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={LINE} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={LINE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#ffffff" strokeOpacity={0.06} />
              <XAxis
                dataKey="date"
                tick={{ fill: "#8a97ad", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "#ffffff22" }}
                minTickGap={40}
                tickFormatter={(d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fill: "#8a97ad", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v: number) => (hidden ? "" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))}
              />
              <Tooltip
                cursor={{ stroke: "#ffffff", strokeOpacity: 0.25 }}
                contentStyle={{ background: "#0e1626", border: "1px solid #ffffff1a", borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: "#e6ebf5" }}
                labelFormatter={(d) => shortDate(String(d))}
                formatter={(v) => [money(Number(v), base, { hidden }), "Value"]}
              />
              <Area type="monotone" dataKey="value" stroke={LINE} strokeWidth={2} fill="url(#valueFill)" isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#0e1626" }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function Breakdown({ data }: { data: Portfolio }) {
  const { hidden } = usePrivacy();
  const [by, setBy] = useState<By>("category");
  const base = data.base_currency;
  const rows = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of data.categories) {
      for (const h of c.holdings) {
        if (h.market_value_base === null) continue;
        if (by === "category") totals.set(c.name, (totals.get(c.name) ?? 0) + Number(h.market_value_base));
        else if (by === "currency") totals.set(h.currency, (totals.get(h.currency) ?? 0) + Number(h.market_value_base));
        else {
          // Split a stock's value across brokers by quantity.
          const q = Number(h.quantity);
          for (const l of h.lots) totals.set(l.broker, (totals.get(l.broker) ?? 0) + (q ? (Number(h.market_value_base) * Number(l.quantity)) / q : 0));
        }
      }
    }
    const sum = [...totals.values()].reduce((a, b) => a + b, 0);
    return [...totals.entries()].map(([label, value]) => ({ label, value, share: sum ? (value / sum) * 100 : 0 })).sort((a, b) => b.value - a.value);
  }, [data, by]);
  const max = rows[0]?.value ?? 0;

  return (
    <Card>
      <div className="px-5 pb-2 pt-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">Where your money is</h2>
      </div>
      <div className="px-4 pb-3">
        <Segmented
          label="Group by"
          value={by}
          onChange={setBy}
          options={[
            { value: "category", label: "Category" },
            { value: "currency", label: "Currency" },
            { value: "broker", label: "Broker" },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <Empty title="Nothing priced yet">Add holdings and prices to see the split.</Empty>
      ) : (
        <ul className="space-y-3 px-5 pb-5">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-semibold text-white">{r.label}</span>
                <span className="tabular shrink-0 text-muted">
                  <span className="font-semibold text-slate-100">{pct(r.share, { dp: 1 })}</span> · {money(r.value, base, { hidden })}
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-white/[0.06]" aria-hidden>
                <div className="h-2 rounded-full bg-accent" style={{ width: `${max ? Math.max(2, (r.value / max) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {data.totals.incomplete && <p className="px-5 pb-4 text-2xs text-faint">Holdings without a price are left out.</p>}
    </Card>
  );
}
