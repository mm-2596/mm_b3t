'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Dices,
  ArrowUpDown,
  BarChart3,
  Settings,
  LogOut,
  User,
} from 'lucide-react'

function WDLogo() {
  return (
    <svg viewBox="0 0 512 512" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" aria-label="Win &amp; Dine">
      <path fill="#34d399" fillRule="evenodd" d="M52 24 H238 C383 24 472 116 472 256 C472 396 383 488 238 488 H52 Q40 488 40 476 V36 Q40 24 52 24 Z M80 154 Q80 147 83.674 152.959 L158.326 274.041 Q162 280 165.781 274.109 L244.219 151.891 Q248 146 251.812 151.871 L331.188 274.129 Q335 280 338.706 274.062 L414.294 152.938 Q418 147 418 154 L418 253 Q418 260 414.339 265.966 L340.661 386.034 Q337 392 333.147 386.156 L251.853 262.844 Q248 257 244.208 262.884 L164.792 386.116 Q161 392 157.339 386.034 L83.661 265.966 Q80 260 80 253 Z"/>
    </svg>
  )
}

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Apuestas', href: '/bets', icon: Dices },
  { name: 'Bankroll', href: '/bankroll', icon: ArrowUpDown },
  { name: 'Estadísticas', href: '/stats', icon: BarChart3 },
  { name: 'Ajustes', href: '/settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserEmail(user?.email ?? null)
    })
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="hidden md:flex fixed left-0 top-0 h-full w-60 border-r border-gray-700/50 bg-gray-900/50 backdrop-blur-xl flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-700/50">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
          <WDLogo />
        </div>
        <div>
          <span className="font-bold text-gray-100 text-base tracking-tight">Win &amp; Dine</span>
          <p className="text-xs text-gray-500">by MM</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.name}
            </Link>
          )
        })}
      </nav>

      {/* User + Logout */}
      <div className="px-3 pb-4 border-t border-gray-700/50 pt-4 space-y-1">
        {userEmail && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800/30">
            <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <User className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <span className="text-xs text-gray-400 truncate">{userEmail}</span>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
