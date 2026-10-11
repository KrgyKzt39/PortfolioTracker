import { useState } from "react";
import { BadgeDollarSign, Banknote, FileBarChart, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { cn, money, priceStr } from "../lib/format";
import { useCalendar, useDividendEvents, useInvalidateAll, useMeta, useOpenSheet, usePrivacy } from "../lib/hooks";
import type { CalendarItem } from "../lib/types";
import { Button, Card, Empty, ErrorBox, IconButton, Segmented, Spinner, useToast } from "../components/ui";
import { TickerBadge } from "../components/TickerBadge";

type Filter = "all" | "dividends" | "earnings";

const KIND = {
  ex_date: { label: "Ex-dividend", icon: BadgeDollarSign, cls: "bg-gold/15 text-gold" },
  pay_date: { label: "Dividend paid", icon: Banknote, cls: "bg-up/15 text-up" },
  earnings: { label: "Earnings", icon: FileBarChart, cls: "bg-accent/15 text-accent" },
} as const;

export function Calendar() {
  const cal = useCalendar();
  const meta = useMeta();
  const open = useOpenSheet();
  const [filter, setFilter] = useState<Filter>("all");
  if (cal.isLoading) return <Spinner label="Loading calendar" />;
  if (cal.error) return <ErrorBox error={cal.error} onRetry={() => cal.refetch()} />;
  const items = cal.data!.filter((i) => filter === "all" || (filter === "earnings" ? i.kind === "earnings" : i.kind !== "earnings"));

  const months: { key: string; days: { date: string; items: CalendarItem[] }[] }[] = [];
  for (const it of items) {
    const key = it.date.slice(0, 7);
    let mo = months[months.length - 1];
    if (!mo || mo.key !== key) months.push((mo = { key, days: [] }));
    const day = mo.days[mo.days.length - 1];
    if (day && day.date === it.date) day.items.push(it);
    else mo.days.push({ date: it.date, items: [it] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <h1 className="text-[28px] font-bold tracking-tight text-fg">Calendar</h1>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="secondary" className="rounded-full px-3 py-1.5 text-[13px]" onClick={() => open({ kind: "earnings" })}>
            <Plus className="h-3.5 w-3.5" /> Earnings
          </Button>
          <Button variant="secondary" className="rounded-full px-3 py-1.5 text-[13px]" onClick={() => open({ kind: "dividend" })}>
            <Plus className="h-3.5 w-3.5" /> Dividend
          </Button>
        </div>
      </div>
      <Segmented
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All" },
          { value: "dividends", label: "Dividends" },
          { value: "earnings", label: "Earnings" },
        ]}
      />
      {months.length === 0 ? (
        <Card>
          <Empty title="Nothing in the next 4 months">
            {meta.data?.longbridge_configured
              ? "Dates for US, HK and SG stocks fill in from Longbridge when you press Refresh. Add Bursa dates yourself."
              : meta.data?.alphavantage_configured
                ? "US earnings dates fill in from Alpha Vantage when you press Refresh. Add other dates yourself."
                : "Add dividend and earnings dates yourself, or add a free Alpha Vantage key (US earnings) or Longbridge keys (US, HK, SG) in .env."}
          </Empty>
        </Card>
      ) : (
        months.map((mo) => (
          <Card key={mo.key}>
            <p className="border-b border-line bg-ink-50 px-4 py-2 text-[13px] font-semibold text-fg2">
              {new Date(`${mo.key}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
            </p>
            <ul>
              {mo.days.map((day) => (
                <li key={day.date} className="flex gap-3 border-b border-line px-4 py-3 last:border-b-0">
                  <DateBlock iso={day.date} />
                  <ul className="min-w-0 flex-1 space-y-2">
                    {day.items.map((it, i) => (
                      <Entry key={`${it.kind}-${it.symbol}-${i}`} it={it} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
      <p className="px-2 pb-4 text-2xs leading-relaxed text-faint">Shows stocks you hold, for the next 4 months. Dividend amounts are estimates for your current quantity after tax.</p>
    </div>
  );
}

function DateBlock({ iso }: { iso: string }) {
  const d = new Date(`${iso}T00:00:00`);
  return (
    <div className="w-11 shrink-0 text-center">
      <p className="text-[10px] font-semibold uppercase text-faint">{d.toLocaleDateString("en-GB", { weekday: "short" })}</p>
      <p className="tabular text-[20px] font-semibold leading-tight text-fg">{d.getDate()}</p>
    </div>
  );
}

function Entry({ it }: { it: CalendarItem }) {
  const { hidden } = usePrivacy();
  const open = useOpenSheet();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const events = useDividendEvents();
  const k = KIND[it.kind];
  const Icon = k.icon;
  let detail = "";
  if (it.kind === "earnings") detail = it.session === "before" ? "Before market opens" : it.session === "after" ? "After market closes" : "Time not announced";
  else detail = `${priceStr(it.amount_per_share ?? null, it.currency ?? "")}/share · you get about ${money(it.expected_net ?? null, it.currency ?? "", { hidden })}`;

  const edit = () => {
    if (it.kind === "earnings") return;
    const ev = events.data?.find((e) => e.id === it.event_id);
    if (ev) open({ kind: "dividend", event: ev });
  };
  const removeEarnings = async () => {
    try {
      await api(`/earnings/${it.earnings_id}`, { method: "DELETE" });
      invalidate();
      toast(`${it.symbol} earnings date removed`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <li className="flex items-center gap-3">
      <TickerBadge symbol={it.symbol} className="h-[28px] w-[44px]" />
      <button className="min-w-0 flex-1 text-left" onClick={edit} disabled={it.kind === "earnings"}>
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-bold text-fg">{it.symbol}</span>
          <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold", k.cls)}>
            <Icon className="h-3 w-3" aria-hidden /> {k.label}
          </span>
        </span>
        <span className="block truncate text-2xs text-muted">{detail}</span>
      </button>
      {it.kind === "earnings" && it.source === "manual" && (
        <IconButton label={`Remove ${it.symbol} earnings date`} className="h-8 w-8 text-faint" onClick={removeEarnings}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      )}
    </li>
  );
}
