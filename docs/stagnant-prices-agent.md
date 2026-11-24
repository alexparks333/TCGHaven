# Pricing stagnant cards — instructions for an AI agent

Run by `/update-stagnant-prices [game] [set or card words]` in Claude Code (the command in
`.claude/commands/update-stagnant-prices.md` just points here — `.claude/` is gitignored, so on a
new computer copy that file over or paste: "Follow docs/stagnant-prices-agent.md for <game>").
What "stagnant" means and how the hand price survives syncs: docs/catalog.md "Stagnant prices".

## The job

1. **List them:** `npm run stagnant-prices -- list --game <game> --json` (all games: leave out
   `--game`; Magic is left out of the check).
   Narrow to the set/cards the person named. Never-priced cards come first, then the oldest hand
   prices. Each row has `reason`: `no-price`, `hand-added`, or `manual` (priced by hand before —
   re-check it).
2. **Research each card's raw, ungraded, Near Mint price in US dollars:**
   - Recent **sold** prices first: eBay sold/completed listings, PriceCharting's ungraded price,
     TCGplayer sales history, CardTrader, Cardmarket (convert €), and for Chinese/Korean-only cards
     the marketplaces that sell them. Asking prices are weaker evidence than sales — say so in the note.
   - Match the exact printing: number (`025a`, `303a`, `*` Signature), language, foil, promo stamp,
     serial numbering. A graded (PSA/BGS/CGC) sale is not a raw price.
   - eBay blocks plain page fetches; use web search, or the Chrome tools when connected.
   - No trustworthy evidence → **skip it** and say why. Never guess or copy another card's price.
3. **Show the person the proposed prices before writing anything** — a table: card, current price,
   new price, evidence (sales count, range, dates, links). Wait for their OK; they may change some.
4. **Write the approved ones**, one call per card:
   `npm run stagnant-prices -- set <game> <id> <price> [--foil <price>] --note "<source>"`
   - `--note` is required and is shown to staff: where, how many sales, the range, the month —
     e.g. `"eBay sold: 4 sales Nov 2026, $410–$480"`.
   - `--foil` only when the card has a separate foil printing with its own price.
   - Add `--dry-run` first if unsure. The script refuses a card that isn't stagnant (a sync or
     PriceCharting already keeps its price).
5. **Report** what was priced, what was skipped and why. The app shows the new prices within about
   2 minutes.

## Never

- Change anything but the price of stagnant cards (no names, sets, images, hiding).
- Price a card without a `--note` that lets a person check it.
- Put PriceCharting **graded** prices on a card (CLAUDE.md rule 39) — PriceCharting's *ungraded*
  price is fine as evidence for the raw price.
- Print or paste any secret from `.env.local`.
