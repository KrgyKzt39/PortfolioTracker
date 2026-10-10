"""Supported currencies and where their exchange rates come from.

Frankfurter (ECB reference rates) covers the first group. The rest come from ExchangeRate-API's
open endpoint (open.er-api.com: documented, free, no key, updated daily, attribution required).
Any pair can also be entered manually.
"""

# code: (name, display symbol)
ECB = {
    "MYR": ("Malaysian ringgit", "RM"), "USD": ("US dollar", "$"), "SGD": ("Singapore dollar", "S$"),
    "GBP": ("British pound", "£"), "HKD": ("Hong Kong dollar", "HK$"), "EUR": ("Euro", "€"),
    "AUD": ("Australian dollar", "A$"), "CAD": ("Canadian dollar", "C$"), "CHF": ("Swiss franc", "CHF "),
    "CNY": ("Chinese yuan", "CN¥"), "JPY": ("Japanese yen", "¥"), "KRW": ("South Korean won", "₩"),
    "INR": ("Indian rupee", "₹"), "IDR": ("Indonesian rupiah", "Rp"), "THB": ("Thai baht", "฿"),
    "PHP": ("Philippine peso", "₱"), "NZD": ("New Zealand dollar", "NZ$"), "SEK": ("Swedish krona", "kr "),
    "NOK": ("Norwegian krone", "kr "), "DKK": ("Danish krone", "kr "), "PLN": ("Polish złoty", "zł "),
    "CZK": ("Czech koruna", "Kč "), "HUF": ("Hungarian forint", "Ft "), "ILS": ("Israeli shekel", "₪"),
    "TRY": ("Turkish lira", "₺"), "ZAR": ("South African rand", "R "), "BRL": ("Brazilian real", "R$"),
    "MXN": ("Mexican peso", "MX$"), "ISK": ("Icelandic króna", "kr "), "RON": ("Romanian leu", "lei "),
    "BGN": ("Bulgarian lev", "лв "),
}
OTHER = {
    "TWD": ("New Taiwan dollar", "NT$"), "VND": ("Vietnamese dong", "₫"), "BND": ("Brunei dollar", "B$"),
    "AED": ("UAE dirham", "AED "), "SAR": ("Saudi riyal", "SAR "), "QAR": ("Qatari riyal", "QAR "),
    "KWD": ("Kuwaiti dinar", "KWD "), "PKR": ("Pakistani rupee", "Rs "), "BDT": ("Bangladeshi taka", "৳"),
    "LKR": ("Sri Lankan rupee", "Rs "), "MOP": ("Macanese pataca", "MOP$"), "EGP": ("Egyptian pound", "E£"),
    "NGN": ("Nigerian naira", "₦"), "KES": ("Kenyan shilling", "KSh "), "CLP": ("Chilean peso", "CLP$"),
    "COP": ("Colombian peso", "COL$"), "ARS": ("Argentine peso", "AR$"), "PEN": ("Peruvian sol", "S/ "),
}
ALL = {**ECB, **OTHER}
CODES = tuple(ALL)

# Exchange suffix -> listing currency, used when a new symbol is added without a currency.
SUFFIX_CCY = {
    ".KL": "MYR", ".SI": "SGD", ".HK": "HKD", ".L": "GBP", ".T": "JPY", ".AX": "AUD", ".TO": "CAD",
    ".V": "CAD", ".PA": "EUR", ".DE": "EUR", ".F": "EUR", ".AS": "EUR", ".MI": "EUR", ".MC": "EUR",
    ".BR": "EUR", ".SW": "CHF", ".SS": "CNY", ".SZ": "CNY", ".TW": "TWD", ".TWO": "TWD", ".BK": "THB",
    ".JK": "IDR", ".KS": "KRW", ".KQ": "KRW", ".NS": "INR", ".BO": "INR", ".NZ": "NZD", ".ST": "SEK",
    ".OL": "NOK", ".CO": "DKK", ".SA": "BRL", ".MX": "MXN", ".PS": "PHP",
}


def guess_currency(symbol: str) -> str:
    s = symbol.upper()
    for suf in sorted(SUFFIX_CCY, key=len, reverse=True):
        if s.endswith(suf):
            return SUFFIX_CCY[suf]
    return "USD"
