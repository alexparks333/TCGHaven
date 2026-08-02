'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Package, TrendingUp, Layers, Sparkles, LogOut, ShoppingBag, BookOpen, SlidersHorizontal, Banknote, Settings, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'

const nav = [
  { href: '/', label: 'Portfolio', icon: TrendingUp },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/sold', label: 'Sold', icon: Banknote },
  { href: '/cardex', label: 'Cardex', icon: BookOpen },
  { href: '/spending', label: 'Spending', icon: ShoppingBag },
  { href: '/pack-analysis', label: 'Pack Analysis', icon: Layers },
  { href: '/admin', label: 'Admin', icon: ShieldCheck },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { calcFloor, showFilters, setShowFilters } = useStore()

  const isAuthPage = pathname === '/login' || pathname === '/signup'
  if (isAuthPage) return null

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
      <aside className="hidden md:flex flex-col w-56 border-r border-slate-800 bg-slate-950/80 backdrop-blur-sm px-3 py-6 shrink-0">
        <div className="flex items-center gap-2 px-3 mb-8">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
            <Sparkles size={16} className="text-white" />
          </div>
          <span className="font-bold text-white text-lg">TCGHaven</span>
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
                  <div className="text-xs font-semibold text-white truncate">
                    {user.displayName ?? 'Collector'}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">{user.email}</div>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 text-xs text-slate-500 hover:text-red-400 transition-colors px-1 py-1 rounded-lg hover:bg-red-950/20"
              >
                <LogOut size={12} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950/95 border-t border-slate-800 backdrop-blur-sm flex">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex-1 flex flex-col items-center gap-0.5 py-3 text-slate-500 transition-colors',
              pathname === href && 'text-violet-400'
            )}
          >
            <Icon size={20} />
            <span className="text-[10px] font-medium">{label}</span>
          </Link>
        ))}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            'flex-1 flex flex-col items-center gap-0.5 py-3 transition-colors relative',
            showFilters ? 'text-violet-400' : 'text-slate-500',
          )}
        >
          <div className="relative">
            <SlidersHorizontal size={20} />
            {calcFloor > 0 && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-violet-500" />
            )}
          </div>
          <span className="text-[10px] font-medium">Filters</span>
        </button>
        <button
          onClick={handleSignOut}
          className="flex-1 flex flex-col items-center gap-0.5 py-3 text-slate-500"
        >
          <LogOut size={20} />
          <span className="text-[10px] font-medium">Sign out</span>
        </button>
      </nav>
    </>
  )
}
