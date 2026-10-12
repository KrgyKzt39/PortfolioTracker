import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, RefreshCw, Settings as Gear } from "lucide-react";
import { api } from "../lib/api";
import { CURRENCY_LIST, cn, money, pct, tone } from "../lib/format";
import { useOpenSheet, usePrivacy, useRefreshStatus, useSaveSettings } from "../lib/hooks";
import type { Portfolio, PriceStatus, RefreshState } from "../lib/types";
import { IconButton, useToast } from "./ui";

export const STATUS_STYLE: Record<PriceStatus, string> = {
  Live: "bg-up-soft text-up",
  Delayed: "bg-gold-soft text-gold",
  Cached: "bg-fill/[0.12] text-muted",
  Manual: "bg-accent-soft text-accent",
  Unavailable: "bg-down-soft text-down",
  Partial: "bg-gold-soft text-gold",
};
const STATUS_HELP: Record<PriceStatus, string> = {
  Live: "Real-time quotes from the provider",
  Delayed: "Provider quotes, typically 15+ minutes delayed",
  Cached: "Last known good prices; latest refresh is older than the freshness window or failed",
  Manual: "Prices entered by you",
  Unavailable: "No prices yet. Add a manual price or enable a provider in Settings",
  Partial: "Some holdings have no price and are excluded from totals",
};

/** Starts a background price refresh and reports the result when it finishes. */
export function useRefresh(running: boolean) {
  const toast = useToast();
  const qc = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const status = useRefreshStatus(waiting);
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
  return { refresh, refreshing: waiting || running };
}

/** Toolbar icons shared by the Dashboard and Portfolio headers. */
export function RefreshAndSettings({ data }: { data: Portfolio }) {
  const open = useOpenSheet();
  const { refresh, refreshing } = useRefresh(data.refresh.running);
  return (
    <>
      <IconButton label={refreshing ? "Updating prices" : "Refresh prices"} onClick={refresh} disabled={refreshing}>
        <RefreshCw className={cn("h-[21px] w-[21px]", refreshing && "animate-spin")} strokeWidth={2} />
      </IconButton>
      <IconButton label="Settings" onClick={() => open({ kind: "settings" })}>
        <Gear className="h-[22px] w-[22px]" strokeWidth={2} />
      </IconButton>
    </>
  );
}

/** Total value, Stocks/Wallet style: big number on the page background, no card. */
export function Summary({ data }: { data: Portfolio }) {
  const { hidden, toggle } = usePrivacy();
  const save = useSaveSettings();
  const t = data.totals;
  const base = data.base_currency;
  const fx = data.fx.filter((f) => f.rate !== null || ["USD", "SGD", "GBP", "HKD", "MYR"].includes(f.from));

  return (
    <section aria-label="Portfolio summary" className="px-1 pb-1">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] text-muted">Total value</h2>
        {data.demo && <span className="rounded-full bg-gold-soft px-2 py-[1px] text-[11px] font-semibold text-gold">DEMO</span>}
        <span title={STATUS_HELP[data.price_status]} className={cn("rounded-full px-2 py-[1px] text-[11px] font-semibold", STATUS_STYLE[data.price_status])} data-testid="price-status">
          {data.refresh.running ? "Updating…" : data.price_status}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <p className="tabular truncate text-[40px] font-semibold leading-[1.15] tracking-[-0.03em] text-fg" data-testid="total-value">
          {money(t.value, base, { hidden })}
        </p>
        <IconButton label={hidden ? "Show values" : "Hide values"} onClick={toggle} className="shrink-0 text-muted">
          {hidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </IconButton>
      </div>
      <p className={cn("tabular text-[17px] font-medium", tone(t.pl))}>
        {money(t.pl, base, { signed: true, hidden })} ({pct(t.pl_pct, { signed: true })})
        <span className="ml-1.5 text-[15px] font-normal text-muted">all time</span>
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
        <label className="sr-only" htmlFor="base-ccy">
          Base currency
        </label>
        <select
          id="base-ccy"
          value={base}
          onChange={(e) => save.mutate({ base_currency: e.target.value as Portfolio["base_currency"] })}
          className="h-7 appearance-none rounded-full bg-fill/[0.12] pl-2.5 pr-6 text-[13px] font-semibold text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
          style={{ backgroundPosition: "right 0.45rem center" }}
        >
          {CURRENCY_LIST.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </select>
        <span className="tabular" title="Exchange rates: ECB reference rates (published once each working day), then ExchangeRate-API">
          {fx.map((f) => `${f.from} ${f.rate === null ? "N/A" : fxStr(f.rate)}${f.date && f.date !== localToday() ? ` (${shortDay(f.date)})` : ""}`).join(" · ")}
        </span>
        <span>· {shortStamp(data.prices_as_of ?? data.generated_at)}</span>
      </div>
      {t.incomplete && <p className="mt-1.5 text-[13px] text-gold">Totals exclude holdings without a price or exchange rate.</p>}
    </section>
  );
}

export function shortStamp(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

function fxStr(r: string) {
  const n = Number(r);
  return n < 1 ? n.toFixed(3) : n.toFixed(2);
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortDay(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
