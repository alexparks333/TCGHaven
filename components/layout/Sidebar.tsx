'use client'

import Link from 'next/link'
import { LogoHover } from './LogoHover'
import { usePathname } from 'next/navigation'
import { Package, TrendingUp, BookOpen, Banknote, Users, ChevronRight, CircleUserRound, Award, Wand2, PanelLeftClose, PanelLeftOpen, LifeBuoy, Crown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/AuthProvider'
import { FriendsSidebarSection } from '@/components/friends/FriendsSidebar'
import { TitleTag } from '@/components/premium/TitleTag'
import { usePremiumAccess } from '@/components/premium/PremiumProvider'
import { useFriends } from '@/components/friends/FriendsProvider'
import { Avatar } from '@/components/friends/Avatar'
import { useAccountRole, canUseCreatorStudio } from '@/lib/accountRoles'
import { useStudioLinks } from '@/lib/studioDevice'
import { useCommunity } from '@/lib/creatorBooks'

const BASE_NAV = [
  { href: '/', label: 'Portfolio', icon: TrendingUp },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/sold', label: 'Sold', icon: Banknote },
  { href: '/cardex', label: 'Cardex', icon: BookOpen },
  { href: '/badges', label: 'Badges', icon: Award },
]
// Phone bottom bar, in display order. Profile holds Settings (the ⚙️ on its banner — account,
// username, Sign out); Filters is a button on the Portfolio page itself (PortfolioPage.tsx).
const MOBILE_NAV = [
  { href: '/', label: 'Portfolio', icon: TrendingUp },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/cardex', label: 'Cardex', icon: BookOpen },
  { href: '/badges', label: 'Badges', icon: Award },
  { href: '/sold', label: 'Sold', icon: Banknote },
  { href: '/profile', label: 'Profile', icon: CircleUserRound },
]

// The app's frame (sidebar, phone header, bottom tabs) waits for sign-in to be known, and never shows
// on a sign-in-only page to someone signed out: those pages send them to Sign In, and the frame
// drawn first flashed the main app before the jump (iPhone app start-up, 2026-11-20). Pages a
// signed-out visitor may open (/u/…, /c/…, /invite, /premium, /scan…) keep it.
const RAIL_KEY = 'haven:menuRail'
const SIGNED_IN_ONLY = ['/portfolio', '/inventory', '/cardex', '/badges', '/sold', '/profile', '/friends', '/settings', '/creator']
/** A page that sends a signed-out visitor to Sign In (AuthGuard). Also used by SplashIntro. */
export const signedInOnlyPath = (pathname: string) =>
  pathname === '/' || SIGNED_IN_ONLY.some((p) => pathname === p || pathname.startsWith(p + '/'))
function useShowFrame(): boolean {
  const pathname = usePathname() ?? '/'
  const { user, loading } = useAuth()
  if (pathname === '/login' || pathname === '/signup') return false
  if (loading) return false
  return !!user || !signedInOnlyPath(pathname)
}

export function Sidebar() {
  const pathname = usePathname()
  const { user } = useAuth()
  const { me } = useFriends()
  const myRole = useAccountRole(user?.uid).record
  const creator = canUseCreatorStudio(myRole)
  const studioLinks = useStudioLinks() // the Creator Studio is computers-only — no link in the app
  const owned = useCommunity(user?.uid).community // the community you run, if any
  // Haven Premium: "Buy Premium" under your profile until you have it (opens the Premium sheet —
  // its purchase goes through the App Store / Stripe as everywhere else, docs/premium-business.md)
  const premium = usePremiumAccess()
  // A sideways phone can fold the menu to a strip of icons (more room for the page). Remembered on
  // this device; has no effect anywhere else (the .is-rail rules only apply to phoneland, globals.css).
  const [rail, setRail] = useState(false)
  useEffect(() => { try { setRail(localStorage.getItem(RAIL_KEY) === '1') } catch { /* private mode */ } }, [])
  const toggleRail = () => setRail((r) => { try { localStorage.setItem(RAIL_KEY, r ? '0' : '1') } catch { /* private mode */ } return !r })

  const showFrame = useShowFrame()
  if (!showFrame) return null

  // Admin isn't in the collector app anymore — it's the separate staff portal at /admin.
  const nav = BASE_NAV



  return (
    <>
      {/* Desktop Sidebar — also an iPhone on its side (wider than md). It scrolls on its own when the
          tabs don't fit the height (a sideways phone is ~390px tall: the lower tabs were out of
          reach, 2026-11-19), and keeps clear of the notch on the left in landscape. */}
      <aside className={cn('hidden md:flex flex-col w-[17rem] border-r border-slate-800 bg-slate-950/80 backdrop-blur-sm px-3 pl-[max(0.75rem,env(safe-area-inset-left))] py-6 phoneland:py-3 shrink-0 overflow-y-auto overscroll-contain', rail && 'is-rail')}>
        {/* Sideways phone only: fold the menu to icons / open it again */}
        <button
          type="button"
          onClick={toggleRail}
          aria-label={rail ? 'Open the menu' : 'Fold the menu away'}
          title={rail ? 'Open the menu' : 'Fold the menu away'}
          className="rail-toggle hidden phoneland:flex items-center justify-center self-end w-9 h-9 mb-1 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800/60 transition-colors"
        >
          {rail ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <div className="rail-hide"><LogoHover /></div>

        <nav className="flex flex-col gap-1">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              title={label}
              className={cn('nav-link', pathname === href && 'active')}
            >
              <Icon size={16} />
              <span className="rail-hide">{label}</span>
            </Link>
          ))}
        </nav>

        {/* Creators only, set apart under a line: their tools (CreatorPage.tsx) — on a computer, never in the app */}
        {((creator && studioLinks) || owned) && user && (
          <div className="mt-3 pt-3 border-t border-slate-800 flex flex-col gap-1">
            {creator && studioLinks && (
              <Link
                href="/creator"
                className={cn('nav-link', pathname.startsWith('/creator') && 'active')}
              >
                <Wand2 size={16} className="text-violet-600" />
                <span className="rail-hide">Creator</span>
                <span className="rail-hide ml-auto text-[0.5625rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-violet-600/15 text-violet-700">Studio</span>
              </Link>
            )}
            {/* The community you run, straight to its page (where you post, pin notes and arrange the wall) */}
            {owned && (
              <Link href={`/c/${user.uid}`} title={owned.name || 'Your community'} className={cn('nav-link', pathname === `/c/${user.uid}` && 'active')}>
                <Users size={16} />
                <span className="rail-hide">Community</span>
              </Link>
            )}
          </div>
        )}

        {/* User section */}
        <div className="mt-auto">
          {user && <div className="rail-hide"><FriendsSidebarSection /></div>}
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
                <div className="rail-hide min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-semibold text-ink truncate">{me?.displayName ?? user.displayName ?? 'Collector'}</span>
                    <TitleTag uid={user.uid} record={myRole} />
                  </div>
                  <div className="text-[0.625rem] text-slate-500 truncate">{me ? `@${me.username}` : 'Your profile'}</div>
                </div>
                <ChevronRight size={14} className="rail-hide text-slate-500 group-hover:text-ink group-hover:translate-x-0.5 transition-all" />
              </Link>
              {/* Support, and to its right "Buy Premium" until you have Haven Premium (opens the Premium
                  sheet — the App Store / Stripe purchase as everywhere else, docs/premium-business.md) */}
              <div className="mt-1.5 flex items-center justify-center gap-3">
                {/* Help: missing cards, account, bugs (components/pages/SupportPage.tsx) */}
                <Link
                  href="/support"
                  title="Support"
                  className={cn('flex items-center gap-1 text-[0.625rem] font-medium hover:underline underline-offset-2 transition-colors', pathname === '/support' ? 'text-ink' : 'text-slate-500 hover:text-ink')}
                >
                  <LifeBuoy size={10} />
                  <span className="rail-hide">Support</span>
                </Link>
                {/* staff (the Owner included) always see it, to check the Premium sheet; everyone else until they have Premium */}
                {premium.loaded && (!premium.member || myRole.role === 'staff') && (
                  <button
                    type="button"
                    onClick={() => premium.openPremium('general')}
                    title="Haven Premium"
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] font-semibold text-slate-400 bg-slate-900/50 border border-slate-800 hover:text-ink hover:border-slate-700 hover:bg-slate-800/50 active:translate-y-px transition-colors"
                  >
                    <Crown size={10} className="shrink-0 text-[#b8862b]" />
                    <span className="rail-hide">Buy Premium</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Mobile Bottom Nav — the five everyday pages. Settings and Sign out live behind the ⚙️ on
          the Profile banner (ProfilePage.tsx) and Filters on the Portfolio page, rather than each
          taking a bottom-bar slot; nine-plus equal slots left every label colliding. */}
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
                  'flex flex-col items-center gap-1 w-full max-w-[4rem] py-1.5 rounded-xl transition-colors',
                  active ? 'bg-slate-700 text-ink' : 'text-slate-300',
                )}
              >
                <Icon size={22} strokeWidth={active ? 2.4 : 2} />
                <span className={cn('text-[0.6875rem] leading-none', active ? 'font-bold' : 'font-semibold')}>{label}</span>
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
  const { incoming } = useFriends()
  const showFrame = useShowFrame()
  if (!showFrame) return null
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
          <span className="absolute -top-1 -right-1 min-w-[1rem] h-4 px-1 rounded-full bg-red-500 text-white text-[0.5625rem] font-bold flex items-center justify-center leading-none">{incoming.length}</span>
        )}
      </Link>
    </header>
  )
}
