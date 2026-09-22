'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Settings } from '@/lib/database.types'

const DEFAULT_SETTINGS = {
  bankroll: 1000,
  unit_value: 10,
  unit_percentage: 1,
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .single()

      if (error && error.code !== 'PGRST116') throw error
      setSettings(data || null)
    } catch {
      // Silently fail — use defaults
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const saveSettings = async (updates: Partial<typeof DEFAULT_SETTINGS>) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    if (settings) {
      const { data, error } = await supabase
        .from('settings')
        .update(updates)
        .eq('id', settings.id)
        .select()
        .single()

      if (error) throw error
      setSettings(data)
      return data
    } else {
      const { data, error } = await supabase
        .from('settings')
        .insert({ ...DEFAULT_SETTINGS, ...updates, user_id: user.id })
        .select()
        .single()

      if (error) throw error
      setSettings(data)
      return data
    }
  }

  return {
    settings,
    loading,
    saveSettings,
    refetch: fetchSettings,
    unitValue: settings?.unit_value ?? DEFAULT_SETTINGS.unit_value,
    bankroll: settings?.bankroll ?? DEFAULT_SETTINGS.bankroll,
    unitPercentage: settings?.unit_percentage ?? DEFAULT_SETTINGS.unit_percentage,
  }
}
