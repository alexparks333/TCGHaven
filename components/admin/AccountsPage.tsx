'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { QueryDocumentSnapshot } from 'firebase/firestore'
import { Search, Loader2, X, ArrowUpRight, History, AlertTriangle, Check, Ban, PauseCircle, PlayCircle, ShieldCheck, Crown, ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/friends/Avatar'
import { profilePath } from '@/lib/firebase/friends'
import { ACCOUNT_ROLES, ROLE_COLORS, ROLE_HINTS, ROLE_LABELS, titleColor, titleLabel, type AccountRole, type AccountRoleRecord } from '@/lib/accountRoles'
import {
  accountHistory, changeAccount, countAllAccounts, isTeamAccount, listAccounts, listOf, listRegular, searchAccounts,
  type AccountChange, type AccountList, type AccountRow,
} from '@/lib/firebase/accountRolesStaff'
import { StaffModal } from './StaffModal'
import { useStaff } from './StaffAuthProvider'

// Accounts — the staff side of every collector account (lib/accountRoles.ts): find anyone, see
// everyone in each list, and change an account's title, suspend or restore a Creator, or ban or
// unban an account. Every change asks why (staff-only notes) and lands in the account's history.
// Nothing an account made is ever deleted from here.

// Two areas, switched at the top: what kind of account, and who's on hold
type Area = 'type' | 'holds'
const LISTS: { id: AccountList; area: Area; label: string; empty: string; danger?: boolean }[] = [
  { id: 'regular', area: 'type', label: 'Regular', empty: 'No Regular accounts.' },
  { id: 'premium', area: 'type', label: 'Premium', empty: 'No Premium accounts yet.' },
  { id: 'creator', area: 'type', label: 'Creators', empty: 'No Creators yet — find an account above and make them one.' },
  { id: 'staff', area: 'type', label: 'Staff', empty: 'No Staff accounts yet.' },
  { id: 'suspended', area: 'holds', label: 'Suspended creators', empty: 'No suspended creators.' },
  { id: 'banned', area: 'holds', label: 'Banned', empty: 'No banned accounts.', danger: true },
]
const FIRST: Record<Area, AccountList> = { type: 'creator', holds: 'suspended' }
type Titled = Exclude<AccountList, 'regular'>
const TITLED = LISTS.map((l) => l.id).filter((id): id is Titled => id !== 'regular')
type Sort = 'name' | 'newest' | 'oldest'

const fmtDate = (ms?: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—')

export function AccountsPage() {
  const [area, setArea] = useState<Area>('type')
  const [tab, setTab] = useState<AccountList>('creator')
  const [lists, setLists] = useState<Partial<Record<Titled, AccountRow[]>>>({})
  const [regular, setRegular] = useState<{ rows: AccountRow[]; next: QueryDocumentSnapshot | null; loading: boolean } | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<AccountRow[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<Sort>('name')
  const [managing, setManaging] = useState<AccountRow | null>(null)

  const fail = (what: string) => (e: unknown) => setError(`${what}: ${(e as Error).message}`)

  const loadTitled = useCallback(() => {
    for (const id of TITLED) listAccounts(id).then((rows) => setLists((l) => ({ ...l, [id]: rows }))).catch(fail('Couldn’t load accounts'))
    countAllAccounts().then(setTotal).catch(() => setTotal(null))
  }, [])
  useEffect(loadTitled, [loadTitled])

  const loadRegular = useCallback((more: boolean) => {
    setRegular((r) => ({ rows: more ? r?.rows ?? [] : [], next: more ? r?.next ?? null : null, loading: true }))
    listRegular(more ? regular?.next ?? null : null)
      .then(({ rows, next }) => setRegular((r) => ({ rows: [...(more ? r?.rows ?? [] : []), ...rows], next, loading: false })))
      .catch((e) => { fail('Couldn’t load Regular accounts')(e); setRegular((r) => (r ? { ...r, loading: false } : r)) })
  }, [regular?.next])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'regular' && !regular) loadRegular(false) }, [tab])

  // Search as you type (a short pause so each keystroke isn't a query)
  useEffect(() => {
    const term = search.trim()
    if (term.replace(/^@/, '').length < 2) { setResults(null); setSearching(false); return }
    setSearching(true)
    let stale = false
    const t = setTimeout(() => {
      searchAccounts(term)
        .then((r) => { if (!stale) setResults(r) })
        .catch((e) => { if (!stale) fail('Search failed')(e) })
        .finally(() => { if (!stale) setSearching(false) })
    }, 250)
    return () => { stale = true; clearTimeout(t) }
  }, [search])

  const titledCount = TITLED.reduce((n, id) => n + (lists[id]?.length ?? 0), 0)
  const count = (id: AccountList): number | null =>
    id === 'regular' ? (total !== null && TITLED.every((t) => lists[t]) ? Math.max(0, total - titledCount) : null) : lists[id]?.length ?? null

  const rows = useMemo(() => {
    const list = tab === 'regular' ? regular?.rows ?? [] : lists[tab] ?? []
    const f = filter.trim().replace(/^@/, '').toLowerCase()
    const shown = f ? list.filter((r) => r.profile.displayName.toLowerCase().includes(f) || r.profile.username.includes(f)) : list
    if (sort === 'name') return shown
    const at = (r: AccountRow) => (tab === 'creator' ? r.record.creatorSince : r.record.updatedAt) ?? 0
    return [...shown].sort((a, b) => (sort === 'newest' ? at(b) - at(a) : at(a) - at(b)))
  }, [lists, regular, tab, filter, sort])

  function onChanged(uid: string, record: AccountRoleRecord) {
    setResults((r) => r?.map((x) => (x.profile.uid === uid ? { ...x, record } : x)) ?? r)
    setManaging((m) => (m && m.profile.uid === uid ? { ...m, record } : m))
    setRegular((r) => (r ? { ...r, rows: r.rows.filter((x) => x.profile.uid !== uid || listOf(record) === 'regular') } : r))
    loadTitled()
  }

  const active = LISTS.find((l) => l.id === tab)!
  const loaded = tab === 'regular' ? !!regular && (!regular.loading || regular.rows.length > 0) : !!lists[tab]
  const dateLabel = tab === 'creator' ? 'Creator since' : tab === 'regular' ? '' : tab === 'premium' || tab === 'staff' ? 'Since' : 'Since (last change)'
  const holdsCount = (count('suspended') ?? 0) + (count('banned') ?? 0)

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink">Accounts</h1>
        <p className="text-sm text-slate-500 mt-0.5">Every collector account — titles, Creator suspensions and bans. Nothing anyone made is deleted from here.</p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-600/40 bg-red-100/20 px-3 py-2 text-sm text-red-600">
          <AlertTriangle size={15} className="shrink-0" />{error}
          <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* Find any account */}
      <div className="card-glass p-4 mb-6">
        <label className="field-label">Find an account</label>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, @username or user ID" className="input-field !pl-9 !py-2.5" />
          {searching && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-500" />}
        </div>
        {results && (
          <div className="mt-3">
            {results.length === 0
              ? <div className="text-sm text-slate-500 py-3 text-center">No accounts match “{search.trim()}”.</div>
              : <AccountTable rows={results} dateLabel="" onManage={setManaging} />}
          </div>
        )}
      </div>

      {/* The two areas */}
      <div className="inline-flex p-1 mb-3 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-inner">
        {([['type', 'Account Type'], ['holds', 'Bans and Suspensions']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => { setArea(id); setTab(FIRST[id]); setFilter('') }}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all',
              area === id ? (id === 'holds' ? 'bg-red-600 text-white shadow-md' : 'bg-violet-600 text-white shadow-md') : 'text-slate-500 hover:text-ink',
            )}
          >
            {id === 'holds' && <Ban size={14} />}
            {label}
            {id === 'holds' && holdsCount > 0 && (
              <span className={cn('text-[11px] px-1.5 rounded-full', area === id ? 'bg-white/25' : 'bg-red-600/15 text-red-600')}>{holdsCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* The lists in this area */}
      <div className="card-glass overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
          {LISTS.filter((l) => l.area === area).map(({ id, label, danger }) => (
            <button
              key={id}
              onClick={() => { setTab(id); setFilter('') }}
              className={cn(
                'flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-sm font-semibold transition-colors',
                tab === id ? (danger ? 'bg-red-100/40 border-red-500/50 text-red-700' : 'bg-slate-800 border-slate-600 text-ink') : 'border-slate-800 text-slate-400 hover:text-ink',
              )}
            >
              {danger && <Ban size={13} />}
              {label}
              <span className="text-[11px] text-slate-500">{count(id) ?? '…'}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 px-4 py-3 border-b border-slate-800">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${active.label.toLowerCase()}${tab === 'regular' ? ' shown below' : ''}…`} className="input-field !pl-8 !py-1.5 !text-xs" />
          </div>
          {tab !== 'regular' && (
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="input-field !w-auto !py-1.5 !text-xs">
              <option value="name">Name A → Z</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          )}
        </div>
        {!loaded ? (
          <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-slate-500" /></div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-slate-500 py-12 text-center">{filter ? 'No one here matches that.' : active.empty}</div>
        ) : (
          <AccountTable rows={rows} dateLabel={dateLabel} onManage={setManaging} />
        )}
        {tab === 'regular' && regular?.next && (
          <div className="p-3 border-t border-slate-800 text-center">
            <button onClick={() => loadRegular(true)} disabled={regular.loading} className="btn-secondary !inline-flex disabled:opacity-60">
              {regular.loading && <Loader2 size={14} className="animate-spin" />}Load more
            </button>
          </div>
        )}
      </div>

      {managing && <ManageAccount row={managing} onClose={() => setManaging(null)} onChanged={onChanged} />}
    </div>
  )
}

export function StatusPills({ record }: { record: AccountRoleRecord }) {
  const color = titleColor(record)
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: color + '22', color }}>
        {record.staffTitle === 'Owner' && <Crown size={10} />}
        {titleLabel(record)}
      </span>
      {(record.suspended || (record.formerCreator && record.role !== 'creator')) && (
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-200/60 text-amber-700">Suspended creator</span>
      )}
      {record.banned && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-600 text-white">Banned</span>}
    </span>
  )
}

function AccountTable({ rows, dateLabel, onManage }: { rows: AccountRow[]; dateLabel: string; onManage: (r: AccountRow) => void }) {
  const creatorDate = dateLabel === 'Creator since'
  return (
    <div>
      <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_130px_90px] gap-4 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-800">
        <span>Account</span><span>Title</span><span>{dateLabel}</span><span />
      </div>
      {rows.map((r) => (
        <div key={r.profile.uid} className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_130px_90px] items-center gap-x-4 gap-y-1 px-4 py-3 border-b border-slate-800/60 last:border-0 hover:bg-slate-800/20">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar seed={r.profile.uid} name={r.profile.displayName} photoURL={r.profile.photoURL} size={34} />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink truncate">{r.profile.displayName}</div>
              <div className="text-xs text-slate-500 truncate">{r.profile.username ? `@${r.profile.username}` : r.profile.uid}</div>
            </div>
          </div>
          <div className="hidden md:block"><StatusPills record={r.record} /></div>
          <div className="hidden md:block text-xs text-slate-400">{dateLabel ? fmtDate(creatorDate ? r.record.creatorSince : r.record.updatedAt) : ''}</div>
          <div className="flex items-center gap-2 justify-end">
            <span className="md:hidden"><StatusPills record={r.record} /></span>
            <button onClick={() => onManage(r)} className="btn-secondary !px-3 !py-1.5 !text-xs">Manage</button>
          </div>
        </div>
      ))}
    </div>
  )
}

const ACTION_TEXT: Record<Exclude<AccountChange['action'], 'title'>, string> = {
  suspend: 'Creator suspended', restore: 'Creator restored', ban: 'Account banned', unban: 'Account unbanned',
  photoBan: 'Profile photo removed & blocked', photoUnban: 'Profile photos allowed again',
}

function ManageAccount({ row, onClose, onChanged }: { row: AccountRow; onClose: () => void; onChanged: (uid: string, r: AccountRoleRecord) => void }) {
  const { user, member } = useStaff()
  const { profile, record } = row
  const [to, setTo] = useState<AccountRole>(record.role)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<AccountChange[] | null>(null)

  useEffect(() => { accountHistory(profile.uid).then(setHistory).catch(() => setHistory([])) }, [profile.uid, record])
  useEffect(() => { setTo(record.role) }, [record.role])

  const losingCreator = record.role === 'creator' && to !== 'creator'
  const titleChanged = to !== record.role

  async function act(change: Parameters<typeof changeAccount>[1], needsNote: boolean, confirmText?: string) {
    if (!user) return
    if (needsNote && !note.trim()) return setError('Add a note saying why — only staff see it.')
    if (confirmText && !confirm(confirmText)) return
    setBusy(change.action); setError('')
    try {
      const next = await changeAccount(profile.uid, change, note, { uid: user.uid, name: member?.name || user.email || 'Staff' })
      setNote('')
      onChanged(profile.uid, next)
    } catch (e) {
      setError(`Couldn’t save: ${(e as Error).message}`)
    } finally { setBusy(null) }
  }

  const name = profile.displayName
  return (
    <StaffModal onClose={onClose} className="max-w-2xl">
      <div className="p-5 md:p-6">
        <div className="flex items-start gap-3 mb-5">
          <Avatar seed={profile.uid} name={name} photoURL={profile.photoURL} size={48} />
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold text-ink truncate">{name}</div>
            <div className="text-sm text-slate-500 truncate">{profile.username ? `@${profile.username}` : ''} <span className="text-[11px] text-slate-600">· {profile.uid}</span></div>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <StatusPills record={record} />
              {record.creatorSince && <span className="text-[11px] text-slate-500">Creator since {fmtDate(record.creatorSince)}</span>}
              {profile.username && (
                <a href={profilePath(profile.uid, profile.username)} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-violet-700 inline-flex items-center gap-0.5 hover:underline">
                  Open their Haven <ArrowUpRight size={11} />
                </a>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800"><X size={16} /></button>
        </div>

        {record.banned && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-100/30 px-3 py-2 text-xs text-red-700">
            <Ban size={14} className="shrink-0 mt-0.5" />This account is banned: they only see a “banned” screen and can’t save anything; their profile is hidden.
          </div>
        )}

        {isTeamAccount(record) ? (
          <div className="flex items-start gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-3 text-sm text-slate-400">
            <Crown size={16} className="shrink-0 mt-0.5" style={{ color: titleColor(record) }} />
            <span>
              On the staff team as <b className="text-ink">{record.staffTitle}</b>, so this account is always Staff.
              {record.staffTitle === 'Owner' ? ' The Owner can’t be changed or banned.' : ' Change their title or remove them on the Team page.'}
            </span>
          </div>
        ) : (<>
        {/* Note — used by whichever action you take */}
        <label className="field-label">Note — only staff see this (required to suspend, ban or remove a photo)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Why? e.g. Partnership signed · Under investigation for…" className="input-field resize-none mb-4" />

        <label className="field-label">Title</label>
        <div className="grid sm:grid-cols-2 gap-2 mb-3">
          {ACCOUNT_ROLES.map((r) => (
            <button
              key={r}
              onClick={() => setTo(r)}
              className={cn('text-left rounded-xl border p-3 transition-colors', to === r ? 'bg-slate-900' : 'border-slate-800 hover:border-slate-700')}
              style={to === r ? { borderColor: ROLE_COLORS[r] } : undefined}
            >
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ROLE_COLORS[r] }} />
                <span className="text-sm font-bold text-ink">{ROLE_LABELS[r]}</span>
                {record.role === r && <span className="ml-auto text-[10px] font-bold uppercase text-slate-500">Current</span>}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 leading-snug">{ROLE_HINTS[r]}</div>
            </button>
          ))}
        </div>
        {titleChanged && (
          <div className="mb-3">
            {losingCreator && (
              <div className="mb-2 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-100/30 px-3 py-2 text-xs text-amber-700">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                They move to Suspended creators: their Creator tab and everything they made is hidden from them and their followers. Nothing is deleted — making them a Creator again brings it all back. (To keep their Creator title while on hold, use Suspend Creator below.)
              </div>
            )}
            {to === 'creator' && record.formerCreator && <div className="mb-2 text-xs text-emerald-700">They were a Creator before — everything they made comes back as it was.</div>}
            <div className="flex justify-end">
              <button
                onClick={() => act({ action: 'title', to }, losingCreator, losingCreator ? `Take Creator away from ${name}?` : undefined)}
                disabled={!!busy}
                className="btn-primary disabled:opacity-50"
              >
                {busy === 'title' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}Make {ROLE_LABELS[to]}
              </button>
            </div>
          </div>
        )}

        {/* Holds */}
        <div className="mt-4 grid sm:grid-cols-2 gap-2">
          {record.role === 'creator' && (
            record.suspended ? (
              <button onClick={() => act({ action: 'restore' }, false)} disabled={!!busy} className="btn-secondary justify-center disabled:opacity-50">
                {busy === 'restore' ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />}Restore Creator
              </button>
            ) : (
              <button
                onClick={() => act({ action: 'suspend' }, true, `Suspend ${name} as a Creator?\n\nTheir Studio is paused and everything they made is hidden from them and their followers until you restore them. Nothing is deleted.`)}
                disabled={!!busy}
                className="btn-secondary justify-center !text-amber-700 disabled:opacity-50"
              >
                {busy === 'suspend' ? <Loader2 size={15} className="animate-spin" /> : <PauseCircle size={15} />}Suspend Creator
              </button>
            )
          )}
          {record.banned ? (
            <button onClick={() => act({ action: 'unban' }, false, `Unban ${name}? They get their account back as it was.`)} disabled={!!busy} className="btn-secondary justify-center disabled:opacity-50">
              {busy === 'unban' ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}Unban account
            </button>
          ) : (
            <button
              onClick={() => act({ action: 'ban' }, true, `Ban ${name}?\n\nThey'll only see a “banned” screen, can't save anything, and their profile is hidden from everyone. Nothing is deleted — unbanning brings it all back.`)}
              disabled={!!busy}
              className="btn-secondary justify-center !text-red-600 hover:!bg-red-100/40 disabled:opacity-50"
            >
              {busy === 'ban' ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />}Ban account
            </button>
          )}
        </div>
        {/* Profile photo: take it down and block new ones (or lift that) */}
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5">
          <Avatar seed={profile.uid} name={name} photoURL={profile.photoURL} size={36} />
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-bold text-ink">Profile photo</div>
            <div className="text-slate-500">
              {record.photoBanned ? 'Removed by staff — they can’t set a new one.' : profile.photoURL ? 'Their own photo.' : 'No photo (their initials show).'}
            </div>
          </div>
          {record.photoBanned ? (
            <button onClick={() => act({ action: 'photoUnban' }, false, `Let ${name} set a profile photo again?`)} disabled={!!busy} className="btn-secondary shrink-0 disabled:opacity-50">
              {busy === 'photoUnban' ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}Allow photos again
            </button>
          ) : (
            <button
              onClick={() => act({ action: 'photoBan' }, true, `Remove ${name}'s profile photo?\n\nIt comes off their profile straight away and they can't set a new one until you allow photos again. Their account is otherwise untouched.`)}
              disabled={!!busy}
              className="btn-secondary shrink-0 !text-red-600 hover:!bg-red-100/40 disabled:opacity-50"
            >
              {busy === 'photoBan' ? <Loader2 size={15} className="animate-spin" /> : <ImageOff size={15} />}Remove photo &amp; block
            </button>
          )}
        </div>
        {error && <div className="mt-3 text-xs text-red-600">{error}</div>}
        </>)}

        <div className="mt-6 pt-4 border-t border-slate-800">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2"><History size={13} />History</div>
          {!history ? (
            <Loader2 size={15} className="animate-spin text-slate-500" />
          ) : history.length === 0 ? (
            <div className="text-xs text-slate-500">No changes yet — a Regular account in good standing.</div>
          ) : (
            <ul className="flex flex-col gap-2 max-h-56 overflow-y-auto">
              {history.map((h) => (
                <li key={h.id} className="text-xs text-slate-400">
                  <span className="text-slate-500">{fmtDate(h.at)}</span> ·{' '}
                  <span className={cn('font-semibold', h.action === 'ban' ? 'text-red-600' : h.action === 'suspend' ? 'text-amber-700' : 'text-ink')}>
                    {h.action === 'title' ? `${ROLE_LABELS[h.from!] ?? h.from} → ${ROLE_LABELS[h.to!] ?? h.to}` : ACTION_TEXT[h.action]}
                  </span>{' '}by {h.byName || 'staff'}
                  {h.note && <div className="text-slate-500 italic mt-0.5">“{h.note}”</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </StaffModal>
  )
}
