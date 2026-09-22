'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Bet } from '@/lib/database.types'
import { calcProfit } from '@/lib/utils'

export function useBets() {
  const [bets, setBets] = useState<Bet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBets = useCallback(async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('bets')
        .select('*')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error
      setBets(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar apuestas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBets()
  }, [fetchBets])

  const addBet = async (bet: Omit<Bet, 'id' | 'created_at' | 'user_id'>) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data, error } = await supabase
      .from('bets')
      .insert({ ...bet, user_id: user.id })
      .select()
      .single()

    if (error) throw error
    setBets(prev => [data, ...prev])
    return data
  }

  const updateBet = async (id: string, updates: Partial<Bet>) => {
    if (updates.status && updates.status !== 'pending') {
      const bet = bets.find(b => b.id === id)
      if (bet) {
        const merged = { ...bet, ...updates }
        if (updates.status !== 'cashout') {
          updates.result_amount = calcProfit(merged as Bet)
        }
      }
    }

    const { data, error } = await supabase
      .from('bets')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    setBets(prev => prev.map(b => b.id === id ? data : b))
    return data
  }

  const deleteBet = async (id: string) => {
    const { error } = await supabase
      .from('bets')
      .delete()
      .eq('id', id)

    if (error) throw error
    setBets(prev => prev.filter(b => b.id !== id))
  }

  return { bets, loading, error, addBet, updateBet, deleteBet, refetch: fetchBets }
}
