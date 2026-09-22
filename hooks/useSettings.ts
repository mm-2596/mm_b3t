'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Settings } from '@/lib/database.types'

const DEMO_USER_ID = 'demo-user'

const DEFAULT_SETTINGS: Omit<Settings, 'id' | 'created_at' | 'updated_at' | 'user_id'> = {
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
      // Silently fail - will use defaults
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const saveSettings = async (updates: Partial<typeof DEFAULT_SETTINGS>) => {
    const { data: { user } } = await supabase.auth.getUser()
    const userId = user?.id || DEMO_USER_ID

    if (settings) {
      const { data, error } = await supabase
        .from('settings')
        .update(updates)
        .eq('user_id', userId)
        .select()
        .single()

      if (error) throw error
      setSettings(data)
      return data
    } else {
      const { data, error } = await supabase
        .from('settings')
        .insert({ ...DEFAULT_SETTINGS, ...updates, user_id: userId })
        .select()
        .single()

      if (error) throw error
      setSettings(data)
      return data
    }
  }

  const unitValue = settings?.unit_value ?? DEFAULT_SETTINGS.unit_value
  const bankroll = settings?.bankroll ?? DEFAULT_SETTINGS.bankroll
  const unitPercentage = settings?.unit_percentage ?? DEFAULT_SETTINGS.unit_percentage

  return {
    settings,
    loading,
    saveSettings,
    refetch: fetchSettings,
    unitValue,
    bankroll,
    unitPercentage,
  }
}
