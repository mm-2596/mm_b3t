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
  TrendingUp,
  LogOut,
  User,
} from 'lucide-react'

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
    <aside className="fixed left-0 top-0 h-full w-60 border-r border-gray-700/50 bg-gray-900/50 backdrop-blur-xl flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-700/50">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <span className="font-bold text-gray-100 text-base tracking-tight">mm_b3t</span>
          <p className="text-xs text-gray-500">Betting Tracker</p>
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
