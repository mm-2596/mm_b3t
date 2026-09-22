'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Transaction } from '@/lib/database.types'

const DEMO_USER_ID = 'demo-user'

export function useTransactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error
      setTransactions(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar transacciones')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTransactions()
  }, [fetchTransactions])

  const addTransaction = async (tx: Omit<Transaction, 'id' | 'created_at' | 'user_id'>) => {
    const { data: { user } } = await supabase.auth.getUser()
    const userId = user?.id || DEMO_USER_ID

    const { data, error } = await supabase
      .from('transactions')
      .insert({ ...tx, user_id: userId })
      .select()
      .single()

    if (error) throw error
    setTransactions(prev => [data, ...prev])
    return data
  }

  const deleteTransaction = async (id: string) => {
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id)

    if (error) throw error
    setTransactions(prev => prev.filter(t => t.id !== id))
  }

  const totalDeposits = transactions
    .filter(t => t.type === 'deposit')
    .reduce((sum, t) => sum + t.amount, 0)

  const totalWithdrawals = transactions
    .filter(t => t.type === 'withdrawal')
    .reduce((sum, t) => sum + t.amount, 0)

  const netBankroll = totalDeposits - totalWithdrawals

  return {
    transactions,
    loading,
    error,
    addTransaction,
    deleteTransaction,
    refetch: fetchTransactions,
    totalDeposits,
    totalWithdrawals,
    netBankroll,
  }
}
