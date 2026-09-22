export type BetStatus = 'pending' | 'won' | 'lost' | 'void' | 'cashout'
export type TransactionType = 'deposit' | 'withdrawal'

export interface Bet {
  id: string
  created_at: string
  date: string
  sport: string
  competition: string
  match: string
  pick: string
  bookmaker: string
  odds: number
  units: number
  stake: number // units * unit_value
  status: BetStatus
  result_amount: number | null // profit/loss in €
  notes: string | null
  user_id: string
}

export interface Transaction {
  id: string
  created_at: string
  date: string
  type: TransactionType
  amount: number
  bookmaker: string | null
  notes: string | null
  user_id: string
}

export interface Settings {
  id: string
  user_id: string
  bankroll: number       // Total bankroll
  unit_value: number     // Value per unit in €
  unit_percentage: number // % of bankroll per unit
  created_at: string
  updated_at: string
}

export interface Database {
  public: {
    Tables: {
      bets: {
        Row: Bet
        Insert: Omit<Bet, 'id' | 'created_at'>
        Update: Partial<Omit<Bet, 'id' | 'created_at' | 'user_id'>>
      }
      transactions: {
        Row: Transaction
        Insert: Omit<Transaction, 'id' | 'created_at'>
        Update: Partial<Omit<Transaction, 'id' | 'created_at' | 'user_id'>>
      }
      settings: {
        Row: Settings
        Insert: Omit<Settings, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Settings, 'id' | 'created_at' | 'user_id'>>
      }
    }
  }
}
