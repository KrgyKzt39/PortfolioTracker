import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { api } from "./api";
import type { Broker, CalendarItem, Category, DividendEvent, DividendSummary, Instrument, Meta, Payment, Portfolio, RefreshState, Settings } from "./types";

export const usePortfolio = (base?: string) =>
  useQuery({ queryKey: ["portfolio", base], queryFn: () => api<Portfolio>(`/portfolio${base ? `?base=${base}` : ""}`) });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });
export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/meta"), staleTime: Infinity });
/** Untagged holdings live under this built-in broker; it never shows up in broker pickers. */
export const NO_BROKER = "No broker";
export const useBrokers = () =>
  useQuery({ queryKey: ["brokers"], queryFn: () => api<Broker[]>("/brokers"), select: (bs) => bs.filter((b) => b.name !== NO_BROKER) });
export const useCategories = () => useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/categories") });
export const useInstruments = () => useQuery({ queryKey: ["instruments"], queryFn: () => api<Instrument[]>("/instruments") });
export const useDividendSummary = () => useQuery({ queryKey: ["dividend-summary"], queryFn: () => api<DividendSummary>("/dividends/summary") });
export const useDividendEvents = () => useQuery({ queryKey: ["dividend-events"], queryFn: () => api<DividendEvent[]>("/dividends/events") });
export const useCalendar = () => useQuery({ queryKey: ["calendar"], queryFn: () => api<CalendarItem[]>("/calendar") });
export const useRefreshStatus = (enabled: boolean) =>
  useQuery({ queryKey: ["refresh"], queryFn: () => api<RefreshState>("/refresh"), refetchInterval: enabled ? 1500 : false });

/** Everything on screen is derived from the database; refetch after any write. */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: Partial<Settings>) => api<Settings>("/settings", { method: "PUT", body: s }),
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["dividend-summary"] });
    },
  });
}

export const PrivacyCtx = createContext<{ hidden: boolean; toggle: () => void }>({ hidden: false, toggle: () => {} });
export const usePrivacy = () => useContext(PrivacyCtx);

/** App-level sheets, openable from any page. */
export type SheetRequest =
  | { kind: "holding"; holdingId?: number; preset?: { symbol?: string; broker_id?: number; category_id?: number | null; quantity?: string; avg_cost?: string } }
  | { kind: "stock"; instrumentId: number }
  | { kind: "price"; instrumentId: number }
  | { kind: "category"; category?: Category }
  | { kind: "broker"; broker?: Broker }
  | { kind: "import" }
  | { kind: "settings" }
  | { kind: "dividend"; event?: DividendEvent; instrumentId?: number }
  | { kind: "payment"; event?: DividendEvent; payment?: Payment }
  | { kind: "earnings"; instrumentId?: number };
export const SheetCtx = createContext<(req: SheetRequest) => void>(() => {});
export const useOpenSheet = () => useContext(SheetCtx);
