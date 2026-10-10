import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { cn, money, priceStr, qty, shortDate, today } from "../lib/format";
import { useDividendEvents, useInstruments, useInvalidateAll, useOpenSheet, usePrivacy } from "../lib/hooks";
import type { DividendEvent, Txn } from "../lib/types";
import { Badge, Button, Card, ConfirmSheet, Empty, ErrorBox, Field, Input, Segmented, Select, Sheet, Spinner, Textarea, useToast } from "../components/ui";
import { TickerBadge } from "../components/TickerBadge";

const STATUS_STYLE: Record<string, string> = {
  forecast: "bg-slate-400/15 text-slate-300",
  announced: "bg-accent/15 text-blue-300",
  pending: "bg-gold/15 text-gold",
  received: "bg-up/15 text-emerald-300",
};

type View = "upcoming" | "history";

export function Dividends() {
  const [view, setView] = useState<View>("upcoming");
  const [instrument, setInstrument] = useState("");
  const instruments = useInstruments();
  const openSheet = useOpenSheet();
  const [editing, setEditing] = useState<DividendEvent | "new" | null>(null);
  const [reconciling, setReconciling] = useState<DividendEvent | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (instrument) p.set("instrument_id", instrument);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [instrument]);
  const events = useDividendEvents(params);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-2xl font-extrabold text-white">Dividends</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => openSheet({ kind: "transaction", preset: { type: "DIVIDEND", instrument_id: instrument || undefined } })}>
            Record
          </Button>
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Event
          </Button>
        </div>
      </div>
      <Segmented
        label="Dividend view"
        value={view}
        onChange={setView}
        options={[
          { value: "upcoming", label: "Upcoming" },
          { value: "history", label: "Received" },
        ]}
      />
      <Select aria-label="Filter by security" value={instrument} onChange={(e) => setInstrument(e.target.value)}>
        <option value="">All holdings</option>
        {(instruments.data ?? []).map((i) => (
          <option key={i.id} value={i.id}>
            {i.symbol}
          </option>
        ))}
      </Select>

      {view === "history" ? (
        <History instrument={instrument} />
      ) : events.isLoading ? (
        <Spinner label="Loading events" />
      ) : events.error ? (
        <ErrorBox error={events.error} onRetry={() => events.refetch()} />
      ) : (
        <EventList events={events.data!} upcoming onEdit={setEditing} onReconcile={setReconciling} />
      )}
      <p className="px-2 pb-4 text-2xs leading-relaxed text-faint">
        Upcoming dividends are expectations. Tap one and choose “Reconcile received” once the money arrives.
      </p>
      {editing && <EventSheet event={editing === "new" ? undefined : editing} defaultInstrument={instrument} onClose={() => setEditing(null)} />}
      {reconciling && <ReconcileSheet event={reconciling} onClose={() => setReconciling(null)} />}
    </div>
  );
}

function EventList({ events, upcoming, onEdit, onReconcile }: { events: DividendEvent[]; upcoming: boolean; onEdit: (e: DividendEvent) => void; onReconcile: (e: DividendEvent) => void }) {
  const t = today();
  const list = upcoming
    ? events.filter((e) => e.status !== "received").sort((a, b) => (a.pay_date ?? a.ex_date).localeCompare(b.pay_date ?? b.ex_date))
    : events;
  if (list.length === 0)
    return (
      <Card>
        <Empty title={upcoming ? "Nothing upcoming" : "No dividend events"}>Add an announced dividend with “+ Event” to see what you should receive.</Empty>
      </Card>
    );
  const groups: { key: string; items: DividendEvent[] }[] = [];
  for (const e of list) {
    const d = upcoming ? e.pay_date ?? e.ex_date : e.ex_date;
    const key = d.slice(0, 7);
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.items.push(e);
    else groups.push({ key, items: [e] });
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <Card key={g.key}>
          <p className="flex items-center gap-2 border-b border-white/5 bg-ink-850 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {new Date(`${g.key}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
            {upcoming && <span className="normal-case tracking-normal">· by payment date</span>}
          </p>
          <ul>
            {g.items.map((e) => (
              <EventRow key={e.id} e={e} overdue={upcoming && (e.pay_date ?? e.ex_date) < t} onEdit={() => onEdit(e)} onReconcile={() => onReconcile(e)} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function EventRow({ e, overdue, onEdit, onReconcile }: { e: DividendEvent; overdue: boolean; onEdit: () => void; onReconcile: () => void }) {
  const { hidden } = usePrivacy();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [confirm, setConfirm] = useState(false);
  const [open, setOpen] = useState(false);
  const c = e.currency;
  const markPending = async () => {
    try {
      await api(`/dividends/events/${e.id}`, { method: "PUT", body: { status: "pending" } });
      invalidate();
      toast(`${e.symbol} marked pending`);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };
  const remove = async () => {
    try {
      await api(`/dividends/events/${e.id}`, { method: "DELETE" });
      invalidate();
      toast("Event deleted");
    } catch (err) {
      toast((err as Error).message, "error");
    }
    setConfirm(false);
  };
  return (
    <li className="border-b border-white/[0.045] last:border-b-0">
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02]" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${e.symbol} dividend ${e.ex_date}`}>
        <TickerBadge symbol={e.symbol} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-white">{e.symbol}</span>
            <Badge className={STATUS_STYLE[e.status]}>{e.status}</Badge>
            {overdue && e.status !== "received" && <Badge className="bg-down/15 text-red-300">awaiting</Badge>}
          </span>
          <span className="block text-2xs text-muted">
            Ex {shortDate(e.ex_date)} · Pay {shortDate(e.pay_date)} · {priceStr(e.amount_per_share, c)}/sh
          </span>
        </span>
        <span className="tabular shrink-0 text-right">
          <span className={cn("block text-sm font-bold", e.status === "received" ? "text-up" : "text-gold")}>{money(e.received_net ?? e.expected_net, c, { hidden })}</span>
          <span className="block text-2xs text-faint">{e.status === "received" ? "received net" : "expected net"}</span>
        </span>
      </button>
      {open && (
        <div className="bg-ink-850/70 px-4 pb-4 pt-1 text-xs">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-muted">Eligible shares</dt>
            <dd className="tabular text-right">{qty(e.eligible_shares)}</dd>
            <dt className="text-muted">Gross expected</dt>
            <dd className="tabular text-right">{money(e.expected_gross, c, { hidden })}</dd>
            <dt className="text-muted">Withholding rate</dt>
            <dd className="tabular text-right">{(Number(e.withholding_rate_effective) * 100).toFixed(1)}%</dd>
            <dt className="text-muted">Net expected</dt>
            <dd className="tabular text-right">{money(e.expected_net, c, { hidden })}</dd>
            {e.received_net !== null && (
              <>
                <dt className="text-muted">Net received</dt>
                <dd className="tabular text-right text-up">{money(e.received_net, c, { hidden })}</dd>
              </>
            )}
          </dl>
          {e.accounts.length > 1 || e.accounts.some((a) => a.difference !== null) ? (
            <ul className="mt-2 space-y-1 border-t border-white/5 pt-2">
              {e.accounts.map((a) => (
                <li key={a.account_id} className="flex justify-between">
                  <span className="text-muted">
                    {a.account_name} · {qty(a.eligible_shares)} sh
                  </span>
                  <span className="tabular">
                    {money(a.expected_net, c, { hidden })}
                    {a.difference !== null && Number(a.difference) !== 0 && <span className={cn("ml-1", Number(a.difference) > 0 ? "text-up" : "text-down")}>({money(a.difference, c, { signed: true, hidden })})</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {e.accounts.length === 0 && <p className="mt-2 text-faint">No shares were held before the ex-date{e.ex_date > today() ? " (current holdings will be used once the ex-date passes)" : ""}.</p>}
          {e.note && <p className="mt-2 text-faint">{e.note}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {e.status !== "received" && e.accounts.length > 0 && <Button className="px-3 py-1.5 text-xs" onClick={onReconcile}>Reconcile received</Button>}
            {e.suggested_status === "pending" && e.status !== "pending" && (
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={markPending}>
                Mark pending
              </Button>
            )}
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => setConfirm(true)} aria-label="Delete event">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
      <ConfirmSheet open={confirm} title="Delete dividend event?" message="Events with reconciled dividend transactions cannot be deleted until those transactions are removed." onConfirm={remove} onClose={() => setConfirm(false)} />
    </li>
  );
}

function History({ instrument }: { instrument: string }) {
  const { hidden } = usePrivacy();
  const openSheet = useOpenSheet();
  const p = new URLSearchParams({ type: "DIVIDEND,DRIP", limit: "500" });
  if (instrument) p.set("instrument_id", instrument);
  const q = useQuery({ queryKey: ["transactions", "div-history", p.toString()], queryFn: () => api<{ total: number; items: Txn[] }>(`/transactions?${p}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const items = q.data!.items;
  if (items.length === 0)
    return (
      <Card>
        <Empty title="No dividends received yet">Use “Record” to enter a dividend, or reconcile an event.</Empty>
      </Card>
    );
  return (
    <Card>
      <ul>
        {items.map((t) => (
          <li key={t.id} className="border-b border-white/[0.045] last:border-b-0">
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02]" onClick={() => openSheet({ kind: "transaction", txnId: t.id })}>
              <TickerBadge symbol={t.symbol ?? "?"} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-white">
                  {t.symbol} {t.type === "DRIP" && <span className="text-2xs font-normal text-muted">reinvested</span>}
                </span>
                <span className="block text-2xs text-muted">
                  {shortDate(t.trade_date)} · {t.account_name}
                  {t.dividend_event_id ? " · reconciled" : ""}
                </span>
              </span>
              <span className="tabular text-right">
                <span className="block text-sm font-bold text-up">{money(Number(t.amount) - Number(t.tax), t.currency, { hidden })}</span>
                <span className="block text-2xs text-faint">
                  gross {money(t.amount, t.currency, { hidden })}
                  {Number(t.tax) ? ` · tax ${money(t.tax, t.currency, { hidden })}` : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function EventSheet({ event, defaultInstrument, onClose }: { event?: DividendEvent; defaultInstrument: string; onClose: () => void }) {
  const instruments = useInstruments();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [v, setV] = useState({
    instrument_id: event ? String(event.instrument_id) : defaultInstrument,
    ex_date: event?.ex_date ?? "",
    pay_date: event?.pay_date ?? "",
    amount_per_share: event?.amount_per_share ?? "",
    status: event?.status === "received" ? "received" : event?.status ?? "announced",
    withholding_tax_rate: event?.withholding_tax_rate ?? "",
    note: event?.note ?? "",
  });
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const inst = instruments.data?.find((i) => String(i.id) === v.instrument_id);
  const fe = (f: string) => (err?.field === f ? err.message : null);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = { ...v, instrument_id: Number(v.instrument_id), pay_date: v.pay_date || null, withholding_tax_rate: v.withholding_tax_rate || null };
      if (event) await api(`/dividends/events/${event.id}`, { method: "PUT", body });
      else await api("/dividends/events", { body });
      invalidate();
      toast(event ? "Event updated" : "Dividend event added");
      onClose();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={event ? `Edit ${event.symbol} dividend` : "New dividend event"}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => submit()} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        {err && !["ex_date", "pay_date", "amount_per_share", "withholding_tax_rate", "instrument_id"].includes(err.field ?? "") && (
          <p role="alert" className="rounded-xl border border-down/30 bg-down/10 px-3 py-2 text-sm text-red-200">
            {err.message}
          </p>
        )}
        <Field label="Security" error={fe("instrument_id")}>
          {(id) => (
            <Select id={id} value={v.instrument_id} onChange={set("instrument_id")} disabled={!!event}>
              <option value="">Select…</option>
              {(instruments.data ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.symbol}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ex-dividend date" error={fe("ex_date")}>
            {(id) => <Input id={id} type="date" value={v.ex_date} onChange={set("ex_date")} required />}
          </Field>
          <Field label="Payment date" error={fe("pay_date")}>
            {(id) => <Input id={id} type="date" value={v.pay_date} onChange={set("pay_date")} />}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Amount per share${inst ? ` (${inst.currency})` : ""}`} error={fe("amount_per_share")}>
            {(id) => <Input id={id} inputMode="decimal" value={v.amount_per_share} onChange={set("amount_per_share")} placeholder="0.00" />}
          </Field>
          <Field label="Status" hint="Use Reconcile to mark received">
            {(id) => (
              <Select id={id} value={v.status} onChange={set("status")} disabled={v.status === "received"}>
                <option value="forecast">Forecast (your estimate)</option>
                <option value="announced">Announced</option>
                <option value="pending">Pending payment</option>
                {v.status === "received" && <option value="received">Received</option>}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Withholding tax rate override" error={fe("withholding_tax_rate")} hint={`Blank = instrument default (${inst ? Number(inst.withholding_tax_rate) * 100 : 0}%)`}>
          {(id) => <Input id={id} inputMode="decimal" value={v.withholding_tax_rate} onChange={set("withholding_tax_rate")} placeholder="e.g. 0.30" />}
        </Field>
        <Field label="Note">{(id) => <Textarea id={id} value={v.note} onChange={set("note")} />}</Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function ReconcileSheet({ event: e, onClose }: { event: DividendEvent; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const t = today();
  const defaultDate = e.pay_date && e.pay_date <= t ? e.pay_date : t;
  const [rows, setRows] = useState(
    e.accounts.filter((a) => a.transaction_ids.length === 0).map((a) => ({ account_id: a.account_id, name: a.account_name, include: true, gross: Number(a.expected_gross).toFixed(2), tax: Number(a.expected_tax).toFixed(2), pay_date: defaultDate })),
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upd = (i: number, k: string, val: string | boolean) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/dividends/events/${e.id}/reconcile`, { body: { entries: rows.filter((r) => r.include).map((r) => ({ account_id: r.account_id, gross: r.gross, tax: r.tax, pay_date: r.pay_date })) } });
      invalidate();
      toast(`${e.symbol} dividend recorded as received`);
      onClose();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Reconcile ${e.symbol} dividend`}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={submit} loading={busy} disabled={!rows.some((r) => r.include)}>
            Record received
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted">Enter what actually arrived (from your broker statement). Pre-filled values are the expected amounts. This creates dividend transactions linked to the event.</p>
        {e.pay_date && e.pay_date > t && <p className="text-xs text-amber-200">The payment date is in the future. Only reconcile once the money has arrived.</p>}
        {err && (
          <p role="alert" className="rounded-xl border border-down/30 bg-down/10 px-3 py-2 text-sm text-red-200">
            {err}
          </p>
        )}
        {rows.map((r, i) => (
          <div key={r.account_id} className="space-y-2 rounded-2xl bg-ink-900 p-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={r.include} onChange={(x) => upd(i, "include", x.target.checked)} /> {r.name}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <Field label={`Gross (${e.currency})`}>{(id) => <Input id={id} inputMode="decimal" value={r.gross} onChange={(x) => upd(i, "gross", x.target.value)} />}</Field>
              <Field label="Tax withheld">{(id) => <Input id={id} inputMode="decimal" value={r.tax} onChange={(x) => upd(i, "tax", x.target.value)} />}</Field>
              <Field label="Paid on">{(id) => <Input id={id} type="date" max={t} value={r.pay_date} onChange={(x) => upd(i, "pay_date", x.target.value)} />}</Field>
            </div>
            <p className="text-2xs text-faint">Net: {money(Number(r.gross || 0) - Number(r.tax || 0), e.currency)}</p>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted">All eligible accounts are already reconciled.</p>}
      </div>
    </Sheet>
  );
}
