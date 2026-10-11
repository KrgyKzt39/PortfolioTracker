import { useCallback, useEffect, useState } from "react";
import { BottomNav, TABS, type Tab } from "./components/BottomNav";
import { BrokerSheet, CategorySheet, DividendSheet, EarningsSheet, HoldingSheet, ImportSheet, PaymentSheet, PriceSheet, StockSheet } from "./components/forms";
import { SettingsSheet } from "./components/SettingsSheet";
import { setCurrencies } from "./lib/format";
import { PrivacyCtx, SheetCtx, useMeta, useSettings, type SheetRequest } from "./lib/hooks";
import { Ask } from "./pages/Ask";
import { Calendar } from "./pages/Calendar";
import { Dashboard } from "./pages/Dashboard";
import { Dividends } from "./pages/Dividends";
import { Overview } from "./pages/Overview";

const readTab = (): Tab => {
  const h = window.location.hash.replace("#/", "") as Tab;
  return TABS.some((t) => t.id === h) ? h : "portfolio";
};

export default function App() {
  const [tab, setTab] = useState<Tab>(readTab);
  const [sheets, setSheets] = useState<SheetRequest[]>([]);
  const settings = useSettings();
  const meta = useMeta();
  if (meta.data) setCurrencies(meta.data.currencies);
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

  return (
    <PrivacyCtx.Provider value={{ hidden: !!hidden, toggle: () => setHidden((h) => !h) }}>
      <SheetCtx.Provider value={openSheet}>
        <div className="safe-top mx-auto min-h-dvh max-w-[640px] px-3 pb-[calc(env(safe-area-inset-bottom)+92px)] sm:px-4">
          <main>
            {tab === "portfolio" && <Dashboard />}
            {tab === "dashboard" && <Overview />}
            {tab === "dividends" && <Dividends />}
            {tab === "calendar" && <Calendar />}
            {tab === "ask" && <Ask />}
          </main>
        </div>
        <BottomNav tab={tab} onChange={go} />
        {sheets.map((s, i) => {
          const close = () => setSheets((x) => x.slice(0, i));
          switch (s.kind) {
            case "holding":
              return <HoldingSheet key={i} holdingId={s.holdingId} preset={s.preset} onClose={close} />;
            case "stock":
              return <StockSheet key={i} instrumentId={s.instrumentId} onClose={close} />;
            case "price":
              return <PriceSheet key={i} instrumentId={s.instrumentId} onClose={close} />;
            case "category":
              return <CategorySheet key={i} category={s.category} onClose={close} />;
            case "broker":
              return <BrokerSheet key={i} broker={s.broker} onClose={close} />;
            case "import":
              return <ImportSheet key={i} onClose={close} />;
            case "settings":
              return <SettingsSheet key={i} onClose={close} />;
            case "dividend":
              return <DividendSheet key={i} event={s.event} instrumentId={s.instrumentId} onClose={close} />;
            case "payment":
              return <PaymentSheet key={i} event={s.event} payment={s.payment} onClose={close} />;
            case "earnings":
              return <EarningsSheet key={i} instrumentId={s.instrumentId} onClose={close} />;
          }
        })}
      </SheetCtx.Provider>
    </PrivacyCtx.Provider>
  );
}
