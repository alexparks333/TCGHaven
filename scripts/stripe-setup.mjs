// Sets up Haven Premium in Stripe — TEST MODE ONLY (a sandbox / sk_test_ key; refuses a live key).
//   npm run stripe-setup
// Creates (or reuses) the "Haven Premium" product, a monthly and a yearly price at the prices on the
// staff portal's Haven Premium page (premium/config), and a billing portal configuration (cancel,
// switch plan, update card, invoices). Writes STRIPE_PRICE_MONTHLY / STRIPE_PRICE_YEARLY (price ids
// — not secrets) into .env.local. Safe to run again: prices are found by lookup key, and a changed
// price gets a new Stripe price that takes the lookup key over. Never prints the secret key.
// docs/premium-business.md

import fs from 'node:fs'

const ENV = '.env.local'
const envText = fs.readFileSync(ENV, 'utf8')
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => {
    const i = l.indexOf('=')
    return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
  }),
)

const key = env.STRIPE_SECRET_KEY
if (!key) { console.error('Add STRIPE_SECRET_KEY (your sandbox key, sk_test_…) to .env.local first.'); process.exit(1) }
if (!/^(sk|rk)_test_/.test(key)) { console.error('STRIPE_SECRET_KEY is not a test key — this script only runs against a Stripe sandbox.'); process.exit(1) }

async function stripe(method, path, params) {
  const body = params ? new URLSearchParams(params).toString() : undefined
  const res = await fetch(`https://api.stripe.com/v1/${path}${method === 'GET' && body ? `?${body}` : ''}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(method === 'POST' && { 'Content-Type': 'application/x-www-form-urlencoded' }) },
    body: method === 'POST' ? body : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Stripe ${path}: ${data?.error?.message ?? res.status}`)
  return data
}

// The prices on the Haven Premium page (public read)
async function premiumPrices() {
  const project = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  try {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/premium/config`)
    const f = (await res.json()).fields ?? {}
    const num = (v, d) => Number(v?.doubleValue ?? v?.integerValue ?? d) || d
    return { monthly: num(f.monthly, 3.99), yearly: num(f.yearly, 34.99) }
  } catch { return { monthly: 3.99, yearly: 34.99 } }
}

const cents = (usd) => String(Math.round(usd * 100))

async function main() {
  const prices = await premiumPrices()
  console.log(`Haven Premium prices: $${prices.monthly.toFixed(2)}/month, $${prices.yearly.toFixed(2)}/year`)

  const found = await stripe('GET', 'products/search', { query: "metadata['app']:'tcghaven-premium'" })
  const product = found.data[0] ?? await stripe('POST', 'products', {
    name: 'Haven Premium',
    description: 'Unlimited scans, graded prices and price history, full-colour badges and 3D pins, portfolio analytics.',
    'metadata[app]': 'tcghaven-premium',
  })
  console.log(`Product: ${product.id}${found.data[0] ? ' (already there)' : ' (created)'}`)

  const ids = {}
  for (const [plan, interval] of [['monthly', 'month'], ['yearly', 'year']]) {
    const lookup = `haven_premium_${plan}`
    const have = (await stripe('GET', 'prices', { 'lookup_keys[]': lookup, active: 'true' })).data[0]
    if (have && have.unit_amount === Number(cents(prices[plan])) && have.product === product.id) {
      ids[plan] = have.id
      console.log(`${plan}: ${have.id} (already there)`)
      continue
    }
    const p = await stripe('POST', 'prices', {
      product: product.id, currency: 'usd', unit_amount: cents(prices[plan]),
      'recurring[interval]': interval, lookup_key: lookup, transfer_lookup_key: 'true',
      nickname: `Haven Premium ${plan}`,
    })
    ids[plan] = p.id
    // The old price stops being offered (archived, not deleted — existing subscribers keep it)
    if (have) await stripe('POST', `prices/${have.id}`, { active: 'false' })
    console.log(`${plan}: ${p.id} (created)`)
  }

  // The billing portal: cancel at period end, switch monthly ↔ yearly, update card, see invoices
  const configs = await stripe('GET', 'billing_portal/configurations', { is_default: 'true', limit: '1' })
  const portal = {
    'business_profile[headline]': 'TCG Haven — manage Haven Premium',
    'features[subscription_cancel][enabled]': 'true',
    'features[subscription_cancel][mode]': 'at_period_end',
    'features[payment_method_update][enabled]': 'true',
    'features[invoice_history][enabled]': 'true',
    'features[subscription_update][enabled]': 'true',
    'features[subscription_update][default_allowed_updates][0]': 'price',
    'features[subscription_update][products][0][product]': product.id,
    'features[subscription_update][products][0][prices][0]': ids.monthly,
    'features[subscription_update][products][0][prices][1]': ids.yearly,
  }
  if (configs.data[0]) await stripe('POST', `billing_portal/configurations/${configs.data[0].id}`, portal)
  else await stripe('POST', 'billing_portal/configurations', portal)
  console.log('Billing portal: set up')

  // Price ids into .env.local (replacing old lines)
  let text = envText
  for (const [name, value] of [['STRIPE_PRICE_MONTHLY', ids.monthly], ['STRIPE_PRICE_YEARLY', ids.yearly]]) {
    const line = `${name}=${value}`
    text = new RegExp(`^${name}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${name}=.*$`, 'm'), line) : `${text.replace(/\s*$/, '')}\n${line}\n`
  }
  if (text !== envText) { fs.writeFileSync(ENV, text); console.log('.env.local: price ids saved') }
  console.log('Done. Restart the dev server so it reads the new settings.')
}

main().catch((e) => { console.error(e.message); process.exit(1) })
