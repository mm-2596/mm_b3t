import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Bet } from './database.types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatUnits(units: number): string {
  return `${units > 0 ? '+' : ''}${units.toFixed(2)}u`
}

export function formatOdds(odds: number): string {
  return odds.toFixed(2)
}

export function calcProfit(bet: Bet): number {
  if (bet.status === 'won') {
    return bet.stake * (bet.odds - 1)
  } else if (bet.status === 'lost') {
    return -bet.stake
  } else if (bet.status === 'void') {
    return 0
  } else if (bet.status === 'cashout' && bet.result_amount !== null) {
    return bet.result_amount - bet.stake
  }
  return 0
}

export function calcProfitUnits(bet: Bet): number {
  if (bet.units === 0) return 0
  const profit = calcProfit(bet)
  return profit / (bet.stake / bet.units)
}

export function calcROI(bets: Bet[]): number {
  const settled = bets.filter(b => b.status !== 'pending')
  if (settled.length === 0) return 0
  const totalStake = settled.reduce((sum, b) => sum + b.stake, 0)
  if (totalStake === 0) return 0
  const totalProfit = settled.reduce((sum, b) => sum + calcProfit(b), 0)
  return (totalProfit / totalStake) * 100
}

export function calcWinRate(bets: Bet[]): number {
  const settled = bets.filter(b => b.status === 'won' || b.status === 'lost')
  if (settled.length === 0) return 0
  const won = settled.filter(b => b.status === 'won').length
  return (won / settled.length) * 100
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'won': return 'text-green-400'
    case 'lost': return 'text-red-400'
    case 'pending': return 'text-yellow-400'
    case 'void': return 'text-gray-400'
    case 'cashout': return 'text-blue-400'
    default: return 'text-gray-400'
  }
}

export function getStatusBg(status: string): string {
  switch (status) {
    case 'won': return 'bg-green-500/10 text-green-400 border-green-500/20'
    case 'lost': return 'bg-red-500/10 text-red-400 border-red-500/20'
    case 'pending': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
    case 'void': return 'bg-gray-500/10 text-gray-400 border-gray-500/20'
    case 'cashout': return 'bg-blue-500/10 text-blue-400 border-blue-500/20'
    default: return 'bg-gray-500/10 text-gray-400 border-gray-500/20'
  }
}

export const SPORTS = [
  'Fútbol', 'Tenis', 'Baloncesto', 'Béisbol', 'Hockey Hielo',
  'MMA/UFC', 'Boxeo', 'Rugby', 'Fórmula 1', 'Ciclismo', 'Otro'
]

export const BOOKMAKERS = [
  'Betfair', 'Bet365', 'Sportium', 'Codere', 'Bwin',
  'Betway', 'William Hill', 'Unibet', 'Pinnacle', 'Betcris', 'Otro'
]

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  won: 'Ganada',
  lost: 'Perdida',
  void: 'Anulada',
  cashout: 'Cash Out',
}
