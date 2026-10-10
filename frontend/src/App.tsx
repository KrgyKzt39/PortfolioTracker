import { useCallback, useEffect, useState } from "react";
import { BottomNav, TABS, type Tab } from "./components/BottomNav";
import { AccountSheet, InstrumentSheet, PriceSheet, TransactionSheet } from "./components/forms";
import { ImportSheet } from "./components/ImportSheet";
import { SettingsSheet } from "./components/SettingsSheet";
import { PrivacyCtx, SheetCtx, useSettings, type SheetRequest } from "./lib/hooks";
import { Dashboard } from "./pages/Dashboard";
import { Dividends } from "./pages/Dividends";
import { DvSummary } from "./pages/DvSummary";
import { Transactions, type TxnFilter } from "./pages/Transactions";

const readTab = (): Tab => {
  const h = window.location.hash.replace("#/", "") as Tab;
  return TABS.some((t) => t.id === h) ? h : "dashboard";
};

export default function App() {
  const [tab, setTab] = useState<Tab>(readTab);
  const [txnFilter, setTxnFilter] = useState<TxnFilter>({});
  const [filterKey, setFilterKey] = useState(0);
  const [sheets, setSheets] = useState<SheetRequest[]>([]);
  const settings = useSettings();
  const [hidden, setHidden] = useState<boolean | null>(null);

  useEffect(() => {
    if (hidden === null && settings.data) setHidden(settings.data.hide_values);
  }, [settings.data, hidden]);

  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (t: Tab) => {
    window.location.hash = `/${t}`;
    setTab(t);
    window.scrollTo({ top: 0 });
  };
  const openSheet = useCallback((req: SheetRequest) => setSheets((s) => [...s, req]), []);
  const closeTop = useCallback(() => setSheets((s) => s.slice(0, -1)), []);

  const showTransactions = (f: TxnFilter) => {
    setTxnFilter(f);
    setFilterKey((k) => k + 1);
    go("transactions");
  };

  return (
    <PrivacyCtx.Provider value={{ hidden: !!hidden, toggle: () => setHidden((h) => !h) }}>
      <SheetCtx.Provider value={openSheet}>
        <div className="safe-top mx-auto min-h-dvh max-w-[640px] px-3 pb-[calc(env(safe-area-inset-bottom)+92px)] sm:px-4">
          <main>
            {tab === "dashboard" && <Dashboard onShowTransactions={showTransactions} />}
            {tab === "dv" && <DvSummary />}
            {tab === "transactions" && <Transactions key={filterKey} initialFilter={txnFilter} />}
            {tab === "dividends" && <Dividends />}
          </main>
        </div>
        <BottomNav
          tab={tab}
          onChange={(t) => {
            if (t === "transactions") setTxnFilter({});
            go(t);
          }}
        />
        {sheets.map((s, i) => {
          const close = i === sheets.length - 1 ? closeTop : () => setSheets((x) => x.slice(0, i));
          switch (s.kind) {
            case "account":
              return <AccountSheet key={i} account={s.account} onClose={close} />;
            case "instrument":
              return <InstrumentSheet key={i} instrument={s.instrument} onSaved={s.onSaved} onClose={close} />;
            case "transaction":
              return <TransactionSheet key={i} txnId={s.txnId} preset={s.preset} onClose={close} />;
            case "price":
              return <PriceSheet key={i} instrumentId={s.instrumentId} onClose={close} />;
            case "settings":
              return <SettingsSheet key={i} onClose={close} />;
            case "import":
              return <ImportSheet key={i} onClose={close} />;
          }
        })}
      </SheetCtx.Provider>
    </PrivacyCtx.Provider>
  );
}
