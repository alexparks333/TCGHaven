'use client'

import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, Package, FolderHeart, ChevronRight, Search, X, Sparkles } from 'lucide-react'
import { useStore } from '@/lib/store'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { GAME_COLORS, type Game, type Card } from '@/lib/types'
import { cn, RARITY_LABELS_BY_GAME, openEbaySearch } from '@/lib/utils'
import { CARDEX_RARITY_ORDER } from '@/lib/api/catalog'
import { PersonalCollectionsView } from './PersonalCollectionsView'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatalogCard {
  id: string
  name: string
  number: string
  setCode: string
  setName: string
  rarity: string
  imageUrl: string
  marketPrice: number
}

type CatalogGame = 'lorcana' | 'riftbound' | 'pokemon' | 'onepiece' | 'mtg'

interface SetMeta {
  name: string           // catalog set name, or '__special__' for inventory-only bucket
  game: CatalogGame
  label?: string         // display label when different from name
  fromInventory?: true   // skip API; show owned inventory cards not in any known set
}

interface SetGroup {
  label: string
  sets: SetMeta[]
}

// The isolated card view CardZoomOverlay renders — normalized so both CardTile (catalog-backed,
// carries `owned`/`quantity`) and InventoryCardTile (special bucket, always owned) can feed it the
// same shape without the overlay needing to know which kind of tile it came from.
interface ZoomCardData {
  imageUrl: string
  name: string
  number: string
  rarityLabel: string
  rarityColor: string
  marketPrice: number
  owned: boolean
  quantity: number
  isFoil?: boolean
  gameColor: string
  ebayCard: Parameters<typeof openEbaySearch>[0]
  originRect: DOMRect
}

// ── Set catalog (fetched from /api/set-registry — see lib/api/registry.ts) ────
// Groups/known-sets used to be hardcoded here; they're now derived from the registry
// (Firestore registry/main doc) so Admin Catalog's "Sync Card Data" feature can register
// newly-discovered sets without editing this file.

interface RegistrySet {
  setName: string
  cardexGroup: string | null
  cardexLabel?: string
}

interface SetRegistryResponse {
  lorcana: { groupOrder: string[]; sets: RegistrySet[] }
  riftbound: { groupOrder: string[]; sets: RegistrySet[] }
}

// Pokemon has no registry-curated cardexGroup (170+ sets — hand-curating a group per set isn't
// worth it). Instead its groups are derived automatically from the `series` field the live
// api.pokemontcg.io set list already carries (e.g. "Scarlet & Violet", "Sword & Shield", "Base")
// — see buildPokemonGroups() below. This is genuinely simpler than the Lorcana/Riftbound
// registry-group approach, not a lesser version of it.
interface PokemonSetOption {
  code: string
  name: string
  releaseDate: string
  series?: string
  isCustom?: boolean
}

// One Piece has no live external "sets" API AND no registry-curated cardexGroup (see CLAUDE.md
// quirk #9 and lib/api/registry.ts's OnePieceRegistrySet comment) — its set list comes from
// /api/sets?game=onepiece (backed by the registry, which catalog-sync.mjs's downloadOnePiece()
// itself populates), and its groups are derived automatically from `code`'s prefix instead of a
// `series` field, since apitcg's data has nothing like Pokemon's series — see
// buildOnePieceGroups() below.
interface OnePieceSetOption {
  code: string
  name: string
  releaseDate: string
  isCustom?: boolean
}

// MTG has a live external "sets" API (api.scryfall.com/sets) like Pokemon, so it's registry-free
// the same way — but Scryfall carries no `series`-equivalent field, so its Cardex grouping uses
// `setType` (Scryfall's own `set_type`, e.g. "expansion", "core", "commander") instead — see
// buildMtgGroups() below.
interface MtgSetOption {
  code: string
  name: string
  releaseDate: string
  setType?: string
  isCustom?: boolean
}

const PLACEHOLDER_SET: SetMeta = { name: '', game: 'lorcana' }

const EMPTY_GROUPS_BY_GAME: Record<CatalogGame, SetGroup[]> = { lorcana: [], riftbound: [], pokemon: [], onepiece: [], mtg: [] }

// Deep-link support (e.g. clicking a "Card Unlocked" toast) — ?game=riftbound&set=Secret+Garden
function isCatalogGame(v: string | null): v is CatalogGame {
  return v === 'lorcana' || v === 'riftbound' || v === 'pokemon' || v === 'onepiece' || v === 'mtg'
}

function buildGroups(
  registrySide: { groupOrder: string[]; sets: RegistrySet[] },
  game: 'lorcana' | 'riftbound',
  specialBucket: SetMeta,
  specialBucketOwnGroup: string | null, // if set, special bucket gets its own trailing group with this label; otherwise it's appended to the last existing group
): SetGroup[] {
  const byGroup = new Map<string, SetMeta[]>()
  for (const label of registrySide.groupOrder) byGroup.set(label, [])
  for (const s of registrySide.sets) {
    if (!s.cardexGroup) continue
    if (!byGroup.has(s.cardexGroup)) byGroup.set(s.cardexGroup, [])
    byGroup.get(s.cardexGroup)!.push({ name: s.setName, game, label: s.cardexLabel })
  }
  const groups: SetGroup[] = Array.from(byGroup.entries()).map(([label, sets]) => ({ label, sets }))
  if (specialBucketOwnGroup) {
    groups.push({ label: specialBucketOwnGroup, sets: [specialBucket] })
  } else if (groups.length > 0) {
    groups[groups.length - 1].sets.push(specialBucket)
  } else {
    groups.push({ label: 'Special', sets: [specialBucket] })
  }
  return groups
}

function buildGroupsByGame(registry: SetRegistryResponse): Record<'lorcana' | 'riftbound', SetGroup[]> {
  return {
    lorcana: buildGroups(
      registry.lorcana, 'lorcana',
      { name: '__special__', game: 'lorcana', label: 'D23, Cruise & Special', fromInventory: true },
      null, // appended to the existing last group ("Promos & Other"), matching prior behavior
    ),
    riftbound: buildGroups(
      registry.riftbound, 'riftbound',
      { name: '__special__', game: 'riftbound', label: 'Metal & Special', fromInventory: true },
      'Special', // its own trailing group, matching prior behavior
    ),
  }
}

// Builds Pokemon's Cardex groups from the live api.pokemontcg.io set list (already fetched
// newest-first by getSetsForGame/getPokemonSets — see lib/api/pokemon.ts). Grouping by `series`
// and relying on Map insertion order (first occurrence = each series' newest set, since the
// input is newest-first) naturally produces newest-era-first groups with zero manual curation —
// no registry entry is needed per set the way Lorcana/Riftbound need `cardexGroup`.
function buildPokemonGroups(sets: PokemonSetOption[]): SetGroup[] {
  const officialSets = sets.filter((s) => !s.isCustom)
  const customSets = sets.filter((s) => s.isCustom)

  const byGroup = new Map<string, SetMeta[]>()
  for (const s of officialSets) {
    const label = s.series || 'Other'
    if (!byGroup.has(label)) byGroup.set(label, [])
    byGroup.get(label)!.push({ name: s.name, game: 'pokemon' })
  }

  const groups: SetGroup[] = Array.from(byGroup.entries()).map(([label, sets]) => ({ label, sets }))

  // Custom sets (Admin Catalog "New Set", source: "manual") get their own trailing group rather
  // than being sorted into a real era — they aren't associated with any upstream series.
  if (customSets.length > 0) {
    groups.push({ label: 'Custom Sets', sets: customSets.map((s) => ({ name: s.name, game: 'pokemon' as const })) })
  }

  groups.push({
    label: 'Special',
    sets: [{ name: '__special__', game: 'pokemon', label: 'Promos & Other', fromInventory: true }],
  })

  return groups
}

// Builds One Piece's Cardex groups from the set-code `catalog-sync.mjs`'s downloadOnePiece()
// already derived. Only the numbered main-story boosters (OP01, OP02, ... — the sets a collector
// actually thinks of as "a One Piece set") get their own "Main Sets" group, sorted newest-first
// by that number and labeled with it (e.g. "Romance Dawn : OP-01") so it reads at a glance.
// Everything else — starter decks, extra/premium boosters, and the long tail of tournament/event
// promo "sets" apitcg tracks — collapses into a single "Special Sets" group instead of being
// split into its own per-prefix section; there are enough of these (dozens) that splitting them
// out just re-creates the "170+ Pokemon sets" clutter problem this whole scheme exists to avoid.
// Same "don't hand-curate every set" reasoning as Pokemon's series-based grouping either way —
// see CLAUDE.md quirk #9.
function buildOnePieceGroups(sets: OnePieceSetOption[]): SetGroup[] {
  const officialSets = sets.filter((s) => !s.isCustom)
  const customSets = sets.filter((s) => s.isCustom)

  const mainSets: Array<{ meta: SetMeta; num: number }> = []
  const specialSets: SetMeta[] = []

  for (const s of officialSets) {
    const opMatch = s.code.match(/^OP(\d+)$/)
    if (opMatch) {
      mainSets.push({
        meta: { name: s.name, game: 'onepiece', label: `${s.name} : OP-${opMatch[1]}` },
        num: parseInt(opMatch[1], 10),
      })
    } else {
      specialSets.push({ name: s.name, game: 'onepiece' })
    }
  }
  mainSets.sort((a, b) => b.num - a.num) // newest (highest OP number) first

  // Custom/manual sets (Admin Catalog "New Set") have no upstream numbering to speak of, so they
  // fold into Special Sets too rather than getting their own group.
  for (const s of customSets) specialSets.push({ name: s.name, game: 'onepiece' })

  const groups: SetGroup[] = []
  if (mainSets.length > 0) groups.push({ label: 'Main Sets', sets: mainSets.map((m) => m.meta) })
  if (specialSets.length > 0) groups.push({ label: 'Special Sets', sets: specialSets })

  groups.push({
    label: 'Unmatched',
    sets: [{ name: '__special__', game: 'onepiece', label: 'Other / Unmatched', fromInventory: true }],
  })

  return groups
}

// Builds MTG's Cardex groups from Scryfall's own `set_type` field (already fetched newest-first
// by getSetsForGame/getMtgSets — see lib/api/mtg.ts), the same "don't hand-curate hundreds of
// sets" reasoning as Pokemon's series-based grouping (CLAUDE.md quirk #9). The handful of types a
// collector actually thinks of as "a Magic set" (expansion, core, masters, commander, draft
// innovation, funny/Un-sets, promo) get their own labeled group; everything else (duel decks,
// premium decks, From the Vault, Spellbook Series, Archenemy/Planechase/Vanguard oversized-card
// products, starter sets, etc.) collapses into one "Special Sets" catch-all, same shape as One
// Piece's Main Sets/Special Sets split.
const MTG_SET_TYPE_LABELS: Record<string, string> = {
  expansion: 'Expansions',
  core: 'Core Sets',
  masters: 'Masters & Reprint Sets',
  commander: 'Commander',
  draft_innovation: 'Draft Innovation',
  funny: 'Un-Sets',
  promo: 'Promos',
}

function buildMtgGroups(sets: MtgSetOption[]): SetGroup[] {
  const officialSets = sets.filter((s) => !s.isCustom)
  const customSets = sets.filter((s) => s.isCustom)

  const byGroup = new Map<string, SetMeta[]>()
  const special: SetMeta[] = []
  for (const s of officialSets) {
    const label = MTG_SET_TYPE_LABELS[s.setType ?? '']
    if (!label) { special.push({ name: s.name, game: 'mtg' }); continue }
    if (!byGroup.has(label)) byGroup.set(label, [])
    byGroup.get(label)!.push({ name: s.name, game: 'mtg' })
  }

  const groups: SetGroup[] = Array.from(byGroup.entries()).map(([label, sets]) => ({ label, sets }))

  if (customSets.length > 0) {
    groups.push({ label: 'Custom Sets', sets: customSets.map((s) => ({ name: s.name, game: 'mtg' as const })) })
  }
  if (special.length > 0) groups.push({ label: 'Special Sets', sets: special })

  groups.push({
    label: 'Unmatched',
    sets: [{ name: '__special__', game: 'mtg', label: 'Other / Unmatched', fromInventory: true }],
  })

  return groups
}

// ── Rarity colors ─────────────────────────────────────────────────────────────

const RARITY_COLORS: Record<string, string> = {
  Common: '#6b7280', Uncommon: '#22c55e', Rare: '#3b82f6',
  Super_rare: '#a855f7', Legendary: '#f97316', Enchanted: '#ec4899', Iconic: '#eab308',
  Epic: '#06b6d4', 'Alt Art': '#fbbf24', Overnumbered: '#fbbf24', Showcase: '#fbbf24', Star: '#fbbf24', Promo: '#84cc16',
  // One Piece: L(eader), C(ommon), UC(ommon), R(are), S(uper) R(are), T(reasure) R(are — a real
  // premium chase tier, see CARDEX_RARITY_ORDER's comment), SEC(ret rare) — "SP CARD" is a
  // further-out special/promo print tier, P/PR both promotional-card codes.
  L: '#38bdf8', C: '#6b7280', UC: '#22c55e', R: '#3b82f6', SR: '#a855f7', TR: '#eab308',
  SEC: '#f97316', 'SP CARD': '#fbbf24', P: '#84cc16', PR: '#84cc16',
  // MTG: Scryfall's `rarity` field is always lowercase.
  common: '#6b7280', uncommon: '#22c55e', rare: '#3b82f6', mythic: '#f97316', special: '#a855f7', bonus: '#ec4899',
  // Pokemon — 44 real values (verified against api.pokemontcg.io/v2/rarities and the full
  // 176-set GitHub dataset), too many for a bespoke color each, so bucketed into 4 value tiers
  // instead: blue (the plain "Rare Holo" baseline, same as Rare) -> purple (the broad "holo
  // rare"-era mechanic tier: EX/GX/V/VMAX/VSTAR/ex, Prime, LEGEND, BREAK, Ultra, Double Rare,
  // ACE SPEC, ...) -> orange (harder pulls: Secret/Rainbow/Shiny/Amazing/Radiant/Illustration
  // Rare/regional exclusives) -> pink (the modern top chase tier: Special Illustration Rare,
  // Hyper Rare, Mega Hyper Rare, Mega Attack Rare). Common/Uncommon/Rare already share the
  // generic keys above. See CARDEX_RARITY_ORDER (lib/api/catalog.ts) for the same 44 values'
  // canonical sort order — that map is the source of truth for what counts as "known" at all;
  // this is purely a display color, unrelated to whether a value is safe to filter by.
  'Rare Holo': '#3b82f6',
  'Rare Holo EX': '#a855f7', 'Rare Holo Star': '#a855f7', 'Rare Holo LV.X': '#a855f7', LEGEND: '#a855f7',
  'Rare Prime': '#a855f7', 'Rare Ultra': '#a855f7', 'Rare ACE': '#a855f7', 'Rare BREAK': '#a855f7',
  'Rare Holo GX': '#a855f7', 'Rare Prism Star': '#a855f7', 'Rare Holo V': '#a855f7', 'Rare Holo VMAX': '#a855f7',
  'Classic Collection': '#a855f7', 'Rare Holo VSTAR': '#a855f7', 'Trainer Gallery Rare Holo': '#a855f7',
  'Double Rare': '#a855f7', 'Ultra Rare': '#a855f7', 'ACE SPEC Rare': '#a855f7',
  'Holo Rare V': '#a855f7', 'Holo Rare VMAX': '#a855f7', 'Holo Rare VSTAR': '#a855f7', 'Rare Holo ex': '#a855f7',
  'Rare Secret': '#f97316', 'Rare Shining': '#f97316', 'Rare Rainbow': '#f97316', 'Rare Shiny': '#f97316',
  'Rare Shiny GX': '#f97316', 'Amazing Rare': '#f97316', 'Radiant Rare': '#f97316', 'Illustration Rare': '#f97316',
  'Shiny Rare': '#f97316', 'Shiny Ultra Rare': '#f97316', 'Black White Rare': '#f97316',
  'Futuristic Rare': '#f97316', 'Pikachu Rare': '#f97316',
  'Special Illustration Rare': '#ec4899', 'Hyper Rare': '#ec4899', 'Mega Hyper Rare': '#ec4899', MEGA_ATTACK_RARE: '#ec4899',
  // App-local correction, not a real pokemontcg.io value — see CARDEX_RARITY_ORDER's comment
  // (lib/api/catalog.ts) for why. Same top-tier pink as the rest of the modern chase tier.
  'Secret Anniversary Rare': '#ec4899',
}

// Games whose rarity toggle filter is wired up in the Cardex — the filter/toggle-list logic
// below (rarityFilters, hiddenRarities) is fully generic per-game, driven by CARDEX_RARITY_ORDER
// (lib/api/catalog.ts) and RARITY_LABELS_BY_GAME (lib/utils.ts), so enabling it for another game
// is just adding it here plus, if its raw rarity strings need friendlier display text or new
// CARDEX_RARITY_ORDER/RARITY_COLORS entries, filling those in — no filtering-logic changes.
const RARITY_TOGGLE_GAMES = new Set<CatalogGame>(['riftbound', 'pokemon', 'lorcana', 'onepiece', 'mtg'])
const EMPTY_SET: Set<string> = new Set()

// ── Matching helpers ──────────────────────────────────────────────────────────

function getOwnedInfo(
  catalogCard: CatalogCard,
  ownedCards: Card[],
  game: Game,
): { owned: boolean; quantity: number } {
  const matches = ownedCards.filter((c) => {
    if (c.apiId) return c.apiId === catalogCard.id
    if (game === 'riftbound') return c.setCode === catalogCard.setCode && c.number === catalogCard.number
    if (game === 'lorcana') return c.set === catalogCard.setName && c.number === catalogCard.number
    // Pokemon: unlike Riftbound, a catalog number never has multiple docs sharing it (no
    // alt-art/overnumbered variant scheme) — a plain setName+number fallback match is safe.
    if (game === 'pokemon') return c.set === catalogCard.setName && c.number === catalogCard.number
    // One Piece: same reasoning as Pokemon — each print variant (base, Parallel, a 2nd/3rd
    // Parallel art) is a fully separate catalog id already (see catalog-sync.mjs's
    // downloadOnePiece()), so a plain setName+number fallback can only ever land on one of them
    // per number... except when a base card AND its Parallel share the same bare number, which
    // they do. Card.number here is the same value the search dropdown fills in from result.number
    // (also just the bare digits, no variant marker), so this fallback — only ever hit for a
    // manually-typed card with no apiId — has the same "collapses onto the base card" limitation
    // Riftbound's number-only fallback has; always add via the search dropdown to avoid it.
    if (game === 'onepiece') return c.set === catalogCard.setName && c.number === catalogCard.number
    // MTG: same reasoning as Pokemon/One Piece — a different art/printing of the same card
    // always gets its own distinct collector number as a separate Scryfall object (finish
    // — foil vs. nonfoil — is a price field on that one object, not a second catalog id the way
    // Riftbound's variants are), so a bare setName+number fallback can't collapse two real
    // printings onto one Cardex slot.
    if (game === 'mtg') return c.set === catalogCard.setName && c.number === catalogCard.number
    return false
  })
  return { owned: matches.length > 0, quantity: matches.reduce((s, c) => s + c.quantity, 0) }
}

// ── Search filtering ─────────────────────────────────────────────────────────

// Plain substring match against name (and collector number, so "#42" or "42" also works) —
// deliberately simpler than AddCardDialog's scoreMatch()/word-start ranking, since this filters
// a set that's already small (one set's worth of cards, or one personal collection) rather than
// searching the whole catalog for a dropdown.
function matchesSearch(query: string, name: string, number: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return name.toLowerCase().includes(q) || number.toLowerCase().includes(q.replace(/^#/, ''))
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CardexPage() {
  const { cards } = useStore()

  // Deep-link support — e.g. clicking a "Card Unlocked" toast navigates to
  // /cardex?game=riftbound&set=Secret+Garden. Read once; a mid-session change to the URL isn't
  // expected to re-drive the page (the user is already browsing at that point).
  const searchParams = useSearchParams()
  const urlGame = searchParams.get('game')
  const urlSet = searchParams.get('set')

  const [activeGame, setActiveGame] = useState<CatalogGame | 'personal'>(isCatalogGame(urlGame) ? urlGame : 'pokemon')
  const [activeSet, setActiveSet] = useState<SetMeta>(PLACEHOLDER_SET)
  const [catalogCards, setCatalogCards] = useState<CatalogCard[]>([])
  const [loading, setLoading] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  // The isolated "zoom" view a plain click on a tile opens — see CardZoomOverlay below. Holding
  // the clicked tile's own bounding rect here (captured at click time) is what lets the overlay
  // fly the card from wherever it actually was in the grid rather than a fixed spot.
  const [zoomCard, setZoomCard] = useState<ZoomCardData | null>(null)
  function openZoom(el: HTMLElement, data: Omit<ZoomCardData, 'originRect'>) {
    setZoomCard({ ...data, originRect: el.getBoundingClientRect() })
  }
  const [searchQuery, setSearchQuery] = useState('')
  // Riftbound-only rarity toggle filter — persists across sets/tabs on purpose (switching from
  // Origins to Spiritforged with "Alt Art" toggled off should keep it off), so this isn't reset
  // alongside searchQuery. A rarity in this set is hidden; empty set means nothing's hidden.
  const [hiddenRarities, setHiddenRarities] = useState<Set<string>>(new Set())
  const [groupsByGame, setGroupsByGame] = useState(EMPTY_GROUPS_BY_GAME)
  const [registryLoading, setRegistryLoading] = useState(true)
  const [pokemonSetsLoading, setPokemonSetsLoading] = useState(true)
  const [onepieceSetsLoading, setOnepieceSetsLoading] = useState(true)
  const [mtgSetsLoading, setMtgSetsLoading] = useState(true)

  // The set picker is a two-level tree: pick a category (an era/product group, e.g. "Scarlet &
  // Violet" or "Main Sets") first, then pick a set from just that category's list — replacing an
  // earlier design that rendered every group's sets expanded all at once (170+ pill buttons for
  // Pokemon alone, most of the page spent scrolling past sets before reaching the actual grid).
  // Remembered per game so switching from Pokemon to Riftbound and back doesn't reset which era
  // you were browsing.
  const [activeCategoryByGame, setActiveCategoryByGame] = useState<Partial<Record<CatalogGame, string>>>({})

  // Only the very first successful group fetch (whichever game it's for) gets to pick the
  // initial active set — otherwise the lorcana/riftbound registry fetch and the Pokemon live-set
  // fetch (which run independently, and can resolve in either order) would race to overwrite
  // each other's default selection. Starts pre-claimed when a deep-link game is present, so none
  // of the four generic pickers below fire — the dedicated effect further down handles picking
  // the actual set (by name, or falling back to the Special bucket) once that game's groups load.
  const initialSetPicked = useRef(isCatalogGame(urlGame))
  const urlSetApplied = useRef(false)

  // "Personalized Collections" isn't a catalog game — fall back to a safe key for the
  // catalog-indexed lookups below (groupsByGame, GAME_COLORS), none of which actually get
  // rendered while that tab is active.
  const catalogGame: CatalogGame = activeGame === 'personal' ? 'lorcana' : activeGame
  const gameColor = activeGame === 'personal' ? '#8b5cf6' : GAME_COLORS[catalogGame]

  // Load Lorcana/Riftbound set groups from the registry once on mount.
  useEffect(() => {
    let stale = false
    fetch('/api/set-registry')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SetRegistryResponse | null) => {
        if (stale || !data) return
        const built = buildGroupsByGame(data)
        setGroupsByGame((g) => ({ ...g, ...built }))
        if (!initialSetPicked.current && (activeGame === 'lorcana' || activeGame === 'riftbound')) {
          const first = built[activeGame][0]
          setActiveSet(first?.sets[0] ?? PLACEHOLDER_SET)
          if (first) setActiveCategoryByGame((c) => ({ ...c, [activeGame]: first.label }))
          initialSetPicked.current = true
        }
      })
      .catch(() => {})
      .finally(() => { if (!stale) setRegistryLoading(false) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load Pokemon's set list (live api.pokemontcg.io data, same endpoint AddCardDialog uses) once
  // on mount and derive Cardex groups from it client-side — see buildPokemonGroups() above for
  // why this doesn't need a registry entry per set the way Lorcana/Riftbound do.
  useEffect(() => {
    let stale = false
    fetch('/api/sets?game=pokemon')
      .then((r) => (r.ok ? r.json() : []))
      .then((sets: PokemonSetOption[]) => {
        if (stale) return
        const built = buildPokemonGroups(sets)
        setGroupsByGame((g) => ({ ...g, pokemon: built }))
        if (!initialSetPicked.current && activeGame === 'pokemon') {
          setActiveSet(built[0]?.sets[0] ?? PLACEHOLDER_SET)
          if (built[0]) setActiveCategoryByGame((c) => ({ ...c, pokemon: built[0].label }))
          initialSetPicked.current = true
        }
      })
      .catch(() => {})
      .finally(() => { if (!stale) setPokemonSetsLoading(false) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load One Piece's set list (registry-backed — see /api/sets?game=onepiece via
  // lib/api/onepiece.ts's getOnePieceSets()) once on mount and derive Cardex groups from it
  // client-side — see buildOnePieceGroups() above.
  useEffect(() => {
    let stale = false
    fetch('/api/sets?game=onepiece')
      .then((r) => (r.ok ? r.json() : []))
      .then((sets: OnePieceSetOption[]) => {
        if (stale) return
        const built = buildOnePieceGroups(sets)
        setGroupsByGame((g) => ({ ...g, onepiece: built }))
        if (!initialSetPicked.current && activeGame === 'onepiece') {
          setActiveSet(built[0]?.sets[0] ?? PLACEHOLDER_SET)
          if (built[0]) setActiveCategoryByGame((c) => ({ ...c, onepiece: built[0].label }))
          initialSetPicked.current = true
        }
      })
      .catch(() => {})
      .finally(() => { if (!stale) setOnepieceSetsLoading(false) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load MTG's set list (live api.scryfall.com/sets data, same endpoint AddCardDialog uses) once
  // on mount and derive Cardex groups from it client-side — see buildMtgGroups() above for why
  // this doesn't need a registry entry per set the way Lorcana/Riftbound do.
  useEffect(() => {
    let stale = false
    fetch('/api/sets?game=mtg')
      .then((r) => (r.ok ? r.json() : []))
      .then((sets: MtgSetOption[]) => {
        if (stale) return
        const built = buildMtgGroups(sets)
        setGroupsByGame((g) => ({ ...g, mtg: built }))
        if (!initialSetPicked.current && activeGame === 'mtg') {
          setActiveSet(built[0]?.sets[0] ?? PLACEHOLDER_SET)
          if (built[0]) setActiveCategoryByGame((c) => ({ ...c, mtg: built[0].label }))
          initialSetPicked.current = true
        }
      })
      .catch(() => {})
      .finally(() => { if (!stale) setMtgSetsLoading(false) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Resolves a deep-linked ?game=&set= once that game's groups have finished loading. Looks for
  // an exact-name match among registered sets first; a card added under a set name the catalog
  // doesn't recognize (not yet synced, or genuinely custom) instead lands in that game's
  // inventory-only Special bucket, same as it does when browsing normally. Also force-opens the
  // containing group if it defaults to collapsed (Promos/Special Sets/etc.), so the picked set's
  // pill is actually visible rather than hidden under a collapsed header.
  useEffect(() => {
    if (!isCatalogGame(urlGame) || urlGame !== activeGame || urlSetApplied.current) return
    const groups = groupsByGame[urlGame]
    if (groups.length === 0) return // this game's groups haven't loaded yet
    urlSetApplied.current = true

    let chosen: SetMeta | null = null
    let chosenGroupLabel: string | null = null
    if (urlSet) {
      for (const g of groups) {
        const found = g.sets.find((s) => !s.fromInventory && s.name === urlSet)
        if (found) { chosen = found; chosenGroupLabel = g.label; break }
      }
      if (!chosen) {
        for (const g of groups) {
          const special = g.sets.find((s) => s.fromInventory)
          if (special) { chosen = special; chosenGroupLabel = g.label; break }
        }
      }
    }
    if (!chosen) { chosen = groups[0]?.sets[0] ?? null; chosenGroupLabel = groups[0]?.label ?? null }

    setActiveSet(chosen ?? PLACEHOLDER_SET)
    if (chosenGroupLabel) {
      setActiveCategoryByGame((c) => ({ ...c, [urlGame]: chosenGroupLabel! }))
    }
  }, [urlGame, urlSet, activeGame, groupsByGame])

  const knownSets = useMemo(() => {
    const s = new Set<string>()
    for (const g of groupsByGame[catalogGame]) {
      for (const set of g.sets) if (!set.fromInventory) s.add(set.name)
    }
    return s
  }, [groupsByGame, catalogGame])

  // Cards for the active game from inventory
  const gameCards = useMemo(() => cards.filter((c) => c.game === catalogGame), [cards, catalogGame])

  // Special bucket: inventory cards whose set is NOT in the known catalog sets
  const specialCards = useMemo(
    () => gameCards.filter((c) => !knownSets.has(c.set)),
    [gameCards, knownSets],
  )

  // Fetch catalog when set changes (skip for inventory-only buckets, the Personalized
  // Collections tab, or before sets have loaded)
  useEffect(() => {
    if (activeGame === 'personal' || !activeSet.name || activeSet.fromInventory) {
      // Explicit setLoading(false) here matters: switching to a fromInventory set while a
      // previous real-set fetch is still in flight leaves `loading` stuck true forever
      // otherwise — that fetch's own cleanup marks itself `stale` (correctly suppressing its
      // stale setCatalogCards), which also suppresses its `finally`'s setLoading(false), and
      // this branch never sets it itself. Reproduces trivially for any game whose only group is
      // "Special" (e.g. One Piece before its first sync populates the registry) — every set
      // click lands here, so a slow prior request's dangling `loading=true` never gets undone.
      setCatalogCards([])
      setLoading(false)
      return
    }
    let stale = false // rapid set switching: ignore responses for a set we've left
    setLoading(true)
    setCatalogCards([])
    fetch(`/api/cardex?game=${activeGame}&set=${encodeURIComponent(activeSet.name)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((cards: CatalogCard[]) => { if (!stale) setCatalogCards(cards) })
      .catch(() => {})
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [activeGame, activeSet])

  // A search left over from a previous set/game is almost never what you want on the next one.
  useEffect(() => { setSearchQuery('') }, [activeGame, activeSet])

  function switchGame(game: CatalogGame | 'personal') {
    setActiveGame(game)
    if (game === 'personal') return
    const groups = groupsByGame[game]
    // Restore whichever category was last active for this game, if it still exists; otherwise
    // fall back to the first one. Lets switching Pokemon -> Riftbound -> back to Pokemon land on
    // the same era instead of resetting to the top every time.
    const remembered = activeCategoryByGame[game]
    const group = groups.find((g) => g.label === remembered) ?? groups[0]
    setActiveSet(group?.sets[0] ?? PLACEHOLDER_SET)
    if (group) setActiveCategoryByGame((c) => ({ ...c, [game]: group.label }))
  }

  function selectCategory(label: string) {
    setActiveCategoryByGame((c) => ({ ...c, [catalogGame]: label }))
    const group = groupsByGame[catalogGame].find((g) => g.label === label)
    setActiveSet(group?.sets[0] ?? PLACEHOLDER_SET)
  }

  function toggleRarity(rarity: string) {
    setHiddenRarities((prev) => {
      const next = new Set(prev)
      if (next.has(rarity)) next.delete(rarity)
      else next.add(rarity)
      return next
    })
  }

  // Enrich catalog cards with owned status
  const enriched = useMemo(
    () => catalogCards.map((cc) => ({ ...cc, ...getOwnedInfo(cc, gameCards, catalogGame) })),
    [catalogCards, gameCards, catalogGame],
  )

  // Progress is always against the full set, not the filtered search view.
  const ownedCount = enriched.filter((c) => c.owned).length
  const totalCount = enriched.length
  const pct = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0

  // Every distinct rarity actually present in the active set, not a fixed list — a hardcoded
  // list silently lets anything outside it become permanently un-hideable (this shipped broken
  // once for Riftbound: Rune cards carry TCGPlayer-sourced "Showcase"/"Promo" rarity values that
  // were never in the original fixed toggle array, so no toggle could ever hide them). Known
  // values sort first by CARDEX_RARITY_ORDER's shared priority map (lib/api/catalog.ts);
  // anything else present sorts after, alphabetically, so a genuinely new/unexpected rarity (a
  // future set's new tier before this app has been updated for it) shows up as a toggle instead
  // of silently bypassing the filter.
  const rarityFilters = useMemo(() => {
    if (!RARITY_TOGGLE_GAMES.has(catalogGame)) return []
    const present = new Set(enriched.map((c) => c.rarity).filter((r): r is string => !!r))
    return Array.from(present).sort((a, b) => {
      const pa = CARDEX_RARITY_ORDER[a] ?? 9999
      const pb = CARDEX_RARITY_ORDER[b] ?? 9999
      return pa !== pb ? pa - pb : a.localeCompare(b)
    })
  }, [catalogGame, enriched])

  const filteredEnriched = useMemo(() => {
    let list = enriched
    if (searchQuery.trim()) list = list.filter((c) => matchesSearch(searchQuery, c.name, c.number))
    if (RARITY_TOGGLE_GAMES.has(catalogGame) && hiddenRarities.size > 0) list = list.filter((c) => !hiddenRarities.has(c.rarity))
    return list
  }, [enriched, searchQuery, catalogGame, hiddenRarities])

  const isSpecial = activeSet.fromInventory

  // The active game's categories (eras/product groups) and which one is currently selected —
  // drives the two-tier tree picker below (category list, then that category's sets).
  const categories = groupsByGame[catalogGame]
  const activeCategoryLabel = activeCategoryByGame[catalogGame] ?? categories[0]?.label
  const activeCategoryGroup = categories.find((g) => g.label === activeCategoryLabel) ?? categories[0]
  const setsLoading = catalogGame === 'pokemon' ? pokemonSetsLoading : catalogGame === 'onepiece' ? onepieceSetsLoading : catalogGame === 'mtg' ? mtgSetsLoading : registryLoading

  return (
    <AuthGuard>
      <div className="pb-20 md:pb-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Cardex</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Your personal collection tracker — grey means missing, full color means you own it.
          </p>
        </div>

        {/* Game tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {(['pokemon', 'onepiece', 'lorcana', 'riftbound', 'mtg', 'personal'] as const).map((game) => (
            <button
              key={game}
              onClick={() => switchGame(game)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all',
                activeGame === game
                  ? 'text-white shadow-lg'
                  : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800',
              )}
              style={activeGame === game
                ? { backgroundColor: (game === 'personal' ? '#8b5cf6' : GAME_COLORS[game]) + '33', color: game === 'personal' ? '#8b5cf6' : GAME_COLORS[game], border: `1px solid ${(game === 'personal' ? '#8b5cf6' : GAME_COLORS[game])}55` }
                : {}}
            >
              {game === 'personal' && <FolderHeart size={14} />}
              {game === 'pokemon' ? 'Pokémon' : game === 'onepiece' ? 'One Piece' : game === 'lorcana' ? 'Lorcana' : game === 'riftbound' ? 'Riftbound' : game === 'mtg' ? 'Magic' : 'Personalized Collections'}
            </button>
          ))}
        </div>

        {activeGame === 'personal' ? (
          <PersonalCollectionsView />
        ) : (
          <>
            {/* Two-tier set picker: pick a category (era/product group) from a dropdown, then a
                set from just that category as pills below — a plain vertical list of categories
                (Pokemon alone has 14+) was worse than the wall of set pills it replaced, so the
                category level collapses into a single-line select instead of its own list. */}
            {setsLoading && (
              <div className="flex items-center gap-2 text-slate-500 text-sm mb-6">
                <Loader2 size={14} className="animate-spin" />
                Loading sets…
              </div>
            )}
            {!setsLoading && (
              <div className="mb-6">
                {/* Category dropdown */}
                <div className="relative inline-block mb-3">
                  <select
                    value={activeCategoryLabel}
                    onChange={(e) => selectCategory(e.target.value)}
                    className="appearance-none bg-slate-900 border rounded-lg pl-3 pr-8 py-2 text-sm font-medium outline-none cursor-pointer"
                    style={{ borderColor: gameColor + '55', color: gameColor }}
                  >
                    {categories.map((group) => (
                      <option key={group.label} value={group.label} className="bg-slate-900 text-white">
                        {group.label} ({group.sets.length})
                      </option>
                    ))}
                  </select>
                  <ChevronRight size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none opacity-70" style={{ color: gameColor }} />
                </div>

                {/* Sets within the active category */}
                <div className="flex gap-2 flex-wrap">
                  {(activeCategoryGroup?.sets ?? []).map((set) => {
                    const isActive = activeSet.name === set.name
                    return (
                      <button
                        key={set.name}
                        onClick={() => setActiveSet(set)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                          isActive
                            ? 'text-white border-transparent'
                            : 'bg-slate-900/50 text-slate-400 border-slate-800 hover:text-white hover:bg-slate-800',
                          set.fromInventory && !isActive && 'border-dashed',
                        )}
                        style={isActive ? { backgroundColor: gameColor + '28', borderColor: gameColor + '60', color: gameColor } : {}}
                      >
                        {set.label ?? set.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Search within the active set/bucket */}
            {!setsLoading && activeSet.name && (
              <div className="relative mb-4">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search ${activeSet.label ?? activeSet.name}…`}
                  className="input-field pl-9"
                />
              </div>
            )}

            {/* Rarity filter — currently wired up for Riftbound and Pokemon, see
                RARITY_TOGGLE_GAMES above */}
            {RARITY_TOGGLE_GAMES.has(catalogGame) && activeSet.name && rarityFilters.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap mb-4">
                {rarityFilters.map((r) => {
                  const active = !hiddenRarities.has(r)
                  const color = RARITY_COLORS[r] ?? '#6b7280'
                  const label = RARITY_LABELS_BY_GAME[catalogGame]?.[r] ?? r.replace('_', ' ')
                  return (
                    <button
                      key={r}
                      onClick={() => toggleRarity(r)}
                      className={cn(
                        'px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all',
                        !active && 'bg-slate-900/50 text-slate-600 border-slate-800 line-through',
                      )}
                      style={active ? { backgroundColor: color + '22', borderColor: color + '55', color } : {}}
                    >
                      {label}
                    </button>
                  )
                })}
                {hiddenRarities.size > 0 && (
                  <button onClick={() => setHiddenRarities(new Set())} className="text-[11px] text-slate-500 hover:text-white px-1">
                    Reset
                  </button>
                )}
              </div>
            )}

            {/* Progress bar (catalog-backed sets only) */}
            {!loading && !isSpecial && totalCount > 0 && (
              <div className="mb-5 card-glass px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-white">{activeSet.label ?? activeSet.name}</span>
                  <span className="text-sm font-bold" style={{ color: gameColor }}>
                    {ownedCount} / {totalCount}
                    <span className="text-slate-500 font-normal text-xs ml-1">({pct}%)</span>
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: gameColor }} />
                </div>
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center py-24 gap-3 text-slate-500">
                <Loader2 size={24} className="animate-spin" style={{ color: gameColor }} />
                <span className="text-sm">Loading {activeSet.label ?? activeSet.name}…</span>
              </div>
            )}

            {/* Catalog-backed card grid */}
            {!loading && !isSpecial && filteredEnriched.length > 0 && (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
                {filteredEnriched.map((card) => (
                  <CardTile
                    key={card.id}
                    card={card}
                    gameColor={gameColor}
                    game={catalogGame}
                    isHovered={hoveredId === card.id}
                    onHover={() => setHoveredId(card.id)}
                    onLeave={() => setHoveredId(null)}
                    onZoom={openZoom}
                  />
                ))}
              </div>
            )}

            {/* Inventory-only "special" bucket */}
            {isSpecial && (
              <SpecialBucket
                cards={specialCards}
                gameColor={gameColor}
                game={catalogGame}
                searchQuery={searchQuery}
                hiddenRarities={RARITY_TOGGLE_GAMES.has(catalogGame) ? hiddenRarities : EMPTY_SET}
                onZoom={openZoom}
              />
            )}

            {/* Empty states */}
            {!loading && !isSpecial && totalCount === 0 && (
              <div className="card-glass flex flex-col items-center justify-center py-20 text-center">
                <div className="text-4xl mb-3">📖</div>
                <div className="text-slate-400 font-medium">No cards found for this set</div>
              </div>
            )}
            {!loading && !isSpecial && totalCount > 0 && filteredEnriched.length === 0 && (
              <div className="card-glass flex flex-col items-center justify-center py-20 text-center">
                <div className="text-4xl mb-3">🔍</div>
                <div className="text-slate-400 font-medium">No cards match &quot;{searchQuery}&quot;</div>
              </div>
            )}
          </>
        )}
      </div>
      <CardZoomOverlay data={zoomCard} onClose={() => setZoomCard(null)} />
    </AuthGuard>
  )
}

// ── Special / inventory-only bucket ──────────────────────────────────────────

function SpecialBucket({ cards, gameColor, game, searchQuery, hiddenRarities, onZoom }: {
  cards: Card[]; gameColor: string; game: string; searchQuery: string; hiddenRarities: Set<string>
  onZoom: (el: HTMLElement, data: Omit<ZoomCardData, 'originRect'>) => void
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  if (cards.length === 0) {
    return (
      <div className="card-glass flex flex-col items-center justify-center py-20 text-center gap-3">
        <Package size={32} className="text-slate-700" />
        <div className="text-slate-400 font-medium">No special cards yet</div>
        <div className="text-slate-600 text-sm max-w-xs">
          Cards added to your inventory with a set name not from the main catalog will appear here —
          {game === 'pokemon' ? " McDonald's promos, custom sets, etc."
            : game === 'onepiece' ? ' one-off tournament promos, custom sets, etc.'
            : game === 'mtg' ? ' Secret Lairs, oddly-named promos, custom sets, etc.'
            : ' D23, Disney Cruise, Metal cards, etc.'}
        </div>
      </div>
    )
  }

  let filteredCards = searchQuery.trim()
    ? cards.filter((c) => matchesSearch(searchQuery, c.name, c.number || ''))
    : cards
  if (hiddenRarities.size > 0) {
    filteredCards = filteredCards.filter((c) => !c.rarity || !hiddenRarities.has(c.rarity))
  }

  if (filteredCards.length === 0) {
    return (
      <div className="card-glass flex flex-col items-center justify-center py-20 text-center">
        <div className="text-4xl mb-3">🔍</div>
        <div className="text-slate-400 font-medium">
          {searchQuery.trim() ? <>No cards match &quot;{searchQuery}&quot;</> : 'No cards match the current rarity filter'}
        </div>
      </div>
    )
  }

  // Group by set name so D23, Cruise, Metal each get their own section
  const bySet = filteredCards.reduce<Record<string, Card[]>>((acc, c) => {
    const key = c.set || 'Unknown Set'
    acc[key] = [...(acc[key] ?? []), c]
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {Object.entries(bySet).map(([setName, setCards]) => (
        <div key={setName}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-bold text-white">{setName}</span>
            <span className="text-xs text-slate-500">{setCards.length} card{setCards.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
            {setCards.map((card) => (
              <InventoryCardTile
                key={card.id}
                card={card}
                gameColor={gameColor}
                isHovered={hoveredId === card.id}
                onHover={() => setHoveredId(card.id)}
                onLeave={() => setHoveredId(null)}
                onZoom={onZoom}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Card tile (catalog-backed) ────────────────────────────────────────────────

interface CardTileProps {
  card: CatalogCard & { owned: boolean; quantity: number }
  gameColor: string
  game: CatalogGame
  isHovered: boolean
  onHover: () => void
  onLeave: () => void
  onZoom: (el: HTMLElement, data: Omit<ZoomCardData, 'originRect'>) => void
}

function CardTile({ card, gameColor, game, isHovered, onHover, onLeave, onZoom }: CardTileProps) {
  const rarityColor = RARITY_COLORS[card.rarity] ?? '#6b7280'
  // RARITY_LABELS_BY_GAME is keyed per-game (lib/utils.ts) — the same raw string can mean
  // something different in two games' catalogs (Riftbound's Rune "Promo" vs. Pokemon's real
  // "Promo" tier), so relabeling must only ever use the current game's own map.
  const rarityLabel = RARITY_LABELS_BY_GAME[game]?.[card.rarity] ?? card.rarity

  return (
    <div
      className="relative group cursor-pointer"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) { openEbaySearch({ name: card.name, number: card.number, set: card.setName, game }); return }
        onZoom(e.currentTarget, {
          imageUrl: card.imageUrl,
          name: card.name,
          number: card.number,
          rarityLabel: rarityLabel.replace('_', ' '),
          rarityColor,
          marketPrice: card.marketPrice,
          owned: card.owned,
          quantity: card.quantity,
          gameColor,
          ebayCard: { name: card.name, number: card.number, set: card.setName, game },
        })
      }}
      title="Click to view — ⌘/Ctrl+Click to search eBay sold listings"
    >
      <div
        className={cn('relative w-full rounded-lg overflow-hidden transition-all duration-200', card.owned ? 'shadow-lg' : 'opacity-30')}
        style={{
          aspectRatio: '5/7',
          filter: card.owned ? 'none' : 'grayscale(1)',
          outline: card.owned ? `2px solid ${gameColor}40` : '1px solid #1e293b',
          boxShadow: card.owned && isHovered ? `0 0 12px ${gameColor}60` : undefined,
        }}
      >
        {card.imageUrl ? (
          <img src={card.imageUrl} alt={card.name} loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: rarityColor + '18', color: rarityColor }}>
            #{card.number}
          </div>
        )}

        {card.owned && (
          card.quantity > 1 ? (
            <div className="absolute top-1 right-1 rounded-full px-1.5 py-0.5 text-[9px] font-black text-white leading-none" style={{ backgroundColor: gameColor }}>
              ×{card.quantity > 99 ? '99+' : card.quantity}
            </div>
          ) : (
            <div className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: gameColor + 'cc' }}>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )
        )}

        <div className="absolute bottom-1 left-1 bg-black/70 rounded px-1 py-0.5 text-[8px] font-bold text-white/80 leading-none">
          #{card.number}
        </div>
      </div>

      {isHovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 pointer-events-none">
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-center shadow-xl whitespace-nowrap">
            <div className="text-xs font-semibold text-white leading-tight max-w-[140px] truncate">{card.name}</div>
            {/* Pokemon catalog cards carry no rarity field — omit the chip rather than show it empty */}
            {card.rarity && <div className="text-[10px] mt-0.5 font-medium" style={{ color: rarityColor }}>{rarityLabel.replace('_', ' ')}</div>}
            {card.marketPrice > 0 && <div className="text-[10px] text-slate-400 mt-0.5">${card.marketPrice.toFixed(2)}</div>}
            {card.owned
              ? <div className="text-[10px] text-emerald-400 mt-0.5">✓ {card.quantity > 1 ? `×${card.quantity} owned` : 'owned'}</div>
              : <div className="text-[10px] text-slate-500 mt-0.5">not collected</div>}
          </div>
          <div className="w-2 h-2 bg-slate-900 border-r border-b border-slate-700 rotate-45 mx-auto -mt-1" />
        </div>
      )}
    </div>
  )
}

// ── Inventory card tile (special bucket — always owned) ───────────────────────

function InventoryCardTile({ card, gameColor, isHovered, onHover, onLeave, onZoom }: {
  card: Card; gameColor: string; isHovered: boolean; onHover: () => void; onLeave: () => void
  onZoom: (el: HTMLElement, data: Omit<ZoomCardData, 'originRect'>) => void
}) {
  const rarityColor = card.rarity ? (RARITY_COLORS[card.rarity] ?? '#6b7280') : '#6b7280'

  return (
    <div
      className="relative cursor-pointer"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) { openEbaySearch(card); return }
        onZoom(e.currentTarget, {
          imageUrl: card.imageUrl ?? '',
          name: card.name,
          number: card.number,
          rarityLabel: card.rarity ?? '',
          rarityColor,
          marketPrice: card.currentPrice ?? 0,
          owned: true,
          quantity: card.quantity,
          isFoil: card.isFoil,
          gameColor,
          ebayCard: card,
        })
      }}
      title="Click to view — ⌘/Ctrl+Click to search eBay sold listings"
    >
      <div
        className="relative w-full rounded-lg overflow-hidden shadow-lg transition-all duration-200"
        style={{
          aspectRatio: '5/7',
          outline: `2px solid ${gameColor}40`,
          boxShadow: isHovered ? `0 0 12px ${gameColor}60` : undefined,
        }}
      >
        {card.imageUrl ? (
          <img src={card.imageUrl} alt={card.name} loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs font-bold text-slate-400 bg-slate-800">
            {card.number ? `#${card.number}` : '?'}
          </div>
        )}

        {card.quantity > 1 ? (
          <div className="absolute top-1 right-1 rounded-full px-1.5 py-0.5 text-[9px] font-black text-white leading-none" style={{ backgroundColor: gameColor }}>
            ×{card.quantity > 99 ? '99+' : card.quantity}
          </div>
        ) : (
          <div className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: gameColor + 'cc' }}>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}

        {card.number && (
          <div className="absolute bottom-1 left-1 bg-black/70 rounded px-1 py-0.5 text-[8px] font-bold text-white/80 leading-none">
            #{card.number}
          </div>
        )}
      </div>

      {isHovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 pointer-events-none">
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-center shadow-xl whitespace-nowrap">
            <div className="text-xs font-semibold text-white leading-tight max-w-[140px] truncate">{card.name}</div>
            {card.isFoil && <div className="text-[10px] text-amber-400 mt-0.5">✨ Foil</div>}
            <div className="text-[10px] text-emerald-400 mt-0.5">
              ✓ {card.quantity > 1 ? `×${card.quantity} owned` : 'owned'}
            </div>
          </div>
          <div className="w-2 h-2 bg-slate-900 border-r border-b border-slate-700 rotate-45 mx-auto -mt-1" />
        </div>
      )}
    </div>
  )
}

// ── Card zoom overlay ──────────────────────────────────────────────────────────
// Clicking a Cardex tile (without ⌘/Ctrl, which is the eBay shortcut instead) pops the card open
// here for an isolated look: it flies from wherever it actually was in the grid to center screen
// while flipping over twice (a real 3D rotateY, not just a scale-up), landing with the same
// bounce-settle feel the rest of the app's "special moment" animations already use (sold-pop,
// card-unlock-toast — see the card-zoom-* keyframes in globals.css, deliberately reusing that
// established motion language rather than inventing a new one).
//
// The flight is a classic FLIP transform play: the mover div is rendered at its real FINAL
// on-screen position/size (centered by the backdrop's own flex layout — no percentage-anchor
// math needed), then measured via a ref. Its bounding rect is compared against the clicked tile's
// own rect (captured at click time, before this component even mounts) to compute the inverse
// translate+scale, which is applied INLINE with no transition so nothing visibly jumps. One frame
// later that inline override is cleared, and the CSS class's own transition animates smoothly from
// "sitting where the tile was" to "centered and full size." This all happens in useLayoutEffect via
// direct ref mutation (not React state) specifically to avoid an extra render and guarantee zero
// flash at the wrong position — see globals.css's own comment on the card-zoom-* rules for the
// timing this is tuned to match.
function CardZoomOverlay({ data, onClose }: { data: ZoomCardData | null; onClose: () => void }) {
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const moverRef = useRef<HTMLDivElement>(null)
  // Keeps rendering the last real card while the close animation plays — `data` itself goes null
  // immediately on close, but the fade/shrink-out still needs something to fade out.
  const lastData = useRef<ZoomCardData | null>(null)
  if (data) lastData.current = data

  useLayoutEffect(() => {
    if (!data || !moverRef.current) return
    const el = moverRef.current
    setVisible(false)
    setClosing(false)
    const finalRect = el.getBoundingClientRect()
    const origin = data.originRect
    const dx = (origin.left + origin.width / 2) - (finalRect.left + finalRect.width / 2)
    const dy = (origin.top + origin.height / 2) - (finalRect.top + finalRect.height / 2)
    const scaleX = origin.width / finalRect.width
    const scaleY = origin.height / finalRect.height
    el.style.transition = 'none'
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`
    el.offsetHeight // force layout so the line above is committed before it's cleared next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!moverRef.current) return
        moverRef.current.style.transition = ''
        moverRef.current.style.transform = ''
        setVisible(true)
      })
    })
  }, [data])

  function handleClose() {
    setClosing(true)
    // `closing` must be reset back to false once the exit animation finishes, in the same beat as
    // telling the parent to clear `data` — otherwise `!data && !closing` never becomes true again
    // after the very first close (parent's `data` goes null, but this component's own `closing`
    // state has nothing else that ever un-sets it), so the component keeps rendering forever: an
    // invisible (opacity-0, but still `fixed inset-0 z-50`) backdrop left sitting over the whole
    // page, silently swallowing every click underneath it. Reproduces on literally the second zoom
    // open/close of a session, not some rare edge case — caught by testing exactly that.
    setTimeout(() => {
      setClosing(false)
      onClose()
    }, 200) // matches card-zoom-backdrop-out / card-zoom-shrink-out's duration
  }

  useEffect(() => {
    if (!data) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (!data && !closing) return null
  const d = lastData.current
  if (!d) return null

  return (
    <div
      className={cn('fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-4 card-zoom-backdrop', closing && 'closing pointer-events-none')}
      style={{ backgroundColor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <button
        onClick={handleClose}
        className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2 rounded-full bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 z-10"
      >
        <X size={18} />
      </button>

      <div className={cn('flex flex-col items-center gap-4', closing && 'card-zoom-content closing')}>
        <div
          ref={moverRef}
          className="relative card-zoom-mover"
          style={{ width: 'min(80vw, 300px)', aspectRatio: '5 / 7', perspective: '1200px' }}
        >
          <div className={cn('relative w-full h-full card-zoom-flipper', visible && 'spin')}>
            {/* Front face — the real card */}
            <div
              className="card-zoom-face absolute inset-0 rounded-2xl overflow-hidden"
              style={{ boxShadow: `0 0 0 2px ${d.gameColor}55, 0 20px 60px -12px rgba(0,0,0,0.7)` }}
            >
              {d.imageUrl ? (
                <img src={d.imageUrl} alt={d.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-lg font-bold" style={{ backgroundColor: d.rarityColor + '18', color: d.rarityColor }}>
                  #{d.number}
                </div>
              )}
            </div>
            {/* Back face — a generic card back (no real per-game back art exists), briefly visible
                twice mid-flip since it never actually shows for more than an instant */}
            <div
              className="card-zoom-face card-zoom-face-back absolute inset-0 rounded-2xl overflow-hidden flex items-center justify-center"
              style={{
                background: `radial-gradient(circle at 50% 40%, ${d.gameColor}33, #0a0a0f 70%)`,
                boxShadow: `0 0 0 2px ${d.gameColor}55, 0 20px 60px -12px rgba(0,0,0,0.7)`,
              }}
            >
              <div className="rounded-full p-4" style={{ backgroundColor: d.gameColor + '22', border: `1px solid ${d.gameColor}55` }}>
                <Sparkles size={32} style={{ color: d.gameColor }} />
              </div>
            </div>
          </div>

          {visible && (
            <div className="card-zoom-glow-ring absolute inset-0 rounded-2xl pointer-events-none" style={{ boxShadow: `0 0 60px 20px ${d.gameColor}` }} />
          )}
          {visible && (
            <div className="card-zoom-shine absolute inset-0 rounded-2xl pointer-events-none overflow-hidden">
              <div className="absolute inset-y-0 w-1/3" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)' }} />
            </div>
          )}
        </div>

        {visible && (
          <div className="card-zoom-panel card-glass px-5 py-3.5 flex flex-col items-center gap-1.5 text-center max-w-xs">
            <div className="text-base font-bold text-white leading-tight">{d.name}</div>
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <span className="text-xs text-slate-500">#{d.number}</span>
              {d.rarityLabel && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: d.rarityColor + '22', color: d.rarityColor }}>
                  {d.rarityLabel}
                </span>
              )}
              {d.isFoil && <span className="text-[11px] font-medium text-amber-400">✨ Foil</span>}
            </div>
            {d.marketPrice > 0 && <div className="text-sm font-semibold text-white">${d.marketPrice.toFixed(2)}</div>}
            <div className="text-xs" style={{ color: d.owned ? '#34d399' : '#64748b' }}>
              {d.owned ? `✓ ${d.quantity > 1 ? `×${d.quantity} owned` : 'owned'}` : 'not collected'}
            </div>
            <button
              onClick={() => openEbaySearch(d.ebayCard)}
              className="mt-1 text-[11px] text-slate-500 hover:text-white underline underline-offset-2"
            >
              Search eBay sold listings
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
