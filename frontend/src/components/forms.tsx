import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { cn, dateTime, money, priceStr, today } from "../lib/format";
import { useAccounts, useInstruments, useInvalidateAll, useOpenSheet, useSettings } from "../lib/hooks";
import type { Account, AuditEntry, Instrument, Txn, TxnType } from "../lib/types";
import { Button, ConfirmSheet, Field, Input, Segmented, Select, Sheet, Spinner, Textarea, Toggle, useToast } from "./ui";

const CURRENCIES = ["MYR", "USD", "SGD", "GBP", "HKD"];

function useFormState<T extends Record<string, unknown>>(initial: T) {
  const [v, setV] = useState<T>(initial);
  const set = <K extends keyof T>(k: K) => (e: { target: { value: string } } | string) =>
    setV((x) => ({ ...x, [k]: typeof e === "string" ? e : e.target.value }));
  return [v, setV, set] as const;
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl border border-down/30 bg-down/10 px-3 py-2 text-sm text-red-200">
      {error}
    </p>
  );
}

/* ================================================================ Account */
export function AccountSheet({ account, onClose }: { account?: Account; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [v, , set] = useFormState({
    name: account?.name ?? "",
    layout: account?.layout ?? "growth",
    currency: account?.currency ?? "MYR",
    broker: account?.broker ?? "",
    sort_order: String(account?.sort_order ?? 0),
    notes: account?.notes ?? "",
  });
  const [trackCash, setTrackCash] = useState(account?.track_cash ?? false);
  const [archived, setArchived] = useState(account?.archived ?? false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = { ...v, sort_order: Number(v.sort_order) || 0, track_cash: trackCash, archived };
      if (account) await api(`/accounts/${account.id}`, { method: "PUT", body });
      else await api("/accounts", { body });
      invalidate();
      toast(account ? "Account updated" : "Account created");
      onClose();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    try {
      await api(`/accounts/${account!.id}`, { method: "DELETE" });
      invalidate();
      toast("Account deleted");
      onClose();
    } catch (e) {
      setConfirm(false);
      setErr(e as ApiError);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={account ? "Edit account" : "New account"}
      footer={
        <>
          {account && (
            <Button variant="danger" onClick={() => setConfirm(true)} aria-label="Delete account">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
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
        <FormError error={err && !err.field ? err.message : null} />
        <Field label="Name" error={err?.field === "name" ? err.message : null}>
          {(id) => <Input id={id} value={v.name} onChange={set("name")} placeholder="e.g. Dividend Acc" autoFocus required />}
        </Field>
        <Field label="Card layout" hint="Dividend layout shows capital gain / dividends and estimated annual income.">
          {() => (
            <Segmented
              label="Card layout"
              value={v.layout}
              onChange={set("layout")}
              options={[
                { value: "dividend", label: "Dividend" },
                { value: "growth", label: "Growth" },
              ]}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cash currency">
            {(id) => (
              <Select id={id} value={v.currency} onChange={set("currency")}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Sort order">{(id) => <Input id={id} inputMode="numeric" value={v.sort_order} onChange={set("sort_order")} />}</Field>
        </div>
        <Field label="Broker (optional)">{(id) => <Input id={id} value={v.broker} onChange={set("broker")} />}</Field>
        <Toggle checked={trackCash} onChange={setTrackCash} label="Track cash balance" description="Include cash (deposits, sales, dividends minus buys) in account value. Turn on only if you record deposits and withdrawals." />
        {account && <Toggle checked={archived} onChange={setArchived} label="Archived" description="Hide this account from the dashboard. Its history is kept." />}
        <Field label="Notes">{(id) => <Textarea id={id} value={v.notes} onChange={set("notes")} />}</Field>
      </form>
      <ConfirmSheet open={confirm} title="Delete account?" message="This permanently removes the account. Accounts with transactions cannot be deleted; archive them instead." onConfirm={remove} onClose={() => setConfirm(false)} />
    </Sheet>
  );
}

/* ================================================================ Instrument */
function InstrumentFields({ v, set, err, editing }: { v: Record<string, string>; set: (k: string) => (e: { target: { value: string } } | string) => void; err: ApiError | null; editing?: boolean }) {
  const fe = (f: string) => (err?.field === f ? err.message : null);
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Symbol" error={fe("symbol")} hint="Bursa: 1155.KL · SGX: D05.SI · HK: 0005.HK · LSE: VOD.L">
          {(id) => <Input id={id} value={v.symbol} onChange={set("symbol")} placeholder="MSFT" autoCapitalize="characters" required />}
        </Field>
        <Field label="Currency" error={fe("currency")} hint={editing ? undefined : "Blank = guess from suffix"}>
          {(id) => (
            <Select id={id} value={v.currency} onChange={set("currency")}>
              <option value="">Auto</option>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Name (optional)">{(id) => <Input id={id} value={v.name} onChange={set("name")} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" error={fe("kind")}>
          {(id) => (
            <Select id={id} value={v.kind} onChange={set("kind")}>
              <option value="stock">Stock</option>
              <option value="etf">ETF</option>
              <option value="reit">REIT</option>
              <option value="fund">Fund (NAV)</option>
              <option value="other">Other</option>
            </Select>
          )}
        </Field>
        <Field label="Pricing" hint="Manual = you enter prices/NAV">
          {(id) => (
            <Select id={id} value={v.price_mode} onChange={set("price_mode")}>
              <option value="auto">Provider</option>
              <option value="manual">Manual</option>
            </Select>
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Forward annual DPS" error={fe("annual_dividend_per_share")} hint="Your estimate. Blank = use trailing 12m">
          {(id) => <Input id={id} inputMode="decimal" value={v.annual_dividend_per_share} onChange={set("annual_dividend_per_share")} placeholder="e.g. 0.60" />}
        </Field>
        <Field label="Withholding tax rate" error={fe("withholding_tax_rate")} hint="0.30 = 30% (US for MY residents)">
          {(id) => <Input id={id} inputMode="decimal" value={v.withholding_tax_rate} onChange={set("withholding_tax_rate")} placeholder="0" />}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Payments per year">{(id) => <Input id={id} inputMode="numeric" value={v.dividend_frequency} onChange={set("dividend_frequency")} placeholder="e.g. 4" />}</Field>
        <Field label="Provider symbol" hint="If different from symbol">
          {(id) => <Input id={id} value={v.provider_symbol} onChange={set("provider_symbol")} />}
        </Field>
      </div>
    </>
  );
}

const emptyInstrument = (i?: Instrument) => ({
  symbol: i?.symbol ?? "",
  currency: i?.currency ?? "",
  name: i?.name ?? "",
  kind: i?.kind ?? "stock",
  price_mode: i?.price_mode ?? "auto",
  annual_dividend_per_share: i?.annual_dividend_per_share ?? "",
  withholding_tax_rate: i?.withholding_tax_rate ?? "0",
  dividend_frequency: i?.dividend_frequency ? String(i.dividend_frequency) : "",
  provider_symbol: i?.provider_symbol ?? "",
});

export function InstrumentSheet({ instrument, onClose, onSaved }: { instrument?: Instrument; onClose: () => void; onSaved?: (i: Instrument) => void }) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [v, , set] = useFormState<Record<string, string>>(emptyInstrument(instrument));
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = { ...v, currency: v.currency || null };
      const saved = instrument ? await api<Instrument>(`/instruments/${instrument.id}`, { method: "PUT", body }) : await api<Instrument>("/instruments", { body });
      invalidate();
      toast(instrument ? "Instrument updated" : `${saved.symbol} added`);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    try {
      await api(`/instruments/${instrument!.id}`, { method: "DELETE" });
      invalidate();
      toast("Instrument deleted");
      onClose();
    } catch (e) {
      setConfirm(false);
      setErr(e as ApiError);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={instrument ? `Edit ${instrument.symbol}` : "New instrument"}
      footer={
        <>
          {instrument && (
            <Button variant="danger" onClick={() => setConfirm(true)} aria-label="Delete instrument">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
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
        <FormError error={err && !err.field ? err.message : null} />
        <InstrumentFields v={v} set={set} err={err} editing={!!instrument} />
      </form>
      <ConfirmSheet open={confirm} title="Delete instrument?" message="Only instruments without transactions can be deleted. Price history is removed too." onConfirm={remove} onClose={() => setConfirm(false)} />
    </Sheet>
  );
}

/* ================================================================ Transaction */
const TYPE_LABELS: Record<TxnType, string> = {
  BUY: "Buy",
  SELL: "Sell",
  DIVIDEND: "Dividend",
  DRIP: "Dividend reinvest",
  DEPOSIT: "Deposit",
  WITHDRAWAL: "Withdrawal",
  FEE: "Fee",
  TAX: "Tax",
  SPLIT: "Stock split",
  TRANSFER: "Transfer",
};
export const typeLabel = (t: string) => TYPE_LABELS[t as TxnType] ?? t;

type TxnForm = Record<string, string>;
const blankTxn = (preset: Record<string, unknown> = {}): TxnForm => ({
  type: "BUY",
  trade_date: today(),
  account_id: "",
  to_account_id: "",
  instrument_id: "",
  quantity: "",
  price: "",
  amount: "",
  fees: "",
  tax: "",
  currency: "",
  fx_rate: "",
  fx_currency: "",
  split_ratio: "",
  note: "",
  transfer_kind: "securities",
  ...Object.fromEntries(Object.entries(preset).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)])),
});

export function TransactionSheet({ txnId, preset, onClose }: { txnId?: number; preset?: Record<string, unknown>; onClose: () => void }) {
  const existing = useQuery({
    queryKey: ["txn", txnId],
    queryFn: () => api<Txn & { history: AuditEntry[] }>(`/transactions/${txnId}`),
    enabled: !!txnId,
  });
  if (txnId && existing.isLoading)
    return (
      <Sheet open onClose={onClose} title="Transaction">
        <Spinner />
      </Sheet>
    );
  if (txnId && existing.error)
    return (
      <Sheet open onClose={onClose} title="Transaction">
        <FormError error={(existing.error as Error).message} />
      </Sheet>
    );
  const t = existing.data;
  const init = t ? blankTxn({ ...t, fees: Number(t.fees) ? t.fees : "", tax: Number(t.tax) ? t.tax : "", transfer_kind: t.type === "TRANSFER" && !t.instrument_id ? "cash" : "securities" }) : blankTxn(preset);
  return <TransactionEditor key={txnId ?? "new"} init={init} txn={t} onClose={onClose} />;
}

function TransactionEditor({ init, txn, onClose }: { init: TxnForm; txn?: Txn & { history: AuditEntry[] }; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const instruments = useInstruments();
  const settings = useSettings();
  const baseCcy = settings.data?.base_currency ?? "MYR";
  const openSheet = useOpenSheet();
  const [v, setV, set] = useFormState<TxnForm>(init);
  const [err, setErr] = useState<ApiError | null>(null);
  const [dup, setDup] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newInst, setNewInst] = useState(false);
  const [ni, , setNi] = useFormState<Record<string, string>>(emptyInstrument());

  const acctList = (accounts.data ?? []).filter((a) => !a.archived || String(a.id) === v.account_id);
  useEffect(() => {
    if (!v.account_id && acctList.length === 1 && v.type !== "SPLIT") setV((x) => ({ ...x, account_id: String(acctList[0].id) }));
  }, [acctList, v.account_id, v.type, setV]);

  const t = v.type as TxnType;
  const inst = instruments.data?.find((i) => String(i.id) === v.instrument_id);
  const acct = accounts.data?.find((a) => String(a.id) === v.account_id);
  const usesInstrument = ["BUY", "SELL", "DIVIDEND", "DRIP", "SPLIT"].includes(t) || (t === "TRANSFER" && v.transfer_kind === "securities") || ((t === "FEE" || t === "TAX") && v.instrument_id !== "");
  const tradeCcy = inst?.currency;
  const cashCcy = ["BUY", "SELL", "DRIP"].includes(t) ? tradeCcy : v.currency || tradeCcy || acct?.currency || "MYR";
  const fe = (f: string) => (err?.field === f ? err.message : null);

  const preview = useMemo(() => {
    const n = (x: string) => (x === "" ? 0 : Number(x));
    if (t === "BUY") return -(n(v.quantity) * n(v.price) + n(v.fees));
    if (t === "SELL") return n(v.quantity) * n(v.price) - n(v.fees);
    if (t === "DIVIDEND") return n(v.amount) - n(v.tax);
    if (t === "DRIP") return n(v.amount) - n(v.tax) - n(v.quantity) * n(v.price);
    if (t === "DEPOSIT") return n(v.amount);
    if (["WITHDRAWAL", "FEE", "TAX"].includes(t)) return -n(v.amount);
    return null;
  }, [t, v]);

  const submit = async (allowDuplicate = false) => {
    setBusy(true);
    setErr(null);
    try {
      let instrumentId = v.instrument_id;
      if (usesInstrument && newInst) {
        const created = await api<Instrument>("/instruments", { body: { ...ni, currency: ni.currency || null } });
        instrumentId = String(created.id);
        setNewInst(false);
        setV((x) => ({ ...x, instrument_id: instrumentId }));
      }
      const body: Record<string, unknown> = {
        type: t,
        trade_date: v.trade_date,
        account_id: v.account_id ? Number(v.account_id) : null,
        to_account_id: t === "TRANSFER" && v.to_account_id ? Number(v.to_account_id) : null,
        instrument_id: usesInstrument && instrumentId ? Number(instrumentId) : null,
        quantity: v.quantity || null,
        price: v.price || null,
        amount: v.amount || null,
        fees: v.fees || "0",
        tax: v.tax || "0",
        currency: v.currency || null,
        fx_rate: v.fx_rate || null,
        fx_currency: v.fx_rate ? v.fx_currency || baseCcy : null,
        split_ratio: v.split_ratio || null,
        note: v.note || null,
      };
      const q = allowDuplicate ? "?allow_duplicate=true" : "";
      if (txn) await api(`/transactions/${txn.id}${q}`, { method: "PUT", body });
      else await api(`/transactions${q}`, { body });
      invalidate();
      toast(txn ? "Transaction updated" : "Transaction saved");
      onClose();
    } catch (e) {
      const ae = e as ApiError;
      if (ae.status === 409 && ae.duplicateIds) setDup(ae.duplicateIds);
      else setErr(ae);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await api(`/transactions/${txn!.id}`, { method: "DELETE" });
      invalidate();
      toast("Transaction deleted");
      onClose();
    } catch (e) {
      setConfirmDelete(false);
      setErr(e as ApiError);
    }
  };

  const showFx = !!tradeCcy && tradeCcy !== baseCcy && ["BUY", "SELL", "DRIP"].includes(t);

  return (
    <Sheet
      open
      onClose={onClose}
      title={txn ? `Transaction #${txn.id}` : "New transaction"}
      footer={
        <>
          {txn && (
            <Button variant="danger" onClick={() => setConfirmDelete(true)} aria-label="Delete transaction">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => submit(false)} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <FormError error={err && !["quantity", "price", "amount", "trade_date", "split_ratio", "to_account_id", "fx_rate", "tax"].includes(err.field ?? "") ? err.message : null} />
        {dup && (
          <div role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            This looks identical to transaction #{dup.join(", #")}. Save anyway only if it really happened twice.
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" onClick={() => setDup(null)}>
                Cancel
              </Button>
              <Button onClick={() => submit(true)} loading={busy}>
                Save anyway
              </Button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            {(id) => (
              <Select id={id} value={v.type} onChange={set("type")} disabled={!!txn?.dividend_event_id}>
                {Object.entries(TYPE_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t === "DIVIDEND" || t === "DRIP" ? "Payment date" : t === "SPLIT" ? "Effective date" : "Trade date"} error={fe("trade_date")}>
            {(id) => <Input id={id} type="date" max={today()} value={v.trade_date} onChange={set("trade_date")} required />}
          </Field>
        </div>

        {t === "TRANSFER" && (
          <Segmented
            label="Transfer kind"
            value={v.transfer_kind}
            onChange={set("transfer_kind")}
            options={[
              { value: "securities", label: "Securities" },
              { value: "cash", label: "Cash" },
            ]}
          />
        )}

        <div className={cn("grid gap-3", t === "TRANSFER" ? "grid-cols-2" : "grid-cols-1")}>
          <Field label={t === "TRANSFER" ? "From account" : t === "SPLIT" ? "Account (blank = all accounts)" : "Account"} error={fe("account_id")}>
            {(id) => (
              <Select id={id} value={v.account_id} onChange={set("account_id")}>
                <option value="">{t === "SPLIT" ? "All accounts" : "Select…"}</option>
                {acctList.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {t === "TRANSFER" && (
            <Field label="To account" error={fe("to_account_id")}>
              {(id) => (
                <Select id={id} value={v.to_account_id} onChange={set("to_account_id")}>
                  <option value="">Select…</option>
                  {acctList
                    .filter((a) => String(a.id) !== v.account_id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        {(usesInstrument || t === "FEE" || t === "TAX") && (
          <Field label={t === "FEE" || t === "TAX" ? "Instrument (optional)" : "Instrument"} error={fe("instrument_id")}>
            {(id) => (
              <Select
                id={id}
                value={newInst ? "__new" : v.instrument_id}
                onChange={(e) => {
                  if (e.target.value === "__new") setNewInst(true);
                  else {
                    setNewInst(false);
                    set("instrument_id")(e);
                  }
                }}
              >
                <option value="">{t === "FEE" || t === "TAX" ? "None (account level)" : "Select…"}</option>
                {(instruments.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.symbol} · {i.currency}
                  </option>
                ))}
                <option value="__new">＋ New instrument…</option>
              </Select>
            )}
          </Field>
        )}
        {newInst && (
          <div className="space-y-3 rounded-2xl border border-white/10 bg-ink-900/60 p-3">
            <InstrumentFields v={ni} set={setNi} err={null} />
          </div>
        )}

        {["BUY", "SELL", "DRIP"].includes(t) && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t === "DRIP" ? "Shares reinvested" : "Quantity"} error={fe("quantity")}>
              {(id) => <Input id={id} inputMode="decimal" value={v.quantity} onChange={set("quantity")} placeholder="0" required />}
            </Field>
            <Field label={`Price${tradeCcy ? ` (${tradeCcy})` : ""}`} error={fe("price")}>
              {(id) => <Input id={id} inputMode="decimal" value={v.price} onChange={set("price")} placeholder="0.00" required />}
            </Field>
          </div>
        )}
        {t === "TRANSFER" && v.transfer_kind === "securities" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity" error={fe("quantity")}>
              {(id) => <Input id={id} inputMode="decimal" value={v.quantity} onChange={set("quantity")} />}
            </Field>
            <Field label="Transfer fee (optional)">{(id) => <Input id={id} inputMode="decimal" value={v.fees} onChange={set("fees")} />}</Field>
          </div>
        )}
        {(["DIVIDEND", "DRIP", "DEPOSIT", "WITHDRAWAL", "FEE", "TAX"].includes(t) || (t === "TRANSFER" && v.transfer_kind === "cash")) && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t === "DIVIDEND" || t === "DRIP" ? "Gross dividend" : "Amount"} error={fe("amount")} hint={t === "DRIP" ? "Blank = shares × price + tax" : undefined}>
              {(id) => <Input id={id} inputMode="decimal" value={v.amount} onChange={set("amount")} placeholder="0.00" />}
            </Field>
            {t !== "DRIP" ? (
              <Field label="Currency">
                {(id) => (
                  <Select id={id} value={v.currency} onChange={set("currency")}>
                    <option value="">Default ({cashCcy})</option>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <Field label="Withholding tax" error={fe("tax")}>
                {(id) => <Input id={id} inputMode="decimal" value={v.tax} onChange={set("tax")} placeholder="0.00" />}
              </Field>
            )}
          </div>
        )}
        {t === "DIVIDEND" && (
          <Field label="Withholding tax" error={fe("tax")} hint={inst && Number(inst.withholding_tax_rate) > 0 && v.amount ? `Default rate ${Number(inst.withholding_tax_rate) * 100}% → ${(Number(v.amount) * Number(inst.withholding_tax_rate)).toFixed(2)}` : "Enter the tax deducted, if any"}>
            {(id) => <Input id={id} inputMode="decimal" value={v.tax} onChange={set("tax")} placeholder="0.00" />}
          </Field>
        )}
        {["BUY", "SELL"].includes(t) && (
          <Field label="Fees & commission">{(id) => <Input id={id} inputMode="decimal" value={v.fees} onChange={set("fees")} placeholder="0.00" />}</Field>
        )}
        {t === "SPLIT" && (
          <Field label="Split ratio (new shares per old share)" error={fe("split_ratio")} hint="2 = 2-for-1 · 0.1 = 1-for-10 reverse split. Cost basis is unchanged.">
            {(id) => <Input id={id} inputMode="decimal" value={v.split_ratio} onChange={set("split_ratio")} placeholder="2" />}
          </Field>
        )}
        {showFx && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`FX rate (optional)`} error={fe("fx_rate")} hint={`1 ${tradeCcy} = ? ${v.fx_currency || baseCcy} on trade date`}>
              {(id) => <Input id={id} inputMode="decimal" value={v.fx_rate} onChange={set("fx_rate")} placeholder="e.g. 4.45" />}
            </Field>
            <Field label="FX into">
              {(id) => (
                <Select id={id} value={v.fx_currency || baseCcy} onChange={set("fx_currency")}>
                  {CURRENCIES.filter((c) => c !== tradeCcy).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}
        <Field label="Note">{(id) => <Input id={id} value={v.note} onChange={set("note")} placeholder="Optional" />}</Field>
        {preview !== null && cashCcy && (
          <p className="text-xs text-muted">
            Cash effect: <span className={cn("tabular font-semibold", preview >= 0 ? "text-up" : "text-down")}>{money(preview, cashCcy, { signed: true })}</span>
          </p>
        )}
        {inst && ["BUY", "SELL"].includes(t) && (
          <button type="button" className="text-xs text-blue-300 underline-offset-2 hover:underline" onClick={() => openSheet({ kind: "instrument", instrument: inst })}>
            Edit {inst.symbol} settings
          </button>
        )}
        {txn && (
          <div className="border-t border-white/5 pt-3 text-2xs text-faint">
            <p>
              Source: {txn.source}
              {txn.import_batch ? ` (batch ${txn.import_batch})` : ""}
              {txn.dividend_event_id ? ` · linked to dividend event #${txn.dividend_event_id}` : ""}
            </p>
            <p className="mt-1 font-semibold text-muted">Change history</p>
            <ul className="mt-1 space-y-0.5">
              {txn.history.map((h) => (
                <li key={h.id}>
                  {dateTime(h.ts)} · {h.action}
                  {h.note ? ` · ${h.note}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="submit" hidden />
      </form>
      <ConfirmSheet
        open={confirmDelete}
        title="Delete transaction?"
        message={
          <>
            This changes holdings and P/L. It is blocked if later transactions depend on it (for example a sale of these shares). The deleted record stays in the audit log.
          </>
        }
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </Sheet>
  );
}

/* ================================================================ Manual price */
export function PriceSheet({ instrumentId, onClose }: { instrumentId?: number; onClose: () => void }) {
  const instruments = useInstruments();
  const openSheet = useOpenSheet();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [instId, setInstId] = useState(instrumentId ? String(instrumentId) : "");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(today());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inst = instruments.data?.find((i) => String(i.id) === instId);
  const history = useQuery({
    queryKey: ["prices", instId],
    queryFn: () => api<{ id: number; price_date: string; price: string; source: string; quality: string; fetched_at: string }[]>(`/prices/${instId}`),
    enabled: !!instId,
  });
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/prices", { body: { instrument_id: Number(instId), price, date } });
      invalidate();
      toast(`${inst?.symbol} price saved (manual)`);
      setPrice("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const del = async (id: number) => {
    try {
      await api(`/prices/${id}`, { method: "DELETE" });
      invalidate();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Sheet open onClose={onClose} title="Manual price / NAV" footer={<Button className="flex-1" onClick={() => submit()} loading={busy} disabled={!instId || !price}>Save price</Button>}>
      <form onSubmit={submit} className="space-y-3">
        <FormError error={err} />
        <Field label="Instrument">
          {(id) => (
            <Select id={id} value={instId} onChange={(e) => setInstId(e.target.value)}>
              <option value="">Select…</option>
              {(instruments.data ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.symbol} · {i.currency} · {i.price_mode === "manual" ? "manual" : "provider"}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Price${inst ? ` (${inst.currency})` : ""}`}>{(id) => <Input id={id} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />}</Field>
          <Field label="Date">{(id) => <Input id={id} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        <p className="text-2xs text-faint">Manual prices are labelled “Manual”. For provider-priced instruments a manual price for the same day takes precedence until a newer quote arrives.</p>
        {inst && (
          <button type="button" className="text-xs text-blue-300 hover:underline" onClick={() => openSheet({ kind: "instrument", instrument: inst })}>
            Edit {inst.symbol} settings (pricing mode, dividend estimate, tax)
          </button>
        )}
      </form>
      {instId && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-semibold text-muted">Recent prices</p>
          {history.isLoading ? (
            <Spinner />
          ) : (history.data ?? []).length === 0 ? (
            <p className="text-xs text-faint">No prices stored yet.</p>
          ) : (
            <ul className="divide-y divide-white/5 text-xs">
              {history.data!.slice(0, 12).map((p) => (
                <li key={p.id} className="flex items-center justify-between py-1.5">
                  <span>{p.price_date}</span>
                  <span className="tabular">{priceStr(p.price, inst?.currency ?? "")}</span>
                  <span className="text-faint">{p.source}</span>
                  <button className="text-faint hover:text-down" aria-label={`Delete price ${p.price_date}`} onClick={() => del(p.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
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
