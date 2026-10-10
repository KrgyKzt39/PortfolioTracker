import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SYMBOLS: Record<string, string> = { MYR: "RM", USD: "$", SGD: "S$", GBP: "£", HKD: "HK$" };

/** Filled from /api/meta at startup so every supported currency gets its symbol. */
export let CURRENCY_LIST: { code: string; name: string; symbol: string }[] = Object.entries(SYMBOLS).map(([code, symbol]) => ({ code, name: code, symbol }));
export function setCurrencies(list: { code: string; name: string; symbol: string }[]) {
  CURRENCY_LIST = list;
  for (const c of list) SYMBOLS[c.code] = c.symbol;
}
export const HIDDEN = "••••••";

export const currencySymbol = (ccy: string) => SYMBOLS[ccy] ?? `${ccy} `;

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Display-only rounding. All accounting happens server-side in Decimal. */
export function money(
  v: string | number | null | undefined,
  ccy: string,
  opts: { signed?: boolean; hidden?: boolean; dp?: number } = {},
): string {
  const n = toNum(v);
  if (n === null) return "N/A";
  if (opts.hidden) return `${currencySymbol(ccy)}${HIDDEN}`;
  const dp = opts.dp ?? 2;
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const rounded = Number(Math.abs(n).toFixed(dp));
  const sign = n < 0 && rounded !== 0 ? "-" : opts.signed && rounded !== 0 ? "+" : "";
  return `${sign}${currencySymbol(ccy)}${abs}`;
}

export function pct(v: string | number | null | undefined, opts: { signed?: boolean; dp?: number } = {}): string {
  const n = toNum(v);
  if (n === null) return "N/A";
  const dp = opts.dp ?? 2;
  const s = Math.abs(n).toFixed(dp);
  const sign = n < 0 && Number(s) !== 0 ? "-" : opts.signed && Number(s) !== 0 ? "+" : "";
  return `${sign}${s}%`;
}

export function qty(v: string | number | null | undefined): string {
  const n = toNum(v);
  if (n === null) return "N/A";
  return n.toLocaleString("en-US", { maximumFractionDigits: Number.isInteger(n) ? 0 : 4 });
}

export function num(v: string | number | null | undefined, dp = 4): string {
  const n = toNum(v);
  if (n === null) return "N/A";
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

export function priceStr(v: string | number | null | undefined, ccy: string): string {
  const n = toNum(v);
  if (n === null) return "N/A";
  const dp = Math.abs(n) < 1 && n !== 0 ? 4 : 2;
  return money(n, ccy, { dp });
}

/** Tailwind colour class for gains (green), losses (red) and unknowns (muted). */
export function tone(v: string | number | null | undefined): string {
  const n = toNum(v);
  if (n === null) return "text-muted";
  if (n > 0) return "text-up";
  if (n < 0) return "text-down";
  return "text-slate-300";
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short" });
}
