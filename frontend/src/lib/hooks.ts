import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { api } from "./api";
import type { Account, DividendEvent, DividendSummary, Instrument, Meta, Portfolio, RefreshState, Settings } from "./types";

export const usePortfolio = (base?: string) =>
  useQuery({ queryKey: ["portfolio", base], queryFn: () => api<Portfolio>(`/portfolio${base ? `?base=${base}` : ""}`) });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });
export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/meta"), staleTime: Infinity });
export const useAccounts = () => useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/accounts") });
export const useInstruments = () => useQuery({ queryKey: ["instruments"], queryFn: () => api<Instrument[]>("/instruments") });
export const useDividendSummary = () => useQuery({ queryKey: ["dividend-summary"], queryFn: () => api<DividendSummary>("/dividends/summary") });
export const useDividendEvents = (params: string) =>
  useQuery({ queryKey: ["dividend-events", params], queryFn: () => api<DividendEvent[]>(`/dividends/events${params}`) });
export const useRefreshStatus = (enabled: boolean) =>
  useQuery({ queryKey: ["refresh"], queryFn: () => api<RefreshState>("/refresh"), refetchInterval: enabled ? 1500 : false });

/** Everything derived from the ledger; invalidated after any write. */
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

/** Opens app-level sheets from any page. */
export type SheetRequest =
  | { kind: "account"; account?: Account }
  | { kind: "instrument"; instrument?: Instrument; onSaved?: (i: Instrument) => void }
  | { kind: "transaction"; txnId?: number; preset?: Record<string, unknown> }
  | { kind: "price"; instrumentId?: number }
  | { kind: "settings" }
  | { kind: "import" };
export const SheetCtx = createContext<(req: SheetRequest) => void>(() => {});
export const useOpenSheet = () => useContext(SheetCtx);
