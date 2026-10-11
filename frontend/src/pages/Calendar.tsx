import { useState } from "react";
import { BadgeDollarSign, Banknote, FileBarChart, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { cn, money, priceStr } from "../lib/format";
import { useCalendar, useDividendEvents, useInvalidateAll, useMeta, useOpenSheet, usePrivacy } from "../lib/hooks";
import type { CalendarItem } from "../lib/types";
import { Card, Empty, ErrorBox, IconButton, PageHeader, SectionTitle, Segmented, Spinner, useToast } from "../components/ui";
import { TickerBadge } from "../components/TickerBadge";

type Filter = "all" | "dividends" | "earnings";

const KIND = {
  ex_date: { label: "Ex-dividend", icon: BadgeDollarSign, cls: "bg-gold-soft text-gold" },
  pay_date: { label: "Dividend paid", icon: Banknote, cls: "bg-up-soft text-up" },
  earnings: { label: "Earnings", icon: FileBarChart, cls: "bg-accent-soft text-accent" },
} as const;

export function Calendar() {
  const cal = useCalendar();
  const meta = useMeta();
  const open = useOpenSheet();
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
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
      <PageHeader title="Calendar">
        <div className="relative">
          <IconButton label="Add a date" aria-expanded={adding} onClick={() => setAdding(!adding)}>
            <Plus className="h-[24px] w-[24px]" strokeWidth={2} />
          </IconButton>
          {adding && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setAdding(false)} aria-hidden />
              <div role="menu" className="absolute right-0 top-10 z-40 w-56 overflow-hidden rounded-[14px] bg-surface/95 shadow-[0_10px_40px_rgba(0,0,0,0.18)] backdrop-blur-xl dark:bg-[#2C2C2E]/95">
                {(
                  [
                    ["earnings", "Earnings date", FileBarChart],
                    ["dividend", "Dividend date", BadgeDollarSign],
                  ] as const
                ).map(([kind, label, Icon], i) => (
                  <button
                    key={kind}
                    role="menuitem"
                    className={cn("flex w-full items-center justify-between px-4 py-3 text-left text-[17px] text-fg active:bg-fill/[0.12]", i === 0 && "hairline")}
                    onClick={() => {
                      setAdding(false);
                      open({ kind });
                    }}
                  >
                    {label}
                    <Icon className="h-5 w-5 text-fg2" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </PageHeader>
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
          <section key={mo.key}>
            <SectionTitle>{new Date(`${mo.key}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</SectionTitle>
          <Card>
            <ul>
              {mo.days.map((day, di) => (
                <li key={day.date} className="flex gap-3 pl-4">
                  <DateBlock iso={day.date} />
                  <ul className={cn("min-w-0 flex-1 space-y-2.5 py-3 pr-3", di < mo.days.length - 1 && "hairline")}>
                    {day.items.map((it, i) => (
                      <Entry key={`${it.kind}-${it.symbol}-${i}`} it={it} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Card>
          </section>
        ))
      )}
      <p className="px-1 pb-4 text-[13px] leading-relaxed text-muted">Shows stocks you hold, for the next 4 months. Dividend amounts are estimates for your current quantity after tax.</p>
    </div>
  );
}

function DateBlock({ iso }: { iso: string }) {
  const d = new Date(`${iso}T00:00:00`);
  return (
    <div className="w-10 shrink-0 pt-3 text-center">
      <p className="text-[11px] font-semibold uppercase text-down">{d.toLocaleDateString("en-GB", { weekday: "short" })}</p>
      <p className="tabular text-[22px] font-normal leading-tight text-fg">{d.getDate()}</p>
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
  else detail = `${priceStr(it.amount_per_share ?? null, it.currency ?? "")}/share · ≈ ${money(it.expected_net ?? null, it.currency ?? "", { hidden })} for you`;

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
      <TickerBadge symbol={it.symbol} />
      <button className="min-w-0 flex-1 text-left" onClick={edit} disabled={it.kind === "earnings"}>
        <span className="flex items-center gap-2">
          <span className="text-[17px] font-semibold text-fg">{it.symbol}</span>
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-semibold", k.cls)}>
            <Icon className="h-3 w-3" aria-hidden /> {k.label}
          </span>
        </span>
        <span className="block truncate text-[13px] text-muted">{detail}</span>
      </button>
      {it.kind === "earnings" && it.source === "manual" && (
        <IconButton label={`Remove ${it.symbol} earnings date`} className="h-8 w-8 text-faint" onClick={removeEarnings}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      )}
    </li>
  );
}
