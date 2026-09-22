/**
 * Riftbound booster-pack pull rates.
 *
 * Pack structure (official — playriftbound.com/en-us/how-to-play):
 *   7 Commons (non-foil)
 *   3 Uncommons (non-foil)
 *   2 foil Rare-or-better slots (guaranteed Rare; can upgrade to Epic)
 *   1 foil wildcard slot (any rarity — where Alt Arts, Overnumbers & Signatures hit)
 *   1 token slot (not a tradeable card)
 *
 * Pull rates per pack:
 *   Epic         25%   (~1 in 4)    — Official (playriftbound.com announcements)
 *   Alt Art       8.3% (~2/box)     — Official (~2 per 24-pack box)
 *   Overnumber    1.4% (~1 in 72)   — Community (gillygabyte / X)
 *   Signature     0.14% (~1 in 720) — Community (gillygabyte / X)
 *
 * The actual EV computation lives server-side in app/api/pack-analysis/riftbound/route.ts, which
 * reads live prices straight from the catalog — this file used to also carry a full parallel
 * implementation (SetEVData, computeEV(), RIFTBOUND_EV_SETS with per-set data frozen at authoring
 * time) that nothing but this same file's own PULL_RATES was ever actually imported from
 * (PackAnalysisPage.tsx only ever used PULL_RATES); the rest was dead code that had already
 * silently diverged from the real, live-computed formula. Removed rather than kept in sync by
 * hand with a route it wasn't even wired to.
 */
export const PULL_RATES = {
  epicPerPack: 0.25,         // official
  altArtPerPack: 0.0833,     // official (~2 per 24-pack box)
  overnumberPerPack: 0.014,  // community
  signaturePerPack: 0.0014,  // community
} as const
