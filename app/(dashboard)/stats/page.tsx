'use client'

import { useMemo } from 'react'
import { useBets } from '@/hooks/useBets'
import { useSettings } from '@/hooks/useSettings'
import { formatCurrency, calcProfit, calcROI, calcWinRate } from '@/lib/utils'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

const COLORS = {
  won: '#4ade80',
  lost: '#f87171',
  void: '#9ca3af',
  cashout: '#60a5fa',
  pending: '#fbbf24',
}

export default function StatsPage() {
  const { bets, loading } = useBets()
  const { unitValue } = useSettings()

  const stats = useMemo(() => {
    const settled = bets.filter(b => b.status !== 'pending')

    // P&L evolution over time
    const sorted = [...bets]
      .filter(b => b.status !== 'pending')
      .sort((a, b) => a.date.localeCompare(b.date))

    let cumulative = 0
    const pnlEvolution = sorted.map(bet => {
      cumulative += calcProfit(bet)
      return {
        date: bet.date,
        label: format(parseISO(bet.date), 'dd/MM', { locale: es }),
        pnl: parseFloat(cumulative.toFixed(2)),
        profit: parseFloat(calcProfit(bet).toFixed(2)),
      }
    })

    // By sport
    const sportMap: Record<string, { wins: number; losses: number; profit: number; bets: number }> = {}
    settled.forEach(bet => {
      if (!sportMap[bet.sport]) {
        sportMap[bet.sport] = { wins: 0, losses: 0, profit: 0, bets: 0 }
      }
      sportMap[bet.sport].bets++
      sportMap[bet.sport].profit += calcProfit(bet)
      if (bet.status === 'won') sportMap[bet.sport].wins++
      if (bet.status === 'lost') sportMap[bet.sport].losses++
    })
    const bySport = Object.entries(sportMap)
      .map(([sport, data]) => ({
        sport,
        ...data,
        roi: calcROI(bets.filter(b => b.sport === sport)),
        winRate: data.wins + data.losses > 0 ? (data.wins / (data.wins + data.losses)) * 100 : 0,
      }))
      .sort((a, b) => b.profit - a.profit)

    // By bookmaker
    const bookieMap: Record<string, { profit: number; bets: number }> = {}
    settled.forEach(bet => {
      if (!bookieMap[bet.bookmaker]) bookieMap[bet.bookmaker] = { profit: 0, bets: 0 }
      bookieMap[bet.bookmaker].profit += calcProfit(bet)
      bookieMap[bet.bookmaker].bets++
    })
    const byBookmaker = Object.entries(bookieMap)
      .map(([bookie, data]) => ({ bookie, ...data }))
      .sort((a, b) => b.profit - a.profit)

    // Status distribution
    const statusDist = [
      { name: 'Ganadas', value: bets.filter(b => b.status === 'won').length, color: COLORS.won },
      { name: 'Perdidas', value: bets.filter(b => b.status === 'lost').length, color: COLORS.lost },
      { name: 'Pendientes', value: bets.filter(b => b.status === 'pending').length, color: COLORS.pending },
      { name: 'Anuladas', value: bets.filter(b => b.status === 'void').length, color: COLORS.void },
    ].filter(s => s.value > 0)

    // Monthly P&L
    const monthMap: Record<string, number> = {}
    settled.forEach(bet => {
      const month = bet.date.substring(0, 7)
      monthMap[month] = (monthMap[month] || 0) + calcProfit(bet)
    })
    const monthlyPnl = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, profit]) => ({
        month: format(parseISO(month + '-01'), 'MMM yy', { locale: es }),
        profit: parseFloat(profit.toFixed(2)),
      }))

    return {
      settled,
      totalProfit: settled.reduce((s, b) => s + calcProfit(b), 0),
      roi: calcROI(bets),
      winRate: calcWinRate(bets),
      avgOdds: settled.length > 0
        ? settled.reduce((s, b) => s + b.odds, 0) / settled.length
        : 0,
      avgUnits: settled.length > 0
        ? settled.reduce((s, b) => s + b.units, 0) / settled.length
        : 0,
      pnlEvolution,
      bySport,
      byBookmaker,
      statusDist,
      monthlyPnl,
    }
  }, [bets, unitValue])

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-3 shadow-xl text-sm">
          <p className="text-gray-400 mb-1">{label}</p>
          {payload.map((p: any) => (
            <p key={p.name} style={{ color: p.color || '#e2e8f0' }}>
              {p.name}: {typeof p.value === 'number' ? formatCurrency(p.value) : p.value}
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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Estadísticas</h1>
        <p className="text-sm text-gray-400 mt-0.5">{stats.settled.length} apuestas liquidadas</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'ROI', value: `${stats.roi.toFixed(2)}%`, positive: stats.roi >= 0 },
          { label: '% Aciertos', value: `${stats.winRate.toFixed(1)}%`, positive: stats.winRate >= 50 },
          { label: 'Cuota Media', value: stats.avgOdds.toFixed(2), positive: true },
          { label: 'Unidades Med.', value: `${stats.avgUnits.toFixed(2)}u`, positive: true },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wider">{s.label}</p>
            <p className={`mt-2 text-2xl font-bold ${s.positive ? 'text-emerald-400' : 'text-red-400'}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* P&L Evolution Chart */}
      {stats.pnlEvolution.length > 1 && (
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-6">
          <h2 className="text-base font-semibold text-gray-100 mb-6">Evolución P&L Acumulado</h2>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={stats.pnlEvolution}>
              <defs>
                <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tickFormatter={v => `${v}€`} tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="pnl"
                name="P&L Acum."
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#pnlGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Monthly P&L */}
        {stats.monthlyPnl.length > 0 && (
          <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-6">
            <h2 className="text-base font-semibold text-gray-100 mb-6">P&L por Mes</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.monthlyPnl}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis tickFormatter={v => `${v}€`} tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar
                  dataKey="profit"
                  name="P&L"
                  radius={[4, 4, 0, 0]}
                  fill="#10b981"
                >
                  {stats.monthlyPnl.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.profit >= 0 ? '#10b981' : '#f87171'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Status distribution */}
        {stats.statusDist.length > 0 && (
          <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-6">
            <h2 className="text-base font-semibold text-gray-100 mb-6">Distribución de Resultados</h2>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={stats.statusDist}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {stats.statusDist.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Legend
                  wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }}
                />
                <Tooltip
                  formatter={(v) => [v, '']}
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  labelStyle={{ color: '#e2e8f0' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* By Sport table */}
      {stats.bySport.length > 0 && (
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-700/50">
            <h2 className="text-base font-semibold text-gray-100">Por Deporte</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700/30">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Deporte</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-400 uppercase">Apuestas</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-400 uppercase">W/L</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-400 uppercase">% Aciertos</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-400 uppercase">ROI</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-400 uppercase">P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/20">
              {stats.bySport.map(row => (
                <tr key={row.sport} className="hover:bg-gray-700/20 transition-colors">
                  <td className="px-6 py-3 text-sm font-medium text-gray-100">{row.sport}</td>
                  <td className="px-6 py-3 text-sm text-gray-300 text-right">{row.bets}</td>
                  <td className="px-6 py-3 text-sm text-gray-300 text-right">{row.wins}/{row.losses}</td>
                  <td className="px-6 py-3 text-sm text-right">
                    <span className={row.winRate >= 50 ? 'text-green-400' : 'text-red-400'}>
                      {row.winRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-right">
                    <span className={row.roi >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {row.roi.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm font-semibold text-right">
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

      {/* By Bookmaker table */}
      {stats.byBookmaker.length > 0 && (
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-700/50">
            <h2 className="text-base font-semibold text-gray-100">Por Casa de Apuestas</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700/30">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Casa</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-400 uppercase">Apuestas</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-400 uppercase">P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/20">
              {stats.byBookmaker.map(row => (
                <tr key={row.bookie} className="hover:bg-gray-700/20 transition-colors">
                  <td className="px-6 py-3 text-sm font-medium text-gray-100">{row.bookie}</td>
                  <td className="px-6 py-3 text-sm text-gray-300 text-right">{row.bets}</td>
                  <td className="px-6 py-3 text-sm font-semibold text-right">
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

      {bets.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-700 p-16 text-center">
          <p className="text-gray-400">Registra apuestas para ver estadísticas</p>
        </div>
      )}
    </div>
  )
}
