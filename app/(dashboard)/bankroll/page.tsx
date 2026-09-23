'use client'

import { useState } from 'react'
import { useTransactions } from '@/hooks/useTransactions'
import { useBets } from '@/hooks/useBets'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatCurrency, calcProfit, BOOKMAKERS } from '@/lib/utils'
import { Plus, ArrowUpRight, ArrowDownLeft, Trash2, TrendingUp, X } from 'lucide-react'
import type { TransactionType } from '@/lib/database.types'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

const BOOKMAKER_OPTIONS = BOOKMAKERS.map(b => ({ value: b, label: b }))
const TYPE_OPTIONS = [
  { value: 'deposit', label: '⬆️ Depósito' },
  { value: 'withdrawal', label: '⬇️ Retiro' },
]

type Tx = { id: string; date: string; type: TransactionType; amount: number; bookmaker: string | null; notes: string | null }

export default function BankrollPage() {
  const { transactions, loading, addTransaction, deleteTransaction, totalDeposits, totalWithdrawals, netBankroll } = useTransactions()
  const { bets } = useBets()
  const [showForm, setShowForm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [detailTx, setDetailTx] = useState<Tx | null>(null)
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    type: 'deposit' as TransactionType,
    amount: '',
    bookmaker: '',
    notes: '',
  })
  const [formLoading, setFormLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalBettingProfit = bets
    .filter(b => b.status !== 'pending')
    .reduce((sum, b) => sum + calcProfit(b), 0)

  const currentBankroll = netBankroll + totalBettingProfit

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [key]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const amount = parseFloat(form.amount)
    if (isNaN(amount) || amount <= 0) {
      setError('El importe debe ser mayor a 0')
      return
    }
    try {
      setFormLoading(true)
      await addTransaction({
        date: form.date,
        type: form.type,
        amount,
        bookmaker: form.bookmaker || null,
        notes: form.notes || null,
      })
      setShowForm(false)
      setForm({ date: new Date().toISOString().split('T')[0], type: 'deposit', amount: '', bookmaker: '', notes: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setFormLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Bankroll</h1>
          <p className="text-sm text-gray-400 mt-0.5">Gestión de depósitos y retiros</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">Movimiento</span>
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Bankroll Actual</p>
          <p className={`mt-2 text-2xl font-bold ${currentBankroll >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatCurrency(currentBankroll)}
          </p>
          <p className="text-xs text-gray-500 mt-1">Incluyendo P&L</p>
        </div>
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Depósitos</p>
          <p className="mt-2 text-2xl font-bold text-green-400">{formatCurrency(totalDeposits)}</p>
        </div>
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Retiros</p>
          <p className="mt-2 text-2xl font-bold text-red-400">{formatCurrency(totalWithdrawals)}</p>
        </div>
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider">P&L Apuestas</p>
          <p className={`mt-2 text-2xl font-bold ${totalBettingProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {totalBettingProfit >= 0 ? '+' : ''}{formatCurrency(totalBettingProfit)}
          </p>
        </div>
      </div>

      {/* Transactions list */}
      <div>
        <h2 className="text-base font-semibold text-gray-100 mb-4">Historial de Movimientos</h2>
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-gray-800/50 animate-pulse" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-700 p-12 text-center">
            <TrendingUp className="w-8 h-8 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No hay movimientos registrados</p>
            <Button onClick={() => setShowForm(true)} className="mt-3" size="sm">
              Registrar primer depósito
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-700/50 bg-gray-800/30 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700/50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Fecha</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Tipo</th>
                  <th className="hidden sm:table-cell text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Casa</th>
                  <th className="hidden sm:table-cell text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Notas</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Importe</th>
                  <th className="hidden sm:table-cell text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/20">
                {(transactions as Tx[]).map(tx => (
                  <>
                    <tr
                      key={tx.id}
                      className="hover:bg-gray-700/20 transition-colors group cursor-pointer sm:cursor-default"
                      onClick={() => { if (window.innerWidth < 640) setDetailTx(tx) }}
                    >
                      <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap">
                        {format(new Date(tx.date + 'T00:00:00'), 'dd MMM yy', { locale: es })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {tx.type === 'deposit'
                            ? <ArrowUpRight className="w-4 h-4 text-green-400" />
                            : <ArrowDownLeft className="w-4 h-4 text-red-400" />}
                          <span className={`text-sm font-medium ${tx.type === 'deposit' ? 'text-green-400' : 'text-red-400'}`}>
                            {tx.type === 'deposit' ? 'Depósito' : 'Retiro'}
                          </span>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3 text-sm text-gray-400">{tx.bookmaker || '—'}</td>
                      <td className="hidden sm:table-cell px-4 py-3 text-sm text-gray-400">{tx.notes || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-semibold ${tx.type === 'deposit' ? 'text-green-400' : 'text-red-400'}`}>
                          {tx.type === 'deposit' ? '+' : '-'}{formatCurrency(tx.amount)}
                        </span>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3 text-right">
                        <button
                          onClick={e => { e.stopPropagation(); setDeleteConfirm(deleteConfirm === tx.id ? null : tx.id) }}
                          className="p-1.5 rounded-md text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                    {deleteConfirm === tx.id && (
                      <tr key={`${tx.id}-del`} className="bg-red-500/5">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-300">¿Eliminar este movimiento?</span>
                            <Button size="sm" variant="danger" onClick={() => { deleteTransaction(tx.id); setDeleteConfirm(null) }}>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Transaction Modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Nuevo Movimiento">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Fecha" type="date" value={form.date} onChange={set('date')} required />
            <Select label="Tipo" options={TYPE_OPTIONS} value={form.type} onChange={set('type')} />
          </div>
          <Input label="Importe *" type="number" step="0.01" min="0.01" prefix="€" placeholder="0.00" value={form.amount} onChange={set('amount')} required />
          <Select label="Casa de apuestas (opcional)" options={[{ value: '', label: 'Ninguna' }, ...BOOKMAKER_OPTIONS]} value={form.bookmaker} onChange={set('bookmaker')} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-300">Notas (opcional)</label>
            <textarea
              className="w-full rounded-lg border border-gray-600 bg-gray-700/50 text-gray-100 text-sm px-3 py-2 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 resize-none"
              placeholder="Ej: Bono bienvenida, retiro mensual..."
              rows={2}
              value={form.notes}
              onChange={set('notes')}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button type="submit" disabled={formLoading}>{formLoading ? 'Guardando...' : 'Registrar'}</Button>
          </div>
        </form>
      </Modal>

      {/* Transaction Detail Bottom Sheet (mobile only) */}
      {detailTx && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 sm:hidden" onClick={() => setDetailTx(null)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 sm:hidden rounded-t-2xl bg-gray-900 border-t border-gray-700/60 pb-8">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700/40">
              <div className="flex items-center gap-2">
                {detailTx.type === 'deposit'
                  ? <ArrowUpRight className="w-5 h-5 text-green-400" />
                  : <ArrowDownLeft className="w-5 h-5 text-red-400" />}
                <span className={`font-semibold ${detailTx.type === 'deposit' ? 'text-green-400' : 'text-red-400'}`}>
                  {detailTx.type === 'deposit' ? 'Depósito' : 'Retiro'}
                </span>
              </div>
              <button onClick={() => setDetailTx(null)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {[
                ['Fecha',   format(new Date(detailTx.date + 'T00:00:00'), 'dd MMM yyyy', { locale: es })],
                ['Casa',    detailTx.bookmaker || '—'],
                ['Notas',   detailTx.notes || '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-400">{label}</span>
                  <span className="text-gray-100 font-medium">{value}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm border-t border-gray-700/40 pt-3">
                <span className="text-gray-400">Importe</span>
                <span className={`font-bold text-base ${detailTx.type === 'deposit' ? 'text-green-400' : 'text-red-400'}`}>
                  {detailTx.type === 'deposit' ? '+' : '-'}{formatCurrency(detailTx.amount)}
                </span>
              </div>
            </div>
            <div className="px-5">
              <Button
                variant="danger"
                className="w-full"
                onClick={() => { deleteTransaction(detailTx.id); setDetailTx(null) }}
              >
                <Trash2 className="w-4 h-4 mr-2" /> Eliminar movimiento
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
