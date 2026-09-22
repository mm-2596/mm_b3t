'use client'

import { useMemo, useState } from 'react'
import { useBets } from '@/hooks/useBets'
import { useTransactions } from '@/hooks/useTransactions'
import { useSettings } from '@/hooks/useSettings'
import { StatsCard } from '@/components/StatsCard'
import { BetForm } from '@/components/BetForm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  formatCurrency, formatUnits, calcProfit, calcROI, calcWinRate,
  getStatusBg, STATUS_LABELS
} from '@/lib/utils'
import {
  TrendingUp, TrendingDown, Wallet, Target,
  Plus, ArrowUpRight, ArrowDownRight, Dices
} from 'lucide-react'
import type { Bet } from '@/lib/database.types'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export default function DashboardPage() {
  const { bets, loading: betsLoading, addBet } = useBets()
  const { netBankroll, totalDeposits } = useTransactions()
  const { unitValue, bankroll } = useSettings()
  const [showBetForm, setShowBetForm] = useState(false)

  const stats = useMemo(() => {
    const settled = bets.filter(b => b.status !== 'pending')
    const totalProfit = settled.reduce((sum, b) => sum + calcProfit(b), 0)
    const totalProfitUnits = unitValue > 0
      ? settled.reduce((sum, b) => {
          const p = calcProfit(b)
          return sum + (b.stake > 0 ? p / (b.stake / b.units) : 0)
        }, 0)
      : 0

    // Current bankroll = deposits - withdrawals + profit from bets
    const currentBankroll = netBankroll + totalProfit

    return {
      totalBets: bets.length,
      settledBets: settled.length,
      pendingBets: bets.filter(b => b.status === 'pending').length,
      wonBets: bets.filter(b => b.status === 'won').length,
      lostBets: bets.filter(b => b.status === 'lost').length,
      totalProfit,
      totalProfitUnits,
      roi: calcROI(bets),
      winRate: calcWinRate(bets),
      currentBankroll,
    }
  }, [bets, netBankroll, unitValue])

  const recentBets = bets.slice(0, 5)

  const profitTrend = stats.totalProfit >= 0 ? 'up' : 'down'
  const roiTrend = stats.roi >= 0 ? 'up' : 'down'

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {format(new Date(), "EEEE, d 'de' MMMM yyyy", { locale: es })}
          </p>
        </div>
        <Button onClick={() => setShowBetForm(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Nueva Apuesta
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Bankroll Actual"
          value={formatCurrency(stats.currentBankroll)}
          subtitle={`Depósitos: ${formatCurrency(totalDeposits)}`}
          icon={Wallet}
          trend="neutral"
        />
        <StatsCard
          title="P&L Total"
          value={formatCurrency(stats.totalProfit)}
          subtitle={`${formatUnits(stats.totalProfitUnits)}`}
          icon={stats.totalProfit >= 0 ? TrendingUp : TrendingDown}
          trend={profitTrend}
        />
        <StatsCard
          title="ROI"
          value={`${stats.roi.toFixed(1)}%`}
          subtitle={`${stats.settledBets} apuestas liquidadas`}
          icon={Target}
          trend={roiTrend}
        />
        <StatsCard
          title="% Aciertos"
          value={`${stats.winRate.toFixed(1)}%`}
          subtitle={`${stats.wonBets}W / ${stats.lostBets}L`}
          icon={Dices}
          trend={stats.winRate >= 50 ? 'up' : 'down'}
        />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Resumen</p>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Total apuestas</span>
              <span className="text-gray-100 font-medium">{stats.totalBets}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Pendientes</span>
              <span className="text-yellow-400 font-medium">{stats.pendingBets}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Ganadas</span>
              <span className="text-green-400 font-medium">{stats.wonBets}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Perdidas</span>
              <span className="text-red-400 font-medium">{stats.lostBets}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Sistema de Unidades</p>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Bankroll base</span>
              <span className="text-gray-100 font-medium">{formatCurrency(bankroll)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Valor 1 unidad</span>
              <span className="text-emerald-400 font-medium">{formatCurrency(unitValue)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Unidades ganadas</span>
              <span className={stats.totalProfitUnits >= 0 ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                {formatUnits(stats.totalProfitUnits)}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Pendientes</p>
          {stats.pendingBets === 0 ? (
            <p className="text-sm text-gray-500">No hay apuestas pendientes</p>
          ) : (
            <div className="space-y-1.5">
              {bets.filter(b => b.status === 'pending').slice(0, 4).map(bet => (
                <div key={bet.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300 truncate flex-1">{bet.pick}</span>
                  <span className="text-yellow-400 ml-2 shrink-0">{formatCurrency(bet.stake)}</span>
                </div>
              ))}
              {stats.pendingBets > 4 && (
                <p className="text-xs text-gray-500">+{stats.pendingBets - 4} más</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Recent bets */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-100">Últimas Apuestas</h2>
          <a href="/bets" className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1">
            Ver todas →
          </a>
        </div>

        {betsLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-gray-800/50 animate-pulse" />
            ))}
          </div>
        ) : recentBets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-700 p-8 text-center">
            <Dices className="w-8 h-8 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No hay apuestas registradas</p>
            <Button onClick={() => setShowBetForm(true)} className="mt-3" size="sm">
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Primera apuesta
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700/50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Fecha</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Pick</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Cuota</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Unidades</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Estado</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                {recentBets.map(bet => {
                  const profit = calcProfit(bet)
                  return (
                    <tr key={bet.id} className="hover:bg-gray-700/20 transition-colors">
                      <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap">
                        {format(new Date(bet.date + 'T00:00:00'), 'dd/MM')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-100 font-medium">{bet.pick}</div>
                        <div className="text-xs text-gray-500">{bet.match}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">{bet.odds.toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{bet.units}u</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${getStatusBg(bet.status)}`}>
                          {STATUS_LABELS[bet.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {bet.status === 'pending' ? (
                          <span className="text-sm text-gray-500">—</span>
                        ) : (
                          <span className={`text-sm font-semibold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {profit >= 0 ? '+' : ''}{formatCurrency(profit)}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bet Form Modal */}
      <BetForm
        open={showBetForm}
        onClose={() => setShowBetForm(false)}
        onSubmit={addBet}
        unitValue={unitValue}
      />
    </div>
  )
}
