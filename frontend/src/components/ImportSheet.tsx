import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { cn } from "../lib/format";
import { useInvalidateAll } from "../lib/hooks";
import { Button, Field, Select, Sheet, Toggle, useToast } from "./ui";

const FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "type", label: "Type", required: true },
  { key: "account", label: "Account", required: true },
  { key: "symbol", label: "Symbol" },
  { key: "quantity", label: "Quantity" },
  { key: "price", label: "Price" },
  { key: "amount", label: "Amount" },
  { key: "fees", label: "Fees" },
  { key: "tax", label: "Withholding tax" },
  { key: "currency", label: "Currency" },
  { key: "to_account", label: "To account" },
  { key: "split_ratio", label: "Split ratio" },
  { key: "fx_rate", label: "FX rate" },
  { key: "fx_currency", label: "FX currency" },
  { key: "note", label: "Note" },
];

interface Preview {
  headers: string[];
  mapping: Record<string, string | null>;
  rows: { line: number; raw: Record<string, string>; errors: string[]; duplicate_of: number | string | null; status: "ok" | "duplicate" | "error" }[];
  summary: { rows: number; valid: number; duplicates: number; errors: number; ledger_error: string | null; will_create: { accounts: string[]; instruments: string[] }; imported?: number };
  can_import: boolean;
}

export function ImportSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null> | null>(null);
  const [dateFormat, setDateFormat] = useState("iso");
  const [createMissing, setCreateMissing] = useState(false);
  const [skipDup, setSkipDup] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (mode: "preview" | "commit", over: Partial<{ file: File; mapping: Record<string, string | null> | null; dateFormat: string; createMissing: boolean; skipDup: boolean }> = {}) => {
    const f = over.file ?? file;
    if (!f) return;
    const m = "mapping" in over ? over.mapping : mapping;
    const form = new FormData();
    form.append("file", f);
    if (m) form.append("mapping", JSON.stringify(m));
    form.append("date_format", over.dateFormat ?? dateFormat);
    form.append("create_missing", String(over.createMissing ?? createMissing));
    form.append("skip_duplicates", String(over.skipDup ?? skipDup));
    setBusy(true);
    setErr(null);
    try {
      const r = await api<Preview>(`/import/${mode}`, { form });
      if (mode === "commit") {
        invalidate();
        toast(`Imported ${r.summary.imported} transactions${r.summary.duplicates ? `, skipped ${r.summary.duplicates} duplicates` : ""}`);
        onClose();
      } else {
        setPreview(r);
        setMapping(r.mapping);
      }
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Import transactions (CSV)"
      wide
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={!preview?.can_import || !preview.summary.valid} loading={busy} onClick={() => run("commit")}>
            Import {preview?.summary.valid ?? 0}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Columns: <code>date,type,account,symbol,quantity,price,amount,fees,tax,currency</code> (plus optional to_account, split_ratio, fx_rate, fx_currency, note). Types: BUY, SELL, DIVIDEND, DRIP, DEPOSIT, WITHDRAWAL, FEE, TAX, SPLIT, TRANSFER. Exported CSVs re-import as-is.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file"
          className="block w-full text-sm text-muted file:mr-3 file:rounded-xl file:border-0 file:bg-ink-700 file:px-3 file:py-2 file:font-semibold file:text-slate-100"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setMapping(null);
            setPreview(null);
            if (f) run("preview", { file: f, mapping: null });
          }}
        />
        {err && (
          <p role="alert" className="rounded-xl border border-down/30 bg-down/10 px-3 py-2 text-sm text-red-200">
            {err}
          </p>
        )}
        {preview && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {FIELDS.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
                  {(id) => (
                    <Select
                      id={id}
                      value={mapping?.[f.key] ?? ""}
                      onChange={(e) => {
                        const m = { ...(mapping ?? {}), [f.key]: e.target.value || null };
                        setMapping(m);
                        run("preview", { mapping: m });
                      }}
                    >
                      <option value="">—</option>
                      {preview.headers.map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              ))}
            </div>
            <Field label="Date format">
              {(id) => (
                <Select
                  id={id}
                  value={dateFormat}
                  onChange={(e) => {
                    setDateFormat(e.target.value);
                    run("preview", { dateFormat: e.target.value });
                  }}
                >
                  <option value="iso">YYYY-MM-DD</option>
                  <option value="dmy">DD/MM/YYYY</option>
                  <option value="mdy">MM/DD/YYYY</option>
                </Select>
              )}
            </Field>
            <Toggle
              checked={createMissing}
              onChange={(v) => {
                setCreateMissing(v);
                run("preview", { createMissing: v });
              }}
              label="Create missing accounts and instruments"
              description="Currency is taken from the row or guessed from the symbol suffix (.KL → MYR)."
            />
            <Toggle
              checked={skipDup}
              onChange={(v) => {
                setSkipDup(v);
                run("preview", { skipDup: v });
              }}
              label="Skip duplicates"
              description="Rows identical to an existing transaction (or an earlier row) are not imported."
            />
            <div className="rounded-xl bg-ink-900 p-3 text-xs">
              <p>
                {preview.summary.rows} rows · <span className="text-up">{preview.summary.valid} valid</span> · <span className="text-amber-300">{preview.summary.duplicates} duplicates</span> · <span className="text-down">{preview.summary.errors} errors</span>
              </p>
              {preview.summary.ledger_error && <p className="mt-1 text-down">{preview.summary.ledger_error}</p>}
              {(preview.summary.will_create.accounts.length > 0 || preview.summary.will_create.instruments.length > 0) && (
                <p className="mt-1 text-muted">
                  Will create: {[...preview.summary.will_create.accounts.map((a) => `account ${a}`), ...preview.summary.will_create.instruments].join(", ")}
                </p>
              )}
            </div>
            <ul className="max-h-64 divide-y divide-white/5 overflow-y-auto rounded-xl bg-ink-900 text-2xs">
              {preview.rows.map((r) => (
                <li key={r.line} className="flex gap-2 px-3 py-1.5">
                  <span className="w-10 shrink-0 text-faint">L{r.line}</span>
                  <span className={cn("w-16 shrink-0 font-semibold", r.status === "ok" ? "text-up" : r.status === "duplicate" ? "text-amber-300" : "text-down")}>{r.status}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {r.errors.length ? r.errors.join("; ") : r.duplicate_of ? `duplicate of ${typeof r.duplicate_of === "number" ? `#${r.duplicate_of}` : r.duplicate_of}` : Object.values(r.raw).filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  );
}
