import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Eye, EyeOff, GripVertical, Pencil, Plus, RefreshCw, Settings as Gear, Upload } from "lucide-react";
import { api } from "../lib/api";
import { cn, money, pct, priceStr, qty, shortDate, tone } from "../lib/format";
import { useOpenSheet, usePortfolio, usePrivacy, useRefreshStatus, useSaveSettings, useSettings } from "../lib/hooks";
import type { CategoryCard, Holding, Portfolio, PriceStatus, RefreshState } from "../lib/types";
import { Badge, Button, Card, Empty, ErrorBox, IconButton, Spinner, useToast } from "../components/ui";
import { TickerBadge } from "../components/TickerBadge";
import { Arrange } from "../components/Arrange";

const STATUS_STYLE: Record<PriceStatus, string> = {
  Live: "bg-black/40 text-white",
  Delayed: "bg-black/40 text-amber-200",
  Cached: "bg-black/40 text-slate-300",
  Manual: "bg-black/40 text-sky-200",
  Unavailable: "bg-black/40 text-red-300",
  Partial: "bg-black/40 text-amber-200",
};
const PRICE_WORD: Record<PriceStatus, string> = {
  Live: "Live",
  Delayed: "Delayed",
  Cached: "Last known",
  Manual: "Entered by you",
  Unavailable: "No price yet",
  Partial: "Partial",
};
const STATUS_HELP: Record<PriceStatus, string> = {
  Live: "Real-time quotes from the provider",
  Delayed: "Provider quotes, typically 15+ minutes delayed",
  Cached: "Last known good prices; latest refresh is older than the freshness window or failed",
  Manual: "Prices entered by you",
  Unavailable: "No prices yet. Add a manual price or enable a provider in Settings",
  Partial: "Some holdings have no price and are excluded from totals",
};

export function Dashboard() {
  const settings = useSettings();
  const base = settings.data?.base_currency;
  const pf = usePortfolio(base);
  const open = useOpenSheet();
  const [arranging, setArranging] = useState(false);

  if (pf.isLoading || settings.isLoading) return <Spinner label="Loading portfolio" />;
  if (pf.error) return <ErrorBox error={pf.error} onRetry={() => pf.refetch()} />;
  const data = pf.data!;
  const empty = data.categories.every((c) => c.holdings.length === 0);

  return (
    <div className="space-y-4">
      <Hero data={data} />
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
        <>
          <div className="flex gap-2 px-1">
            <Button variant="secondary" className="flex-1" onClick={() => open({ kind: "holding" })}>
              <Plus className="h-4 w-4" /> Add
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => open({ kind: "import" })}>
              <Upload className="h-4 w-4" /> Upload
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => setArranging(true)}>
              <GripVertical className="h-4 w-4" /> Arrange
            </Button>
          </div>
          {data.categories.map((c) => (
            <CategoryCardView key={c.id ?? "none"} card={c} base={data.base_currency} />
          ))}
        </>
      )}
    </div>
  );
}

function Hero({ data }: { data: Portfolio }) {
  const { hidden, toggle } = usePrivacy();
  const open = useOpenSheet();
  const save = useSaveSettings();
  const toast = useToast();
  const qc = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const status = useRefreshStatus(waiting);
  const t = data.totals;
  const base = data.base_currency;

  useEffect(() => {
    const s: RefreshState | undefined = status.data;
    if (waiting && s && !s.running && s.finished_at) {
      setWaiting(false);
      qc.invalidateQueries();
      const errs = Object.keys(s.errors).length;
      toast(s.message + (errs ? ` · ${Object.entries(s.errors).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join("; ")}` : ""), errs ? "error" : "success");
    }
  }, [status.data, waiting, qc, toast]);

  const refresh = async () => {
    try {
      await api<RefreshState>("/refresh", { method: "POST" });
      setWaiting(true);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const refreshing = waiting || data.refresh.running;
  const fx = data.fx.filter((f) => f.rate !== null || ["USD", "SGD", "GBP", "HKD", "MYR"].includes(f.from));

  return (
    <section
      aria-label="Portfolio summary"
      className="relative overflow-hidden rounded-[24px] border border-hero-edge/60 bg-gradient-to-br from-hero-from via-[#17305e] to-hero-to px-5 pb-4 pt-5 shadow-xl shadow-black/30"
    >
      <div className="flex items-center justify-between gap-2">
        <h1 className="whitespace-nowrap text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9db3dc]">Total portfolio value</h1>
        <div className="flex items-center gap-1.5">
          {data.demo && <Badge className="bg-gold/20 text-gold">DEMO</Badge>}
          <span title={STATUS_HELP[data.price_status]} className={cn("rounded-xl px-3 py-1.5 text-[13px] font-bold", STATUS_STYLE[data.price_status])} data-testid="price-status">
            {refreshing ? "Updating…" : data.price_status}
          </span>
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <p className="tabular text-[36px] font-extrabold leading-tight tracking-tight text-white" data-testid="total-value">
          {money(t.value, base, { hidden })}
        </p>
        <IconButton label={hidden ? "Show values" : "Hide values"} onClick={toggle} className="text-[#9db3dc]">
          {hidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </IconButton>
      </div>

      <p className={cn("tabular mt-0.5 flex gap-3 whitespace-nowrap text-[17px] font-bold", tone(t.pl))}>
        <span>{money(t.pl, base, { signed: true, hidden })}</span>
        <span>{pct(t.pl_pct, { signed: true })}</span>
      </p>
      <p className="tabular mt-2 text-[11.5px] leading-snug text-[#a9b8d6]">
        {chunk(fx, 2).map((row, i) => (
          <span key={i} className="block">
            {row.map((f) => `${f.from}→${f.to}: ${f.rate === null ? "N/A" : fxStr(f.rate)}`).join(" · ")}
          </span>
        ))}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[12px] text-[#a9b8d6]">
          {shortStamp(data.prices_as_of ?? data.generated_at)}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <label className="sr-only" htmlFor="base-ccy">
            Base currency
          </label>
          <select
            id="base-ccy"
            value={base}
            onChange={(e) => save.mutate({ base_currency: e.target.value as Portfolio["base_currency"] })}
            className="h-8 w-[78px] rounded-full border border-white/10 bg-white/5 pl-2.5 pr-5 text-[12px] font-semibold text-[#cfe0ff] focus:outline-none focus:ring-1 focus:ring-accent"
            style={{ backgroundPosition: "right 0.4rem center" }}
          >
            {["MYR", "USD", "SGD", "GBP", "HKD"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <IconButton label="Settings" onClick={() => open({ kind: "settings" })} className="h-8 w-8 text-[#9db3dc]">
            <Gear className="h-[18px] w-[18px]" />
          </IconButton>
          <Button variant="pill" onClick={refresh} loading={refreshing} className="px-3.5 py-1.5">
            {!refreshing && <RefreshCw className="h-4 w-4" />} Refresh
          </Button>
        </div>
      </div>
      {t.incomplete && <p className="mt-2 text-2xs text-amber-200/90">Totals exclude holdings without a price or FX rate.</p>}
    </section>
  );
}

function shortStamp(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

function fxStr(r: string) {
  const n = Number(r);
  return n < 1 ? n.toFixed(3) : n.toFixed(2);
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function Warnings({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 px-4 py-2.5 text-xs text-amber-100">
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1">{items.length} data warning{items.length > 1 ? "s" : ""}</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="mt-2 list-disc space-y-0.5 pl-6 text-amber-100/80">
          {items.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryCardView({ card: c, base }: { card: CategoryCard; base: string }) {
  const { hidden } = usePrivacy();
  const open = useOpenSheet();
  const [expanded, setExpanded] = useState<number | null>(null);
  const isDiv = c.show_dividends;
  const cols = isDiv ? ["Stocks", "P/L (%)", "Gain / DV", "Live / Avg"] : ["Stocks", "P/L (%)", "Live / Avg", "Value"];
  if (c.holdings.length === 0 && c.id === null) return null;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 px-5 pb-3.5 pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h2 className="truncate text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{c.name}</h2>
            {c.id !== null && (
              <IconButton label={`Edit ${c.name}`} className="h-7 w-7 text-faint" onClick={() => open({ kind: "category", category: { id: c.id!, name: c.name, show_dividends: c.show_dividends, sort_order: c.sort_order } })}>
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
            )}
          </div>
          <p className="tabular truncate text-[24px] font-extrabold leading-tight text-white">{money(c.value, base, { hidden })}</p>
          <p className={cn("tabular mt-0.5 flex gap-3 whitespace-nowrap text-[15px] font-bold", tone(c.pl))}>
            <span>{money(c.pl, base, { signed: true, hidden })}</span>
            <span>{pct(c.pl_pct, { signed: true })}</span>
          </p>
        </div>
        {isDiv && (
          <div className="shrink-0 text-right">
            <p className="text-[12px] text-muted">Est. Annual DV</p>
            <p className="tabular whitespace-nowrap text-[20px] font-extrabold leading-tight text-gold">{money(c.est_annual_dividend, base, { hidden })}</p>
            <p className="tabular text-[14px] font-semibold text-gold/90">{pct(c.dividend_yield)}</p>
          </div>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)] gap-1.5 whitespace-nowrap border-y border-white/5 bg-ink-850 px-2.5 py-2.5 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-faint" role="row">
        {cols.map((col, i) => (
          <span key={col} className={i === 0 ? "pl-[46px] text-left" : "text-center"} role="columnheader">
            {col}
          </span>
        ))}
      </div>
      {c.holdings.length === 0 && <Empty title="No stocks here yet">Use Arrange to move stocks into this category.</Empty>}
      <ul>
        {c.holdings.map((h) => (
          <HoldingRow key={h.instrument_id} h={h} isDiv={isDiv} hidden={hidden} base={base} expanded={expanded === h.instrument_id} onToggle={() => setExpanded(expanded === h.instrument_id ? null : h.instrument_id)} />
        ))}
      </ul>
      {c.incomplete && <p className="border-t border-white/5 px-5 py-2 text-2xs text-amber-200/80">Stocks without a price are left out of this total.</p>}
    </Card>
  );
}

function HoldingRow({ h, isDiv, hidden, base, expanded, onToggle }: { h: Holding; isDiv: boolean; hidden: boolean; base: string; expanded: boolean; onToggle: () => void }) {
  const ccy = h.currency;
  const unit = h.kind === "fund" ? "units" : "shares";
  return (
    <li className="border-b border-white/[0.045] last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${h.symbol} details`}
        className="grid w-full grid-cols-[minmax(0,1.7fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-1.5 whitespace-nowrap px-2.5 py-3 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <TickerBadge symbol={h.symbol} className="h-[28px] w-[40px]" />
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-bold text-white">{h.symbol}</span>
            <span className="tabular block truncate text-[11px] text-muted">
              {qty(h.quantity)} {unit}
            </span>
          </span>
        </span>
        <span className="tabular text-center">
          <span className={cn("block text-[11.5px] font-bold", tone(h.total_pl))}>{money(h.total_pl, ccy, { signed: true, hidden })}</span>
          <span className={cn("block text-[10.5px] font-semibold", tone(h.total_pl))}>{pct(h.pl_pct, { signed: true })}</span>
        </span>
        {isDiv ? (
          <>
            <span className="tabular text-center">
              <span className={cn("block text-[11.5px] font-bold", tone(h.gain))}>{money(h.gain, ccy, { signed: true, hidden })}</span>
              <span className="block text-[10.5px] font-semibold text-up">{money(h.dividends_net, ccy, { signed: true, hidden })}</span>
            </span>
            <span className="tabular text-center">
              <PriceCell h={h} />
              <span className="block text-[11px] text-muted">{h.kind === "fund" && h.dividend_yield ? `${pct(h.dividend_yield)} yield` : `${priceStr(h.avg_cost, ccy)} avg`}</span>
            </span>
          </>
        ) : (
          <>
            <span className="tabular text-center">
              <PriceCell h={h} />
              <span className="block text-[11px] text-muted">{priceStr(h.avg_cost, ccy)} avg</span>
            </span>
            <span className="tabular text-center text-[11.5px] font-bold text-white">{money(h.market_value, ccy, { hidden })}</span>
          </>
        )}
      </button>
      {expanded && <HoldingDetail h={h} base={base} hidden={hidden} />}
    </li>
  );
}

function PriceCell({ h }: { h: Holding }) {
  return (
    <span className="block text-[11.5px] font-bold text-white" title={`${PRICE_WORD[h.price_status]}${h.price_source ? ` · ${h.price_source}` : ""}${h.price_date ? ` · ${h.price_date}` : ""}`}>
      {priceStr(h.price, h.currency)}
      {(h.price_status === "Cached" || h.price_status === "Unavailable") && <span className="ml-0.5 align-super text-[9px] text-amber-300">•</span>}
    </span>
  );
}

function HoldingDetail({ h, base, hidden }: { h: Holding; base: string; hidden: boolean }) {
  const open = useOpenSheet();
  const c = h.currency;
  const m = (v: string | null, signed = false, ccy = c) => money(v, ccy, { signed, hidden });
  const rows: [string, string, string?][] = [
    ["Value", m(h.market_value)],
    ["Cost", `${m(h.cost)} · avg ${priceStr(h.avg_cost, c)}`],
    ["Gain / loss", m(h.gain, true), tone(h.gain)],
  ];
  if (Number(h.dividends_net) !== 0) rows.push(["Dividends received", m(h.dividends_net, true), "text-up"]);
  if (h.est_annual_dividend_net) rows.push(["Expected yearly dividend", `${m(h.est_annual_dividend_net)} · ${pct(h.dividend_yield)} yield`, "text-gold"]);
  if (c !== base) rows.push([`Value in ${base}`, m(h.market_value_base, false, base)]);
  rows.push(["Price", `${PRICE_WORD[h.price_status]}${h.price_source && h.price_source !== "manual" ? ` · ${h.price_source}` : ""}${h.price_date ? ` · ${shortDate(h.price_date)}` : ""}`]);
  return (
    <div className="bg-ink-850/70 px-5 pb-4 pt-1">
      {h.name && <p className="pb-2 text-xs text-muted">{h.name}</p>}
      <dl className="grid grid-cols-1 gap-y-1.5 text-[13px]">
        {rows.map(([k, v, cls]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className={cn("tabular text-right font-medium text-slate-100", cls)}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">Held at</p>
      <ul className="mt-1 divide-y divide-white/5 rounded-xl bg-ink-900/70">
        {h.lots.map((l) => (
          <li key={l.holding_id}>
            <button className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-white/[0.03]" onClick={() => open({ kind: "holding", holdingId: l.holding_id })} aria-label={`Edit ${h.symbol} at ${l.broker}`}>
              <span className="text-slate-200">{l.broker}</span>
              <span className="tabular text-muted">
                {qty(l.quantity)} @ {priceStr(l.avg_cost, c)}
                <Pencil className="ml-2 inline h-3 w-3 text-faint" />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => open({ kind: "holding", preset: { symbol: h.symbol } })}>
          <Plus className="h-3.5 w-3.5" /> Another broker
        </Button>
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => open({ kind: "stock", instrumentId: h.instrument_id })}>
          Stock settings
        </Button>
        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => open({ kind: "price", instrumentId: h.instrument_id })}>
          Enter price
        </Button>
      </div>
    </div>
  );
}
