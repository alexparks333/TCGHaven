// The currency prices are SHOWN in (Settings → Currency). Everything is tracked and stored in US
// dollars — the catalog's prices, purchase prices, sales, history — and only converted on the way
// to the screen, by formatCurrency() (lib/utils.ts), at a daily rate from /api/fx (the European
// Central Bank's reference rates). A collector's choice is saved on their account
// (users/{uid}/settings/preferences `currency`, lib/preferencesSync.ts) and on this device.

export const CURRENCIES = [
  { code: 'USD', name: 'US dollar', flag: '🇺🇸' },
  { code: 'CAD', name: 'Canadian dollar', flag: '🇨🇦' },
  { code: 'EUR', name: 'Euro', flag: '🇪🇺' },
  { code: 'GBP', name: 'British pound', flag: '🇬🇧' },
  { code: 'AUD', name: 'Australian dollar', flag: '🇦🇺' },
  { code: 'NZD', name: 'New Zealand dollar', flag: '🇳🇿' },
  { code: 'JPY', name: 'Japanese yen', flag: '🇯🇵' },
  { code: 'MXN', name: 'Mexican peso', flag: '🇲🇽' },
  { code: 'CHF', name: 'Swiss franc', flag: '🇨🇭' },
  { code: 'SEK', name: 'Swedish krona', flag: '🇸🇪' },
  { code: 'NOK', name: 'Norwegian krone', flag: '🇳🇴' },
  { code: 'DKK', name: 'Danish krone', flag: '🇩🇰' },
  { code: 'PLN', name: 'Polish złoty', flag: '🇵🇱' },
  { code: 'SGD', name: 'Singapore dollar', flag: '🇸🇬' },
  { code: 'HKD', name: 'Hong Kong dollar', flag: '🇭🇰' },
  { code: 'KRW', name: 'South Korean won', flag: '🇰🇷' },
  { code: 'BRL', name: 'Brazilian real', flag: '🇧🇷' },
] as const
export type CurrencyCode = typeof CURRENCIES[number]['code']
export const isCurrency = (c: unknown): c is CurrencyCode => CURRENCIES.some((x) => x.code === c)

const RATES_KEY = 'tcghaven-fx' // this device's last rates: { at, rates: { CAD: 1.37, … } }
const CHOICE_KEY = 'tcghaven-currency'

// What formatCurrency uses right now. USD (rate 1) until a choice AND its rate are known — never a
// converted number at a guessed rate.
let current: { code: CurrencyCode; rate: number } = { code: 'USD', rate: 1 }
let rates: Record<string, number> = {}

function readLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(RATES_KEY) || 'null') as { rates?: Record<string, number> } | null
    if (saved?.rates) rates = saved.rates
    const code = localStorage.getItem(CHOICE_KEY)
    if (isCurrency(code) && (code === 'USD' || rates[code])) current = { code, rate: code === 'USD' ? 1 : rates[code] }
  } catch { /* blocked storage: USD */ }
}
// So the first paint is already in the chosen currency. Not the staff portal: its money is USD.
if (typeof window !== 'undefined' && !location.pathname.startsWith('/admin')) readLocal()

export const displayCurrency = () => current

/** Sets the currency shown; true if it took (USD, or a currency whose rate is known). */
export function applyCurrency(code: CurrencyCode): boolean {
  try { localStorage.setItem(CHOICE_KEY, code) } catch { /* fine */ }
  if (code === 'USD') { current = { code, rate: 1 }; return true }
  if (!rates[code]) return false
  current = { code, rate: rates[code] }
  return true
}

/** Today's rates from the server (cached there for hours); kept on the device for next time. */
export async function refreshRates(): Promise<boolean> {
  try {
    const r = await fetch('/api/fx')
    if (!r.ok) return false
    const body = (await r.json()) as { rates?: Record<string, number> }
    if (!body.rates) return false
    rates = body.rates
    try { localStorage.setItem(RATES_KEY, JSON.stringify({ at: Date.now(), rates })) } catch { /* fine */ }
    return true
  } catch { return false }
}
