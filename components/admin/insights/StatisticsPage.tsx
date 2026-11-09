'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, documentId, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { Loader2, RefreshCw, Layers, Activity, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { staffDb } from '@/lib/firebase/staff'
import { adminFetch } from '@/lib/firebase/authFetch'
import { GAME_LABELS, type Game } from '@/lib/types'
import type { DailyStats } from '@/lib/stats/types'
import {
  CategoryBars, Empty, GAME_CHART, GAME_ORDER, Panel, RankBars, Tile, TimeBars, TrendArea,
  fmtDuration, fmtInt, fmtPct, shortDay,
} from './charts'

// Staff portal → Statistics (/admin/statistics). Everything here comes from stats_daily — one doc
// per day of totals made by lib/stats/aggregate.ts — so a visit costs ~90 reads however many
// accounts there are. Staff never see any one account's numbers (firestore.rules).

type Section = 'cards' | 'app'
type Range = 7 | 30 | 90

const SECTION_LABELS: Record<string, string> = {
  portfolio: 'Portfolio', inventory: 'Inventory', cardex: 'Cardex', badges: 'Badges', sold: 'Sold',
  friends: 'Friends', profile: 'Own profile', profiles: 'Other profiles', creator: 'Creator Studio', other: 'Other',
}
const GRADER_ORDER = ['PSA', 'CGC', 'BGS', 'TAG', 'SGC', 'ACE', 'OTHER']
const gameName = (g: string) => (g === 'mtg' ? 'Magic' : GAME_LABELS[g as Game] ?? g)

export function StatisticsPage() {
  const [days, setDays] = useState<DailyStats[] | null>(null)
  const [error, setError] = useState('')
  const [section, setSection] = useState<Section>('cards')
  const [range, setRange] = useState<Range>(30)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(() => {
    getDocs(query(collection(staffDb, 'stats_daily'), orderBy(documentId(), 'desc'), limit(91)))
      .then((snap) => setDays(snap.docs.map((d) => d.data() as DailyStats).reverse()))
      .catch((e) => setError(`Couldn’t load statistics: ${(e as Error).message}`))
  }, [])
  useEffect(load, [load])

  async function refresh() {
    setRefreshing(true); setError('')
    try {
      const res = await adminFetch('/api/admin/stats', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`)
      load()
    } catch (e) {
      setError(`Refresh failed: ${(e as Error).message}`)
    } finally { setRefreshing(false) }
  }

  const latest = days?.[days.length - 1]
  const shown = useMemo(() => (days ?? []).slice(-range), [days, range])

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">Statistics</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            How TCGHaven is used — totals only, never one person’s data.
            {latest && <> Updated {shortDay(latest.day)}{latest.final ? '' : ' (today so far)'}.</>}
          </p>
        </div>
        <button onClick={refresh} disabled={refreshing} className="ml-auto btn-secondary disabled:opacity-60" title="Re-count today now (reads every account summary once — a few cents at most)">
          {refreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}Refresh now
        </button>
      </div>

      {/* Section + range — one row of filters above everything */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="inline-flex p-1 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-inner">
          {([['cards', 'Card Statistics', Layers], ['app', 'Application Statistics', Activity]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={cn('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all', section === id ? 'bg-violet-600 text-white shadow-md' : 'text-slate-500 hover:text-ink')}
            >
              <Icon size={15} />{label}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-xl border border-slate-800 overflow-hidden text-xs font-semibold ml-auto">
          {([7, 30, 90] as Range[]).map((r) => (
            <button key={r} onClick={() => setRange(r)} className={cn('px-3 py-1.5 transition-colors', range === r ? 'bg-slate-800 text-ink' : 'text-slate-500 hover:text-ink')}>
              {r} days
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-600/40 bg-red-100/20 px-3 py-2 text-sm text-red-600">{error}</div>}

      {!days ? (
        <div className="flex justify-center py-20"><Loader2 size={26} className="animate-spin text-slate-500" /></div>
      ) : !latest ? (
        <Empty>
          No totals yet. They’re worked out twice a day with the price sync (09:00 and 21:00 UTC), or press <b>Refresh now</b>.
          Accounts start sending their numbers the first time they open the app after this update.
        </Empty>
      ) : section === 'cards' ? (
        <CardStats days={shown} latest={latest} range={range} />
      ) : (
        <AppStats days={shown} latest={latest} range={range} />
      )}
    </div>
  )
}

// ── Card Statistics ─────────────────────────────────────────────────────────────────────────

function CardStats({ days, latest, range }: { days: DailyStats[]; latest: DailyStats; range: Range }) {
  const c = latest.cards
  const games = GAME_ORDER.filter((g) => (c.byGame[g] ?? 0) > 0 || days.some((d) => (d.cards?.byGame?.[g] ?? 0) > 0))
  const gradedTotal = Object.values(c.graded).reduce((s, n) => s + n, 0)

  // Cards added each day per game = the change in each game's total since the day before
  // (a day with more removed than added counts as 0 added)
  const added = useMemo(() => {
    const out: Record<string, unknown>[] = []
    for (let i = 1; i < days.length; i++) {
      const prev = days[i - 1].cards?.byGame ?? {}, cur = days[i].cards?.byGame ?? {}
      const row: Record<string, unknown> = { label: shortDay(days[i].day) }
      for (const g of games) row[g] = Math.max(0, (cur[g] ?? 0) - (prev[g] ?? 0))
      out.push(row)
    }
    return out
  }, [days, games])
  const addedByGame = games.map((g) => ({ g, n: added.reduce((s, r) => s + (r[g] as number), 0) }))
  const addedTotal = addedByGame.reduce((s, x) => s + x.n, 0)
  const first = days[0]
  const growth = first && first !== latest ? c.total - (first.cards?.total ?? 0) : 0

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Cards in all accounts" value={fmtInt(c.total)} sub={`${fmtInt(c.unique)} different entries`} delta={growth ? { text: `${growth > 0 ? '+' : ''}${fmtInt(growth)} in ${range} days`, good: growth > 0 } : undefined} />
        <Tile label="Average per account" value={fmtInt(c.avgPerAccount)} sub={`${fmtInt(c.avgPerCollector)} among accounts with cards`} />
        <Tile label="Median collection" value={fmtInt(c.median)} sub="Half of accounts have fewer" />
        <Tile label="Graded" value={fmtPct(c.total ? gradedTotal / c.total : 0)} sub={`${fmtInt(gradedTotal)} slabs`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Cards added per day, by game" sub={`${fmtInt(addedTotal)} added in the last ${range} days · net of cards removed that day`}>
          {added.length ? <TimeBars data={added} series={games.map((g) => ({ key: g, name: gameName(g), color: GAME_CHART[g] }))} /> : <div className="text-xs text-slate-500 py-10 text-center">Needs two days of totals.</div>}
        </Panel>
        <Panel title="Most cards added by game" sub={`Last ${range} days`}>
          <RankBars
            items={addedByGame.sort((a, b) => b.n - a.n).map(({ g, n }) => ({ key: g, label: gameName(g), value: n, color: GAME_CHART[g], detail: `${gameName(g)}: ${fmtInt(n)} added (${addedTotal ? fmtPct(n / addedTotal) : '0%'})` }))}
            empty="No cards added in this range yet."
          />
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Panel title="Most-used catalogs" sub="Share of every card, by game">
          <RankBars
            items={games.map((g) => ({ g, n: c.byGame[g] ?? 0 })).sort((a, b) => b.n - a.n).map(({ g, n }) => ({ key: g, label: gameName(g), value: n, color: GAME_CHART[g], detail: `${gameName(g)}: ${fmtInt(n)} cards · collected by ${fmtInt(c.uniqueByGame[g] ?? 0)} accounts` }))}
            format={(n) => `${fmtInt(n)} · ${c.total ? fmtPct(n / c.total, 0) : '0%'}`}
          />
        </Panel>
        <Panel title="Accounts collecting each game" sub="An account counts once per game it has cards in">
          <RankBars
            items={games.map((g) => ({ g, n: c.uniqueByGame[g] ?? 0 })).sort((a, b) => b.n - a.n).map(({ g, n }) => ({ key: g, label: gameName(g), value: n, color: GAME_CHART[g] }))}
            format={(n) => `${fmtInt(n)} · ${latest.accounts.withCards ? fmtPct(n / latest.accounts.withCards, 0) : '0%'}`}
          />
        </Panel>
        <Panel title="Graded slabs by company" sub={`${fmtPct(c.total ? gradedTotal / c.total : 0)} of all cards are graded`}>
          <RankBars
            items={Object.entries(c.graded).sort((a, b) => GRADER_ORDER.indexOf(a[0]) - GRADER_ORDER.indexOf(b[0]) || b[1] - a[1]).sort((a, b) => b[1] - a[1]).map(([co, n]) => ({ key: co, label: co === 'OTHER' ? 'Other' : co, value: n }))}
            format={(n) => `${fmtInt(n)} · ${gradedTotal ? fmtPct(n / gradedTotal, 0) : '0%'}`}
            empty="No graded cards yet."
          />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Collection sizes" sub="How many accounts have how many cards">
          <CategoryBars name="Accounts" data={Object.entries(c.buckets).map(([label, value]) => ({ label, value }))} />
        </Panel>
        <Panel title="Games per account" sub="How many different games each account collects">
          <CategoryBars name="Accounts" data={['0', '1', '2', '3', '4', '5'].map((k) => ({ label: k === '5' ? '5+' : k, value: c.gamesPerAccount?.[k] ?? 0 }))} />
        </Panel>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Japanese cards" value={fmtPct(c.total ? c.japanese / c.total : 0)} sub={`${fmtInt(c.japanese)} cards`} />
        <Tile label="Foil / holo" value={fmtPct(c.total ? c.foil / c.total : 0)} sub={`${fmtInt(c.foil)} cards`} />
        <Tile label="Accounts with cards" value={fmtInt(latest.accounts.withCards)} sub={`of ${fmtInt(latest.accounts.summaries)} reporting`} />
        <Tile label="Cards sold (all time)" value={fmtInt(latest.social.sold)} sub="Logged on the Sold page" />
      </div>

      <Panel title="Total cards over time">
        <TrendArea data={days.map((d) => ({ label: shortDay(d.day), total: d.cards?.total ?? 0 }))} dataKey="total" name="Cards" />
      </Panel>
      <Note />
    </div>
  )
}

// ── Application Statistics ──────────────────────────────────────────────────────────────────

function AppStats({ days, latest, range }: { days: DailyStats[]; latest: DailyStats; range: Range }) {
  // The latest FULL day for daily figures (today is still in progress)
  const full = [...days].reverse().find((d) => d.final && d.usage) ?? latest
  const u = full.usage
  const a = latest.accounts
  const finals = days.filter((d) => d.final && d.usage)
  const avg = (f: (d: DailyStats) => number) => (finals.length ? finals.reduce((s, d) => s + f(d), 0) / finals.length : 0)
  const signups = days.reduce((s, d) => s + (d.accounts?.signups ?? 0), 0)
  const inactive = Math.max(0, a.total - a.active30)

  const pages = Object.keys(SECTION_LABELS).filter((k) => (u?.pageUsers?.[k] ?? 0) > 0 || (u?.pageSeconds?.[k] ?? 0) > 0)
  const ret = latest.retention

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label={`Daily active · ${shortDay(full.day)}`} value={fmtInt(u?.dau ?? 0)} sub={`${fmtInt(avg((d) => d.usage.dau))} a day on average`} />
        <Tile label="Weekly active" value={fmtInt(a.active7)} sub="Used in the last 7 days" />
        <Tile label="Monthly active" value={fmtInt(a.active30)} sub={`${a.total ? fmtPct(a.active30 / a.total, 0) : '0%'} of all accounts`} />
        <Tile label="Time per active user" value={fmtDuration(u?.dau ? u.seconds / u.dau : 0)} sub={`${u?.dau ? (u.sessions / u.dau).toFixed(1) : '0'} visits each`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Daily active accounts" sub="Accounts that used the app each day">
          <TrendArea data={finals.map((d) => ({ label: shortDay(d.day), dau: d.usage.dau }))} dataKey="dau" name="Active accounts" />
        </Panel>
        <Panel title="Visits per day" sub="App opens, plus returns after 30 minutes away — the closest thing to logins">
          <TimeBars data={finals.map((d) => ({ label: shortDay(d.day), sessions: d.usage.sessions }))} series={[{ key: 'sessions', name: 'Visits', color: '#3d6db8' }]} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Most-used parts of the app" sub={`${shortDay(full.day)} · share of active accounts that opened each part`}>
          <RankBars
            items={pages.map((k) => ({ k, users: u.pageUsers[k] ?? 0 })).sort((x, y) => y.users - x.users).map(({ k, users }) => ({
              key: k, label: SECTION_LABELS[k], value: users,
              detail: `${SECTION_LABELS[k]}: ${fmtInt(users)} accounts · ${fmtDuration((u.pageSeconds[k] ?? 0) / Math.max(1, users))} each · ${fmtInt(u.pageVisits?.[k] ?? 0)} visits`,
            }))}
            format={(n) => `${fmtInt(n)} · ${u.dau ? fmtPct(n / u.dau, 0) : '0%'}`}
            empty="No activity recorded for this day yet."
          />
        </Panel>
        <Panel title="Where time is spent" sub={`${shortDay(full.day)} · minutes, all accounts`}>
          <RankBars
            items={pages.map((k) => ({ k, s: u.pageSeconds[k] ?? 0 })).sort((x, y) => y.s - x.s).map(({ k, s }) => ({ key: k, label: SECTION_LABELS[k], value: s / 60 }))}
            format={(n) => `${fmtInt(n)} min · ${u.seconds ? fmtPct((n * 60) / u.seconds, 0) : '0%'}`}
            empty="No activity recorded for this day yet."
          />
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Panel title="Signed up vs active" sub="Every account, by when it was last used">
          <RankBars
            items={[
              { key: 'w', label: 'Active this week', value: a.active7, color: '#16876a' },
              { key: 'm', label: 'Active this month (not this week)', value: Math.max(0, a.active30 - a.active7), color: '#3d6db8' },
              { key: 'i', label: 'Inactive (30+ days)', value: inactive, color: '#a99a80' },
            ]}
            format={(n) => `${fmtInt(n)} · ${a.total ? fmtPct(n / a.total, 0) : '0%'}`}
          />
          <div className="text-[11px] text-slate-500 mt-3">{fmtInt(a.total)} accounts in all · {fmtInt(signups)} new in the last {range} days</div>
        </Panel>
        <Panel title="iPhone app vs website" sub={`${shortDay(full.day)} · active accounts on each (some use both)`}>
          <RankBars
            items={[
              { key: 'app', label: 'iPhone app', value: u?.appUsers ?? 0, detail: `iPhone app: ${fmtDuration(u?.appUsers ? u.appSeconds / u.appUsers : 0)} each` },
              { key: 'web', label: 'Website', value: u?.webUsers ?? 0, detail: `Website: ${fmtDuration(u?.webUsers ? u.webSeconds / u.webUsers : 0)} each` },
            ]}
            format={(n) => `${fmtInt(n)} · ${u?.dau ? fmtPct(n / u.dau, 0) : '0%'}`}
          />
        </Panel>
        <Panel title="Coming back" sub="Of accounts that signed up 1, 7 and 30 days ago, how many used the app again since">
          <RankBars
            items={(['d1', 'd7', 'd30'] as const).map((k) => ({ key: k, label: k === 'd1' ? 'Next day' : k === 'd7' ? 'After a week' : 'After a month', value: ret[k].cohort ? ret[k].retained / ret[k].cohort : 0, detail: `${fmtInt(ret[k].retained)} of ${fmtInt(ret[k].cohort)}` }))}
            format={(n) => fmtPct(n, 0)}
            empty="No sign-ups old enough yet."
          />
        </Panel>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Average friends" value={latest.social.avgFriends.toFixed(1)} sub={`${a.summaries ? fmtPct(latest.social.withFriend / a.summaries, 0) : '0%'} have at least one`} />
        <Tile label="Average badges earned" value={latest.social.avgBadges.toFixed(1)} sub={`${a.summaries ? fmtPct(latest.social.withBadge / a.summaries, 0) : '0%'} have at least one`} />
        <Tile label="Use the Portfolio" value={u?.dau ? fmtPct((u.pageUsers.portfolio ?? 0) / u.dau, 0) : '—'} sub={`of active accounts · ${shortDay(full.day)}`} />
        <Tile label="New sign-ups" value={fmtInt(signups)} sub={`last ${range} days`} />
      </div>

      <Panel title="New sign-ups per day">
        <TimeBars data={days.map((d) => ({ label: shortDay(d.day), signups: d.accounts?.signups ?? 0 }))} series={[{ key: 'signups', name: 'Sign-ups', color: '#16876a' }]} />
      </Panel>
      <Note />
    </div>
  )
}

function Note() {
  return (
    <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
      <Info size={12} className="shrink-0 mt-0.5" />
      Days are in UTC. Accounts are counted from the first time they opened the app after statistics began, so early numbers undercount. Time only counts while someone is actually using the app (touched in the last 2 minutes).
    </p>
  )
}
