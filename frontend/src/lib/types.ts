export type Num = string | null;
export type Currency = "MYR" | "USD" | "SGD" | "GBP" | "HKD";
export type PriceStatus = "Live" | "Delayed" | "Cached" | "Manual" | "Unavailable" | "Partial";

export interface Lot {
  holding_id: number;
  broker_id: number;
  broker: string;
  quantity: string;
  avg_cost: string;
  updated_at: string;
  source: string;
}

export interface Holding {
  instrument_id: number;
  symbol: string;
  name: string | null;
  kind: string;
  currency: string;
  category_id: number | null;
  sort_order: number;
  quantity: string;
  avg_cost: Num;
  cost: string;
  price: Num;
  price_status: PriceStatus;
  price_source: string | null;
  price_date: string | null;
  price_fetched_at: string | null;
  market_value: Num;
  gain: Num;
  dividends_net: string;
  total_pl: Num;
  pl_pct: Num;
  dps: Num;
  dps_source: string | null;
  withholding_tax_rate: string;
  est_annual_dividend_net: Num;
  dividend_yield: Num;
  fx_rate: Num;
  market_value_base: Num;
  cost_base: Num;
  total_pl_base: Num;
  est_annual_dividend_base: Num;
  lots: Lot[];
}

export interface CategoryCard {
  id: number | null;
  name: string;
  show_dividends: boolean;
  sort_order: number;
  holdings: Holding[];
  value: string;
  cost: string;
  pl: string;
  pl_pct: Num;
  est_annual_dividend: string;
  dividend_yield: Num;
  incomplete: boolean;
}

export interface RefreshState {
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  message: string;
  results: Record<string, string>;
  errors: Record<string, string>;
}

export interface Portfolio {
  base_currency: Currency;
  generated_at: string;
  prices_as_of: string | null;
  demo: boolean;
  price_status: PriceStatus;
  fx: { from: string; to: string; rate: Num; date: string | null; source: string | null }[];
  totals: { value: string; cost: string; pl: string; pl_pct: Num; est_annual_dividend: string; dividend_yield: Num; incomplete: boolean };
  categories: CategoryCard[];
  warnings: string[];
  refresh: RefreshState;
}

export interface Broker {
  id: number;
  name: string;
  notes: string | null;
  holdings?: number;
}

export interface Category {
  id: number;
  name: string;
  show_dividends: boolean;
  sort_order: number;
}

export interface Instrument {
  id: number;
  symbol: string;
  name: string | null;
  currency: string;
  kind: string;
  price_mode: "auto" | "manual";
  provider_symbol: string | null;
  annual_dividend_per_share: Num;
  dividend_frequency: number | null;
  withholding_tax_rate: string;
  category_id: number | null;
  notes: string | null;
}

export interface AuditEntry {
  id: number;
  ts: string;
  entity: string;
  entity_id: number | null;
  action: string;
  before: string | null;
  after: string | null;
  note: string | null;
}

export interface DividendEvent {
  id: number;
  instrument_id: number;
  symbol: string;
  name: string | null;
  ex_date: string;
  pay_date: string | null;
  amount_per_share: string;
  currency: string;
  status: "forecast" | "announced" | "pending" | "received";
  withholding_tax_rate: Num;
  withholding_rate_effective: string;
  source: string | null;
  note: string | null;
  quantity: string;
  expected_gross: string;
  expected_tax: string;
  expected_net: string;
  expected_net_base?: Num;
  received_net: Num;
  awaiting_confirmation: boolean;
}

export interface Payment {
  id: number;
  instrument_id: number;
  symbol: string;
  broker: string | null;
  broker_id: number | null;
  event_id: number | null;
  pay_date: string;
  gross: string;
  tax: string;
  net: string;
  currency: string;
  note: string | null;
}

export interface DividendSummary {
  base_currency: Currency;
  forward_annual_estimate: string;
  monthly_average_projected: string;
  portfolio_yield: Num;
  t12m_net: string;
  chart: { month: string; received: string; expected: string }[];
  holdings: { symbol: string; category: string; currency: string; est_annual_net_base: string; dividend_yield: Num; dps_source: string | null }[];
  to_confirm: DividendEvent[];
  upcoming: DividendEvent[];
  recent_payments: Payment[];
}

export interface CalendarItem {
  kind: "ex_date" | "pay_date" | "earnings";
  date: string;
  symbol: string;
  instrument_id: number;
  event_id?: number;
  earnings_id?: number;
  currency?: string;
  amount_per_share?: string;
  expected_net?: string;
  status?: string;
  pay_date?: string | null;
  ex_date?: string;
  session?: "before" | "after" | null;
  title?: string | null;
  source?: string;
}

export interface Settings {
  base_currency: Currency;
  longbridge_enabled: boolean;
  alpaca_enabled: boolean;
  yahoo_enabled: boolean;
  frankfurter_enabled: boolean;
  refresh_interval_minutes: number;
  stale_after_minutes: number;
  hide_values: boolean;
}

export interface Meta {
  currencies: Currency[];
  demo: boolean;
  db_path: string;
  lan_urls: string[];
  alphavantage_configured: boolean;
  alpaca_configured: boolean;
  longbridge_configured: boolean;
}
