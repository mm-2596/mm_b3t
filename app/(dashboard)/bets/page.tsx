'use client'

import { useState, useMemo } from 'react'
import { useBets } from '@/hooks/useBets'
import { useSettings } from '@/hooks/useSettings'
import { BetForm } from '@/components/BetForm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  formatCurrency, calcProfit, getStatusBg, STATUS_LABELS,
  SPORTS, BOOKMAKERS
} from '@/lib/utils'
import { Plus, Search, Filter, Pencil, Trash2, CheckCircle } from 'lucide-react'
import type { Bet, BetStatus } from '@/lib/database.types'
import { format } from 'date-fns'

const STATUS_FILTER = [
  { value: '', label: 'Todos los estados' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'won', label: 'Ganada' },
  { value: 'lost', label: 'Perdida' },
  { value: 'void', label: 'Anulada' },
  { value: 'cashout', label: 'Cash Out' },
]

const SPORT_FILTER = [
  { value: '', label: 'Todos los deportes' },
  ...SPORTS.map(s => ({ value: s, label: s }))
]

const SETTLE_STATUS_OPTIONS = [
  { value: 'won', label: '✅ Ganada' },
  { value: 'lost', label: '❌ Perdida' },
  { value: 'void', label: '⚪ Anulada' },
  { value: 'cashout', label: '💰 Cash Out' },
]

export default function BetsPage() {
  const { bets, loading, addBet, updateBet, deleteBet } = useBets()
  const { unitValue } = useSettings()

  const [showForm, setShowForm] = useState(false)
  const [editBet, setEditBet] = useState<Bet | undefined>()
  const [settlingBet, setSettlingBet] = useState<string | null>(null)
  const [settleStatus, setSettleStatus] = useState<BetStatus>('won')
  const [cashoutAmount, setCashoutAmount] = useState('')
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSport, setFilterSport] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const filtered = useMemo(() => {
    return bets.filter(bet => {
      if (filterStatus && bet.status !== filterStatus) return false
      if (filterSport && bet.sport !== filterSport) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          bet.match.toLowerCase().includes(q) ||
          bet.pick.toLowerCase().includes(q) ||
          bet.bookmaker.toLowerCase().includes(q) ||
          bet.competition?.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [bets, filterStatus, filterSport, search])

  const handleEdit = (bet: Bet) => {
    setEditBet(bet)
    setShowForm(true)
  }

  const handleUpdate = async (data: Omit<Bet, 'id' | 'created_at' | 'user_id'>) => {
    if (editBet) {
      await updateBet(editBet.id, data)
      setEditBet(undefined)
    }
  }

  const handleSettle = async (betId: string) => {
    const updates: Partial<Bet> = { status: settleStatus }
    if (settleStatus === 'cashout' && cashoutAmount) {
      updates.result_amount = parseFloat(cashoutAmount)
    }
    await updateBet(betId, updates)
    setSettlingBet(null)
    setCashoutAmount('')
  }

  const handleDelete = async (id: string) => {
    await deleteBet(id)
    setDeleteConfirm(null)
  }

  const totalStake = filtered.reduce((s, b) => s + b.stake, 0)
  const totalProfit = filtered
    .filter(b => b.status !== 'pending')
    .reduce((s, b) => s + calcProfit(b), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Apuestas</h1>
          <p className="text-sm text-gray-400 mt-0.5">{bets.length} apuestas registradas</p>
        </div>
        <Button onClick={() => { setEditBet(undefined); setShowForm(true) }}>
          <Plus className="w-4 h-4 mr-2" />
          Nueva Apuesta
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="w-full rounded-lg border border-gray-600 bg-gray-700/50 text-gray-100 text-sm pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 placeholder:text-gray-500"
            placeholder="Buscar partido, pick..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="rounded-lg border border-gray-600 bg-gray-700/50 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          {STATUS_FILTER.map(o => (
            <option key={o.value} value={o.value} className="bg-gray-800">{o.label}</option>
          ))}
        </select>
        <select
          className="rounded-lg border border-gray-600 bg-gray-700/50 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          value={filterSport}
          onChange={e => setFilterSport(e.target.value)}
        >
          {SPORT_FILTER.map(o => (
            <option key={o.value} value={o.value} className="bg-gray-800">{o.label}</option>
          ))}
        </select>
      </div>

      {/* Summary strip */}
      {filtered.length > 0 && (
        <div className="flex gap-4 text-sm">
          <span className="text-gray-400">{filtered.length} apuestas</span>
          <span className="text-gray-400">Stake: <span className="text-gray-200">{formatCurrency(totalStake)}</span></span>
          <span className={totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}>
            P&L: {totalProfit >= 0 ? '+' : ''}{formatCurrency(totalProfit)}
          </span>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-gray-800/50 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-700 p-12 text-center">
          <p className="text-gray-400">No se encontraron apuestas</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/30 overflow-hidden">
          <div className="overflow-x-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700/50">
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-400 uppercase">Fecha</th>
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-400 uppercase">Pick</th>
                  <th className="hidden md:table-cell text-left px-3 py-3 text-xs font-medium text-gray-400 uppercase">Deporte</th>
                  <th className="hidden sm:table-cell text-left px-3 py-3 text-xs font-medium text-gray-400 uppercase">Casa</th>
                  <th className="hidden sm:table-cell text-left px-3 py-3 text-xs font-medium text-gray-400 uppercase">Cuota</th>
                  <th className="hidden md:table-cell text-left px-3 py-3 text-xs font-medium text-gray-400 uppercase">Ud.</th>
                  <th className="hidden md:table-cell text-left px-3 py-3 text-xs font-medium text-gray-400 uppercase">Stake</th>
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-400 uppercase">Estado</th>
                  <th className="text-right px-3 py-3 text-xs font-medium text-gray-400 uppercase">P&L</th>
                  <th className="hidden sm:table-cell text-right px-3 py-3 text-xs font-medium text-gray-400 uppercase">Acc.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/20">
                {filtered.map(bet => {
                  const profit = calcProfit(bet)
                  const isSettling = settlingBet === bet.id
                  return (
                    <>
                      <tr
                        key={bet.id}
                        className="hover:bg-gray-700/20 transition-colors group"
                      >
                        <td className="px-3 py-3 text-sm text-gray-400 whitespace-nowrap">
                          {format(new Date(bet.date + 'T00:00:00'), 'dd/MM/yy')}
                        </td>
                        <td className="px-3 py-3 min-w-0">
                          <div className="text-sm text-gray-100 font-medium truncate">{bet.pick}</div>
                          <div className="text-xs text-gray-500 truncate">
                            {[bet.competition, bet.match !== 'Apuesta' ? bet.match : null].filter(Boolean).join(' · ')}
                          </div>
                        </td>
                        <td className="hidden md:table-cell px-3 py-3 text-sm text-gray-400">{bet.sport}</td>
                        <td className="hidden sm:table-cell px-3 py-3 text-sm text-gray-400">{bet.bookmaker}</td>
                        <td className="hidden sm:table-cell px-3 py-3 text-sm text-gray-300 font-mono">{bet.odds.toFixed(2)}</td>
                        <td className="hidden md:table-cell px-3 py-3 text-sm text-gray-300">{bet.units}u</td>
                        <td className="hidden md:table-cell px-3 py-3 text-sm text-gray-300">{formatCurrency(bet.stake)}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${getStatusBg(bet.status)}`}>
                            {STATUS_LABELS[bet.status]}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          {bet.status === 'pending' ? (
                            <span className="text-sm text-gray-500">—</span>
                          ) : (
                            <span className={`text-sm font-semibold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {profit >= 0 ? '+' : ''}{formatCurrency(profit)}
                            </span>
                          )}
                        </td>
                        <td className="hidden sm:table-cell px-3 py-3">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {bet.status === 'pending' && (
                              <button
                                onClick={() => setSettlingBet(isSettling ? null : bet.id)}
                                className="p-1.5 rounded-md text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                                title="Liquidar apuesta"
                              >
                                <CheckCircle className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleEdit(bet)}
                              className="p-1.5 rounded-md text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                              title="Editar"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(deleteConfirm === bet.id ? null : bet.id)}
                              className="p-1.5 rounded-md text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {/* Settle inline */}
                      {isSettling && (
                        <tr key={`${bet.id}-settle`} className="bg-gray-800/60">
                          <td colSpan={10} className="px-4 py-3">
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-sm text-gray-400">Liquidar como:</span>
                              <select
                                className="rounded-lg border border-gray-600 bg-gray-700 text-gray-100 text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                value={settleStatus}
                                onChange={e => setSettleStatus(e.target.value as BetStatus)}
                              >
                                {SETTLE_STATUS_OPTIONS.map(o => (
                                  <option key={o.value} value={o.value} className="bg-gray-800">{o.label}</option>
                                ))}
                              </select>
                              {settleStatus === 'cashout' && (
                                <input
                                  type="number"
                                  step="0.01"
                                  className="w-32 rounded-lg border border-gray-600 bg-gray-700 text-gray-100 text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder:text-gray-500"
                                  placeholder="Importe €"
                                  value={cashoutAmount}
                                  onChange={e => setCashoutAmount(e.target.value)}
                                />
                              )}
                              <Button size="sm" onClick={() => handleSettle(bet.id)}>
                                Confirmar
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setSettlingBet(null)}>
                                Cancelar
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )}
                      {/* Delete confirm */}
                      {deleteConfirm === bet.id && (
                        <tr key={`${bet.id}-delete`} className="bg-red-500/5">
                          <td colSpan={10} className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <span className="text-sm text-gray-300">¿Eliminar esta apuesta?</span>
                              <Button size="sm" variant="danger" onClick={() => handleDelete(bet.id)}>
                                Eliminar
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(null)}>
                                Cancelar
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Form Modal */}
      <BetForm
        open={showForm}
        onClose={() => { setShowForm(false); setEditBet(undefined) }}
        onSubmit={editBet ? handleUpdate : addBet}
        initialData={editBet}
        unitValue={unitValue}
        title={editBet ? 'Editar Apuesta' : 'Nueva Apuesta'}
      />
    </div>
  )
}
