import { useState } from "react";
import { AlertTriangle, ArrowUpDown, ChevronDown, ChevronRight, Pencil, Plus, Upload } from "lucide-react";
import { cn, money, pct, priceStr, qty, shortDate, tone } from "../lib/format";
import { useOpenSheet, usePortfolio, usePrivacy, useSettings } from "../lib/hooks";
import type { CategoryCard, Holding, PriceStatus } from "../lib/types";
import { Button, Card, Empty, ErrorBox, IconButton, PageHeader, Spinner } from "../components/ui";
import { TickerBadge } from "../components/TickerBadge";
import { Arrange } from "../components/Arrange";
import { RefreshAndSettings } from "../components/Summary";

const PRICE_WORD: Record<PriceStatus, string> = {
  Live: "Live",
  Delayed: "Delayed",
  Cached: "Last known",
  Manual: "Entered by you",
  Unavailable: "No price yet",
  Partial: "Partial",
};

/** The Portfolio tab: holdings grouped by the user's categories. */
export function Dashboard() {
  const settings = useSettings();
  const base = settings.data?.base_currency;
  const pf = usePortfolio(base);
  const open = useOpenSheet();
  const { hidden } = usePrivacy();
  const [arranging, setArranging] = useState(false);

  if (pf.isLoading || settings.isLoading) return <Spinner label="Loading portfolio" />;
  if (pf.error) return <ErrorBox error={pf.error} onRetry={() => pf.refetch()} />;
  const data = pf.data!;
  const empty = data.categories.every((c) => c.holdings.length === 0);
  const t = data.totals;

  return (
    <div className="space-y-5">
      <div>
        <PageHeader title="Portfolio">
          <IconButton label="Add" onClick={() => open({ kind: "holding" })}>
            <Plus className="h-[24px] w-[24px]" strokeWidth={2} />
          </IconButton>
          <IconButton label="Upload" onClick={() => open({ kind: "import" })}>
            <Upload className="h-[21px] w-[21px]" strokeWidth={2} />
          </IconButton>
          {!empty && (
            <IconButton label="Arrange" onClick={() => setArranging(!arranging)} className={arranging ? "bg-accent-soft" : undefined}>
              <ArrowUpDown className="h-[21px] w-[21px]" strokeWidth={2} />
            </IconButton>
          )}
          <RefreshAndSettings data={data} />
        </PageHeader>
        {!empty && (
          <p className="tabular px-1 pt-0.5 text-[15px] text-muted">
            <span className="font-semibold text-fg" data-testid="total-value">{money(t.value, data.base_currency, { hidden })}</span>{" "}
            <span className={tone(t.pl)}>
              {money(t.pl, data.base_currency, { signed: true, hidden })} ({pct(t.pl_pct, { signed: true })})
            </span>
          </p>
        )}
      </div>
      {data.warnings.length > 0 && <Warnings items={data.warnings} />}
      {empty ? (
        <Card>
          <Empty title="Add your holdings">
            <p>Enter each stock with the quantity and average price shown in your broker app, or upload your broker's Excel export.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button onClick={() => open({ kind: "holding" })}>
                <Plus className="h-4 w-4" /> Add holding
              </Button>
              <Button variant="secondary" onClick={() => open({ kind: "import" })}>
                <Upload className="h-4 w-4" /> Upload file
              </Button>
            </div>
          </Empty>
        </Card>
      ) : arranging ? (
        <Arrange data={data} onDone={() => setArranging(false)} />
      ) : (
        data.categories.map((c) => <CategorySection key={c.id ?? "none"} card={c} base={data.base_currency} />)
      )}
    </div>
  );
}

function Warnings({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[14px] bg-gold-soft px-4 py-3 text-[15px] text-gold">
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1">
          {items.length} data warning{items.length > 1 ? "s" : ""}
        </span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="mt-2 list-disc space-y-0.5 pl-6 text-[13px]">
          {items.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategorySection({ card: c, base }: { card: CategoryCard; base: string }) {
  const { hidden } = usePrivacy();
  const open = useOpenSheet();
  const [expanded, setExpanded] = useState<number | null>(null);
  if (c.holdings.length === 0 && c.id === null) return null;

  return (
    <section aria-label={c.name}>
      <div className="flex items-end justify-between gap-3 px-1 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <h2 className="truncate text-[20px] font-semibold tracking-[-0.02em] text-fg">{c.name}</h2>
            {c.id !== null && (
              <IconButton
                label={`Edit ${c.name}`}
                className="h-7 w-7 text-muted"
                onClick={() => open({ kind: "category", category: { id: c.id!, name: c.name, show_dividends: c.show_dividends, sort_order: c.sort_order } })}
              >
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
            )}
          </div>
          <p className={cn("tabular text-[13px]", tone(c.pl))}>
            {money(c.pl, base, { signed: true, hidden })} ({pct(c.pl_pct, { signed: true })})
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular text-[17px] font-semibold text-fg">{money(c.value, base, { hidden })}</p>
          {c.show_dividends && (
            <p className="tabular text-[13px] text-gold" title="Expected yearly dividend after tax">
              {money(c.est_annual_dividend, base, { hidden, compact: true })}/yr · {pct(c.dividend_yield)}
            </p>
          )}
        </div>
      </div>
      <Card>
        {c.holdings.length === 0 && <Empty title="No stocks here yet">Use Arrange to move stocks into this category.</Empty>}
        <ul>
          {c.holdings.map((h, i) => (
            <HoldingRow
              key={h.instrument_id}
              h={h}
              last={i === c.holdings.length - 1}
              hidden={hidden}
              base={base}
              expanded={expanded === h.instrument_id}
              onToggle={() => setExpanded(expanded === h.instrument_id ? null : h.instrument_id)}
            />
          ))}
        </ul>
      </Card>
      {c.incomplete && <p className="px-1 pt-1.5 text-[13px] text-muted">Stocks without a price are left out of this total.</p>}
    </section>
  );
}

/** Stocks-app style row: symbol and position on the left, value and return pill on the right. */
function HoldingRow({ h, last, hidden, base, expanded, onToggle }: { h: Holding; last: boolean; hidden: boolean; base: string; expanded: boolean; onToggle: () => void }) {
  const ccy = h.currency;
  const isBalance = h.kind === "fund" && Number(h.price) === 1;
  const position = isBalance ? (h.name ?? "Balance") : `${qty(h.quantity)} ${h.kind === "fund" ? "units" : "shares"}`;
  const n = h.pl_pct === null ? null : Number(h.pl_pct);
  const pill = n === null ? "bg-fill/[0.16] text-muted" : n > 0 ? "bg-up-strong text-white" : n < 0 ? "bg-down-strong text-white" : "bg-fill/[0.3] text-white";
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={expanded} aria-label={`${h.symbol} details`} className="flex w-full items-center gap-3 pl-4 text-left active:bg-fill/[0.08]">
        <TickerBadge symbol={h.symbol} />
        <span className={cn("flex min-w-0 flex-1 items-center gap-3 py-[11px] pr-4", !(last && !expanded) && "hairline")}>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] font-semibold leading-snug text-fg">{h.symbol}</span>
            <span className="tabular block truncate text-[13px] text-muted">
              {position}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className="tabular text-[17px] leading-snug text-fg">
              {money(h.market_value, ccy, { hidden })}
              {(h.price_status === "Cached" || h.price_status === "Unavailable") && <span className="ml-0.5 align-super text-[10px] text-gold" title={PRICE_WORD[h.price_status]}>•</span>}
            </span>
            <span className={cn("tabular min-w-[68px] rounded-[6px] px-1.5 py-[1px] text-right text-[13px] font-semibold", pill)}>{pct(h.pl_pct, { signed: true })}</span>
          </span>
        </span>
      </button>
      {expanded && <HoldingDetail h={h} base={base} hidden={hidden} last={last} />}
    </li>
  );
}

function HoldingDetail({ h, base, hidden, last }: { h: Holding; base: string; hidden: boolean; last: boolean }) {
  const open = useOpenSheet();
  const c = h.currency;
  const m = (v: string | null, signed = false, ccy = c) => money(v, ccy, { signed, hidden });
  const rows: [string, string, string?][] = [
    ["Price", `${priceStr(h.price, c)} · avg ${priceStr(h.avg_cost, c)}`],
    ["Value", m(h.market_value)],
    ["Cost", m(h.cost)],
    ["Gain / loss", m(h.gain, true), tone(h.gain)],
  ];
  if (Number(h.dividends_net) !== 0) rows.push(["Dividends received", m(h.dividends_net, true), "text-up"]);
  rows.push(["Total return", `${m(h.total_pl, true)} (${pct(h.pl_pct, { signed: true })})`, tone(h.total_pl)]);
  if (h.est_annual_dividend_net) rows.push(["Expected yearly dividend", `${m(h.est_annual_dividend_net)} · ${pct(h.dividend_yield)}`, "text-gold"]);
  if (c !== base) rows.push([`Value in ${base}`, m(h.market_value_base, false, base)]);
  rows.push(["Price source", `${PRICE_WORD[h.price_status]}${h.price_source && h.price_source !== "manual" ? ` · ${h.price_source}` : ""}${h.price_date ? ` · ${shortDate(h.price_date)}` : ""}`]);
  return (
    <div className={cn("bg-ink-50 px-4 pb-4 pt-2 dark:bg-white/[0.03]", !last && "hairline")}>
      {h.name && <p className="pb-2 text-[13px] text-muted">{h.name}</p>}
      <dl className="grid grid-cols-1 gap-y-[7px] text-[15px]">
        {rows.map(([k, v, cls]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className={cn("tabular text-right text-fg", cls)}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 px-1 text-[13px] text-muted">Held at</p>
      <ul className="mt-1 overflow-hidden rounded-[10px] bg-surface">
        {h.lots.map((l, i) => (
          <li key={l.holding_id}>
            <button
              className={cn("flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-[15px] active:bg-fill/[0.08]", i < h.lots.length - 1 && "hairline")}
              onClick={() => open({ kind: "holding", holdingId: l.holding_id })}
              aria-label={`Edit ${h.symbol} at ${l.broker}`}
            >
              <span className="text-fg">{l.broker}</span>
              <span className="tabular flex items-center gap-1 text-muted">
                {qty(l.quantity)} @ {priceStr(l.avg_cost, c)}
                <ChevronRight className="h-4 w-4 text-faint" />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" className="rounded-full px-3.5 py-1.5 text-[13px]" onClick={() => open({ kind: "holding", preset: { symbol: h.symbol } })}>
          <Plus className="h-3.5 w-3.5" /> Another broker
        </Button>
        <Button variant="secondary" className="rounded-full px-3.5 py-1.5 text-[13px]" onClick={() => open({ kind: "stock", instrumentId: h.instrument_id })}>
          Stock settings
        </Button>
        <Button variant="secondary" className="rounded-full px-3.5 py-1.5 text-[13px]" onClick={() => open({ kind: "price", instrumentId: h.instrument_id })}>
          Enter price
        </Button>
      </div>
    </div>
  );
}
