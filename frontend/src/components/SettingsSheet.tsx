import { setThemePref, useTheme } from "../lib/theme";
import { useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Pencil, Plus, RotateCcw, Upload } from "lucide-react";
import { api } from "../lib/api";
import { dateTime, num, today } from "../lib/format";
import { CURRENCY_LIST } from "../lib/format";
import { useBrokers, useCategories, useInvalidateAll, useMeta, useOpenSheet, useSaveSettings, useSettings } from "../lib/hooks";
import type { AuditEntry, RefreshState, Settings } from "../lib/types";
import { Button, ConfirmSheet, Field, Input, Segmented, Select, Sheet, Spinner, Toggle, useToast } from "./ui";
import { Section } from "./forms";


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
  const theme = useTheme();
  const openSheet = useOpenSheet();
  const brokers = useBrokers();
  const categories = useCategories();
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
              {CURRENCY_LIST.map((c) => (<option key={c.code} value={c.code}>{c.code}</option>))}
            </Select>
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Appearance</span>
          <Segmented
            label="Appearance"
            value={theme.pref}
            onChange={setThemePref}
            options={[
              { value: "system", label: "Auto" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
          <span className="text-2xs text-faint">Auto follows your phone or computer setting. Saved on this device only.</span>
        </div>
        <Toggle checked={s.hide_values} onChange={(v) => update({ hide_values: v })} label="Hide values on open" description="Start with amounts masked (tap the eye icon to reveal)." />
      </Section>

      <Section title="Price sources">
        <p className="text-2xs text-faint">Tried in this order. Keys are set in the .env file on your PC and never leave it.</p>
        <Toggle
          checked={s.longbridge_enabled}
          onChange={(v) => update({ longbridge_enabled: v })}
          label="Longbridge"
          description={meta.data?.longbridge_configured ? "US, Hong Kong and Singapore. Connected via your keys." : "US, Hong Kong and Singapore. Add LONGBRIDGE_APP_KEY, _APP_SECRET and _ACCESS_TOKEN to .env."}
        />
        <Toggle
          checked={s.alpaca_enabled}
          onChange={(v) => update({ alpaca_enabled: v })}
          label="Alpaca"
          description={meta.data?.alpaca_configured ? "US stocks and ETFs. Connected via your keys." : "US stocks and ETFs. Add ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY to .env (free account)."}
        />
        <Toggle
          checked={s.yahoo_enabled}
          onChange={(v) => update({ yahoo_enabled: v })}
          label="Yahoo Finance (unofficial)"
          description="Last resort, and the only free source with Bursa (.KL) prices. Not an official API, so it can break."
        />
        <Toggle checked={s.frankfurter_enabled} onChange={(v) => update({ frankfurter_enabled: v })} label="Exchange rates" description="Daily rates for the currencies you hold: ECB reference rates, plus ExchangeRate-API (open.er-api.com) for currencies the ECB does not publish." />
        {refresh.data && Object.keys(refresh.data.errors).length > 0 && (
          <details className="rounded-xl bg-ink-900 p-3 text-2xs text-muted">
            <summary className="cursor-pointer">Last refresh: {refresh.data.message}</summary>
            {Object.entries(refresh.data.errors).map(([k, v]) => (
              <p key={k} className="mt-1 text-gold/80">
                {k}: {v}
              </p>
            ))}
          </details>
        )}
      </Section>


      <Section
        title="Brokers"
        action={
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openSheet({ kind: "broker" })}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        }
      >
        <ul className="divide-y divide-line rounded-xl bg-ink-900">
          {(brokers.data ?? []).map((b) => (
            <li key={b.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                {b.name} <span className="text-2xs text-faint">· {b.holdings ?? 0} holdings</span>
              </span>
              <button className="text-faint hover:text-fg" aria-label={`Edit ${b.name}`} onClick={() => openSheet({ kind: "broker", broker: b })}>
                <Pencil className="h-4 w-4" />
              </button>
            </li>
          ))}
          {brokers.data?.length === 0 && <li className="px-3 py-2 text-xs text-faint">No brokers yet</li>}
        </ul>
      </Section>

      <Section
        title="Categories"
        action={
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openSheet({ kind: "category" })}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        }
      >
        <ul className="divide-y divide-line rounded-xl bg-ink-900">
          {(categories.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                {c.name} {c.show_dividends && <span className="text-2xs text-faint">· dividend columns</span>}
              </span>
              <button className="text-faint hover:text-fg" aria-label={`Edit ${c.name}`} onClick={() => openSheet({ kind: "category", category: c })}>
                <Pencil className="h-4 w-4" />
              </button>
            </li>
          ))}
          {categories.data?.length === 0 && <li className="px-3 py-2 text-xs text-faint">No categories yet</li>}
        </ul>
        <p className="text-2xs text-faint">To move a stock, use Arrange on the Portfolio tab, or open the stock and pick a category.</p>
      </Section>

      <DataSection />

      <details className="group">
        <summary className="cursor-pointer text-[13px] font-semibold text-muted">Advanced</summary>
        <div className="mt-4 space-y-6">
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              update({ refresh_interval_minutes: Number(interval), stale_after_minutes: Number(stale) });
            }}
          >
            <Field label="Auto refresh (minutes)">{(id) => <Input id={id} inputMode="numeric" value={interval} onChange={(e) => setInterval(e.target.value)} />}</Field>
            <Field label="Mark as old after (min)">{(id) => <Input id={id} inputMode="numeric" value={stale} onChange={(e) => setStale(e.target.value)} />}</Field>
            <Button type="submit" variant="secondary" className="col-span-2">
              Save intervals
            </Button>
          </form>
          <p className="text-2xs text-faint">Alpha Vantage (US, optional): {meta.data?.alphavantage_configured ? "configured" : "set ALPHAVANTAGE_API_KEY in .env"}.</p>
          <p className="text-2xs text-faint">
            AI (statement PDFs and Ask):{" "}
            {meta.data?.ai_providers?.length ? `${meta.data.ai_providers.join(", ")} configured` : "set GEMINI_API_KEY and/or GROQ_API_KEY in .env (both have free tiers)"}.
          </p>
          <FxSection />
          <AuditSection />
        </div>
      </details>

      <Section title="iPhone access">
        <div className="space-y-1 text-xs text-muted">
          {meta.data?.lan_urls.length ? (
            <p>
              Open on your iPhone (same Wi-Fi): {meta.data.lan_urls.map((u) => <code key={u} className="mr-2 text-accent">{u}</code>)}
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
          {CURRENCY_LIST.map((c) => (<option key={c.code} value={c.code}>{c.code}</option>))}
        </Select>
        <Select aria-label="To currency" value={quote} onChange={(e) => setQuote(e.target.value)}>
          {CURRENCY_LIST.map((c) => (<option key={c.code} value={c.code}>{c.code}</option>))}
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
        <a href="/api/holdings/export.csv" className="inline-flex items-center gap-1.5 rounded-xl bg-ink-700 px-3.5 py-2 text-sm font-semibold text-fg hover:bg-ink-600">
          <Download className="h-4 w-4" /> Export holdings
        </a>
        <Button variant="secondary" onClick={() => openSheet({ kind: "import" })}>
          <Upload className="h-4 w-4" /> Upload holdings
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
      <ul className="divide-y divide-line rounded-xl bg-ink-900 text-2xs">
        {(backups.data ?? []).slice(0, 8).map((b) => (
          <li key={b.name} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="truncate text-muted">{b.name}</span>
            <span className="flex shrink-0 gap-3">
              <a className="text-accent hover:underline" href={`/api/backups/${encodeURIComponent(b.name)}`}>
                Download
              </a>
              <button className="text-gold hover:underline" onClick={() => setRestoreName(b.name)}>
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
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-xl bg-ink-900 text-2xs">
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
