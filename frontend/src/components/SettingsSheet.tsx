import { useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Pencil, Plus, RotateCcw, Upload } from "lucide-react";
import { api } from "../lib/api";
import { dateTime, num, today } from "../lib/format";
import { useAccounts, useInstruments, useInvalidateAll, useMeta, useOpenSheet, useSaveSettings, useSettings } from "../lib/hooks";
import type { AuditEntry, RefreshState, Settings } from "../lib/types";
import { Button, ConfirmSheet, Field, Input, Select, Sheet, Spinner, Toggle, useToast } from "./ui";
import { Section } from "./forms";

const CURRENCIES = ["MYR", "USD", "SGD", "GBP", "HKD"];

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  return (
    <Sheet open onClose={onClose} title="Settings" wide>
      {settings.isLoading || !settings.data ? <Spinner /> : <SettingsBody s={settings.data} />}
    </Sheet>
  );
}

function SettingsBody({ s }: { s: Settings }) {
  const save = useSaveSettings();
  const toast = useToast();
  const meta = useMeta();
  const openSheet = useOpenSheet();
  const accounts = useAccounts();
  const instruments = useInstruments();
  const refresh = useQuery({ queryKey: ["refresh"], queryFn: () => api<RefreshState>("/refresh") });
  const [interval, setInterval] = useState(String(s.refresh_interval_minutes));
  const [stale, setStale] = useState(String(s.stale_after_minutes));

  const update = (patch: Partial<Settings>) =>
    save.mutate(patch, { onSuccess: () => toast("Settings saved"), onError: (e) => toast((e as Error).message, "error") });

  return (
    <div className="space-y-6 pb-2">
      {meta.data?.demo && <p className="rounded-xl bg-gold/10 px-3 py-2 text-xs text-gold">Demo mode: you are using the separate demo database ({meta.data.db_path}). Your real data is untouched.</p>}

      <Section title="General">
        <Field label="Base currency">
          {(id) => (
            <Select id={id} value={s.base_currency} onChange={(e) => update({ base_currency: e.target.value as Settings["base_currency"] })}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          )}
        </Field>
        <Toggle checked={s.hide_values} onChange={(v) => update({ hide_values: v })} label="Hide values on open" description="Start with amounts masked (tap the eye icon to reveal)." />
      </Section>

      <Section title="Market data">
        <Toggle checked={s.frankfurter_enabled} onChange={(v) => update({ frankfurter_enabled: v })} label="FX: Frankfurter (ECB reference rates)" description="Free, documented, no key. Updated once per working day." />
        <Toggle
          checked={s.yahoo_enabled}
          onChange={(v) => update({ yahoo_enabled: v })}
          label="Prices: Yahoo Finance (unofficial)"
          description="Covers Bursa (.KL), US, SGX, HKEX, LSE. Not an officially documented API: it may break or rate-limit. Quotes are delayed."
        />
        <p className="text-2xs text-faint">Alpha Vantage (US stocks): {meta.data?.alphavantage_configured ? "configured via ALPHAVANTAGE_API_KEY" : "not configured. Set ALPHAVANTAGE_API_KEY in .env (free key)."}</p>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            update({ refresh_interval_minutes: Number(interval), stale_after_minutes: Number(stale) });
          }}
        >
          <Field label="Auto refresh (minutes)">{(id) => <Input id={id} inputMode="numeric" value={interval} onChange={(e) => setInterval(e.target.value)} />}</Field>
          <Field label="Mark cached after (min)">{(id) => <Input id={id} inputMode="numeric" value={stale} onChange={(e) => setStale(e.target.value)} />}</Field>
          <Button type="submit" variant="secondary" className="col-span-2">
            Save intervals
          </Button>
        </form>
        {refresh.data && (
          <div className="rounded-xl bg-ink-900 p-3 text-2xs text-muted">
            <p>
              Last refresh: {refresh.data.finished_at ? dateTime(refresh.data.finished_at) : "not run this session"} · {refresh.data.message}
            </p>
            {Object.entries(refresh.data.errors).map(([k, v]) => (
              <p key={k} className="text-amber-200/80">
                {k}: {v}
              </p>
            ))}
          </div>
        )}
      </Section>

      <FxSection />

      <Section
        title="Accounts"
        action={
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openSheet({ kind: "account" })}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        }
      >
        <ul className="divide-y divide-white/5 rounded-xl bg-ink-900">
          {(accounts.data ?? []).map((a) => (
            <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                {a.name} <span className="text-2xs text-faint">· {a.layout}{a.archived ? " · archived" : ""}</span>
              </span>
              <button className="text-faint hover:text-white" aria-label={`Edit ${a.name}`} onClick={() => openSheet({ kind: "account", account: a })}>
                <Pencil className="h-4 w-4" />
              </button>
            </li>
          ))}
          {accounts.data?.length === 0 && <li className="px-3 py-2 text-xs text-faint">No accounts</li>}
        </ul>
      </Section>

      <Section
        title="Instruments"
        action={
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openSheet({ kind: "instrument" })}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        }
      >
        <ul className="divide-y divide-white/5 rounded-xl bg-ink-900">
          {(instruments.data ?? []).map((i) => (
            <li key={i.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                {i.symbol} <span className="text-2xs text-faint">· {i.currency} · {i.kind} · {i.price_mode === "manual" ? "manual price" : "provider"}</span>
              </span>
              <span className="flex gap-3">
                <button className="text-2xs text-blue-300 hover:underline" onClick={() => openSheet({ kind: "price", instrumentId: i.id })}>
                  Price
                </button>
                <button className="text-faint hover:text-white" aria-label={`Edit ${i.symbol}`} onClick={() => openSheet({ kind: "instrument", instrument: i })}>
                  <Pencil className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
          {instruments.data?.length === 0 && <li className="px-3 py-2 text-xs text-faint">No instruments</li>}
        </ul>
      </Section>

      <DataSection />
      <AuditSection />

      <Section title="iPhone access">
        <div className="space-y-1 text-xs text-muted">
          {meta.data?.lan_urls.length ? (
            <p>
              Open on your iPhone (same Wi-Fi): {meta.data.lan_urls.map((u) => <code key={u} className="mr-2 text-blue-300">{u}</code>)}
            </p>
          ) : (
            <p>LAN access is off. Set PT_HOST=0.0.0.0 in .env and restart start.bat to open the app from your iPhone.</p>
          )}
          <p>In Safari: Share → Add to Home Screen. Over plain HTTP the app works normally; offline caching and some PWA features need HTTPS.</p>
        </div>
      </Section>
    </div>
  );
}

function FxSection() {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const fx = useQuery({ queryKey: ["fx"], queryFn: () => api<{ id: number; base: string; quote: string; rate: string; rate_date: string; source: string }[]>("/fx") });
  const [base, setBase] = useState("USD");
  const [quote, setQuote] = useState("MYR");
  const [rate, setRate] = useState("");
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/fx", { body: { base, quote, rate, date } });
      invalidate();
      toast(`${base}→${quote} saved`);
      setRate("");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const latest = new Map<string, { rate: string; rate_date: string; source: string }>();
  for (const r of fx.data ?? []) if (!latest.has(`${r.base}${r.quote}`)) latest.set(`${r.base}${r.quote}`, r);
  return (
    <Section title="FX rates">
      <form onSubmit={submit} className="grid grid-cols-[1fr_1fr_1.2fr] gap-2">
        <Select aria-label="From currency" value={base} onChange={(e) => setBase(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <Select aria-label="To currency" value={quote} onChange={(e) => setQuote(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <Input aria-label="Rate" inputMode="decimal" placeholder={`1 ${base} = ? ${quote}`} value={rate} onChange={(e) => setRate(e.target.value)} />
        <Input aria-label="Rate date" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} className="col-span-2" />
        <Button type="submit" variant="secondary" loading={busy} disabled={!rate}>
          Save rate
        </Button>
      </form>
      <p className="text-2xs text-faint">Manual rates are used when no provider rate exists for that day. Historic rates (e.g. on purchase dates) let the app separate FX effect from price gains.</p>
      <ul className="grid grid-cols-2 gap-1 text-2xs text-muted">
        {[...latest.entries()].map(([k, r]) => (
          <li key={k}>
            {k.slice(0, 3)}→{k.slice(3)} {num(r.rate, 5)} <span className="text-faint">({r.rate_date}, {r.source})</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function DataSection() {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const openSheet = useOpenSheet();
  const backups = useQuery({ queryKey: ["backups"], queryFn: () => api<{ name: string; size: number; modified: string }[]>("/backups") });
  const [busy, setBusy] = useState(false);
  const [restoreName, setRestoreName] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ name: string }>("/backups", { method: "POST" });
      backups.refetch();
      toast(`Backup created: ${r.name}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const doRestore = async () => {
    setBusy(true);
    try {
      let r: { safety_backup: string };
      if (uploadFile) {
        const form = new FormData();
        form.append("file", uploadFile);
        r = await api("/restore", { form });
      } else r = await api(`/backups/${encodeURIComponent(restoreName!)}/restore`, { method: "POST" });
      invalidate();
      toast(`Restored. Previous data saved as ${r.safety_backup}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      setRestoreName(null);
      setUploadFile(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  return (
    <Section title="Data">
      <div className="flex flex-wrap gap-2">
        <a href="/api/transactions/export.csv" className="inline-flex items-center gap-1.5 rounded-xl bg-ink-700 px-3.5 py-2 text-sm font-semibold text-slate-100 hover:bg-ink-600">
          <Download className="h-4 w-4" /> Export CSV
        </a>
        <Button variant="secondary" onClick={() => openSheet({ kind: "import" })}>
          <Upload className="h-4 w-4" /> Import CSV
        </Button>
        <Button variant="secondary" onClick={create} loading={busy}>
          Backup now
        </Button>
        <Button variant="ghost" onClick={() => fileRef.current?.click()}>
          <RotateCcw className="h-4 w-4" /> Restore from file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".db,application/octet-stream"
          className="hidden"
          aria-label="Backup file to restore"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setUploadFile(f);
              setRestoreName(f.name);
            }
          }}
        />
      </div>
      <ul className="divide-y divide-white/5 rounded-xl bg-ink-900 text-2xs">
        {(backups.data ?? []).slice(0, 8).map((b) => (
          <li key={b.name} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="truncate text-muted">{b.name}</span>
            <span className="flex shrink-0 gap-3">
              <a className="text-blue-300 hover:underline" href={`/api/backups/${encodeURIComponent(b.name)}`}>
                Download
              </a>
              <button className="text-amber-300 hover:underline" onClick={() => setRestoreName(b.name)}>
                Restore
              </button>
            </span>
          </li>
        ))}
        {backups.data?.length === 0 && <li className="px-3 py-2 text-faint">No backups yet. Backups are stored in data/backups on your PC.</li>}
      </ul>
      <ConfirmSheet
        open={!!restoreName}
        title="Restore backup?"
        confirmLabel="Restore"
        loading={busy}
        message={`Replace all current data with "${restoreName}"? The file is integrity-checked first, and your current data is saved as a safety backup.`}
        onConfirm={doRestore}
        onClose={() => {
          setRestoreName(null);
          setUploadFile(null);
        }}
      />
    </Section>
  );
}

function AuditSection() {
  const [open, setOpen] = useState(false);
  const log = useQuery({ queryKey: ["audit"], queryFn: () => api<AuditEntry[]>("/audit?limit=60"), enabled: open });
  return (
    <Section title="Audit history">
      {!open ? (
        <Button variant="ghost" className="px-2 text-xs" onClick={() => setOpen(true)}>
          Show recent changes
        </Button>
      ) : log.isLoading ? (
        <Spinner />
      ) : (
        <ul className="max-h-72 divide-y divide-white/5 overflow-y-auto rounded-xl bg-ink-900 text-2xs">
          {(log.data ?? []).map((e) => (
            <li key={e.id} className="px-3 py-1.5">
              <span className="text-muted">{dateTime(e.ts)}</span> · {e.entity} {e.entity_id ? `#${e.entity_id}` : ""} · <span className="font-semibold">{e.action}</span>
              {e.note ? ` · ${e.note}` : ""}
              {e.action === "delete" && e.before && <details className="mt-0.5 text-faint"><summary>Deleted record</summary><pre className="whitespace-pre-wrap break-all">{e.before}</pre></details>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
