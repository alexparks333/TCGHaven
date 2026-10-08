'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Package, TrendingUp, LogOut, ShoppingBag, BookOpen, SlidersHorizontal, Banknote, Settings, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import { ADMIN_UID } from '@/lib/firebase/config'

const BASE_NAV = [
  { href: '/', label: 'Portfolio', icon: TrendingUp },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/sold', label: 'Sold', icon: Banknote },
  { href: '/cardex', label: 'Cardex', icon: BookOpen },
  { href: '/spending', label: 'Spending', icon: ShoppingBag },
  { href: '/settings', label: 'Settings', icon: Settings },
]
const ADMIN_NAV_ITEM = { href: '/admin', label: 'Admin', icon: ShieldCheck }
// Phone bottom bar, in display order. Everything not here (Filters, Admin, Sign out) is
// reachable from the Settings page on phones.
const MOBILE_NAV = [
  { href: '/', label: 'Portfolio', icon: TrendingUp },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/cardex', label: 'Cardex', icon: BookOpen },
  { href: '/sold', label: 'Sold', icon: Banknote },
  { href: '/spending', label: 'Spending', icon: ShoppingBag },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { calcFloor, showFilters, setShowFilters } = useStore()

  const isAuthPage = pathname === '/login' || pathname === '/signup'
  if (isAuthPage) return null

  // UI-level only — hides the link for non-admins, same as AdminCatalogPage.tsx hides its
  // write controls. Real enforcement is Firestore/Storage security rules, not this check.
  const isAdmin = !!user && !!ADMIN_UID && user.uid === ADMIN_UID
  const nav = isAdmin ? [...BASE_NAV.slice(0, -1), ADMIN_NAV_ITEM, BASE_NAV[BASE_NAV.length - 1]] : BASE_NAV

  async function handleSignOut() {
    await signOut()
    router.replace('/login')
  }

  const initials = user?.displayName
    ? user.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : user?.email?.[0]?.toUpperCase() ?? '?'

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
          {user && (
            <div className="px-3 py-3 rounded-xl bg-slate-900/50 border border-slate-800">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-full bg-violet-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
                  ) : initials}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-ink truncate">
                    {user.displayName ?? 'Collector'}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">{user.email}</div>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 text-xs text-slate-500 hover:text-red-600 transition-colors px-1 py-1 rounded-lg hover:bg-red-100/20"
              >
                <LogOut size={12} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Bottom Nav — the six everyday pages. Filters, Admin and Sign out live on the
          Settings page on phones (see AccountActions in SettingsPage.tsx) rather than taking a
          bottom-bar slot each; nine-plus equal slots left every label colliding. */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950 border-t border-slate-700 shadow-[0_-4px_16px_rgba(60,40,20,0.08)] flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {MOBILE_NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex-1 min-w-0 flex flex-col items-center gap-1 pt-2.5 pb-2 transition-colors',
                active ? 'text-violet-700' : 'text-slate-300',
              )}
            >
              <div className="relative">
                <Icon size={22} strokeWidth={active ? 2.4 : 2} />
                {href === '/settings' && calcFloor > 0 && (
                  <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-violet-600" />
                )}
              </div>
              <span className={cn('text-[11px] leading-none', active ? 'font-bold' : 'font-semibold')}>{label}</span>
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
    </header>
  )
}
