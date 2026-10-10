export type Num = string | null;
export type Currency = "MYR" | "USD" | "SGD" | "GBP" | "HKD";
export type PriceStatus = "Live" | "Delayed" | "Cached" | "Manual" | "Unavailable" | "Partial";

export interface Holding {
  instrument_id: number;
  symbol: string;
  name: string | null;
  kind: string;
  currency: string;
  quantity: string;
  avg_cost: Num;
  cost: string;
  price: Num;
  price_status: PriceStatus;
  price_source: string | null;
  price_date: string | null;
  price_fetched_at: string | null;
  market_value: Num;
  unrealized: Num;
  realized: string;
  capital_gain: Num;
  dividends_gross: string;
  dividend_tax: string;
  dividends_net: string;
  fees: string;
  total_pl: Num;
  pl_pct: Num;
  dps: Num;
  dps_source: string | null;
  withholding_tax_rate: string;
  est_annual_dividend: Num;
  est_annual_dividend_net: Num;
  dividend_yield: Num;
  yield_on_cost: Num;
  fx_rate: Num;
  market_value_base: Num;
  cost_base: Num;
  total_pl_base: Num;
  fx_effect_base: Num;
  first_date: string | null;
}

export interface AccountView {
  id: number;
  name: string;
  layout: "dividend" | "growth";
  currency: Currency;
  broker: string | null;
  track_cash: boolean;
  archived: boolean;
  notes: string | null;
  sort_order: number;
  value: string;
  market_value: string;
  cost: string;
  pl: string;
  pl_pct: Num;
  unrealized: string;
  realized: string;
  dividends_net: string;
  fees: string;
  fx_effect: string;
  est_annual_dividend: string;
  est_annual_dividend_gross: string;
  dividend_yield: Num;
  cash: Record<string, string>;
  cash_base: string;
  net_contributions: Num;
  value_minus_contributions: Num;
  incomplete: boolean;
  holdings: Holding[];
  closed: Holding[];
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
  price_status_counts: Record<string, number>;
  fx: { from: string; to: string; rate: Num; date: string | null; source: string | null }[];
  totals: {
    value: string;
    market_value: string;
    cash: string;
    cost: string;
    pl: string;
    pl_pct: Num;
    unrealized: string;
    realized: string;
    dividends_net: string;
    fees: string;
    fx_effect: Num;
    est_annual_dividend: string;
    est_annual_dividend_gross: string;
    dividend_yield: Num;
    incomplete: boolean;
  };
  accounts: AccountView[];
  warnings: string[];
  refresh: RefreshState;
}

export interface Account {
  id: number;
  name: string;
  layout: "dividend" | "growth";
  currency: Currency;
  broker: string | null;
  track_cash: boolean;
  sort_order: number;
  archived: boolean;
  notes: string | null;
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
  notes: string | null;
}

export type TxnType = "BUY" | "SELL" | "DIVIDEND" | "DRIP" | "DEPOSIT" | "WITHDRAWAL" | "FEE" | "TAX" | "SPLIT" | "TRANSFER";

export interface Txn {
  id: number;
  type: TxnType;
  trade_date: string;
  account_id: number | null;
  to_account_id: number | null;
  instrument_id: number | null;
  quantity: Num;
  price: Num;
  amount: Num;
  fees: string;
  tax: string;
  currency: string;
  fx_rate: Num;
  fx_currency: string | null;
  split_ratio: Num;
  dividend_event_id: number | null;
  note: string | null;
  source: string;
  import_batch: string | null;
  created_at: string;
  updated_at: string;
  account_name: string | null;
  to_account_name: string | null;
  symbol: string | null;
  cash_effect: Num;
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
  ex_date: string;
  pay_date: string | null;
  amount_per_share: string;
  currency: string;
  status: "forecast" | "announced" | "pending" | "received";
  withholding_tax_rate: Num;
  withholding_rate_effective: string;
  note: string | null;
  eligible_shares: string;
  expected_gross: string;
  expected_net: string;
  received_net: Num;
  suggested_status: string;
  reconciled: boolean;
  accounts: {
    account_id: number;
    account_name: string;
    eligible_shares: string;
    expected_gross: string;
    expected_tax: string;
    expected_net: string;
    received_net: Num;
    transaction_ids: number[];
    difference: Num;
  }[];
}

export interface DividendSummary {
  base_currency: Currency;
  forward_annual_estimate: string;
  forward_annual_estimate_gross: string;
  monthly_average_projected: string;
  t12m_net: string;
  t12m_gross: string;
  t12m_tax: string;
  portfolio_yield: Num;
  yield_on_cost: Num;
  chart: { month: string; received: string; forecast: string; run_rate: string; period: "past" | "future" }[];
  holdings: {
    account: string;
    symbol: string;
    currency: string;
    est_annual_net_base: Num;
    est_annual_gross: Num;
    dps: Num;
    dps_source: string | null;
    dividend_yield: Num;
    yield_on_cost: Num;
    withholding_tax_rate: string;
    t12m_net_base: string;
    share_pct: Num;
  }[];
  by_account: { account: string; t12m_net: string; forward_net: string }[];
  by_currency: { currency: string; t12m_net: string; forward_net: string }[];
  by_year: { year: string; net: string }[];
  upcoming: (DividendEvent & { expected_net_base: string; date_for_calendar: string })[];
  notes: { estimates: string; fx_fallback: boolean; unconverted_transactions: number[] };
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
  transaction_types: TxnType[];
  dividend_statuses: string[];
  demo: boolean;
  db_path: string;
  lan_urls: string[];
  alphavantage_configured: boolean;
  alpaca_configured: boolean;
  longbridge_configured: boolean;
}
