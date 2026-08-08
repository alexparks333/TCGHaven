'use client'

import { useState, useMemo } from 'react'
import { Plus, Trash2, Pencil, Check, X, ShoppingBag, History } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useAuth } from '@/components/auth/AuthProvider'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { formatCurrency, localDateString } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { GAME_COLORS, GAME_LABELS, type Game } from '@/lib/types'
import {
  SPENDING_CATALOG,
  PRODUCT_TYPE_LABELS,
  PRODUCT_TYPE_COLORS,
  type SpendingProduct,
} from '@/lib/spending/catalog'
import type { Purchase } from '@/lib/spending/types'
import {
  savePurchase,
  updatePurchase as updatePurchaseInFirestore,
  deletePurchase as deletePurchaseInFirestore,
} from '@/lib/firebase/spending'

const GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound']

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function todayISO() {
  return localDateString()
}

// Build a lookup map for quick product access
const CATALOG_MAP = new Map<string, SpendingProduct>(SPENDING_CATALOG.map((p) => [p.id, p]))

export default function SpendingPage() {
  // Purchases are loaded into the store by AuthProvider at login —
  // no extra Firestore read needed here
  const { purchases, addPurchase, editPurchase, removePurchase } = useStore()
  const { user } = useAuth()
  const [view, setView] = useState<'browse' | 'history'>('browse')
  const [activeGame, setActiveGame] = useState<Game>('pokemon')

  // --- Totals ---
  const totals = useMemo(() => {
    const byGame = GAMES.map((game) => {
      const gamePurchases = purchases.filter((p) => {
        const prod = CATALOG_MAP.get(p.productId)
        return prod?.game === game
      })
      const spent = gamePurchases.reduce((s, p) => s + p.pricePaid * p.quantity, 0)
      const packs = gamePurchases.reduce((s, p) => {
        const prod = CATALOG_MAP.get(p.productId)
        return s + p.quantity * (prod?.packsIncluded ?? 1)
      }, 0)
      return { game, spent, packs }
    })
    const totalSpent = byGame.reduce((s, g) => s + g.spent, 0)
    const totalPacks = byGame.reduce((s, g) => s + g.packs, 0)
    return { totalSpent, totalPacks, byGame }
  }, [purchases])

  // --- Browse: group products by set ---
  const setGroups = useMemo(() => {
    const products = SPENDING_CATALOG.filter((p) => p.game === activeGame)
    const map = new Map<string, SpendingProduct[]>()
    for (const p of products) {
      if (!map.has(p.setCode)) map.set(p.setCode, [])
      map.get(p.setCode)!.push(p)
    }
    return Array.from(map.entries())
      .map(([setCode, prods]) => ({
        setCode,
        setName: prods[0].setName,
        releaseDate: prods[0].releaseDate,
        products: prods,
      }))
      .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
  }, [activeGame])

  // --- History: sort newest first ---
  const sortedHistory = useMemo(
    () => [...purchases].sort((a, b) => b.date.localeCompare(a.date)),
    [purchases]
  )

  // --- Add purchase ---
  function handleAddPurchase(productId: string, pricePaid: number, quantity: number) {
    const purchase: Purchase = {
      id: genId(),
      productId,
      pricePaid,
      quantity,
      date: todayISO(),
    }
    addPurchase(purchase)
    if (user) savePurchase(user.uid, purchase).catch(() => {})
  }

  // --- Edit purchase ---
  function handleEditPurchase(id: string, updates: Partial<Purchase>) {
    editPurchase(id, updates)
    if (user) updatePurchaseInFirestore(user.uid, id, updates).catch(() => {})
  }

  // --- Delete purchase ---
  function handleDeletePurchase(id: string) {
    removePurchase(id)
    if (user) deletePurchaseInFirestore(user.uid, id).catch(() => {})
  }

  const gameColor = GAME_COLORS[activeGame]

  return (
    <AuthGuard>
      <div className="pb-20 md:pb-0">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Spending</h1>
          <p className="text-slate-400 text-sm mt-0.5">Log every pack and box you buy at the price you paid</p>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="stat-card col-span-2 lg:col-span-1">
            <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Total Spent</span>
            <span className="text-3xl font-bold text-white">{formatCurrency(totals.totalSpent)}</span>
            <span className="text-xs text-slate-500">{totals.totalPacks.toLocaleString()} packs total</span>
          </div>
          {totals.byGame.map(({ game, spent, packs }) => (
            <div key={game} className="stat-card">
              <span className="text-xs font-bold uppercase tracking-wide" style={{ color: GAME_COLORS[game] }}>
                {GAME_LABELS[game]}
              </span>
              <span className="text-2xl font-bold text-white">{formatCurrency(spent)}</span>
              <span className="text-xs text-slate-500">{packs.toLocaleString()} packs</span>
            </div>
          ))}
        </div>

        {/* View toggle */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setView('browse')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
              view === 'browse'
                ? 'bg-violet-600 text-white'
                : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
            )}
          >
            <ShoppingBag size={14} />
            Browse Products
          </button>
          <button
            onClick={() => setView('history')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
              view === 'history'
                ? 'bg-violet-600 text-white'
                : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
            )}
          >
            <History size={14} />
            Purchase History
            {purchases.length > 0 && (
              <span className="bg-violet-500/30 text-violet-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {purchases.length}
              </span>
            )}
          </button>
        </div>

        {view === 'browse' ? (
          <>
            {/* Game tabs */}
            <div className="flex gap-2 mb-8">
              {GAMES.map((game) => (
                <button
                  key={game}
                  onClick={() => setActiveGame(game)}
                  className={cn(
                    'px-4 py-2 rounded-xl text-sm font-medium transition-all',
                    activeGame === game
                      ? 'text-white shadow-lg'
                      : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
                  )}
                  style={
                    activeGame === game
                      ? {
                          backgroundColor: GAME_COLORS[game] + '33',
                          color: GAME_COLORS[game],
                          border: `1px solid ${GAME_COLORS[game]}55`,
                        }
                      : {}
                  }
                >
                  {GAME_LABELS[game]}
                </button>
              ))}
            </div>

            {/* Product grid */}
            <div className="space-y-10">
              {setGroups.map(({ setCode, setName, products }) => {
                const setSpent = purchases
                  .filter((p) => {
                    const prod = CATALOG_MAP.get(p.productId)
                    return prod?.setCode === setCode
                  })
                  .reduce((s, p) => s + p.pricePaid * p.quantity, 0)

                return (
                  <div key={setCode}>
                    <div className="flex items-center gap-3 mb-4">
                      <h2 className="text-base font-bold text-white">{setName}</h2>
                      {setSpent > 0 && (
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: gameColor + '22', color: gameColor }}
                        >
                          {formatCurrency(setSpent)} spent
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                      {products.map((product) => {
                        const productPurchases = purchases.filter((p) => p.productId === product.id)
                        return (
                          <ProductCard
                            key={product.id}
                            product={product}
                            gameColor={gameColor}
                            purchaseCount={productPurchases.length}
                            onAdd={handleAddPurchase}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <HistoryView
            purchases={sortedHistory}
            onEdit={handleEditPurchase}
            onDelete={handleDeletePurchase}
          />
        )}
      </div>
    </AuthGuard>
  )
}

// ─── Product Card ──────────────────────────────────────────────────────────────

interface ProductCardProps {
  product: SpendingProduct
  gameColor: string
  purchaseCount: number
  onAdd: (productId: string, pricePaid: number, quantity: number) => void
}

function ProductCard({ product, gameColor, purchaseCount, onAdd }: ProductCardProps) {
  const [adding, setAdding] = useState(false)
  const [price, setPrice] = useState(product.price.toFixed(2))
  const [qty, setQty] = useState('1')

  const typeColor = PRODUCT_TYPE_COLORS[product.type]
  const initials = product.setName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  function submit() {
    const p = parseFloat(price)
    const q = parseInt(qty, 10)
    if (isNaN(p) || p < 0 || isNaN(q) || q < 1) return
    onAdd(product.id, p, q)
    setAdding(false)
    setPrice(product.price.toFixed(2))
    setQty('1')
  }

  function cancel() {
    setAdding(false)
    setPrice(product.price.toFixed(2))
    setQty('1')
  }

  return (
    <div className="card-glass overflow-hidden flex flex-col">
      {/* Visual header */}
      <div
        className="relative h-32 flex items-center justify-center overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${gameColor}18 0%, ${gameColor}08 100%)` }}
      >
        {/* Plain <img>, deliberately not next/image: onError below replaces this element's
            parent innerHTML directly, which would fight next/image's own DOM management on
            any later re-render. */}
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.setName}
            className="h-28 w-full object-contain px-4 py-2 drop-shadow-lg"
            onError={(e) => {
              const img = e.target as HTMLImageElement
              img.style.display = 'none'
              const parent = img.parentElement
              if (parent) {
                parent.innerHTML = `<span style="font-size:2rem;font-weight:900;color:${gameColor}30;letter-spacing:-0.05em">${initials}</span>`
              }
            }}
          />
        ) : (
          <span className="text-4xl font-black tracking-tighter select-none" style={{ color: gameColor + '35' }}>
            {initials}
          </span>
        )}

        {/* Type badge */}
        <div
          className="absolute top-2 right-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: typeColor + '30', color: typeColor }}
        >
          {PRODUCT_TYPE_LABELS[product.type]}
        </div>

        {/* Purchase count badge */}
        {purchaseCount > 0 && (
          <div
            className="absolute top-2 left-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
            style={{ backgroundColor: gameColor }}
          >
            {purchaseCount}×
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div>
          <div className="font-semibold text-white text-sm leading-tight">{product.name}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {product.packsIncluded} pack{product.packsIncluded !== 1 ? 's' : ''} · MSRP {formatCurrency(product.price)}
          </div>
        </div>

        {adding ? (
          /* Inline add form */
          <div className="mt-auto space-y-2">
            <div className="flex gap-1.5">
              <div className="flex-1 min-w-0">
                <label className="text-[10px] text-slate-500 mb-0.5 block">Price paid ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  className="w-full text-sm font-bold text-white bg-slate-800 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  autoFocus
                />
              </div>
              <div className="w-14 shrink-0">
                <label className="text-[10px] text-slate-500 mb-0.5 block">Qty</label>
                <input
                  type="number"
                  min="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  className="w-full text-sm font-bold text-white bg-slate-800 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={submit}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-bold text-white"
                style={{ backgroundColor: gameColor }}
              >
                <Check size={11} /> Add to Tab
              </button>
              <button
                onClick={cancel}
                className="w-8 flex items-center justify-center rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-auto flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all hover:opacity-90 active:scale-95"
            style={{ backgroundColor: gameColor + '22', color: gameColor, border: `1px solid ${gameColor}33` }}
          >
            <Plus size={12} />
            Log Purchase
          </button>
        )}
      </div>
    </div>
  )
}

// ─── History View ──────────────────────────────────────────────────────────────

interface HistoryViewProps {
  purchases: Purchase[]
  onEdit: (id: string, updates: Partial<Purchase>) => void
  onDelete: (id: string) => void
}

function HistoryView({ purchases, onEdit, onDelete }: HistoryViewProps) {
  if (purchases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <History size={40} className="text-slate-700 mb-3" />
        <p className="text-slate-500 text-sm">No purchases yet.</p>
        <p className="text-slate-600 text-xs mt-1">Switch to Browse Products and hit Log Purchase on any item.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {purchases.map((purchase) => {
        const product = CATALOG_MAP.get(purchase.productId)
        return (
          <HistoryRow
            key={purchase.id}
            purchase={purchase}
            product={product}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )
      })}
    </div>
  )
}

// ─── History Row ───────────────────────────────────────────────────────────────

interface HistoryRowProps {
  purchase: Purchase
  product: SpendingProduct | undefined
  onEdit: (id: string, updates: Partial<Purchase>) => void
  onDelete: (id: string) => void
}

function HistoryRow({ purchase, product, onEdit, onDelete }: HistoryRowProps) {
  const [editing, setEditing] = useState(false)
  const [price, setPrice] = useState(purchase.pricePaid.toFixed(2))
  const [qty, setQty] = useState(String(purchase.quantity))
  const [date, setDate] = useState(purchase.date)

  const gameColor = product ? GAME_COLORS[product.game] : '#6366f1'
  const initials = product
    ? product.setName.split(' ').map((w) => w[0]).join('').toUpperCase()
    : '??'

  function save() {
    const p = parseFloat(price)
    const q = parseInt(qty, 10)
    if (isNaN(p) || p < 0 || isNaN(q) || q < 1) return
    onEdit(purchase.id, { pricePaid: p, quantity: q, date })
    setEditing(false)
  }

  function discard() {
    setPrice(purchase.pricePaid.toFixed(2))
    setQty(String(purchase.quantity))
    setDate(purchase.date)
    setEditing(false)
  }

  const total = purchase.pricePaid * purchase.quantity

  return (
    <div className="card-glass p-3 flex items-center gap-3">
      {/* Thumbnail */}
      <div
        className="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${gameColor}22, ${gameColor}0a)` }}
      >
        {product?.imageUrl ? (
          <img
            src={product.imageUrl}
            alt=""
            className="w-full h-full object-contain p-1"
            onError={(e) => {
              const img = e.target as HTMLImageElement
              img.style.display = 'none'
            }}
          />
        ) : (
          <span className="text-xs font-black" style={{ color: gameColor + '60' }}>{initials}</span>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              <div className="flex-1 min-w-[80px]">
                <label className="text-[10px] text-slate-500 block mb-0.5">Price paid ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full text-sm font-bold text-white bg-slate-800 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  autoFocus
                />
              </div>
              <div className="w-16">
                <label className="text-[10px] text-slate-500 block mb-0.5">Qty</label>
                <input
                  type="number"
                  min="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="w-full text-sm font-bold text-white bg-slate-800 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>
              <div className="flex-1 min-w-[110px]">
                <label className="text-[10px] text-slate-500 block mb-0.5">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full text-sm text-white bg-slate-800 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={save}
                className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold text-white bg-violet-600 hover:bg-violet-500"
              >
                <Check size={11} /> Save
              </button>
              <button
                onClick={discard}
                className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium text-slate-400 bg-slate-800 hover:text-white"
              >
                <X size={11} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white truncate">
                {product?.name ?? purchase.productId}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {product?.setName} ·{' '}
                <span
                  className="text-[10px] font-bold px-1 py-0.5 rounded"
                  style={{
                    backgroundColor: GAME_COLORS[product?.game ?? 'pokemon'] + '20',
                    color: GAME_COLORS[product?.game ?? 'pokemon'],
                  }}
                >
                  {GAME_LABELS[product?.game ?? 'pokemon']}
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-bold text-white">
                {purchase.quantity > 1
                  ? `${purchase.quantity}× ${formatCurrency(purchase.pricePaid)} = ${formatCurrency(total)}`
                  : formatCurrency(total)}
              </div>
              <div className="text-xs text-slate-500">{purchase.date}</div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {!editing && (
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => onDelete(purchase.id)}
            className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 hover:text-red-400 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
