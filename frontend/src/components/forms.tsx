import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { CURRENCY_LIST, cn, money, priceStr, today } from "../lib/format";
import { useBrokers, useCategories, useInstruments, useInvalidateAll, useMeta, useOpenSheet } from "../lib/hooks";
import type { Broker, Category, DividendEvent, Instrument, Payment } from "../lib/types";
import { Button, ConfirmSheet, Field, Input, Segmented, Select, Sheet, Spinner, Textarea, Toggle, useToast } from "./ui";


export function FormError({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl border border-down/30 bg-down/10 px-3 py-2 text-sm text-red-200">
      {error}
    </p>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Footer({ onClose, onSave, busy, onDelete, saveLabel = "Save" }: { onClose: () => void; onSave: () => void; busy: boolean; onDelete?: () => void; saveLabel?: string }) {
  return (
    <>
      {onDelete && (
        <Button variant="danger" onClick={onDelete} aria-label="Delete">
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
      <Button variant="secondary" className="flex-1" onClick={onClose}>
        Cancel
      </Button>
      <Button className="flex-1" onClick={onSave} loading={busy}>
        {saveLabel}
      </Button>
    </>
  );
}

/** Shared submit plumbing for the sheets below. */
function useSubmit(onClose: () => void) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      invalidate();
      toast(done);
      onClose();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return { err, busy, run, fe: (f: string) => (err?.field === f ? err.message : null), general: err && !err.field ? err.message : null };
}

const pctToRate = (v: string) => (v === "" ? null : String(Number(v) / 100));
const rateToPct = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? "" : String(Number((Number(v) * 100).toFixed(4))));

const SUFFIX_CCY: Record<string, string> = {
  ".KL": "MYR", ".SI": "SGD", ".HK": "HKD", ".L": "GBP", ".T": "JPY", ".AX": "AUD", ".TO": "CAD", ".V": "CAD", ".PA": "EUR", ".DE": "EUR",
  ".F": "EUR", ".AS": "EUR", ".MI": "EUR", ".MC": "EUR", ".BR": "EUR", ".SW": "CHF", ".SS": "CNY", ".SZ": "CNY", ".TW": "TWD", ".TWO": "TWD",
  ".BK": "THB", ".JK": "IDR", ".KS": "KRW", ".KQ": "KRW", ".NS": "INR", ".BO": "INR", ".NZ": "NZD", ".ST": "SEK", ".OL": "NOK", ".CO": "DKK",
  ".SA": "BRL", ".MX": "MXN", ".PS": "PHP",
};
/** Same rule as the server: listing currency from the exchange suffix, else USD. */
function guessCcy(symbol: string) {
  const s = symbol.trim().toUpperCase();
  const suf = Object.keys(SUFFIX_CCY)
    .sort((a, b) => b.length - a.length)
    .find((x) => s.endsWith(x));
  return suf ? SUFFIX_CCY[suf] : "USD";
}

/* ================================================================ Holding */
type HoldingRow = { id: number; broker_id: number; instrument_id: number; symbol: string; quantity: string; avg_cost: string; broker: string; kind: string; currency: string };
type HoldingPreset = { symbol?: string; broker_id?: number; category_id?: number | null };

export function HoldingSheet({ holdingId, preset, onClose }: { holdingId?: number; preset?: HoldingPreset; onClose: () => void }) {
  const holdings = useQuery({ queryKey: ["holdings"], queryFn: () => api<HoldingRow[]>("/holdings") });
  if (holdingId && holdings.isLoading)
    return (
      <Sheet open onClose={onClose} title="Holding">
        <Spinner />
      </Sheet>
    );
  const existing = holdingId ? holdings.data?.find((h) => h.id === holdingId) : undefined;
  return <HoldingEditor key={existing?.id ?? "new"} existing={existing} preset={preset} onClose={onClose} />;
}

function HoldingEditor({ existing, preset, onClose }: { existing?: HoldingRow; preset?: HoldingPreset; onClose: () => void }) {
  const brokers = useBrokers();
  const categories = useCategories();
  const instruments = useInstruments();
  const { busy, run, fe, general } = useSubmit(onClose);
  const [confirm, setConfirm] = useState(false);
  const presetInst = instruments.data?.find((i) => i.symbol === preset?.symbol);
  const [isFund, setIsFund] = useState(existing ? existing.kind === "fund" : presetInst?.kind === "fund");
  const [v, setV] = useState({
    broker_id: String(existing?.broker_id ?? preset?.broker_id ?? ""),
    new_broker: "",
    symbol: existing?.symbol ?? preset?.symbol ?? "",
    name: "",
    quantity: existing ? String(Number(existing.quantity)) : "",
    avg_cost: existing ? String(Number(existing.avg_cost)) : "",
    total_cost: existing ? String(Number((Number(existing.quantity) * Number(existing.avg_cost)).toFixed(2))) : "",
    price: "1.00",
    currency: "",
    category_id: preset?.category_id ? String(preset.category_id) : "",
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const brokerList = brokers.data ?? [];
  const noBrokers = brokers.isSuccess && brokerList.length === 0 && !existing;
  const known = instruments.data?.find((i) => i.symbol === v.symbol.trim().toUpperCase());
  const ccy = existing?.currency ?? known?.currency ?? (v.currency || (v.symbol ? (isFund ? "MYR" : guessCcy(v.symbol)) : ""));
  const newBroker = noBrokers || v.broker_id === "__new";
  const isNewStock = !existing && !known && v.symbol.trim() !== "";

  const save = () =>
    run(async () => {
      let brokerId = v.broker_id;
      if (newBroker) {
        const b = await api<Broker>("/brokers", { body: { name: v.new_broker } });
        brokerId = String(b.id);
        setV((x) => ({ ...x, broker_id: brokerId }));
      }
      const amounts = isFund ? { quantity: v.quantity, total_cost: v.total_cost } : { quantity: v.quantity, avg_cost: v.avg_cost };
      const body = { broker_id: Number(brokerId) || null, ...amounts };
      if (existing) await api(`/holdings/${existing.id}`, { method: "PUT", body });
      else
        await api("/holdings", {
          body: {
            ...body,
            symbol: v.symbol,
            name: v.name || null,
            kind: isNewStock && isFund ? "fund" : undefined,
            price: isNewStock && isFund ? v.price : undefined,
            currency: v.currency || (isNewStock && isFund ? "MYR" : null),
            category_id: v.category_id ? Number(v.category_id) : null,
          },
        });
    }, existing ? "Holding updated" : `${v.symbol.trim().toUpperCase()} added`);

  const title = existing ? `${existing.symbol} at ${existing.broker}` : isFund ? "Add fund or savings" : "Add holding";
  return (
    <Sheet open onClose={onClose} title={title} footer={<Footer onClose={onClose} onSave={save} busy={busy} onDelete={existing ? () => setConfirm(true) : undefined} />}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <FormError error={general} />
        {!existing && (
          <Segmented
            label="What are you adding"
            value={isFund ? "fund" : "stock"}
            onChange={(x) => setIsFund(x === "fund")}
            options={[
              { value: "stock", label: "Stock or ETF" },
              { value: "fund", label: "Fund or savings" },
            ]}
          />
        )}
        {!existing && (
          <p className="text-xs text-muted">
            {isFund ? "EPF, ASB, ASNB, unit trusts and the like. Enter the balance and what you put in; update the balance whenever you check it." : "Copy the quantity and average price from your broker app."}
          </p>
        )}
        {brokers.isLoading ? (
          <Field label={isFund ? "Held with" : "Broker"}>{(id) => <Input id={id} disabled placeholder="Loading…" />}</Field>
        ) : noBrokers ? (
          <Field label={isFund ? "Held with" : "Broker"} error={fe("name")}>
            {(id) => <Input id={id} value={v.new_broker} onChange={set("new_broker")} placeholder={isFund ? "e.g. KWSP, ASNB, Public Mutual" : "e.g. Rakuten Trade"} />}
          </Field>
        ) : (
          <Field label={isFund ? "Held with" : "Broker"} error={fe("broker_id") || fe("name")}>
            {(id) => (
              <Select id={id} value={v.broker_id} onChange={set("broker_id")}>
                <option value="">Select…</option>
                {brokerList.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
                <option value="__new">＋ New…</option>
              </Select>
            )}
          </Field>
        )}
        {v.broker_id === "__new" && <Input aria-label="New broker name" value={v.new_broker} onChange={set("new_broker")} placeholder={isFund ? "e.g. KWSP" : "Broker name"} />}
        {!existing && (
          <Field
            label={isFund ? "Fund name" : "Stock symbol"}
            error={fe("symbol") || fe("currency")}
            hint={isFund ? "A short name you'll recognise, e.g. EPF, ASB, Public Ittikal" : "Bursa 1155.KL · US MSFT · SGX D05.SI · HK 0005.HK · Tokyo 7203.T · ASX BHP.AX"}
          >
            {(id) => (
              <>
                <Input id={id} list="known-symbols" value={v.symbol} onChange={set("symbol")} placeholder={isFund ? "e.g. EPF" : "e.g. 1155.KL"} autoCapitalize="characters" autoCorrect="off" />
                <datalist id="known-symbols">
                  {(instruments.data ?? [])
                    .filter((i) => (i.kind === "fund") === isFund)
                    .map((i) => (
                      <option key={i.id} value={i.symbol}>
                        {i.name ?? ""}
                      </option>
                    ))}
                </datalist>
              </>
            )}
          </Field>
        )}
        {isFund ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Balance or units`} error={fe("quantity")} hint="EPF/ASB: your balance">
              {(id) => <Input id={id} inputMode="decimal" value={v.quantity} onChange={set("quantity")} placeholder="0" />}
            </Field>
            <Field label={`Amount you put in${ccy ? ` (${ccy})` : ""}`} error={fe("total_cost") || fe("avg_cost")} hint="Total, not per unit">
              {(id) => <Input id={id} inputMode="decimal" value={v.total_cost} onChange={set("total_cost")} placeholder="0.00" />}
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity" error={fe("quantity")}>
              {(id) => <Input id={id} inputMode="decimal" value={v.quantity} onChange={set("quantity")} placeholder="0" />}
            </Field>
            <Field label={`Average cost${ccy ? ` (${ccy})` : ""}`} error={fe("avg_cost")}>
              {(id) => <Input id={id} inputMode="decimal" value={v.avg_cost} onChange={set("avg_cost")} placeholder="per share" />}
            </Field>
          </div>
        )}
        {isNewStock && isFund && (
          <Field label="Price per unit (NAV)" error={fe("price")} hint="EPF and ASB stay at 1.00. For unit trusts, the latest NAV.">
            {(id) => <Input id={id} inputMode="decimal" value={v.price} onChange={set("price")} />}
          </Field>
        )}
        {isNewStock && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency">
              {(id) => (
                <Select id={id} value={v.currency} onChange={set("currency")}>
                  <option value="">{isFund ? "MYR" : `${guessCcy(v.symbol)} (from symbol)`}</option>
                  {CURRENCY_LIST.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Category">
              {(id) => (
                <Select id={id} value={v.category_id} onChange={set("category_id")}>
                  <option value="">Uncategorised</option>
                  {(categories.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}
        <button type="submit" hidden />
      </form>
      <ConfirmSheet
        open={confirm}
        title="Remove holding?"
        message={`Removes ${existing?.symbol} at ${existing?.broker}. Dividends you recorded stay in your history.`}
        confirmLabel="Remove"
        onConfirm={() => run(() => api(`/holdings/${existing!.id}`, { method: "DELETE" }), "Holding removed")}
        onClose={() => setConfirm(false)}
      />
    </Sheet>
  );
}

/* ================================================================ Stock settings */
export function StockSheet({ instrumentId, onClose }: { instrumentId: number; onClose: () => void }) {
  const instruments = useInstruments();
  const inst = instruments.data?.find((i) => i.id === instrumentId);
  if (!inst)
    return (
      <Sheet open onClose={onClose} title="Stock">
        <Spinner />
      </Sheet>
    );
  return <StockEditor inst={inst} onClose={onClose} />;
}

function StockEditor({ inst, onClose }: { inst: Instrument; onClose: () => void }) {
  const categories = useCategories();
  const openSheet = useOpenSheet();
  const { busy, run, fe, general } = useSubmit(onClose);
  const [v, setV] = useState({
    name: inst.name ?? "",
    category_id: inst.category_id ? String(inst.category_id) : "",
    kind: inst.kind,
    price_mode: inst.price_mode,
    annual_dividend_per_share: inst.annual_dividend_per_share ?? "",
    withholding: rateToPct(inst.withholding_tax_rate),
    provider_symbol: inst.provider_symbol ?? "",
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = () =>
    run(
      () =>
        api(`/instruments/${inst.id}`, {
          method: "PUT",
          body: {
            name: v.name,
            kind: v.kind,
            price_mode: v.price_mode,
            provider_symbol: v.provider_symbol,
            annual_dividend_per_share: v.annual_dividend_per_share,
            category_id: v.category_id ? Number(v.category_id) : null,
            withholding_tax_rate: pctToRate(v.withholding) ?? "0",
          },
        }),
      `${inst.symbol} updated`,
    );
  return (
    <Sheet open onClose={onClose} title={`${inst.symbol} settings`} footer={<Footer onClose={onClose} onSave={save} busy={busy} />}>
      <div className="space-y-3">
        <FormError error={general} />
        <Field label="Name">{(id) => <Input id={id} value={v.name} onChange={set("name")} placeholder="Optional" />}</Field>
        <Field label="Category">
          {(id) => (
            <Select id={id} value={v.category_id} onChange={set("category_id")}>
              <option value="">Uncategorised</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            {(id) => (
              <Select id={id} value={v.kind} onChange={set("kind")}>
                <option value="stock">Stock</option>
                <option value="etf">ETF</option>
                <option value="reit">REIT</option>
                <option value="fund">Fund</option>
                <option value="other">Other</option>
              </Select>
            )}
          </Field>
          <Field label="Price">
            {(id) => (
              <Select id={id} value={v.price_mode} onChange={set("price_mode")}>
                <option value="auto">Automatic</option>
                <option value="manual">I enter it</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Yearly dividend / share (${inst.currency})`} error={fe("annual_dividend_per_share")} hint="Blank = last 12 months">
            {(id) => <Input id={id} inputMode="decimal" value={v.annual_dividend_per_share} onChange={set("annual_dividend_per_share")} placeholder="e.g. 0.60" />}
          </Field>
          <Field label="Dividend tax withheld (%)" error={fe("withholding_tax_rate")} hint="US stocks: 30 for Malaysians">
            {(id) => <Input id={id} inputMode="decimal" value={v.withholding} onChange={set("withholding")} placeholder="0" />}
          </Field>
        </div>
        <Field label="Symbol at price source" hint="Only if different, e.g. for Yahoo">
          {(id) => <Input id={id} value={v.provider_symbol} onChange={set("provider_symbol")} />}
        </Field>
        <Button variant="secondary" onClick={() => openSheet({ kind: "price", instrumentId: inst.id })}>
          Enter a price
        </Button>
      </div>
    </Sheet>
  );
}

/* ================================================================ Manual price */
export function PriceSheet({ instrumentId, onClose }: { instrumentId: number; onClose: () => void }) {
  const instruments = useInstruments();
  const inst = instruments.data?.find((i) => i.id === instrumentId);
  const invalidate = useInvalidateAll();
  const toast = useToast();
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(today());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useQuery({
    queryKey: ["prices", instrumentId],
    queryFn: () => api<{ id: number; price_date: string; price: string; source: string }[]>(`/prices/${instrumentId}`),
  });
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/prices", { body: { instrument_id: instrumentId, price, date } });
      invalidate();
      toast(`${inst?.symbol ?? ""} price saved`);
      setPrice("");
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
      title={`${inst?.symbol ?? ""} price`}
      footer={
        <Button className="flex-1" onClick={() => submit()} loading={busy} disabled={!price}>
          Save price
        </Button>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <FormError error={err} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Price${inst ? ` (${inst.currency})` : ""}`}>{(id) => <Input id={id} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />}</Field>
          <Field label="Date">{(id) => <Input id={id} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        <p className="text-2xs text-faint">For funds like ASNB, or stocks no price source covers.</p>
      </form>
      <ul className="mt-4 divide-y divide-white/5 text-xs">
        {(history.data ?? []).slice(0, 8).map((p) => (
          <li key={p.id} className="flex justify-between py-1.5 text-muted">
            <span>{p.price_date}</span>
            <span className="tabular text-slate-200">{priceStr(p.price, inst?.currency ?? "")}</span>
            <span>{p.source === "manual" ? "you" : p.source}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/* ================================================================ Category & broker */
export function CategorySheet({ category, onClose }: { category?: Category; onClose: () => void }) {
  const [name, setName] = useState(category?.name ?? "");
  const [showDiv, setShowDiv] = useState(category?.show_dividends ?? false);
  const [confirm, setConfirm] = useState(false);
  const { busy, run, fe, general } = useSubmit(onClose);
  const save = () =>
    run(
      () => (category ? api(`/categories/${category.id}`, { method: "PUT", body: { name, show_dividends: showDiv } }) : api("/categories", { body: { name, show_dividends: showDiv } })),
      category ? "Category updated" : `${name.trim()} added`,
    );
  return (
    <Sheet open onClose={onClose} title={category ? "Edit category" : "New category"} footer={<Footer onClose={onClose} onSave={save} busy={busy} onDelete={category ? () => setConfirm(true) : undefined} />}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <FormError error={general} />
        <Field label="Name" error={fe("name")}>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Blue chips" />}
        </Field>
        <Toggle checked={showDiv} onChange={setShowDiv} label="Show dividend columns" description="Shows gain and dividends side by side, plus the expected yearly dividend for this group." />
        <button type="submit" hidden />
      </form>
      <ConfirmSheet
        open={confirm}
        title="Delete category?"
        message="Its stocks move to Uncategorised. No holdings are removed."
        onConfirm={() => run(() => api(`/categories/${category!.id}`, { method: "DELETE" }), "Category deleted")}
        onClose={() => setConfirm(false)}
      />
    </Sheet>
  );
}

export function BrokerSheet({ broker, onClose }: { broker?: Broker; onClose: () => void }) {
  const [name, setName] = useState(broker?.name ?? "");
  const [notes, setNotes] = useState(broker?.notes ?? "");
  const [confirm, setConfirm] = useState(false);
  const { busy, run, fe, general } = useSubmit(onClose);
  const save = () => run(() => (broker ? api(`/brokers/${broker.id}`, { method: "PUT", body: { name, notes } }) : api("/brokers", { body: { name, notes } })), broker ? "Broker updated" : `${name.trim()} added`);
  return (
    <Sheet open onClose={onClose} title={broker ? "Edit broker" : "New broker"} footer={<Footer onClose={onClose} onSave={save} busy={busy} onDelete={broker ? () => setConfirm(true) : undefined} />}>
      <div className="space-y-3">
        <FormError error={general} />
        <Field label="Name" error={fe("name")}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Moomoo" />}</Field>
        <Field label="Notes">{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. for US stocks" />}</Field>
      </div>
      <ConfirmSheet open={confirm} title="Delete broker?" message="Only brokers without holdings can be deleted." onConfirm={() => run(() => api(`/brokers/${broker!.id}`, { method: "DELETE" }), "Broker deleted")} onClose={() => setConfirm(false)} />
    </Sheet>
  );
}

/* ================================================================ Import */
const IMPORT_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "symbol", label: "Symbol", required: true },
  { key: "quantity", label: "Quantity", required: true },
  { key: "avg_cost", label: "Average cost", required: true },
  { key: "name", label: "Name" },
  { key: "currency", label: "Currency" },
  { key: "category", label: "Category" },
  { key: "broker", label: "Broker" },
  { key: "kind", label: "Type" },
];

type StatementRow = { symbol: string; name: string | null; quantity: string; avg_cost: string | null; currency: string | null; kind: string };
const csvCell = (v: string | null) => (v == null ? "" : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function statementCsv(rows: StatementRow[]) {
  const cols = ["symbol", "name", "quantity", "avg_cost", "currency", "kind"] as const;
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
}

interface ImportPreview {
  header: string[];
  mapping: Record<string, number | null>;
  rows: { line: number; symbol: string; status: string; message: string | null; broker?: string; quantity?: string }[];
  summary: { rows: number; new: number; updated: number; unchanged: number; skipped: number; errors: number; removed: { broker: string; symbol: string; quantity: string }[]; created: { instruments: string[]; brokers: string[]; categories: string[] } };
  can_import: boolean;
}

export function ImportSheet({ onClose }: { onClose: () => void }) {
  const brokers = useBrokers();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [file, setFile] = useState<File | null>(null);
  const [brokerId, setBrokerId] = useState("");
  const [replace, setReplace] = useState(true);
  const [mapping, setMapping] = useState<Record<string, number | null> | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const meta = useMeta();
  const canReadPdf = (meta.data?.ai_providers ?? []).length > 0;

  const readStatement = async (pdf: File) => {
    const form = new FormData();
    form.append("file", pdf);
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ rows: StatementRow[]; provider: string; statement_date: string | null }>("/ai/statement", { form });
      if (!r.rows.length) throw new Error("No holdings found in this PDF. Try your broker's Excel or CSV export instead.");
      const csv = new File([statementCsv(r.rows)], pdf.name.replace(/\.pdf$/i, "") + ".csv", { type: "text/csv" });
      setFile(csv);
      setAiNote(`Read ${r.rows.length} holding${r.rows.length === 1 ? "" : "s"} from the PDF${r.statement_date ? ` (statement date ${r.statement_date})` : ""}. AI can misread numbers: check every row below before importing.`);
      setBusy(false);
      await run("preview", { file: csv, mapping: null });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const run = async (mode: "preview" | "commit", o: { file?: File; brokerId?: string; replace?: boolean; mapping?: Record<string, number | null> | null } = {}) => {
    const f = o.file ?? file;
    if (!f) return;
    const b = o.brokerId ?? brokerId;
    const m = "mapping" in o ? o.mapping : mapping;
    const form = new FormData();
    form.append("file", f);
    if (b && b !== "__column") form.append("broker_id", b);
    form.append("replace", String(o.replace ?? replace));
    if (m) form.append("mapping", JSON.stringify(m));
    setBusy(true);
    setErr(null);
    try {
      const r = await api<ImportPreview>(`/import/${mode}`, { form });
      if (mode === "commit") {
        invalidate();
        const s = r.summary;
        toast(`Imported: ${s.new} new, ${s.updated} updated${s.removed.length ? `, ${s.removed.length} removed` : ""}`);
        onClose();
      } else {
        setPreview(r);
        setMapping(r.mapping);
      }
    } catch (e) {
      setErr((e as Error).message);
      if (mode === "preview") setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  const s = preview?.summary;
  const brokerName = brokers.data?.find((b) => String(b.id) === brokerId)?.name;

  return (
    <Sheet
      open
      onClose={onClose}
      title="Upload holdings"
      wide
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={!preview?.can_import} loading={busy} onClick={() => run("commit")}>
            Import
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Export holdings from your broker as Excel (.xlsx) or CSV. Each row needs a symbol, quantity and average cost.
          {canReadPdf && " You can also upload a PDF statement: AI reads the holdings and you check them before anything is saved."}
        </p>
        <Field label="Broker">
          {(id) => (
            <Select
              id={id}
              value={brokerId}
              onChange={(e) => {
                setBrokerId(e.target.value);
                run("preview", { brokerId: e.target.value });
              }}
            >
              <option value="">Select…</option>
              {(brokers.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              <option value="__column">Named in a column of the file</option>
            </Select>
          )}
        </Field>
        <input
          type="file"
          accept={`.xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet${canReadPdf ? ",.pdf,application/pdf" : ""}`}
          aria-label="Holdings file"
          className="block w-full text-sm text-muted file:mr-3 file:rounded-xl file:border-0 file:bg-ink-700 file:px-3 file:py-2 file:font-semibold file:text-slate-100"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setMapping(null);
            setPreview(null);
            setAiNote(null);
            if (f && f.name.toLowerCase().endsWith(".pdf")) return void readStatement(f);
            setFile(f);
            if (f) run("preview", { file: f, mapping: null });
          }}
        />
        <Toggle
          checked={replace}
          onChange={(v) => {
            setReplace(v);
            run("preview", { replace: v });
          }}
          label="This file is my full list for this broker"
          description="Stocks not in the file are removed from this broker. Turn off to only add or update."
        />
        {busy && !preview && <p className="text-xs text-muted">Reading…</p>}
        {aiNote && <p className="rounded-xl bg-gold/10 p-3 text-xs text-gold">{aiNote}</p>}
        <FormError error={err} />
        {preview && s && (
          <>
            <details className="rounded-xl bg-ink-900 p-3 text-xs">
              <summary className="cursor-pointer text-muted">Columns used</summary>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {IMPORT_FIELDS.map((f) => (
                  <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
                    {(id) => (
                      <Select
                        id={id}
                        value={mapping?.[f.key] ?? ""}
                        onChange={(e) => {
                          const m = { ...(mapping ?? {}), [f.key]: e.target.value === "" ? null : Number(e.target.value) };
                          setMapping(m);
                          run("preview", { mapping: m });
                        }}
                      >
                        <option value="">—</option>
                        {preview.header.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `Column ${i + 1}`}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ))}
              </div>
            </details>
            <div className="rounded-xl bg-ink-900 p-3 text-xs">
              <p>
                <span className="text-up">{s.new} new</span> · {s.updated} updated · {s.unchanged} unchanged
                {s.errors > 0 && <span className="text-down"> · {s.errors} with errors</span>}
              </p>
              {s.removed.length > 0 && (
                <p className="mt-1 text-amber-200">
                  Will remove from {brokerName ?? "this broker"}: {s.removed.map((r) => r.symbol).join(", ")}
                </p>
              )}
              {s.created.brokers.length + s.created.categories.length > 0 && (
                <p className="mt-1 text-muted">Will add {[...s.created.brokers.map((b) => `broker ${b}`), ...s.created.categories.map((c) => `category ${c}`)].join(", ")}</p>
              )}
            </div>
            <ul className="max-h-64 divide-y divide-white/5 overflow-y-auto rounded-xl bg-ink-900 text-xs">
              {preview.rows.map((r) => (
                <li key={r.line} className="flex gap-3 px-3 py-2">
                  <span className="w-20 shrink-0 font-semibold text-white">{r.symbol || `Line ${r.line}`}</span>
                  <span className={cn("w-20 shrink-0", r.status === "error" ? "text-down" : r.status === "new" ? "text-up" : "text-muted")}>{r.status}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{r.message ?? (r.quantity ? `${Number(r.quantity).toLocaleString()} at ${r.broker}` : "")}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  );
}

/* ================================================================ Dividends & earnings */
function StockSelect({ value, onChange, id, disabled }: { value: string; onChange: (v: string) => void; id: string; disabled?: boolean }) {
  const instruments = useInstruments();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">Select…</option>
      {(instruments.data ?? []).map((i) => (
        <option key={i.id} value={i.id}>
          {i.symbol}
        </option>
      ))}
    </Select>
  );
}

export function DividendSheet({ event, instrumentId, onClose }: { event?: DividendEvent; instrumentId?: number; onClose: () => void }) {
  const instruments = useInstruments();
  const [v, setV] = useState({
    instrument_id: String(event?.instrument_id ?? instrumentId ?? ""),
    ex_date: event?.ex_date ?? "",
    pay_date: event?.pay_date ?? "",
    amount_per_share: event?.amount_per_share ?? "",
    status: event?.status ?? "announced",
    withholding: event?.withholding_tax_rate ? rateToPct(event.withholding_tax_rate) : "",
  });
  const [confirm, setConfirm] = useState(false);
  const { busy, run, fe, general } = useSubmit(onClose);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const inst = instruments.data?.find((i) => String(i.id) === v.instrument_id);
  const save = () =>
    run(() => {
      const body = { instrument_id: Number(v.instrument_id), ex_date: v.ex_date, pay_date: v.pay_date || null, amount_per_share: v.amount_per_share, status: v.status, withholding_tax_rate: pctToRate(v.withholding) };
      return event ? api(`/dividends/events/${event.id}`, { method: "PUT", body }) : api("/dividends/events", { body });
    }, event ? "Dividend updated" : "Dividend added");
  return (
    <Sheet open onClose={onClose} title={event ? `${event.symbol} dividend` : "Upcoming dividend"} footer={<Footer onClose={onClose} onSave={save} busy={busy} onDelete={event ? () => setConfirm(true) : undefined} />}>
      <div className="space-y-3">
        <FormError error={general} />
        <Field label="Stock" error={fe("instrument_id")}>
          {(id) => <StockSelect id={id} value={v.instrument_id} onChange={(x) => setV({ ...v, instrument_id: x })} disabled={!!event} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ex-date" error={fe("ex_date")}>{(id) => <Input id={id} type="date" value={v.ex_date} onChange={set("ex_date")} />}</Field>
          <Field label="Payment date" error={fe("pay_date")}>{(id) => <Input id={id} type="date" value={v.pay_date} onChange={set("pay_date")} />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Per share${inst ? ` (${inst.currency})` : ""}`} error={fe("amount_per_share")}>
            {(id) => <Input id={id} inputMode="decimal" value={v.amount_per_share} onChange={set("amount_per_share")} placeholder="0.00" />}
          </Field>
          <Field label="Status">
            {(id) => (
              <Select id={id} value={v.status} onChange={set("status")} disabled={v.status === "received"}>
                <option value="announced">Announced</option>
                <option value="forecast">My estimate</option>
                {v.status === "pending" && <option value="pending">Paid by company</option>}
                {v.status === "received" && <option value="received">Received</option>}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Tax withheld (%)" error={fe("withholding_tax_rate")} hint={`Blank = the stock's usual rate (${inst ? rateToPct(inst.withholding_tax_rate) || "0" : "0"}%)`}>
          {(id) => <Input id={id} inputMode="decimal" value={v.withholding} onChange={set("withholding")} />}
        </Field>
      </div>
      <ConfirmSheet open={confirm} title="Delete this dividend?" message="Any amount already marked as received stays in your history." onConfirm={() => run(() => api(`/dividends/events/${event!.id}`, { method: "DELETE" }), "Dividend deleted")} onClose={() => setConfirm(false)} />
    </Sheet>
  );
}

export function PaymentSheet({ event, payment, onClose }: { event?: DividendEvent; payment?: Payment; onClose: () => void }) {
  const brokers = useBrokers();
  const t = today();
  const [v, setV] = useState({
    instrument_id: String(event?.instrument_id ?? payment?.instrument_id ?? ""),
    gross: event ? Number(event.expected_gross).toFixed(2) : "",
    tax: event ? Number(event.expected_tax).toFixed(2) : "",
    pay_date: event?.pay_date && event.pay_date <= t ? event.pay_date : t,
    broker_id: "",
  });
  const [confirm, setConfirm] = useState(false);
  const { busy, run, fe, general } = useSubmit(onClose);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const net = useMemo(() => Number(v.gross || 0) - Number(v.tax || 0), [v.gross, v.tax]);
  const instruments = useInstruments();
  const ccy = event?.currency ?? payment?.currency ?? instruments.data?.find((i) => String(i.id) === v.instrument_id)?.currency ?? "MYR";
  const save = () =>
    run(() => {
      const body = { instrument_id: Number(v.instrument_id), gross: v.gross, tax: v.tax || "0", pay_date: v.pay_date, broker_id: v.broker_id ? Number(v.broker_id) : null };
      return event ? api(`/dividends/events/${event.id}/received`, { body }) : api("/dividends/payments", { body });
    }, "Dividend recorded");
  if (payment)
    return (
      <Sheet open onClose={onClose} title={`${payment.symbol} dividend`}>
        <p className="text-sm text-slate-200">
          {money(payment.net, payment.currency)} received on {payment.pay_date}
          {payment.broker ? ` at ${payment.broker}` : ""}.
        </p>
        <Button variant="danger" className="mt-4" onClick={() => setConfirm(true)}>
          <Trash2 className="h-4 w-4" /> Remove
        </Button>
        <ConfirmSheet open={confirm} title="Remove this dividend?" message="It will no longer count towards your returns." confirmLabel="Remove" onConfirm={() => run(() => api(`/dividends/payments/${payment.id}`, { method: "DELETE" }), "Dividend removed")} onClose={() => setConfirm(false)} />
      </Sheet>
    );
  return (
    <Sheet open onClose={onClose} title={event ? `Did ${event.symbol} pay?` : "Record a dividend"} footer={<Footer onClose={onClose} onSave={save} busy={busy} saveLabel="Received" />}>
      <div className="space-y-3">
        <FormError error={general} />
        {event ? (
          <p className="text-xs text-muted">Pre-filled with the expected amount for {Number(event.quantity).toLocaleString()} shares. Change it if your broker shows something different.</p>
        ) : (
          <Field label="Stock" error={fe("instrument_id")}>{(id) => <StockSelect id={id} value={v.instrument_id} onChange={(x) => setV({ ...v, instrument_id: x })} />}</Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Before tax (${ccy})`} error={fe("gross")}>{(id) => <Input id={id} inputMode="decimal" value={v.gross} onChange={set("gross")} placeholder="0.00" />}</Field>
          <Field label="Tax withheld" error={fe("tax")}>{(id) => <Input id={id} inputMode="decimal" value={v.tax} onChange={set("tax")} placeholder="0.00" />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid on" error={fe("pay_date")}>{(id) => <Input id={id} type="date" max={t} value={v.pay_date} onChange={set("pay_date")} />}</Field>
          <Field label="Broker (optional)">
            {(id) => (
              <Select id={id} value={v.broker_id} onChange={set("broker_id")}>
                <option value="">—</option>
                {(brokers.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <p className="text-sm text-slate-200">
          You received <span className="tabular font-semibold text-up">{money(net, ccy)}</span>
        </p>
      </div>
    </Sheet>
  );
}

export function EarningsSheet({ instrumentId, onClose }: { instrumentId?: number; onClose: () => void }) {
  const [v, setV] = useState({ instrument_id: String(instrumentId ?? ""), date: "", session: "" });
  const { busy, run, fe, general } = useSubmit(onClose);
  const save = () => run(() => api("/earnings", { body: { instrument_id: Number(v.instrument_id), date: v.date, session: v.session || null } }), "Earnings date added");
  return (
    <Sheet open onClose={onClose} title="Earnings date" footer={<Footer onClose={onClose} onSave={save} busy={busy} />}>
      <div className="space-y-3">
        <FormError error={general} />
        <Field label="Stock" error={fe("instrument_id")}>{(id) => <StockSelect id={id} value={v.instrument_id} onChange={(x) => setV({ ...v, instrument_id: x })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" error={fe("date")}>{(id) => <Input id={id} type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />}</Field>
          <Field label="When">
            {(id) => (
              <Select id={id} value={v.session} onChange={(e) => setV({ ...v, session: e.target.value })}>
                <option value="">Not sure</option>
                <option value="before">Before market opens</option>
                <option value="after">After market closes</option>
              </Select>
            )}
          </Field>
        </div>
      </div>
    </Sheet>
  );
}
