'use client'

import { useMemo, useState } from 'react'
import { useBets } from '@/hooks/useBets'
import { useSettings } from '@/hooks/useSettings'
import { formatCurrency, calcProfit, calcROI, calcWinRate } from '@/lib/utils'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'
import {
  startOfDay, startOfWeek, startOfMonth, startOfYear,
  endOfDay, endOfWeek, endOfMonth, endOfYear,
  format, parseISO, isWithinInterval, subWeeks, subMonths
} from 'date-fns'
import { es } from 'date-fns/locale'
import type { Bet } from '@/lib/database.types'

type Period = 'today' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year' | 'all'

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Hoy',
  this_week: 'Esta semana',
  last_week: 'Semana pasada',
  this_month: 'Este mes',
  last_month: 'Mes pasado',
  this_year: 'Este año',
  all: 'Todo',
}

const COLORS = {
  won: '#4ade80',
  lost: '#f87171',
  void: '#9ca3af',
  cashout: '#60a5fa',
  pending: '#fbbf24',
}

function getPeriodRange(period: Period): { start: Date; end: Date } | null {
  const now = new Date()
  switch (period) {
    case 'today':
      return { start: startOfDay(now), end: endOfDay(now) }
    case 'this_week':
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
    case 'last_week': {
      const lw = subWeeks(now, 1)
      return { start: startOfWeek(lw, { weekStartsOn: 1 }), end: endOfWeek(lw, { weekStartsOn: 1 }) }
    }
    case 'this_month':
      return { start: startOfMonth(now), end: endOfMonth(now) }
    case 'last_month': {
      const lm = subMonths(now, 1)
      return { start: startOfMonth(lm), end: endOfMonth(lm) }
    }
    case 'this_year':
      return { start: startOfYear(now), end: endOfYear(now) }
    case 'all':
      return null
  }
}

function filterByPeriod(bets: Bet[], period: Period): Bet[] {
  const range = getPeriodRange(period)
  if (!range) return bets
  return bets.filter(b => {
    const d = parseISO(b.date)
    return isWithinInterval(d, range)
  })
}

export default function StatsPage() {
  const { bets, loading } = useBets()
  const { unitValue } = useSettings()
  const [period, setPeriod] = useState<Period>('this_month')

  const filtered = useMemo(() => filterByPeriod(bets, period), [bets, period])

  const stats = useMemo(() => {
    const settled = filtered.filter(b => b.status !== 'pending')

    // P&L cumulative
    const sorted = [...settled].sort((a, b) => a.date.localeCompare(b.date))
    let cum = 0
    const pnlEvolution = sorted.map(bet => {
      cum += calcProfit(bet)
      return {
        label: format(parseISO(bet.date), 'dd/MM', { locale: es }),
        pnl: parseFloat(cum.toFixed(2)),
      }
    })

    // By sport
    const sportMap: Record<string, { wins: number; losses: number; profit: number; bets: number; stake: number }> = {}
    settled.forEach(bet => {
      if (!sportMap[bet.sport]) sportMap[bet.sport] = { wins: 0, losses: 0, profit: 0, bets: 0, stake: 0 }
      sportMap[bet.sport].bets++
      sportMap[bet.sport].profit += calcProfit(bet)
      sportMap[bet.sport].stake += bet.stake
      if (bet.status === 'won') sportMap[bet.sport].wins++
      if (bet.status === 'lost') sportMap[bet.sport].losses++
    })
    const bySport = Object.entries(sportMap)
      .map(([sport, d]) => ({
        sport, ...d,
        roi: d.stake > 0 ? (d.profit / d.stake) * 100 : 0,
        winRate: d.wins + d.losses > 0 ? (d.wins / (d.wins + d.losses)) * 100 : 0,
      }))
      .sort((a, b) => b.profit - a.profit)

    // By bookmaker
    const bookieMap: Record<string, { profit: number; bets: number; stake: number }> = {}
    settled.forEach(bet => {
      if (!bookieMap[bet.bookmaker]) bookieMap[bet.bookmaker] = { profit: 0, bets: 0, stake: 0 }
      bookieMap[bet.bookmaker].profit += calcProfit(bet)
      bookieMap[bet.bookmaker].bets++
      bookieMap[bet.bookmaker].stake += bet.stake
    })
    const byBookmaker = Object.entries(bookieMap)
      .map(([bookie, d]) => ({
        bookie, ...d,
        roi: d.stake > 0 ? (d.profit / d.stake) * 100 : 0,
      }))
      .sort((a, b) => b.profit - a.profit)

    // Status distribution
    const statusDist = [
      { name: 'Ganadas', value: filtered.filter(b => b.status === 'won').length, color: COLORS.won },
      { name: 'Perdidas', value: filtered.filter(b => b.status === 'lost').length, color: COLORS.lost },
      { name: 'Pendientes', value: filtered.filter(b => b.status === 'pending').length, color: COLORS.pending },
      { name: 'Anuladas', value: filtered.filter(b => b.status === 'void').length, color: COLORS.void },
    ].filter(s => s.value > 0)

    // Monthly breakdown (for "all" or "this year")
    const monthMap: Record<string, { profit: number; bets: number; won: number; lost: number }> = {}
    settled.forEach(bet => {
      const month = bet.date.substring(0, 7)
      if (!monthMap[month]) monthMap[month] = { profit: 0, bets: 0, won: 0, lost: 0 }
      monthMap[month].profit += calcProfit(bet)
      monthMap[month].bets++
      if (bet.status === 'won') monthMap[month].won++
      if (bet.status === 'lost') monthMap[month].lost++
    })
    const monthlyPnl = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({
        month: format(parseISO(month + '-01'), 'MMM yy', { locale: es }),
        profit: parseFloat(d.profit.toFixed(2)),
        bets: d.bets,
      }))

    const totalStake = settled.reduce((s, b) => s + b.stake, 0)
    const totalProfit = settled.reduce((s, b) => s + calcProfit(b), 0)
    const totalUnits = unitValue > 0
      ? settled.reduce((s, b) => {
          const p = calcProfit(b)
          return s + (b.stake > 0 ? p / (b.stake / b.units) : 0)
        }, 0)
      : 0

    return {
      filtered,
      settled,
      pending: filtered.filter(b => b.status === 'pending').length,
      totalProfit,
      totalUnits,
      totalStake,
      roi: calcROI(filtered),
      winRate: calcWinRate(filtered),
      won: filtered.filter(b => b.status === 'won').length,
      lost: filtered.filter(b => b.status === 'lost').length,
      avgOdds: settled.length > 0 ? settled.reduce((s, b) => s + b.odds, 0) / settled.length : 0,
      pnlEvolution,
      bySport,
      byBookmaker,
      statusDist,
      monthlyPnl,
    }
  }, [filtered, unitValue])

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload?.length) {
      return (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-3 shadow-xl text-sm">
          <p className="text-gray-400 mb-1">{label}</p>
          {payload.map((p: any) => (
            <p key={p.name} style={{ color: p.color || '#e2e8f0' }}>
              {p.name}: {typeof p.value === 'number' && p.name !== 'Apuestas' ? formatCurrency(p.value) : p.value}
            </p>
          ))}
        </div>
      )
    }
    return null
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-48 rounded-xl bg-gray-800/50 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header + Period selector */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-100">Estadísticas</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {stats.settled.length} liquidadas · {stats.pending} pendientes
            </p>
          </div>
        </div>
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1 border border-gray-700/50 w-max sm:w-auto sm:flex-wrap">
            {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                  period === p
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'P&L', value: formatCurrency(stats.totalProfit), positive: stats.totalProfit >= 0, sub: `${stats.totalUnits >= 0 ? '+' : ''}${stats.totalUnits.toFixed(2)}u` },
          { label: 'ROI', value: `${stats.roi.toFixed(2)}%`, positive: stats.roi >= 0, sub: `Stake: ${formatCurrency(stats.totalStake)}` },
          { label: '% Aciertos', value: `${stats.winRate.toFixed(1)}%`, positive: stats.winRate >= 50, sub: `${stats.won}G / ${stats.lost}P` },
          { label: 'Cuota Media', value: stats.avgOdds.toFixed(2), positive: true, sub: `${stats.settled.length} liquidadas` },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wider">{s.label}</p>
            <p className={`mt-2 text-2xl font-bold ${s.positive ? 'text-emerald-400' : 'text-red-400'}`}>
              {s.value}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* No data */}
      {stats.filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-700 p-16 text-center">
          <p className="text-gray-400">No hay apuestas en {PERIOD_LABELS[period].toLowerCase()}</p>
        </div>
      )}

      {/* P&L Evolution */}
      {stats.pnlEvolution.length > 1 && (
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-6">
          <h2 className="text-sm font-semibold text-gray-100 mb-5">P&L Acumulado</h2>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={stats.pnlEvolution}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tickFormatter={v => `${v}€`} tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="pnl" name="P&L" stroke="#10b981" strokeWidth={2} fill="url(#g1)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Monthly P&L */}
        {stats.monthlyPnl.length > 0 && (
          <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-6">
            <h2 className="text-sm font-semibold text-gray-100 mb-5">P&L por Mes</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.monthlyPnl}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis tickFormatter={v => `${v}€`} tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="profit" name="P&L" radius={[4, 4, 0, 0]}>
                  {stats.monthlyPnl.map((e, i) => (
                    <Cell key={i} fill={e.profit >= 0 ? '#10b981' : '#f87171'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Pie */}
        {stats.statusDist.length > 0 && (
          <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-6">
            <h2 className="text-sm font-semibold text-gray-100 mb-5">Distribución</h2>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={stats.statusDist} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                  {stats.statusDist.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }} />
                <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} labelStyle={{ color: '#e2e8f0' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* By Sport */}
      {stats.bySport.length > 0 && (
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-700/50">
            <h2 className="text-sm font-semibold text-gray-100">Por Deporte</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700/30">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Deporte</th>
                <th className="hidden sm:table-cell text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Ap.</th>
                <th className="hidden sm:table-cell text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">W/L</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">% Ac.</th>
                <th className="hidden sm:table-cell text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">ROI</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/20">
              {stats.bySport.map(row => (
                <tr key={row.sport} className="hover:bg-gray-700/20 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-gray-100">{row.sport}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-sm text-gray-300 text-right">{row.bets}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-sm text-gray-300 text-right">{row.wins}/{row.losses}</td>
                  <td className="px-4 py-3 text-sm text-right">
                    <span className={row.winRate >= 50 ? 'text-green-400' : 'text-red-400'}>{row.winRate.toFixed(1)}%</span>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 text-sm text-right">
                    <span className={row.roi >= 0 ? 'text-green-400' : 'text-red-400'}>{row.roi.toFixed(1)}%</span>
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-right">
                    <span className={row.profit >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {row.profit >= 0 ? '+' : ''}{formatCurrency(row.profit)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* By Bookmaker */}
      {stats.byBookmaker.length > 0 && (
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-700/50">
            <h2 className="text-sm font-semibold text-gray-100">Por Casa de Apuestas</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700/30">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Casa</th>
                <th className="hidden sm:table-cell text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Ap.</th>
                <th className="hidden sm:table-cell text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Stake</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">ROI</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/20">
              {stats.byBookmaker.map(row => (
                <tr key={row.bookie} className="hover:bg-gray-700/20 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-gray-100">{row.bookie}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-sm text-gray-300 text-right">{row.bets}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-sm text-gray-300 text-right">{formatCurrency(row.stake)}</td>
                  <td className="px-4 py-3 text-sm text-right">
                    <span className={row.roi >= 0 ? 'text-green-400' : 'text-red-400'}>{row.roi.toFixed(1)}%</span>
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-right">
                    <span className={row.profit >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {row.profit >= 0 ? '+' : ''}{formatCurrency(row.profit)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
