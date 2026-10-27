'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Package, TrendingUp, BookOpen, SlidersHorizontal, Banknote, Users, ChevronRight, CircleUserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import { FriendsSidebarSection } from '@/components/friends/FriendsSidebar'
import { useFriends } from '@/components/friends/FriendsProvider'
import { Avatar } from '@/components/friends/Avatar'

const BASE_NAV = [
  { href: '/', label: 'Portfolio', icon: TrendingUp },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/sold', label: 'Sold', icon: Banknote },
  { href: '/cardex', label: 'Cardex', icon: BookOpen },
]
// Phone bottom bar, in display order. Profile holds Settings (the ⚙️ on its banner — account,
// username, Sign out); Filters is a button in the phone top bar (MobileHeader).
const MOBILE_NAV = [
  { href: '/', label: 'Portfolio', icon: TrendingUp },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/cardex', label: 'Cardex', icon: BookOpen },
  { href: '/sold', label: 'Sold', icon: Banknote },
  { href: '/profile', label: 'Profile', icon: CircleUserRound },
]

export function Sidebar() {
  const pathname = usePathname()
  const { user } = useAuth()
  const { calcFloor, showFilters, setShowFilters } = useStore()
  const { me } = useFriends()

  const isAuthPage = pathname === '/login' || pathname === '/signup'
  if (isAuthPage) return null

  // Admin isn't in the collector app anymore — it's the separate staff portal at /admin.
  const nav = BASE_NAV



  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-[272px] border-r border-slate-800 bg-slate-950/80 backdrop-blur-sm px-3 py-6 shrink-0">
        <div className="flex items-center gap-1.5 px-1 mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="w-[72px] h-[72px] object-contain shrink-0" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-text.png" alt="TCGHaven" className="min-w-0 flex-1 h-auto object-contain" />
        </div>

        <nav className="flex flex-col gap-1">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn('nav-link', pathname === href && 'active')}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>

        {/* Filters trigger */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            'mt-3 nav-link w-full text-left',
            showFilters && 'active',
          )}
        >
          <SlidersHorizontal size={16} />
          Filters
          {calcFloor > 0 && (
            <span className="ml-auto text-[10px] font-bold bg-violet-600 text-white px-1.5 py-0.5 rounded-full leading-none">
              ON
            </span>
          )}
        </button>

        {/* User section */}
        <div className="mt-auto">
          {user && <FriendsSidebarSection />}
          {user && (
            <>
              {/* Your profile — what your friends see (components/pages/ProfilePage.tsx). Sign out
                  is in Settings, behind the ⚙️ on the profile banner. */}
              <Link
                href="/profile"
                className={cn(
                  'group flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-colors',
                  pathname === '/profile' ? 'bg-slate-800 border-slate-700' : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50',
                )}
              >
                <Avatar seed={user.uid} name={me?.displayName ?? user.displayName ?? user.email ?? ''} photoURL={user.photoURL ?? ''} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-ink truncate">{me?.displayName ?? user.displayName ?? 'Collector'}</div>
                  <div className="text-[10px] text-slate-500 truncate">{me ? `@${me.username}` : 'Your profile'}</div>
                </div>
                <ChevronRight size={14} className="text-slate-500 group-hover:text-ink group-hover:translate-x-0.5 transition-all" />
              </Link>
            </>
          )}
        </div>
      </aside>

      {/* Mobile Bottom Nav — the five everyday pages. Settings and Sign out live behind the ⚙️ on
          the Profile banner (ProfilePage.tsx) and Filters in the top bar, rather than each taking a
          bottom-bar slot; nine-plus equal slots left every label colliding. */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950 border-t border-slate-700 shadow-[0_-4px_16px_rgba(60,40,20,0.08)] flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {MOBILE_NAV.map(({ href, label, icon: Icon }) => {
          // Sub-pages count too: a card's detail page and Portfolio Analytics live under
          // /portfolio/..., which belongs to the Portfolio tab.
          const active = href === '/'
            ? pathname === '/' || pathname.startsWith('/portfolio')
            : pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className="flex-1 min-w-0 flex justify-center pt-1.5 pb-1.5"
            >
              {/* The current tab gets a darker tinted pill so it's obvious which page you're on */}
              <span
                className={cn(
                  'flex flex-col items-center gap-1 w-full max-w-[64px] py-1.5 rounded-xl transition-colors',
                  active ? 'bg-slate-700 text-ink' : 'text-slate-300',
                )}
              >
                <Icon size={22} strokeWidth={active ? 2.4 : 2} />
                <span className={cn('text-[11px] leading-none', active ? 'font-bold' : 'font-semibold')}>{label}</span>
              </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}

// Phone-only top bar — the sidebar (and its logo) is hidden below md, so this is where the
// brand lives on a phone. Pads for the iPhone notch/status bar (the app uses a translucent
// status bar when installed to the home screen — see appleWebApp in app/layout.tsx).
export function MobileHeader() {
  const pathname = usePathname()
  const { calcFloor, showFilters, setShowFilters } = useStore()
  const { incoming } = useFriends()
  if (pathname === '/login' || pathname === '/signup') return null
  return (
    <header
      className="md:hidden flex items-center gap-1.5 px-4 pb-2 border-b border-slate-800 bg-slate-950/80"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
    >
      <Link href="/" className="flex items-center gap-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="w-11 h-11 object-contain" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-text.png" alt="TCGHaven" className="h-6 w-auto object-contain" />
      </Link>
      {/* Friends — on phones the sidebar's Friends card lives behind this button */}
      <Link
        href={incoming.length ? '/friends?tab=requests' : '/friends'}
        className={cn('ml-auto relative w-9 h-9 flex items-center justify-center rounded-xl border text-slate-300', pathname === '/friends' ? 'bg-slate-800 border-slate-700 text-ink' : 'border-slate-800')}
        aria-label={incoming.length ? `Friends — ${incoming.length} new request${incoming.length === 1 ? '' : 's'}` : 'Friends'}
      >
        <Users size={17} />
        {incoming.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">{incoming.length}</span>
        )}
      </Link>
      {/* Portfolio Filters dropdown toggle — opens the same FilterPanel the desktop sidebar's
          Filters button does, right under this bar */}
      <button
        onClick={() => setShowFilters(!showFilters)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[13px] font-semibold transition-colors',
          showFilters ? 'bg-slate-800 border-slate-700 text-ink' : 'border-slate-800 text-slate-300',
        )}
        aria-expanded={showFilters}
      >
        <SlidersHorizontal size={15} />
        Filters
        {calcFloor > 0 && <span className="text-[9px] font-bold bg-violet-600 text-white px-1.5 py-0.5 rounded-full leading-none">ON</span>}
      </button>
    </header>
  )
}
