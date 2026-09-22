'use client'

import { useState, useEffect } from 'react'
import { Modal } from './ui/modal'
import { Input } from './ui/input'
import { Select } from './ui/select'
import { Button } from './ui/button'
import { SPORTS, BOOKMAKERS, STATUS_LABELS, formatCurrency } from '@/lib/utils'
import type { Bet, BetStatus } from '@/lib/database.types'

interface BetFormProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: Omit<Bet, 'id' | 'created_at' | 'user_id'>) => Promise<void>
  initialData?: Bet
  unitValue: number
  title?: string
}

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))
const SPORT_OPTIONS = SPORTS.map(s => ({ value: s, label: s }))
const BOOKMAKER_OPTIONS = BOOKMAKERS.map(b => ({ value: b, label: b }))

export function BetForm({ open, onClose, onSubmit, initialData, unitValue, title }: BetFormProps) {
  const today = new Date().toISOString().split('T')[0]

  const [form, setForm] = useState({
    date: today,
    sport: '',
    competition: '',
    match: '',
    pick: '',
    bookmaker: '',
    odds: '',
    units: '',
    status: 'pending' as BetStatus,
    result_amount: '',
    notes: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialData) {
      setForm({
        date: initialData.date,
        sport: initialData.sport,
        competition: initialData.competition,
        match: initialData.match,
        pick: initialData.pick,
        bookmaker: initialData.bookmaker,
        odds: String(initialData.odds),
        units: String(initialData.units),
        status: initialData.status,
        result_amount: initialData.result_amount !== null ? String(initialData.result_amount) : '',
        notes: initialData.notes || '',
      })
    } else {
      setForm({
        date: today,
        sport: '',
        competition: '',
        match: '',
        pick: '',
        bookmaker: '',
        odds: '',
        units: '',
        status: 'pending',
        result_amount: '',
        notes: '',
      })
    }
  }, [initialData, open, today])

  const stake = parseFloat(form.units || '0') * unitValue
  const potentialProfit = stake * (parseFloat(form.odds || '1') - 1)

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [key]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!form.sport || !form.match || !form.pick || !form.bookmaker || !form.odds || !form.units) {
      setError('Por favor completa todos los campos obligatorios')
      return
    }

    const odds = parseFloat(form.odds)
    const units = parseFloat(form.units)

    if (isNaN(odds) || odds < 1.01) {
      setError('Las cuotas deben ser mayores a 1.01')
      return
    }
    if (isNaN(units) || units <= 0) {
      setError('Las unidades deben ser mayores a 0')
      return
    }

    try {
      setLoading(true)
      await onSubmit({
        date: form.date,
        sport: form.sport,
        competition: form.competition,
        match: form.match,
        pick: form.pick,
        bookmaker: form.bookmaker,
        odds,
        units,
        stake: units * unitValue,
        status: form.status,
        result_amount: form.result_amount ? parseFloat(form.result_amount) : null,
        notes: form.notes || null,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar la apuesta')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || 'Nueva Apuesta'}
      description="Registra los detalles de tu pick"
      className="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Row 1: Date + Sport */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Fecha"
            type="date"
            value={form.date}
            onChange={set('date')}
            required
          />
          <Select
            label="Deporte"
            options={SPORT_OPTIONS}
            placeholder="Seleccionar..."
            value={form.sport}
            onChange={set('sport')}
            required
          />
        </div>

        {/* Row 2: Competition + Bookmaker */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Competición"
            placeholder="ej: La Liga, Champions..."
            value={form.competition}
            onChange={set('competition')}
          />
          <Select
            label="Casa de apuestas"
            options={BOOKMAKER_OPTIONS}
            placeholder="Seleccionar..."
            value={form.bookmaker}
            onChange={set('bookmaker')}
            required
          />
        </div>

        {/* Row 3: Match */}
        <Input
          label="Partido / Evento *"
          placeholder="ej: Real Madrid vs Barcelona"
          value={form.match}
          onChange={set('match')}
          required
        />

        {/* Row 4: Pick */}
        <Input
          label="Pick / Selección *"
          placeholder="ej: Real Madrid +1.5, BTTS Sí, Over 2.5..."
          value={form.pick}
          onChange={set('pick')}
          required
        />

        {/* Row 5: Odds + Units */}
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="Cuota *"
            type="number"
            step="0.01"
            min="1.01"
            placeholder="2.10"
            value={form.odds}
            onChange={set('odds')}
            required
          />
          <Input
            label="Unidades *"
            type="number"
            step="0.5"
            min="0.5"
            placeholder="1"
            value={form.units}
            onChange={set('units')}
            required
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-300">Stake</label>
            <div className="rounded-lg border border-gray-600 bg-gray-700/30 px-3 py-2 text-sm">
              <span className="text-emerald-400 font-semibold">{formatCurrency(stake)}</span>
              {potentialProfit > 0 && (
                <span className="text-xs text-gray-400 block">Beneficio: {formatCurrency(potentialProfit)}</span>
              )}
            </div>
          </div>
        </div>

        {/* Row 6: Status */}
        <Select
          label="Estado"
          options={STATUS_OPTIONS}
          value={form.status}
          onChange={set('status')}
        />

        {/* Cash out amount (only for cashout) */}
        {form.status === 'cashout' && (
          <Input
            label="Importe recibido (Cash Out)"
            type="number"
            step="0.01"
            prefix="€"
            placeholder="0.00"
            value={form.result_amount}
            onChange={set('result_amount')}
          />
        )}

        {/* Notes */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-300">Notas</label>
          <textarea
            className="w-full rounded-lg border border-gray-600 bg-gray-700/50 text-gray-100 text-sm px-3 py-2 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 resize-none"
            placeholder="Análisis, razonamiento del pick..."
            rows={2}
            value={form.notes}
            onChange={set('notes')}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Guardando...' : initialData ? 'Actualizar' : 'Registrar apuesta'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
