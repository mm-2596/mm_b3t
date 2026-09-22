'use client'

import { useState, useEffect } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'
import { Settings, Coins, BookOpen, CheckCircle } from 'lucide-react'

export default function SettingsPage() {
  const { settings, unitValue, bankroll, saveSettings } = useSettings()
  const [form, setForm] = useState({
    bankroll: '',
    unit_percentage: '',
    unit_value: '',
  })
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setForm({
      bankroll: String(bankroll),
      unit_percentage: String(settings?.unit_percentage ?? 1),
      unit_value: String(unitValue),
    })
  }, [bankroll, unitValue, settings])

  // When bankroll or percentage changes, recalculate unit value
  const handleBankrollOrPctChange = (key: 'bankroll' | 'unit_percentage', value: string) => {
    const updated = { ...form, [key]: value }
    const b = parseFloat(updated.bankroll) || 0
    const p = parseFloat(updated.unit_percentage) || 0
    if (b > 0 && p > 0) {
      updated.unit_value = ((b * p) / 100).toFixed(2)
    }
    setForm(updated)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const bl = parseFloat(form.bankroll)
    const pct = parseFloat(form.unit_percentage)
    const uv = parseFloat(form.unit_value)
    if (isNaN(bl) || bl <= 0) { setError('El bankroll debe ser mayor a 0'); return }
    if (isNaN(pct) || pct <= 0) { setError('El porcentaje debe ser mayor a 0'); return }
    if (isNaN(uv) || uv <= 0) { setError('El valor de unidad debe ser mayor a 0'); return }
    try {
      setLoading(true)
      await saveSettings({ bankroll: bl, unit_percentage: pct, unit_value: uv })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Ajustes</h1>
        <p className="text-sm text-gray-400 mt-0.5">Configura tu sistema de unidades y bankroll</p>
      </div>

      {/* Explanation card */}
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5">
        <div className="flex gap-3">
          <BookOpen className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-300 mb-1">¿Qué es el sistema de unidades?</p>
            <p className="text-sm text-gray-400">
              Como tipster profesional, defines tu bankroll total y un porcentaje de riesgo por apuesta (1 unidad).
              Así, si tu bankroll es <strong className="text-gray-300">€1,000</strong> y usas <strong className="text-gray-300">1% por unidad</strong>,
              1 unidad = <strong className="text-gray-300">€10</strong>.
              Cuando registres picks, solo indicas cuántas unidades apuestas (ej: 2u = €20),
              independientemente del tamaño del bankroll en cada momento.
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-6 space-y-5">
          <div className="flex items-center gap-2 mb-2">
            <Coins className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-gray-100">Bankroll y Unidades</h2>
          </div>

          <Input
            label="Bankroll Base (€)"
            type="number"
            step="1"
            min="1"
            prefix="€"
            placeholder="1000"
            value={form.bankroll}
            onChange={e => handleBankrollOrPctChange('bankroll', e.target.value)}
          />

          <Input
            label="% de Bankroll por Unidad"
            type="number"
            step="0.1"
            min="0.1"
            max="10"
            suffix="%"
            placeholder="1"
            value={form.unit_percentage}
            onChange={e => handleBankrollOrPctChange('unit_percentage', e.target.value)}
          />

          {/* Calculated unit value */}
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">Valor calculado de 1 unidad</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {form.bankroll || '0'} × {form.unit_percentage || '0'}% = {form.unit_value || '0'} €
                </p>
              </div>
              <p className="text-2xl font-bold text-emerald-400">
                {formatCurrency(parseFloat(form.unit_value) || 0)}
              </p>
            </div>
          </div>

          <Input
            label="Valor de 1 Unidad (ajuste manual)"
            type="number"
            step="0.01"
            min="0.01"
            prefix="€"
            placeholder="10.00"
            value={form.unit_value}
            onChange={e => setForm(prev => ({ ...prev, unit_value: e.target.value }))}
          />
        </div>

        {/* Reference table */}
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-6">
          <h2 className="text-sm font-semibold text-gray-100 mb-4">Tabla de referencia</h2>
          <div className="space-y-2">
            {[0.5, 1, 1.5, 2, 3, 4, 5].map(u => {
              const stake = u * (parseFloat(form.unit_value) || 0)
              return (
                <div key={u} className="flex items-center justify-between py-1.5 border-b border-gray-700/30 last:border-0">
                  <span className="text-sm text-gray-400">{u}u {u === 1 && '(estándar)'} {u === 2 && '(confianza)'} {u === 5 && '(máximo)'}</span>
                  <span className="text-sm font-medium text-gray-100">{formatCurrency(stake)}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {saved && (
            <div className="flex items-center gap-2 text-green-400 text-sm">
              <CheckCircle className="w-4 h-4" />
              Guardado correctamente
            </div>
          )}
          <Button type="submit" disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar ajustes'}
          </Button>
        </div>
      </form>
    </div>
  )
}
