'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter, useDroppable, useSensor, useSensors,
  type DragStartEvent, type DragOverEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowUp, ArrowDown, Trash2, Plus, Cuboid, Pencil, GripVertical, BookMarked } from 'lucide-react'
import { cn } from '@/lib/utils'
import { badgesInSet, chaptersOf, type BadgeCatalog, type BadgeDef, type BadgeSet } from '@/lib/badges'
import { BadgePin } from '@/components/badges/BadgePin'

// The staff portal's chapter editor for one pin book: each chapter is a card showing its pages as
// small 2 × 3 grids with the badges where collectors will see them (6 a page). Rename a chapter in
// place, move it up/down, add or remove one; click a pin to edit it.
//
// Dragging (dnd-kit): pick up a pin and the others slide out of the way live — within a chapter
// (across its pages) or into another chapter. The new order shows immediately (`layout`, local
// state) and is saved when you let go; the saved catalog then becomes the layout again.

const PER_PAGE = 6

type Layout = Record<string, string[]> // chapter -> badge ids, in order

export default function ChaptersBoard({ catalog, set, persist, onEdit, onNew, onPreview, onDelete }: {
  catalog: BadgeCatalog
  set: BadgeSet
  persist: (next: BadgeCatalog) => Promise<void>
  onEdit: (b: BadgeDef) => void
  onNew: (chapter: string) => void
  onPreview: (b: BadgeDef) => void
  onDelete: (b: BadgeDef) => void
}) {
  const chapters = useMemo(() => chaptersOf(catalog, set.id), [catalog, set.id])
  const badges = useMemo(() => badgesInSet(catalog, set.id), [catalog, set.id])
  const byId = useMemo(() => new Map(badges.map((b) => [b.id, b])), [badges])
  const saved = useMemo<Layout>(() => Object.fromEntries(chapters.map((c) => [c, badges.filter((b) => b.page === c).map((b) => b.id)])), [chapters, badges])

  // The layout on screen: follows the saved catalog, except while dragging / saving a drop
  const [layout, setLayout] = useState<Layout>(saved)
  const pending = useRef(false)
  useEffect(() => { if (!pending.current) setLayout(saved) }, [saved])

  const [activeId, setActiveId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), // a click still opens the editor
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const chapterOf = (id: string, l: Layout = layout) =>
    id.startsWith('chapter:') ? id.slice(8) : Object.keys(l).find((c) => l[c].includes(id))

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
    setError('')
  }

  // Moving into another chapter happens live, as the pin passes over it
  function onDragOver(e: DragOverEvent) {
    const { active, over } = e
    if (!over) return
    const from = chapterOf(String(active.id)), to = chapterOf(String(over.id))
    if (!from || !to || from === to) return
    setLayout((l) => {
      const src = l[from].filter((x) => x !== active.id)
      const dst = [...l[to]]
      const overIndex = dst.indexOf(String(over.id))
      dst.splice(overIndex >= 0 ? overIndex : dst.length, 0, String(active.id))
      return { ...l, [from]: src, [to]: dst }
    })
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    setActiveId(null)
    if (!over) { setLayout(saved); return }
    const chapter = chapterOf(String(active.id))
    if (!chapter) return
    let next = layout
    const list = layout[chapter]
    const from = list.indexOf(String(active.id)), to = list.indexOf(String(over.id))
    if (to >= 0 && from !== to) next = { ...layout, [chapter]: arrayMove(list, from, to) }
    setLayout(next)
    if (JSON.stringify(next) === JSON.stringify(saved)) return
    pending.current = true
    try {
      await persist(applyLayout(catalog, set.id, next))
    } catch {
      setLayout(saved)
    } finally {
      pending.current = false
    }
  }

  // ── Chapter operations ──
  const withChapters = (list: string[], mapBadge?: (b: BadgeDef) => BadgeDef): BadgeCatalog => ({
    ...catalog,
    sets: catalog.sets.map((s) => (s.id === set.id ? { ...s, chapters: list } : s)),
    badges: mapBadge ? catalog.badges.map(mapBadge) : catalog.badges,
  })
  function rename(i: number, raw: string) {
    const name = raw.trim()
    const old = chapters[i]
    if (name === old) return
    if (!name) return setError('A chapter needs a name.')
    if (chapters.includes(name)) return setError(`There's already a chapter called "${name}".`)
    setError('')
    persist(withChapters(chapters.map((c, j) => (j === i ? name : c)), (b) => (b.set === set.id && b.page === old ? { ...b, page: name } : b)))
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= chapters.length) return
    const list = [...chapters]
    ;[list[i], list[j]] = [list[j], list[i]]
    persist(withChapters(list))
  }
  function remove(i: number) {
    if (layout[chapters[i]]?.length) return setError('Move or delete this chapter’s badges first.')
    setError('')
    persist(withChapters(chapters.filter((_, j) => j !== i)))
  }
  function add() {
    const name = newName.trim()
    if (!name) return
    if (chapters.includes(name)) return setError(`There's already a chapter called "${name}".`)
    setError(''); setNewName('')
    persist(withChapters([...chapters, name]))
  }

  const active = activeId ? byId.get(activeId) : null

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="text-xs text-red-600">{error}</div>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setLayout(saved) }}>
        {chapters.map((chapter, i) => {
          const ids = layout[chapter] ?? []
          const pageCount = Math.max(1, Math.ceil(ids.length / PER_PAGE))
          const left = PER_PAGE - (ids.length % PER_PAGE)
          return (
            <section key={chapter} className="card-glass overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
                <span className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-[11px] font-bold text-slate-400">Chapter {i + 1}</span>
                <input
                  key={chapter}
                  defaultValue={chapter}
                  aria-label="Chapter name"
                  onBlur={(e) => rename(i, e.target.value)}
                  onKeyDown={(e) => {
                    const el = e.target as HTMLInputElement
                    if (e.key === 'Enter') el.blur()
                    if (e.key === 'Escape') { el.value = chapter; el.blur() }
                  }}
                  className="min-w-0 flex-1 bg-transparent text-base font-bold text-ink outline-none rounded-lg px-2 py-1 -mx-2 hover:bg-slate-800/60 focus:bg-slate-800 focus:ring-1 focus:ring-slate-600"
                />
                <span className="hidden sm:block text-xs text-slate-500 whitespace-nowrap">
                  {ids.length} badge{ids.length === 1 ? '' : 's'} · {pageCount} page{pageCount === 1 ? '' : 's'}
                </span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <HeadBtn label="Move chapter up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></HeadBtn>
                  <HeadBtn label="Move chapter down" disabled={i === chapters.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></HeadBtn>
                  <HeadBtn label="Delete chapter" disabled={ids.length > 0} onClick={() => remove(i)}><Trash2 size={14} /></HeadBtn>
                  <button onClick={() => onNew(chapter)} className="btn-primary !px-3 !py-1.5 !text-xs ml-1"><Plus size={13} />Badge</button>
                </div>
              </div>

              <ChapterArea chapter={chapter}>
                <SortableContext items={ids} strategy={rectSortingStrategy}>
                  {Array.from({ length: pageCount }, (_, p) => {
                    const onPage = ids.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE)
                    return (
                      <div key={p} className="rounded-xl border border-slate-800 bg-slate-950/50 w-[264px] shrink-0 p-2.5">
                        <div className="text-[11px] font-semibold text-slate-500 mb-2 px-0.5">Page {p + 1}{pageCount > 1 ? ` of ${pageCount}` : ''}</div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {onPage.map((id) => {
                            const b = byId.get(id)
                            return b ? <PinTile key={id} b={b} onEdit={onEdit} onPreview={onPreview} onDelete={onDelete} /> : null
                          })}
                          {Array.from({ length: PER_PAGE - onPage.length }, (_, k) => (
                            <div key={`empty${k}`} className={cn('h-[92px] rounded-lg border border-dashed transition-colors', activeId ? 'border-violet-600/40' : 'border-slate-800')} />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </SortableContext>
                <div className="w-[120px] shrink-0 rounded-xl border border-dashed border-slate-800 flex flex-col items-center justify-center gap-1 text-center text-[11px] text-slate-500 p-2">
                  <BookMarked size={16} />
                  {ids.length > 0 && left === PER_PAGE ? 'Next badge starts a new page' : `${left} spot${left === 1 ? '' : 's'} left on this page`}
                </div>
              </ChapterArea>
            </section>
          )
        })}

        {/* The pin under the pointer while dragging */}
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
          {active ? <TileFace b={active} lifted /> : null}
        </DragOverlay>
      </DndContext>

      <div className="rounded-2xl border-2 border-dashed border-slate-700 p-3 flex items-center gap-2">
        <span className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-[11px] font-bold text-slate-400">Chapter {chapters.length + 1}</span>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder="New chapter name (e.g. Alternative Arts)" className="input-field flex-1" />
        <button onClick={add} disabled={!newName.trim()} className="btn-primary disabled:opacity-50"><Plus size={15} />Add chapter</button>
      </div>
    </div>
  )
}

// The catalog with this book's badges in the layout's order and chapters. Badges of other books
// keep their places; this book's badges fill the slots its badges already occupied, in order.
function applyLayout(catalog: BadgeCatalog, setId: string, layout: Layout): BadgeCatalog {
  const byId = new Map(catalog.badges.map((b) => [b.id, b]))
  const ordered = Object.entries(layout).flatMap(([chapter, ids]) => ids.map((id) => ({ ...byId.get(id)!, page: chapter })))
  let k = 0
  return { ...catalog, badges: catalog.badges.map((b) => (b.set === setId ? ordered[k++] : b)) }
}

// A chapter's drop area — lets a pin land in a chapter with no badges (or past the last one)
function ChapterArea({ chapter, children }: { chapter: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `chapter:${chapter}` })
  return (
    <div ref={setNodeRef} className={cn('flex flex-wrap gap-3 p-4 transition-colors', isOver && 'bg-violet-600/5')}>
      {children}
    </div>
  )
}

function PinTile({ b, onEdit, onPreview, onDelete }: { b: BadgeDef; onEdit: (b: BadgeDef) => void; onPreview: (b: BadgeDef) => void; onDelete: (b: BadgeDef) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: b.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={() => onEdit(b)}
      className={cn('group relative touch-none cursor-grab active:cursor-grabbing', isDragging && 'opacity-30')}
    >
      <TileFace b={b} />
      <div className="absolute right-1 top-1 hidden group-hover:flex flex-col gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
        <MiniBtn label="Edit" onClick={() => onEdit(b)}><Pencil size={11} /></MiniBtn>
        <MiniBtn label="Preview in 3D" onClick={() => onPreview(b)}><Cuboid size={11} /></MiniBtn>
        <MiniBtn label="Delete" danger onClick={() => onDelete(b)}><Trash2 size={11} /></MiniBtn>
      </div>
    </div>
  )
}

function TileFace({ b, lifted }: { b: BadgeDef; lifted?: boolean }) {
  return (
    <div className={cn(
      'relative h-[92px] rounded-lg border bg-slate-900/60 flex flex-col items-center justify-center gap-1 px-1 transition-shadow',
      lifted ? 'border-violet-600 shadow-2xl scale-[1.04] bg-slate-900' : 'border-slate-800 hover:border-slate-600',
    )}>
      <GripVertical size={12} className="absolute left-0.5 top-1 text-slate-600" />
      <BadgePin art={b.art} imageUrl={b.imageUrl} size={46} />
      <span className="max-w-[112px] truncate text-[11px] font-semibold text-ink">{b.name}</span>
      {!b.slots.length && <span className="absolute left-1.5 bottom-1.5 w-2 h-2 rounded-full bg-amber-500" title="No requirements yet" />}
    </div>
  )
}

function HeadBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none">
      {children}
    </button>
  )
}

function MiniBtn({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick() }} title={label} aria-label={label}
      className={cn('w-6 h-6 flex items-center justify-center rounded-md bg-slate-800 text-slate-400 hover:text-ink', danger && 'hover:text-red-600')}>
      {children}
    </button>
  )
}
