import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Download, Plus, Search, SlidersHorizontal, Upload, X } from "lucide-react";
import { api } from "../lib/api";
import { cn, money, qty, priceStr, shortDate } from "../lib/format";
import { useAccounts, useInstruments, useOpenSheet, usePrivacy } from "../lib/hooks";
import type { Txn } from "../lib/types";
import { Button, Card, Empty, ErrorBox, Field, IconButton, Input, Select, Spinner } from "../components/ui";
import { TickerBadge } from "../components/TickerBadge";
import { typeLabel } from "../components/forms";

const TYPE_STYLE: Record<string, string> = {
  BUY: "bg-accent/15 text-blue-300",
  SELL: "bg-down/15 text-red-300",
  DIVIDEND: "bg-up/15 text-emerald-300",
  DRIP: "bg-up/15 text-emerald-300",
  DEPOSIT: "bg-sky-400/15 text-sky-300",
  WITHDRAWAL: "bg-orange-400/15 text-orange-300",
  FEE: "bg-slate-400/15 text-slate-300",
  TAX: "bg-slate-400/15 text-slate-300",
  SPLIT: "bg-purple-400/15 text-purple-300",
  TRANSFER: "bg-cyan-400/15 text-cyan-300",
};

export interface TxnFilter {
  account_id?: number;
  instrument_id?: number;
}

const PAGE = 50;

export function Transactions({ initialFilter }: { initialFilter: TxnFilter }) {
  const open = useOpenSheet();
  const { hidden } = usePrivacy();
  const accounts = useAccounts();
  const instruments = useInstruments();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [account, setAccount] = useState(initialFilter.account_id ? String(initialFilter.account_id) : "");
  const [instrument, setInstrument] = useState(initialFilter.instrument_id ? String(initialFilter.instrument_id) : "");
  const [type, setType] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [showFilters, setShowFilters] = useState(!!(initialFilter.account_id || initialFilter.instrument_id));

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced) p.set("q", debounced);
    if (account) p.set("account_id", account);
    if (instrument) p.set("instrument_id", instrument);
    if (type) p.set("type", type);
    if (start) p.set("start", start);
    if (end) p.set("end", end);
    return p.toString();
  }, [debounced, account, instrument, type, start, end]);

  const list = useInfiniteQuery({
    queryKey: ["transactions", params],
    queryFn: ({ pageParam }) => api<{ total: number; items: Txn[] }>(`/transactions?${params}&limit=${PAGE}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (pages.length * PAGE < last.total ? pages.length * PAGE : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const activeFilters = [account, instrument, type, start, end].filter(Boolean).length;

  const groups = useMemo(() => {
    const out: { date: string; items: Txn[] }[] = [];
    for (const t of items) {
      const g = out[out.length - 1];
      if (g && g.date === t.trade_date) g.items.push(t);
      else out.push({ date: t.trade_date, items: [t] });
    }
    return out;
  }, [items]);

  const clear = () => {
    setAccount("");
    setInstrument("");
    setType("");
    setStart("");
    setEnd("");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-2xl font-extrabold text-white">Transactions</h1>
        <div className="flex gap-1">
          <IconButton label="Import CSV" onClick={() => open({ kind: "import" })}>
            <Upload className="h-5 w-5" />
          </IconButton>
          <a href={`/api/transactions/export.csv?${params}`} aria-label="Export CSV" title="Export CSV (current filters)" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-300 hover:bg-white/10">
            <Download className="h-5 w-5" />
          </a>
          <Button onClick={() => open({ kind: "transaction", preset: { account_id: account || undefined, instrument_id: instrument || undefined } })} className="ml-1">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
          <Input aria-label="Search transactions" placeholder="Search symbol, name or note" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" type="search" />
        </div>
        <Button variant={activeFilters ? "pill" : "secondary"} onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters} aria-label="Filters">
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilters > 0 && activeFilters}
        </Button>
      </div>

      {showFilters && (
        <Card className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account">
              {(id) => (
                <Select id={id} value={account} onChange={(e) => setAccount(e.target.value)}>
                  <option value="">All</option>
                  {(accounts.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Type">
              {(id) => (
                <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">All</option>
                  <option value="BUY,SELL">Trades</option>
                  <option value="DIVIDEND,DRIP">Dividends</option>
                  <option value="DEPOSIT,WITHDRAWAL,TRANSFER">Cash & transfers</option>
                  {["BUY", "SELL", "DIVIDEND", "DRIP", "DEPOSIT", "WITHDRAWAL", "FEE", "TAX", "SPLIT", "TRANSFER"].map((t) => (
                    <option key={t} value={t}>
                      {typeLabel(t)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Instrument" className="col-span-2">
              {(id) => (
                <Select id={id} value={instrument} onChange={(e) => setInstrument(e.target.value)}>
                  <option value="">All</option>
                  {(instruments.data ?? []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.symbol}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="From">{(id) => <Input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
            <Field label="To">{(id) => <Input id={id} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
          </div>
          {activeFilters > 0 && (
            <Button variant="ghost" className="px-2 text-xs" onClick={clear}>
              <X className="h-3.5 w-3.5" /> Clear filters
            </Button>
          )}
        </Card>
      )}

      {list.isLoading ? (
        <Spinner label="Loading transactions" />
      ) : list.error ? (
        <ErrorBox error={list.error} onRetry={() => list.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <Empty title={params ? "No matching transactions" : "No transactions yet"}>{params ? "Try different filters." : "Add a buy, deposit or dividend, or import a CSV."}</Empty>
        </Card>
      ) : (
        <Card>
          <p className="border-b border-white/5 px-4 py-2 text-2xs text-faint">{total} transaction{total === 1 ? "" : "s"}</p>
          {groups.map((g) => (
            <div key={g.date}>
              <p className="bg-ink-850 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">{shortDate(g.date)}</p>
              <ul>
                {g.items.map((t) => (
                  <li key={t.id} className="border-b border-white/[0.045] last:border-b-0">
                    <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02]" onClick={() => open({ kind: "transaction", txnId: t.id })} aria-label={`${typeLabel(t.type)} ${t.symbol ?? ""} ${t.trade_date}`}>
                      {t.symbol ? <TickerBadge symbol={t.symbol} /> : <div className="flex h-[30px] w-[50px] shrink-0 items-center justify-center rounded-[8px] bg-ink-700 text-[10px] font-bold text-muted">{t.currency}</div>}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase", TYPE_STYLE[t.type])}>{typeLabel(t.type)}</span>
                          <span className="truncate text-sm font-semibold text-white">{t.symbol ?? (t.type === "TRANSFER" ? "Cash" : "")}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-2xs text-muted">{describe(t)}</span>
                      </span>
                      <span className={cn("tabular shrink-0 text-right text-sm font-semibold", t.cash_effect === null ? "text-muted" : Number(t.cash_effect) >= 0 ? "text-up" : "text-slate-200")}>
                        {t.cash_effect === null ? "—" : money(t.cash_effect, t.currency, { signed: true, hidden })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {list.hasNextPage && (
            <div className="p-3 text-center">
              <Button variant="secondary" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function describe(t: Txn): string {
  const acct = t.type === "TRANSFER" ? `${t.account_name} → ${t.to_account_name}` : t.account_name ?? "All accounts";
  switch (t.type) {
    case "BUY":
    case "SELL":
      return `${acct} · ${qty(t.quantity)} @ ${priceStr(t.price, t.currency)}${Number(t.fees) ? ` · fees ${money(t.fees, t.currency)}` : ""}`;
    case "DRIP":
      return `${acct} · ${qty(t.quantity)} @ ${priceStr(t.price, t.currency)} reinvested`;
    case "DIVIDEND":
      return `${acct} · gross ${money(t.amount, t.currency)}${Number(t.tax) ? ` · tax ${money(t.tax, t.currency)}` : ""}`;
    case "SPLIT":
      return `${acct} · ratio ${t.split_ratio}:1`;
    case "TRANSFER":
      return t.instrument_id ? `${acct} · ${qty(t.quantity)} shares` : `${acct}`;
    default:
      return `${acct}${t.note ? ` · ${t.note}` : ""}`;
  }
}
