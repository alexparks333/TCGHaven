'use client'

import { useState, useEffect, useMemo } from 'react'
import { Loader2, Package, FolderHeart } from 'lucide-react'
import { useStore } from '@/lib/store'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { GAME_COLORS, type Game, type Card } from '@/lib/types'
import { cn } from '@/lib/utils'
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

interface SetMeta {
  name: string           // catalog set name, or '__special__' for inventory-only bucket
  game: 'lorcana' | 'riftbound'
  label?: string         // display label when different from name
  fromInventory?: true   // skip API; show owned inventory cards not in any known set
}

interface SetGroup {
  label: string
  sets: SetMeta[]
}

// ── Set catalog (fetched from /api/set-registry — see lib/api/registry.ts) ────
// Groups/known-sets used to be hardcoded here; they're now derived from
// data/set-registry.json so the Settings "Sync Card Data" feature can register
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

const PLACEHOLDER_SET: SetMeta = { name: '', game: 'lorcana' }

const EMPTY_GROUPS_BY_GAME: Record<'lorcana' | 'riftbound', SetGroup[]> = { lorcana: [], riftbound: [] }

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

// ── Rarity colors ─────────────────────────────────────────────────────────────

const RARITY_COLORS: Record<string, string> = {
  Common: '#6b7280', Uncommon: '#22c55e', Rare: '#3b82f6',
  Super_rare: '#a855f7', Legendary: '#f97316', Enchanted: '#ec4899',
  Epic: '#06b6d4', Showcase: '#fbbf24', Star: '#fbbf24', Promo: '#84cc16',
}

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
    return false
  })
  return { owned: matches.length > 0, quantity: matches.reduce((s, c) => s + c.quantity, 0) }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CardexPage() {
  const { cards } = useStore()
  const [activeGame, setActiveGame] = useState<'lorcana' | 'riftbound' | 'personal'>('lorcana')
  const [activeSet, setActiveSet] = useState<SetMeta>(PLACEHOLDER_SET)
  const [catalogCards, setCatalogCards] = useState<CatalogCard[]>([])
  const [loading, setLoading] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [groupsByGame, setGroupsByGame] = useState(EMPTY_GROUPS_BY_GAME)
  const [registryLoading, setRegistryLoading] = useState(true)

  // "Personalized Collections" isn't a catalog game — fall back to a safe key for the
  // catalog-indexed lookups below (groupsByGame, GAME_COLORS), none of which actually get
  // rendered while that tab is active.
  const catalogGame: 'lorcana' | 'riftbound' = activeGame === 'personal' ? 'lorcana' : activeGame
  const gameColor = activeGame === 'personal' ? '#8b5cf6' : GAME_COLORS[catalogGame]

  // Load set groups/known-sets from the registry once on mount.
  useEffect(() => {
    let stale = false
    fetch('/api/set-registry')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SetRegistryResponse | null) => {
        if (stale || !data) return
        const built = buildGroupsByGame(data)
        setGroupsByGame(built)
        setActiveSet(built.lorcana[0]?.sets[0] ?? PLACEHOLDER_SET)
      })
      .catch(() => {})
      .finally(() => { if (!stale) setRegistryLoading(false) })
    return () => { stale = true }
  }, [])

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
    if (activeGame === 'personal' || !activeSet.name || activeSet.fromInventory) { setCatalogCards([]); return }
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

  function switchGame(game: 'lorcana' | 'riftbound' | 'personal') {
    setActiveGame(game)
    if (game !== 'personal') setActiveSet(groupsByGame[game][0]?.sets[0] ?? PLACEHOLDER_SET)
  }

  // Enrich catalog cards with owned status
  const enriched = useMemo(
    () => catalogCards.map((cc) => ({ ...cc, ...getOwnedInfo(cc, gameCards, catalogGame) })),
    [catalogCards, gameCards, catalogGame],
  )

  const ownedCount = enriched.filter((c) => c.owned).length
  const totalCount = enriched.length
  const pct = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0

  const isSpecial = activeSet.fromInventory

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
          {(['lorcana', 'riftbound', 'personal'] as const).map((game) => (
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
              {game === 'lorcana' ? 'Lorcana' : game === 'riftbound' ? 'Riftbound' : 'Personalized Collections'}
            </button>
          ))}
        </div>

        {activeGame === 'personal' ? (
          <PersonalCollectionsView />
        ) : (
          <>
            {/* Grouped set selector */}
            {registryLoading && (
              <div className="flex items-center gap-2 text-slate-500 text-sm mb-6">
                <Loader2 size={14} className="animate-spin" />
                Loading sets…
              </div>
            )}
            <div className="space-y-3 mb-6">
              {groupsByGame[catalogGame].map((group) => (
                <div key={group.label}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1.5 px-0.5">
                    {group.label}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {group.sets.map((set) => {
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
              ))}
            </div>

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
            {!loading && !isSpecial && enriched.length > 0 && (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
                {enriched.map((card) => (
                  <CardTile
                    key={card.id}
                    card={card}
                    gameColor={gameColor}
                    isHovered={hoveredId === card.id}
                    onHover={() => setHoveredId(card.id)}
                    onLeave={() => setHoveredId(null)}
                  />
                ))}
              </div>
            )}

            {/* Inventory-only "special" bucket */}
            {isSpecial && <SpecialBucket cards={specialCards} gameColor={gameColor} game={catalogGame} />}

            {/* Empty states */}
            {!loading && !isSpecial && enriched.length === 0 && (
              <div className="card-glass flex flex-col items-center justify-center py-20 text-center">
                <div className="text-4xl mb-3">📖</div>
                <div className="text-slate-400 font-medium">No cards found for this set</div>
              </div>
            )}
          </>
        )}
      </div>
    </AuthGuard>
  )
}

// ── Special / inventory-only bucket ──────────────────────────────────────────

function SpecialBucket({ cards, gameColor, game }: { cards: Card[]; gameColor: string; game: string }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  if (cards.length === 0) {
    return (
      <div className="card-glass flex flex-col items-center justify-center py-20 text-center gap-3">
        <Package size={32} className="text-slate-700" />
        <div className="text-slate-400 font-medium">No special cards yet</div>
        <div className="text-slate-600 text-sm max-w-xs">
          Cards added to your inventory with a set name not from the main catalog will appear here —
          D23, Disney Cruise, Metal cards, etc.
        </div>
      </div>
    )
  }

  // Group by set name so D23, Cruise, Metal each get their own section
  const bySet = cards.reduce<Record<string, Card[]>>((acc, c) => {
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
  isHovered: boolean
  onHover: () => void
  onLeave: () => void
}

function CardTile({ card, gameColor, isHovered, onHover, onLeave }: CardTileProps) {
  const rarityColor = RARITY_COLORS[card.rarity] ?? '#6b7280'

  return (
    <div className="relative group cursor-default" onMouseEnter={onHover} onMouseLeave={onLeave}>
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
            <div className="text-[10px] mt-0.5 font-medium" style={{ color: rarityColor }}>{card.rarity.replace('_', ' ')}</div>
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

function InventoryCardTile({ card, gameColor, isHovered, onHover, onLeave }: {
  card: Card; gameColor: string; isHovered: boolean; onHover: () => void; onLeave: () => void
}) {
  return (
    <div className="relative cursor-default" onMouseEnter={onHover} onMouseLeave={onLeave}>
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
