import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Eye, EyeOff, Pencil, Plus, RefreshCw, Settings as Gear, Upload } from "lucide-react";
import { api } from "../lib/api";
import { cn, money, pct, priceStr, qty, tone } from "../lib/format";
import { useOpenSheet, usePortfolio, usePrivacy, useRefreshStatus, useSaveSettings, useSettings } from "../lib/hooks";
import type { AccountView, Holding, Portfolio, PriceStatus, RefreshState } from "../lib/types";
import { Badge, Button, Card, Empty, ErrorBox, IconButton, Spinner, useToast } from "../components/ui";
import { TickerBadge } from "../components/TickerBadge";

const STATUS_STYLE: Record<PriceStatus, string> = {
  Live: "bg-black/40 text-white",
  Delayed: "bg-black/40 text-amber-200",
  Cached: "bg-black/40 text-slate-300",
  Manual: "bg-black/40 text-sky-200",
  Unavailable: "bg-black/40 text-red-300",
  Partial: "bg-black/40 text-amber-200",
};
const STATUS_HELP: Record<PriceStatus, string> = {
  Live: "Real-time quotes from the provider",
  Delayed: "Provider quotes, typically 15+ minutes delayed",
  Cached: "Last known good prices; latest refresh is older than the freshness window or failed",
  Manual: "Prices entered by you",
  Unavailable: "No prices yet. Add a manual price or enable a provider in Settings",
  Partial: "Some holdings have no price and are excluded from totals",
};

export function Dashboard({ onShowTransactions }: { onShowTransactions: (filter: { account_id?: number; instrument_id?: number }) => void }) {
  const settings = useSettings();
  const base = settings.data?.base_currency;
  const pf = usePortfolio(base);
  const open = useOpenSheet();

  if (pf.isLoading || settings.isLoading) return <Spinner label="Loading portfolio" />;
  if (pf.error) return <ErrorBox error={pf.error} onRetry={() => pf.refetch()} />;
  const data = pf.data!;
  const accounts = data.accounts.filter((a) => !a.archived);

  return (
    <div className="space-y-4">
      <Hero data={data} />
      {data.warnings.length > 0 && <Warnings items={data.warnings} />}
      {accounts.length === 0 ? (
        <Card>
          <Empty title="No accounts yet">
            <p>Create an account, then add transactions. Holdings and P/L are calculated from your transactions.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button onClick={() => open({ kind: "account" })}>
                <Plus className="h-4 w-4" /> Add account
              </Button>
              <Button variant="secondary" onClick={() => open({ kind: "import" })}>
                <Upload className="h-4 w-4" /> Import CSV
              </Button>
            </div>
          </Empty>
        </Card>
      ) : (
        accounts.map((a) => <AccountCard key={a.id} account={a} base={data.base_currency} onShowTransactions={onShowTransactions} />)
      )}
      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1 pb-2">
          <Button variant="secondary" onClick={() => open({ kind: "transaction" })}>
            <Plus className="h-4 w-4" /> Transaction
          </Button>
          <Button variant="secondary" onClick={() => open({ kind: "account" })}>
            <Plus className="h-4 w-4" /> Account
          </Button>
          <Button variant="ghost" onClick={() => open({ kind: "import" })}>
            <Upload className="h-4 w-4" /> Import CSV
          </Button>
        </div>
      )}
      <p className="px-2 pb-4 text-2xs leading-relaxed text-faint">
        P/L = capital gain (unrealised + realised) + net dividends − fees. Return % is P/L ÷ current cost basis. Base-currency totals translate each holding at the latest FX rate; FX effect on cost is shown separately in holding details.
      </p>
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

function AccountCard({ account: a, base, onShowTransactions }: { account: AccountView; base: string; onShowTransactions: (f: { account_id?: number; instrument_id?: number }) => void }) {
  const { hidden } = usePrivacy();
  const open = useOpenSheet();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const isDiv = a.layout === "dividend";
  const cols = isDiv ? ["Stocks", "P/L (%)", "Cap gain / DV", "Live / Avg"] : ["Stocks", "P/L (%)", "Live / Avg", "Value"];

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 px-5 pb-3.5 pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h2 className="truncate text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{a.name}</h2>
            <IconButton label={`Edit ${a.name}`} className="h-7 w-7 text-faint" onClick={() => open({ kind: "account", account: { ...a } })}>
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <p className="tabular truncate text-[24px] font-extrabold leading-tight text-white">{money(a.value, base, { hidden })}</p>
          <p className={cn("tabular mt-0.5 flex gap-3 whitespace-nowrap text-[15px] font-bold", tone(a.pl))}>
            <span>{money(a.pl, base, { signed: true, hidden })}</span>
            <span>{pct(a.pl_pct, { signed: true })}</span>
          </p>
        </div>
        {isDiv && (
          <div className="shrink-0 text-right">
            <p className="text-[12px] text-muted">Est. Annual DV</p>
            <p className="tabular whitespace-nowrap text-[20px] font-extrabold leading-tight text-gold">{money(a.est_annual_dividend, base, { hidden })}</p>
            <p className="tabular text-[14px] font-semibold text-gold/90">{pct(a.dividend_yield)}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)] gap-1.5 border-y border-white/5 bg-ink-850 px-2.5 py-2.5 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-faint whitespace-nowrap" role="row">
        {cols.map((c, i) => (
          <span key={c} className={i === 0 ? "pl-[46px] text-left" : "text-center"} role="columnheader">
            {c}
          </span>
        ))}
      </div>

      {a.holdings.length === 0 && a.closed.length === 0 && (
        <Empty title="No holdings yet">
          <Button className="mt-2" variant="secondary" onClick={() => open({ kind: "transaction", preset: { account_id: a.id, type: "BUY" } })}>
            <Plus className="h-4 w-4" /> Add a buy
          </Button>
        </Empty>
      )}
      <ul>
        {a.holdings.map((h) => (
          <HoldingRow key={h.instrument_id} h={h} isDiv={isDiv} hidden={hidden} expanded={expanded === h.instrument_id} onToggle={() => setExpanded(expanded === h.instrument_id ? null : h.instrument_id)} account={a} base={base} onShowTransactions={onShowTransactions} />
        ))}
      </ul>

      {a.track_cash && (
        <div className="flex items-center justify-between border-t border-white/5 px-5 py-3 text-sm">
          <span className="text-muted">Cash</span>
          <span className="tabular text-right text-slate-200">
            {Object.keys(a.cash).length === 0 ? money(0, a.currency, { hidden }) : Object.entries(a.cash).map(([c, v]) => money(v, c, { hidden })).join(" · ")}
            {Object.keys(a.cash).some((c) => c !== base) && <span className="ml-2 text-2xs text-faint">≈ {money(a.cash_base, base, { hidden })}</span>}
          </span>
        </div>
      )}
      {a.closed.length > 0 && (
        <div className="border-t border-white/5">
          <button className="flex w-full items-center justify-between px-5 py-3 text-xs text-muted" onClick={() => setShowClosed(!showClosed)} aria-expanded={showClosed}>
            <span>Closed positions ({a.closed.length})</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", showClosed && "rotate-180")} />
          </button>
          {showClosed && (
            <ul className="pb-2">
              {a.closed.map((h) => (
                <li key={h.instrument_id} className="flex items-center justify-between px-5 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <TickerBadge symbol={h.symbol} />
                    <span className="font-semibold">{h.symbol}</span>
                  </span>
                  <span className="text-right">
                    <span className={cn("tabular block font-semibold", tone(h.total_pl))}>{money(h.total_pl, h.currency, { signed: true, hidden })}</span>
                    <span className="block text-2xs text-faint">realised {money(h.realized, h.currency, { signed: true, hidden })} · DV {money(h.dividends_net, h.currency, { hidden })}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {a.incomplete && <p className="border-t border-white/5 px-5 py-2 text-2xs text-amber-200/80">Some holdings lack a price or FX rate and are excluded from this account's totals.</p>}
    </Card>
  );
}

function HoldingRow({ h, isDiv, hidden, expanded, onToggle, account, base, onShowTransactions }: { h: Holding; isDiv: boolean; hidden: boolean; expanded: boolean; onToggle: () => void; account: AccountView; base: string; onShowTransactions: (f: { account_id?: number; instrument_id?: number }) => void }) {
  const ccy = h.currency;
  const unit = h.kind === "fund" ? "units" : "shares";
  const isFund = h.kind === "fund";
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
              <span className={cn("block text-[11.5px] font-bold", tone(h.capital_gain))}>{money(h.capital_gain, ccy, { signed: true, hidden })}</span>
              <span className="block text-[10.5px] font-semibold text-up">{money(h.dividends_net, ccy, { signed: true, hidden })}</span>
            </span>
            <span className="tabular text-center">
              <PriceCell h={h} />
              <span className="block text-[11px] text-muted">{isFund && h.dividend_yield ? `${pct(h.dividend_yield)} yield` : `${priceStr(h.avg_cost, ccy)} avg`}</span>
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
      {expanded && <HoldingDetail h={h} account={account} base={base} hidden={hidden} onShowTransactions={onShowTransactions} />}
    </li>
  );
}

function PriceCell({ h }: { h: Holding }) {
  return (
    <span className="block text-[11.5px] font-bold text-white" title={`${h.price_status}${h.price_source ? ` · ${h.price_source}` : ""}${h.price_date ? ` · ${h.price_date}` : ""}`}>
      {priceStr(h.price, h.currency)}
      {(h.price_status === "Cached" || h.price_status === "Unavailable") && <span className="ml-0.5 align-super text-[9px] text-amber-300">•</span>}
    </span>
  );
}

function HoldingDetail({ h, account, base, hidden, onShowTransactions }: { h: Holding; account: AccountView; base: string; hidden: boolean; onShowTransactions: (f: { account_id?: number; instrument_id?: number }) => void }) {
  const open = useOpenSheet();
  const c = h.currency;
  const m = (v: string | null, signed = false, ccy = c) => money(v, ccy, { signed, hidden });
  const rows: [string, string, string?][] = [
    ["Quantity", qty(h.quantity)],
    ["Average cost", priceStr(h.avg_cost, c)],
    ["Cost basis", m(h.cost)],
    ["Price", `${priceStr(h.price, c)} · ${h.price_status}${h.price_date ? ` (${h.price_date})` : ""}`],
    ["Market value", m(h.market_value)],
    ["Unrealised", m(h.unrealized, true), tone(h.unrealized)],
    ["Realised", m(h.realized, true), tone(h.realized)],
    ["Dividends gross / tax", `${m(h.dividends_gross)} / ${m(h.dividend_tax)}`],
    ["Dividends net", m(h.dividends_net, true), "text-up"],
    ["Fees & taxes", m(h.fees)],
    ["Total P/L", `${m(h.total_pl, true)} (${pct(h.pl_pct, { signed: true })})`, tone(h.total_pl)],
    ["Est. annual DV (gross / net)", `${m(h.est_annual_dividend)} / ${m(h.est_annual_dividend_net)}`, "text-gold"],
    ["DPS", h.dps ? `${priceStr(h.dps, c)} · ${h.dps_source}` : "N/A"],
    ["Yield / yield on cost", `${pct(h.dividend_yield)} / ${pct(h.yield_on_cost)}`],
    ["Withholding tax", pct(Number(h.withholding_tax_rate) * 100, { dp: 0 })],
  ];
  if (c !== base) {
    rows.push(
      [`Value in ${base}`, m(h.market_value_base, false, base)],
      [`P/L in ${base} (at today's FX)`, m(h.total_pl_base, true, base), tone(h.total_pl_base)],
      ["FX effect on cost", h.fx_effect_base === null ? "N/A (missing historical FX)" : m(h.fx_effect_base, true, base), tone(h.fx_effect_base)],
    );
  }
  return (
    <div className="bg-ink-850/70 px-5 pb-4 pt-1">
      {h.name && <p className="pb-2 text-xs text-muted">{h.name}</p>}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
        {rows.map(([k, v, cls]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className={cn("tabular text-right font-medium text-slate-100", cls)}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => open({ kind: "transaction", preset: { account_id: account.id, instrument_id: h.instrument_id, type: "BUY" } })}>
          <Plus className="h-3.5 w-3.5" /> Transaction
        </Button>
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => open({ kind: "price", instrumentId: h.instrument_id })}>
          Update price
        </Button>
        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => onShowTransactions({ account_id: account.id, instrument_id: h.instrument_id })}>
          History
        </Button>
      </div>
    </div>
  );
}
