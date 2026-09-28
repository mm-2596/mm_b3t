import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const CHAT_ID_MAP: Record<string, string> = (() => {
  try { return JSON.parse(process.env.TELEGRAM_CHAT_ID_MAP || '{}') }
  catch { return {} }
})()

function getSupabaseAdmin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function sendMsg(chatId: number, text: string, replyMarkup?: object) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', reply_markup: replyMarkup }),
  })
}

async function editMsg(chatId: number, messageId: number, text: string, replyMarkup?: object) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: replyMarkup }),
  })
}

async function answerCQ(id: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id }),
  })
}

// ── Football API (ESPN — free, no key) ───────────────────────────────────────
interface Fixture { home: string; away: string; time: string; id?: string }

const LEAGUE_MAP: Record<string, string> = {
  'Liga EA Sports':   'esp.1',
  'Premier League':   'eng.1',
  'Serie A':          'ita.1',
  'Bundesliga':       'ger.1',
  'Champions League': 'uefa.champions',
  'Copa del Rey':     'esp.copa_del_rey',
  'Nations League':   'uefa.nations',
}

function toMadridTime(utcDateStr: string): string {
  return new Date(utcDateStr).toLocaleTimeString('es-ES', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
  })
}

async function fetchTodayFixtures(comp: string): Promise<Fixture[]> {
  const slug = LEAGUE_MAP[comp]
  if (!slug) return []
  try {
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '')
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${dateStr}`,
      { cache: 'no-store' }
    )
    const data = await res.json()
    if (!Array.isArray(data.events)) return []
    const shorten = (name: string) => name.length > 18 ? name.slice(0, 17) + '…' : name
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.events as any[]).slice(0, 8).map(e => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const competitors: any[] = e.competitions?.[0]?.competitors || []
      const home = shorten(competitors.find((c: any) => c.homeAway === 'home')?.team?.shortDisplayName || competitors.find((c: any) => c.homeAway === 'home')?.team?.displayName || '')
      const away = shorten(competitors.find((c: any) => c.homeAway === 'away')?.team?.shortDisplayName || competitors.find((c: any) => c.homeAway === 'away')?.team?.displayName || '')
      return { home, away, time: toMadridTime(e.date), id: e.id }
    }).filter((f: Fixture) => f.home && f.away)
  } catch { return [] }
}

interface LineupTeam { teamName: string; players: string[] }

async function fetchLineup(leagueSlug: string, eventId: string): Promise<LineupTeam[]> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/summary?event=${eventId}`,
      { cache: 'no-store' }
    )
    const data = await res.json()
    if (!Array.isArray(data.rosters) || data.rosters.length === 0) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.rosters as any[]).slice(0, 2).map(r => ({
      teamName: r.team?.shortDisplayName || r.team?.displayName || '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      players: (r.roster as any[] || [])
        .filter((p: any) => p.starter)
        .map((p: any) => p.athlete?.shortName || p.athlete?.displayName || '')
        .filter(Boolean).slice(0, 11),
    })).filter(t => t.players.length > 0)
  } catch { return [] }
}

// ── Session ───────────────────────────────────────────────────────────────────
interface SessionData {
  bk?: string
  comp?: string
  match?: string
  betType?: string
  picks?: string[]
  odds?: number
  stake?: number
  betId?: string
  status?: string
  cashoutAmount?: number
  fixtures?: Fixture[]
  mixFixtures?: Array<{ match: string }>
  mixBrowseFixtures?: Fixture[]
  pickCategory?: string
  matchId?: string
  leagueSlug?: string
  lineup?: LineupTeam[]
  lineupTeamIdx?: number
  lineupPlayer?: string
  editBetId?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSession(supabase: any, chatId: number): Promise<{ step: string; data: SessionData } | null> {
  try {
    const { data } = await supabase.from('bot_sessions').select('*').eq('chat_id', chatId).single()
    return data
  } catch { return null }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setSession(supabase: any, chatId: number, step: string, data: SessionData) {
  await supabase.from('bot_sessions').upsert({
    chat_id: chatId, step, data, updated_at: new Date().toISOString(),
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function clearSession(supabase: any, chatId: number) {
  try { await supabase.from('bot_sessions').delete().eq('chat_id', chatId) } catch { /* ok */ }
}

// ── Keyboards ─────────────────────────────────────────────────────────────────
const BOOKMAKERS = ['Bet365', 'Winamax', 'William Hill', 'Bwin', 'Betfair', 'Otro']
const COMPETITIONS_LIST = [
  'Liga EA Sports', 'Premier League',
  'Serie A', 'Bundesliga',
  'Champions League', 'Copa del Rey',
  'Nations League', 'MIX',
]
const PICK_CATEGORIES: Record<string, string[]> = {
  resultado: ['1', 'X', '2', '1X', 'X2', '12'],
  goles:     ['Over 0.5', 'Under 0.5', 'Over 1.5', 'Under 1.5', 'Over 2.5', 'Under 2.5', 'Over 3.5', 'Under 3.5', 'BTTS Sí', 'BTTS No'],
  corners:   ['+7.5c', '+8.5c', '+9.5c', '+10.5c', '+11.5c', '-7.5c', '-8.5c', '-9.5c', '-10.5c'],
  tarjetas:  ['Tarj +2.5', 'Tarj +3.5', 'Tarj +4.5', 'Tarj +5.5'],
}
const COMMON_ODDS = ['1.30', '1.50', '1.70', '1.85', '2.00', '2.25', '2.50', '3.00', '4.00']
const COMMON_STAKES = ['5', '10', '15', '20', '30', '40', '50', '75', '100']

function mainMenuKb() {
  return {
    inline_keyboard: [
      [
        { text: '➕ Nueva apuesta', callback_data: 'menu:nueva' },
        { text: '⏳ Pendientes', callback_data: 'menu:pendientes' },
      ],
      [
        { text: '📊 Resumen hoy', callback_data: 'menu:resumen' },
        { text: '📅 Historial', callback_data: 'menu:historial' },
      ],
      [
        { text: '🛠️ Gestionar', callback_data: 'menu:gestionar' },
        { text: '🔔 Últimas 5', callback_data: 'menu:ultimas' },
      ],
    ],
  }
}

function bookmakersKb() {
  return {
    inline_keyboard: [
      BOOKMAKERS.slice(0, 3).map(b => ({ text: b, callback_data: `bk:${b}` })),
      BOOKMAKERS.slice(3).map(b => ({ text: b, callback_data: `bk:${b}` })),
    ],
  }
}

function competitionsKb() {
  return {
    inline_keyboard: [
      COMPETITIONS_LIST.slice(0, 2).map(c => ({ text: c, callback_data: `cp:${c}` })),
      COMPETITIONS_LIST.slice(2, 4).map(c => ({ text: c, callback_data: `cp:${c}` })),
      COMPETITIONS_LIST.slice(4, 6).map(c => ({ text: c, callback_data: `cp:${c}` })),
      COMPETITIONS_LIST.slice(6).map(c => ({ text: c, callback_data: `cp:${c}` })),
    ],
  }
}

function fixturesSingleKb(fixtures: Fixture[]) {
  const rows = fixtures.map((f, i) => [{
    text: `${f.time} ⚽ ${f.home} - ${f.away}`,
    callback_data: `fx:${i}`,
  }])
  rows.push([{ text: '✏️ Otro partido', callback_data: 'fx_custom' }])
  return { inline_keyboard: rows }
}

function mixLeagueKb(selectedCount: number) {
  const leagues = COMPETITIONS_LIST.filter(c => c !== 'MIX')
  const rows: { text: string; callback_data: string }[][] = [
    leagues.slice(0, 2).map(c => ({ text: c, callback_data: `mxl:${c}` })),
    leagues.slice(2, 4).map(c => ({ text: c, callback_data: `mxl:${c}` })),
    leagues.slice(4, 6).map(c => ({ text: c, callback_data: `mxl:${c}` })),
    leagues.slice(6).map(c => ({ text: c, callback_data: `mxl:${c}` })),
  ]
  if (selectedCount > 0) {
    rows.push([{ text: `✅ Listo (${selectedCount} partido${selectedCount > 1 ? 's' : ''})`, callback_data: 'mx_done' }])
  }
  rows.push([{ text: '❌ Cancelar', callback_data: 'cancel' }])
  return { inline_keyboard: rows }
}

function mixFixturesKb(fixtures: Fixture[], selected: Array<{ match: string }>) {
  const rows = fixtures.map((f, i) => {
    const name = `${f.home} - ${f.away}`
    const isSelected = selected.some(s => s.match === name)
    return [{
      text: `${isSelected ? '✅ ' : ''}${f.time} ${f.home} - ${f.away}`,
      callback_data: `mxfx:${i}`,
    }]
  })
  rows.push([
    { text: '⬅️ Otras ligas', callback_data: 'mx_add' },
    { text: '✏️ Escribir', callback_data: 'mx_custom' },
  ])
  if (selected.length > 0) {
    rows.push([{ text: `✅ Listo (${selected.length} partido${selected.length > 1 ? 's' : ''})`, callback_data: 'mx_done' }])
  }
  return { inline_keyboard: rows }
}

function typeKb() {
  return {
    inline_keyboard: [[
      { text: '🎯 Pick', callback_data: 'tp:pick' },
      { text: '🎉 Funbet', callback_data: 'tp:funbet' },
    ]],
  }
}

function categoryKb(selectedPicks: string[], hasLineup = false) {
  const rows: { text: string; callback_data: string }[][] = [
    [
      { text: '⚽ Resultado', callback_data: 'cat:resultado' },
      { text: '🥅 Goles', callback_data: 'cat:goles' },
    ],
    [
      { text: '📐 Corners', callback_data: 'cat:corners' },
      { text: '🟨 Tarjetas', callback_data: 'cat:tarjetas' },
    ],
  ]
  if (hasLineup) rows.push([{ text: '👤 Jugadores', callback_data: 'cat:jugadores' }])
  rows.push([{ text: '✏️ Otro pick', callback_data: 'pk_custom' }])
  if (selectedPicks.length > 0) {
    rows.push([{ text: `✅ Listo — ${selectedPicks.join(' + ')}`, callback_data: 'pk_done' }])
  }
  return { inline_keyboard: rows }
}

function lineupTeamsKb(lineup: LineupTeam[]) {
  return {
    inline_keyboard: [
      lineup.map((t, i) => ({ text: t.teamName, callback_data: `lnt:${i}` })),
      [{ text: '⬅️ Categorías', callback_data: 'pk_back' }],
    ],
  }
}

function lineupPlayersKb(players: string[], selectedPicks: string[]) {
  const rows: { text: string; callback_data: string }[][] = []
  for (let i = 0; i < players.length; i += 2) {
    rows.push(players.slice(i, i + 2).map((p, j) => ({
      text: selectedPicks.some(pick => pick.includes(p)) ? `✅ ${p}` : p,
      callback_data: `lnp:${i + j}`,
    })))
  }
  rows.push([{ text: '⬅️ Equipos', callback_data: 'lnt_back' }])
  if (selectedPicks.length > 0) {
    rows.push([{ text: `✅ Listo — ${selectedPicks.join(' + ')}`, callback_data: 'pk_done' }])
  }
  return { inline_keyboard: rows }
}

function lineupActionKb(player: string) {
  return {
    inline_keyboard: [
      [
        { text: '⚽ Gol', callback_data: 'lna:gol' },
        { text: '🎯 Tiro a puerta', callback_data: 'lna:tiro' },
      ],
      [
        { text: '🟨 Tarjeta', callback_data: 'lna:tarjeta' },
        { text: '🎖️ Asistencia', callback_data: 'lna:asistencia' },
      ],
      [{ text: `⬅️ ${player}`, callback_data: 'lnp_back' }],
    ],
  }
}

function categoryPicksKb(category: string, selectedPicks: string[]) {
  const picks = PICK_CATEGORIES[category] || []
  const btn = (p: string) => ({
    text: selectedPicks.includes(p) ? `✅ ${p}` : p,
    callback_data: `pk:${p}`,
  })
  let rows: { text: string; callback_data: string }[][] = []
  if (category === 'resultado') {
    rows = [picks.slice(0, 3).map(btn), picks.slice(3).map(btn)]
  } else if (category === 'goles') {
    rows = [[btn(picks[0]), btn(picks[1])], [btn(picks[2]), btn(picks[3])],
            [btn(picks[4]), btn(picks[5])], [btn(picks[6]), btn(picks[7])],
            [btn(picks[8]), btn(picks[9])]]
  } else if (category === 'corners') {
    rows = [picks.slice(0, 3).map(btn), picks.slice(3, 5).map(btn), picks.slice(5, 7).map(btn), picks.slice(7).map(btn)]
  } else {
    rows = [picks.slice(0, 2).map(btn), picks.slice(2).map(btn)]
  }
  rows.push([{ text: '⬅️ Categorías', callback_data: 'pk_back' }])
  if (selectedPicks.length > 0) {
    rows.push([{ text: `✅ Listo — ${selectedPicks.join(' + ')}`, callback_data: 'pk_done' }])
  }
  return { inline_keyboard: rows }
}

function oddsKb() {
  const rows = []
  for (let i = 0; i < COMMON_ODDS.length; i += 4) {
    rows.push(COMMON_ODDS.slice(i, i + 4).map(o => ({ text: o, callback_data: `od:${o}` })))
  }
  rows.push([{ text: '✏️ Otra cuota', callback_data: 'od_custom' }])
  return { inline_keyboard: rows }
}

function stakeKb() {
  const rows = []
  for (let i = 0; i < COMMON_STAKES.length; i += 5) {
    rows.push(COMMON_STAKES.slice(i, i + 5).map(s => ({ text: `${s}€`, callback_data: `st:${s}` })))
  }
  rows.push([{ text: '✏️ Otro importe', callback_data: 'st_custom' }])
  return { inline_keyboard: rows }
}

function historialKb() {
  return {
    inline_keyboard: [
      [
        { text: 'Hoy', callback_data: 'hist:today' },
        { text: 'Ayer', callback_data: 'hist:yesterday' },
      ],
      [
        { text: 'Esta semana', callback_data: 'hist:week' },
        { text: 'Este mes', callback_data: 'hist:month' },
      ],
      [{ text: '⬅️ Volver', callback_data: 'hist:back' }],
    ],
  }
}

function gestionarKb() {
  return {
    inline_keyboard: [
      [
        { text: '🗑️ Eliminar apuesta', callback_data: 'del_list' },
        { text: '✏️ Editar apuesta', callback_data: 'edt_list' },
      ],
      [{ text: '❌ Cancelar', callback_data: 'cancel' }],
    ],
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deleteBetsKb(bets: any[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = bets.map((b: any) => {
    const label = b.match !== 'Apuesta' ? b.match : `${b.pick} @ ${b.odds}`
    const short = label.length > 30 ? label.slice(0, 29) + '…' : label
    return [{ text: `🗑️ ${short}`, callback_data: `del:${b.id}` }]
  })
  rows.push([{ text: '❌ Cancelar', callback_data: 'cancel' }])
  return { inline_keyboard: rows }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function editBetsKb(bets: any[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = bets.map((b: any) => {
    const label = b.match !== 'Apuesta' ? b.match : `${b.pick} @ ${b.odds}`
    const short = label.length > 30 ? label.slice(0, 29) + '…' : label
    return [{ text: `✏️ ${short}`, callback_data: `edt:${b.id}` }]
  })
  rows.push([{ text: '❌ Cancelar', callback_data: 'cancel' }])
  return { inline_keyboard: rows }
}

function editFieldKb(betId: string) {
  return {
    inline_keyboard: [
      [
        { text: '📌 Pick', callback_data: `edt_pick:${betId}` },
        { text: '📊 Cuota', callback_data: `edt_odds:${betId}` },
      ],
      [
        { text: '💵 Importe', callback_data: `edt_stake:${betId}` },
      ],
      [{ text: '❌ Cancelar', callback_data: 'cancel' }],
    ],
  }
}

function summaryText(bk: string, comp: string, match: string, betType: string, picks: string[], odds: number, stake: number, units: number) {
  const profit = stake * (odds - 1)
  const total = stake + profit
  const typeLabel = betType === 'funbet' ? '🎉 Funbet' : '🎯 Pick'
  return (
    `📋 <b>Resumen de la apuesta</b>\n\n` +
    `🏦 ${bk} | ${typeLabel}\n` +
    `🏆 <b>${comp}</b>\n` +
    (match && match !== 'Apuesta' ? `⚽ <b>${match}</b>\n` : '') +
    `📌 Pick: <b>${picks.join(' + ')}</b>\n` +
    `📊 Cuota: <b>${odds}</b>\n` +
    `💵 Apostado: <b>€${stake.toFixed(2)}</b> (${units}u)\n` +
    `💰 Ganancias: <b>+€${profit.toFixed(2)}</b>\n` +
    `🏆 Total a cobrar: <b>€${total.toFixed(2)}</b>`
  )
}

function getDateRange(period: string): { gte: string; lte: string } {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  if (period === 'today') return { gte: today, lte: today }
  if (period === 'yesterday') {
    const y = new Date(now); y.setDate(y.getDate() - 1)
    const d = y.toISOString().split('T')[0]
    return { gte: d, lte: d }
  }
  if (period === 'week') {
    const w = new Date(now); w.setDate(w.getDate() - 6)
    return { gte: w.toISOString().split('T')[0], lte: today }
  }
  if (period === 'month') {
    return { gte: `${today.slice(0, 7)}-01`, lte: today }
  }
  return { gte: today, lte: today }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function historialText(bets: any[], period: string) {
  const labels: Record<string, string> = { today: 'HOY', yesterday: 'AYER', week: 'ESTA SEMANA', month: 'ESTE MES' }
  const e: Record<string, string> = { pending: '⏳', won: '✅', lost: '❌', void: '↩️', cashout: '💸' }
  if (!bets.length) return `📅 <b>${labels[period]}</b>\n\nSin apuestas registradas.`
  const lines = bets.map((b: any) => {
    const name = b.match !== 'Apuesta' ? b.match : b.pick
    const short = name.length > 28 ? name.slice(0, 27) + '…' : name
    const pl = b.result_amount != null
      ? (b.result_amount >= 0 ? ` <b>+€${b.result_amount.toFixed(2)}</b>` : ` <b>-€${Math.abs(b.result_amount).toFixed(2)}</b>`) : ''
    return `${e[b.status] || '?'} ${short} @ ${b.odds}${pl}`
  }).join('\n')
  const settled = bets.filter((b: any) => b.status !== 'pending')
  const pl = settled.reduce((s: number, b: any) => s + (b.result_amount ?? 0), 0)
  const plText = settled.length ? (pl >= 0 ? `+€${pl.toFixed(2)}` : `-€${Math.abs(pl).toFixed(2)}`) : '—'
  return `📅 <b>${labels[period]}</b> — ${bets.length} apuesta${bets.length > 1 ? 's' : ''}\n\n${lines}\n\n💰 P&L: <b>${plText}</b>`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function statsText(bets: any[], bookmaker?: string) {
  const header = bookmaker ? `📊 <b>Stats — ${bookmaker}</b>` : `📊 <b>Stats generales</b>`
  if (!bets.length) return `${header}\n\nSin apuestas registradas.`
  const won    = bets.filter((b: any) => b.status === 'won')
  const lost   = bets.filter((b: any) => b.status === 'lost')
  const pend   = bets.filter((b: any) => b.status === 'pending')
  const co     = bets.filter((b: any) => b.status === 'cashout')
  const voids  = bets.filter((b: any) => b.status === 'void')
  const settled = [...won, ...lost, ...co, ...voids]
  const totalStaked = settled.reduce((s: number, b: any) => s + (b.stake ?? 0), 0)
  const pl = settled.reduce((s: number, b: any) => s + (b.result_amount ?? 0), 0)
  const roi = totalStaked > 0 ? (pl / totalStaked * 100).toFixed(1) : '—'
  const plText = pl >= 0 ? `+€${pl.toFixed(2)}` : `-€${Math.abs(pl).toFixed(2)}`
  const winRate = settled.length > 0 ? ((won.length / settled.filter((b: any) => b.status !== 'void').length) * 100).toFixed(0) : '—'
  return (
    `${header}\n\n` +
    `📈 Total: <b>${bets.length}</b>  |  Win rate: <b>${winRate}%</b>\n` +
    `✅ Ganadas: <b>${won.length}</b>  ❌ Perdidas: <b>${lost.length}</b>\n` +
    `💸 Cashout: <b>${co.length}</b>  ↩️ Anuladas: <b>${voids.length}</b>  ⏳ Pendientes: <b>${pend.length}</b>\n\n` +
    `💵 Apostado: <b>€${totalStaked.toFixed(2)}</b>\n` +
    `💰 P&L: <b>${plText}</b>  |  ROI: <b>${roi}%</b>`
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function settleBet(supabase: any, chatId: number, bet: any, status: string, cashoutAmount: number | null) {
  let resultAmount: number | null = null
  if (status === 'won') resultAmount = bet.stake * (bet.odds - 1)
  else if (status === 'lost') resultAmount = -bet.stake
  else if (status === 'void') resultAmount = 0
  else if (status === 'cashout' && cashoutAmount !== null) resultAmount = cashoutAmount - bet.stake

  await supabase.from('bets').update({ status, result_amount: resultAmount }).eq('id', bet.id)

  const e: Record<string, string> = { won: '✅', lost: '❌', void: '↩️', cashout: '💸' }
  const profitText = resultAmount !== null
    ? (resultAmount >= 0 ? `+€${resultAmount.toFixed(2)}` : `-€${Math.abs(resultAmount).toFixed(2)}`) : ''
  const label = bet.match !== 'Apuesta' ? bet.match : `${bet.pick} @ ${bet.odds}`
  await sendMsg(chatId,
    `${e[status]} <b>${label}</b> — ${status}${profitText ? ` | ${profitText}` : ''}`
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getUserSettings(supabase: any, userId: string) {
  const { data } = await supabase.from('settings').select('*').eq('user_id', userId).single()
  return data
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // ── Callback query ────────────────────────────────────────────────────────
    if (body.callback_query) {
      const cq = body.callback_query
      const chatId: number = cq.message.chat.id
      const messageId: number = cq.message.message_id
      const cbData: string = cq.data || ''
      const userId = CHAT_ID_MAP[String(chatId)]

      await answerCQ(cq.id)
      if (!userId) return NextResponse.json({ ok: true })

      const supabase = getSupabaseAdmin()

      // ── Bookmaker selected ──────────────────────────────────────────────
      if (cbData.startsWith('bk:')) {
        const bk = cbData.slice(3)
        await setSession(supabase, chatId, 'comp', { bk, picks: [] })
        await editMsg(chatId, messageId,
          `🏦 <b>${bk}</b>\n\n🏆 ¿Qué <b>competición</b>?`,
          competitionsKb()
        )
        return NextResponse.json({ ok: true })
      }

      // ── Competition selected ────────────────────────────────────────────
      if (cbData.startsWith('cp:')) {
        const comp = cbData.slice(3)
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })

        if (comp === 'MIX') {
          await setSession(supabase, chatId, 'mix_league', { ...session.data, comp, mixFixtures: [] })
          await editMsg(chatId, messageId,
            `🏦 <b>${session.data.bk}</b> · 🎲 <b>Combinada</b>\n\n¿De qué liga quieres el primer partido?`,
            mixLeagueKb(0)
          )
        } else {
          const leagueSlug = LEAGUE_MAP[comp] || ''
          const fixtures = await fetchTodayFixtures(comp)
          if (fixtures.length > 0) {
            await setSession(supabase, chatId, 'match', { ...session.data, comp, leagueSlug, fixtures })
            await editMsg(chatId, messageId,
              `🏦 <b>${session.data.bk}</b> · 🏆 <b>${comp}</b>\n\n⚽ Partidos de hoy — elige el tuyo:`,
              fixturesSingleKb(fixtures)
            )
          } else {
            await setSession(supabase, chatId, 'type', { ...session.data, comp, match: '' })
            await editMsg(chatId, messageId,
              `🏦 <b>${session.data.bk}</b> · 🏆 <b>${comp}</b>\n` +
              `⚠️ Sin partidos hoy en esta liga.\n` +
              `\n¿Qué tipo de apuesta?`,
              typeKb()
            )
          }
        }
        return NextResponse.json({ ok: true })
      }

      // ── Fixture selected (single bet) ───────────────────────────────────
      if (cbData.startsWith('fx:')) {
        const idx = parseInt(cbData.slice(3))
        const session = await getSession(supabase, chatId)
        const f = session?.data.fixtures?.[idx]
        if (!f) return NextResponse.json({ ok: true })
        const match = `${f.home} vs ${f.away}`
        await setSession(supabase, chatId, 'type', { ...session!.data, match, matchId: f.id, fixtures: undefined })
        await editMsg(chatId, messageId,
          `🏦 <b>${session!.data.bk}</b> · 🏆 <b>${session!.data.comp}</b>\n⚽ <b>${match}</b>\n\n¿Qué tipo de apuesta?`,
          typeKb()
        )
        return NextResponse.json({ ok: true })
      }

      // ── Custom match entry (single bet) ─────────────────────────────────
      if (cbData === 'fx_custom') {
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })
        await setSession(supabase, chatId, 'typing_match_pre', { ...session.data, fixtures: undefined })
        await editMsg(chatId, messageId,
          `✏️ Escribe el nombre del partido (ej: <code>Real Madrid vs Barça</code>):`
        )
        return NextResponse.json({ ok: true })
      }

      // ── MIX: league selected ────────────────────────────────────────────
      if (cbData.startsWith('mxl:')) {
        const comp = cbData.slice(4)
        const session = await getSession(supabase, chatId)
        if (!session) return NextResponse.json({ ok: true })
        const mixFixtures = session.data.mixFixtures || []
        const fixtures = await fetchTodayFixtures(comp)

        if (fixtures.length === 0) {
          await editMsg(chatId, messageId,
            `⚠️ Sin partidos hoy en <b>${comp}</b>. Elige otra liga:`,
            mixLeagueKb(mixFixtures.length)
          )
        } else {
          await setSession(supabase, chatId, 'mix_fixtures', { ...session.data, mixBrowseFixtures: fixtures })
          const selText = mixFixtures.length > 0
            ? `\n\n📋 Ya añadidos: <b>${mixFixtures.map(f => f.match).join(', ')}</b>` : ''
          await editMsg(chatId, messageId,
            `🏆 <b>${comp}</b> — partidos de hoy:${selText}\n\n⚽ Toca para añadir:`,
            mixFixturesKb(fixtures, mixFixtures)
          )
        }
        return NextResponse.json({ ok: true })
      }

      // ── MIX: fixture tapped (toggle) ────────────────────────────────────
      if (cbData.startsWith('mxfx:')) {
        const idx = parseInt(cbData.slice(5))
        const session = await getSession(supabase, chatId)
        const fixtures = session?.data.mixBrowseFixtures || []
        const f = fixtures[idx]
        if (!f) return NextResponse.json({ ok: true })
        const name = `${f.home} - ${f.away}`
        const mixFixtures = session?.data.mixFixtures || []
        const newMix = mixFixtures.some(m => m.match === name)
          ? mixFixtures.filter(m => m.match !== name)
          : [...mixFixtures, { match: name }]
        await setSession(supabase, chatId, 'mix_fixtures', { ...session!.data, mixFixtures: newMix })
        const selText = newMix.length > 0
          ? `\n\n📋 Seleccionados: <b>${newMix.map(m => m.match).join(' + ')}</b>` : ''
        await editMsg(chatId, messageId,
          `⚽ Partidos de hoy:${selText}\n\nToca para añadir/quitar:`,
          mixFixturesKb(fixtures, newMix)
        )
        return NextResponse.json({ ok: true })
      }

      // ── MIX: back to league selection ───────────────────────────────────
      if (cbData === 'mx_add') {
        const session = await getSession(supabase, chatId)
        const mixFixtures = session?.data.mixFixtures || []
        await setSession(supabase, chatId, 'mix_league', { ...session?.data, mixBrowseFixtures: undefined })
        const selText = mixFixtures.length > 0
          ? `\n\n📋 Ya añadidos: <b>${mixFixtures.map(f => f.match).join(', ')}</b>` : ''
        await editMsg(chatId, messageId,
          `🎲 <b>Combinada</b>${selText}\n\n¿De qué liga añades el siguiente partido?`,
          mixLeagueKb(mixFixtures.length)
        )
        return NextResponse.json({ ok: true })
      }

      // ── MIX: custom match text ──────────────────────────────────────────
      if (cbData === 'mx_custom') {
        const session = await getSession(supabase, chatId)
        if (!session) return NextResponse.json({ ok: true })
        await setSession(supabase, chatId, 'typing_mix_match', session.data)
        await editMsg(chatId, messageId,
          `✏️ Escribe el partido (ej: <code>Real Madrid vs Barça</code>):`
        )
        return NextResponse.json({ ok: true })
      }

      // ── MIX: done selecting fixtures ────────────────────────────────────
      if (cbData === 'mx_done') {
        const session = await getSession(supabase, chatId)
        const mixFixtures = session?.data.mixFixtures || []
        const matchName = mixFixtures.length > 0
          ? mixFixtures.map(f => f.match).join(' + ')
          : 'Combinada'
        await setSession(supabase, chatId, 'type', {
          ...session?.data, match: matchName,
          mixBrowseFixtures: undefined, mixFixtures: undefined,
        })
        await editMsg(chatId, messageId,
          `🏦 <b>${session?.data.bk}</b> · 🎲 <b>MIX</b>\n⚽ <b>${matchName}</b>\n\n¿Qué tipo de apuesta?`,
          typeKb()
        )
        return NextResponse.json({ ok: true })
      }

      // ── Type selected → show pick categories ───────────────────────────
      if (cbData.startsWith('tp:')) {
        const betType = cbData.slice(3)
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })
        await setSession(supabase, chatId, 'picks', { ...session.data, betType, picks: [], pickCategory: undefined })
        const matchLine = session.data.match ? `⚽ <b>${session.data.match}</b>\n` : ''
        await editMsg(chatId, messageId,
          `🏦 <b>${session.data.bk}</b> | ${betType === 'funbet' ? '🎉 Funbet' : '🎯 Pick'}\n${matchLine}\n📌 ¿Qué tipo de pick?`,
          categoryKb([], !!session.data.matchId)
        )
        return NextResponse.json({ ok: true })
      }

      // ── Category selected → show picks for that category ───────────────
      if (cbData.startsWith('cat:')) {
        const cat = cbData.slice(4)
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })
        const picks = session.data.picks || []
        await setSession(supabase, chatId, 'picks', { ...session.data, pickCategory: cat })
        const labels: Record<string, string> = { resultado: '⚽ Resultado', goles: '🥅 Goles', corners: '📐 Corners', tarjetas: '🟨 Tarjetas' }
        await editMsg(chatId, messageId,
          `${labels[cat]} — elige tu pick:` + (picks.length ? `\n\nYa seleccionado: <b>${picks.join(' + ')}</b>` : ''),
          categoryPicksKb(cat, picks)
        )
        return NextResponse.json({ ok: true })
      }

      // ── Jugadores: fetch lineup ─────────────────────────────────────────
      if (cbData === 'cat:jugadores') {
        const session = await getSession(supabase, chatId)
        if (!session?.data.matchId || !session.data.leagueSlug) return NextResponse.json({ ok: true })
        const lineup = await fetchLineup(session.data.leagueSlug, session.data.matchId)
        if (lineup.length === 0) {
          await editMsg(chatId, messageId,
            `⚠️ Alineaciones aún no disponibles (suelen publicarse ~1h antes).\n\nUsa ✏️ Otro pick para escribir manualmente.`,
            categoryKb(session.data.picks || [], true)
          )
        } else {
          await setSession(supabase, chatId, 'picks', { ...session.data, lineup, lineupTeamIdx: undefined, lineupPlayer: undefined })
          await editMsg(chatId, messageId, `👤 ¿De qué equipo?`, lineupTeamsKb(lineup))
        }
        return NextResponse.json({ ok: true })
      }

      // ── Jugadores: team selected ────────────────────────────────────────
      if (cbData.startsWith('lnt:')) {
        const idx = parseInt(cbData.slice(4))
        const session = await getSession(supabase, chatId)
        const lineup = session?.data.lineup
        if (!lineup?.[idx]) return NextResponse.json({ ok: true })
        await setSession(supabase, chatId, 'picks', { ...session!.data, lineupTeamIdx: idx, lineupPlayer: undefined })
        const picks = session!.data.picks || []
        await editMsg(chatId, messageId,
          `👤 <b>${lineup[idx].teamName}</b> — elige el jugador:`,
          lineupPlayersKb(lineup[idx].players, picks)
        )
        return NextResponse.json({ ok: true })
      }

      // ── Jugadores: back to team selector ───────────────────────────────
      if (cbData === 'lnt_back') {
        const session = await getSession(supabase, chatId)
        const lineup = session?.data.lineup
        if (!lineup) return NextResponse.json({ ok: true })
        await setSession(supabase, chatId, 'picks', { ...session!.data, lineupPlayer: undefined })
        await editMsg(chatId, messageId, `👤 ¿De qué equipo?`, lineupTeamsKb(lineup))
        return NextResponse.json({ ok: true })
      }

      // ── Jugadores: player selected → show actions ───────────────────────
      if (cbData.startsWith('lnp:')) {
        const idx = parseInt(cbData.slice(4))
        const session = await getSession(supabase, chatId)
        const teamIdx = session?.data.lineupTeamIdx ?? 0
        const player = session?.data.lineup?.[teamIdx]?.players?.[idx]
        if (!player) return NextResponse.json({ ok: true })
        await setSession(supabase, chatId, 'picks', { ...session!.data, lineupPlayer: player })
        await editMsg(chatId, messageId,
          `👤 <b>${player}</b> — ¿qué tipo de apuesta?`,
          lineupActionKb(player)
        )
        return NextResponse.json({ ok: true })
      }

      // ── Jugadores: back to player list ──────────────────────────────────
      if (cbData === 'lnp_back') {
        const session = await getSession(supabase, chatId)
        const lineup = session?.data.lineup
        const teamIdx = session?.data.lineupTeamIdx ?? 0
        if (!lineup?.[teamIdx]) return NextResponse.json({ ok: true })
        await setSession(supabase, chatId, 'picks', { ...session!.data, lineupPlayer: undefined })
        const picks = session!.data.picks || []
        await editMsg(chatId, messageId,
          `👤 <b>${lineup[teamIdx].teamName}</b> — elige el jugador:`,
          lineupPlayersKb(lineup[teamIdx].players, picks)
        )
        return NextResponse.json({ ok: true })
      }

      // ── Jugadores: action selected → save pick ──────────────────────────
      if (cbData.startsWith('lna:')) {
        const action = cbData.slice(4)
        const session = await getSession(supabase, chatId)
        const player = session?.data.lineupPlayer
        if (!player) return NextResponse.json({ ok: true })
        const actionLabels: Record<string, string> = { gol: '⚽ gol', tiro: '🎯 tiro', tarjeta: '🟨 tarjeta', asistencia: '🎖️ asistencia' }
        const pick = `${player} ${actionLabels[action] || action}`
        const picks = [...(session!.data.picks || []), pick]
        await setSession(supabase, chatId, 'picks', { ...session!.data, picks, lineupPlayer: undefined, pickCategory: undefined })
        const matchLine = session!.data.match ? `⚽ <b>${session!.data.match}</b>\n` : ''
        await editMsg(chatId, messageId,
          `✅ <b>${pick}</b> añadido\n\n🏦 <b>${session!.data.bk}</b>\n${matchLine}\n📌 ¿Qué tipo de pick?` +
          `\n\nSeleccionado: <b>${picks.join(' + ')}</b>`,
          categoryKb(picks, true)
        )
        return NextResponse.json({ ok: true })
      }

      // ── Pick button tapped ──────────────────────────────────────────────
      if (cbData.startsWith('pk:')) {
        const pick = cbData.slice(3)
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })
        const picks = session.data.picks || []
        const newPicks = picks.includes(pick)
          ? picks.filter((p: string) => p !== pick)
          : [...picks, pick]
        const cat = session.data.pickCategory
        await setSession(supabase, chatId, 'picks', { ...session.data, picks: newPicks })
        if (cat) {
          const labels: Record<string, string> = { resultado: '⚽ Resultado', goles: '🥅 Goles', corners: '📐 Corners', tarjetas: '🟨 Tarjetas' }
          await editMsg(chatId, messageId,
            `${labels[cat]} — elige tu pick:` + (newPicks.length ? `\n\nSeleccionado: <b>${newPicks.join(' + ')}</b>` : ''),
            categoryPicksKb(cat, newPicks)
          )
        } else {
          const matchLine = session.data.match ? `⚽ <b>${session.data.match}</b>\n` : ''
          await editMsg(chatId, messageId,
            `🏦 <b>${session.data.bk}</b>\n${matchLine}\n📌 ¿Qué tipo de pick?` +
            (newPicks.length ? `\n\nSeleccionado: <b>${newPicks.join(' + ')}</b>` : ''),
            categoryKb(newPicks)
          )
        }
        return NextResponse.json({ ok: true })
      }

      // ── Back to categories ──────────────────────────────────────────────
      if (cbData === 'pk_back') {
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })
        const picks = session.data.picks || []
        await setSession(supabase, chatId, 'picks', { ...session.data, pickCategory: undefined, lineup: undefined, lineupTeamIdx: undefined, lineupPlayer: undefined })
        const matchLine = session.data.match ? `⚽ <b>${session.data.match}</b>\n` : ''
        await editMsg(chatId, messageId,
          `🏦 <b>${session.data.bk}</b>\n${matchLine}\n📌 ¿Qué tipo de pick?` +
          (picks.length ? `\n\nSeleccionado: <b>${picks.join(' + ')}</b>` : ''),
          categoryKb(picks, !!session.data.matchId)
        )
        return NextResponse.json({ ok: true })
      }

      // ── Custom pick ─────────────────────────────────────────────────────
      if (cbData === 'pk_custom') {
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })
        await setSession(supabase, chatId, 'typing_pick', session.data)
        await editMsg(chatId, messageId,
          `✏️ Escribe el pick (ej: <code>Mbappé tiro a puerta</code>):`
        )
        return NextResponse.json({ ok: true })
      }

      // ── Picks done → show odds ──────────────────────────────────────────
      if (cbData === 'pk_done') {
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk || !session.data.picks?.length) return NextResponse.json({ ok: true })
        await setSession(supabase, chatId, 'odds', session.data)
        const matchLine = session.data.match ? `⚽ <b>${session.data.match}</b>\n` : ''
        await editMsg(chatId, messageId,
          `🏦 <b>${session.data.bk}</b>\n${matchLine}📌 <b>${session.data.picks.join(' + ')}</b>\n\n📊 ¿Cuál es la <b>cuota</b>?`,
          oddsKb()
        )
        return NextResponse.json({ ok: true })
      }

      // ── Odds button tapped ──────────────────────────────────────────────
      if (cbData.startsWith('od:')) {
        const odds = parseFloat(cbData.slice(3))
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })
        await setSession(supabase, chatId, 'stake', { ...session.data, odds })
        await editMsg(chatId, messageId,
          `🏦 <b>${session.data.bk}</b> | ${session.data.picks?.join(' + ')} @ <b>${odds}</b>\n\n💵 ¿Cuánto <b>dinero</b> apuestas?`,
          stakeKb()
        )
        return NextResponse.json({ ok: true })
      }

      // ── Custom odds ─────────────────────────────────────────────────────
      if (cbData === 'od_custom') {
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })
        await setSession(supabase, chatId, 'typing_odds', session.data)
        await editMsg(chatId, messageId,
          `✏️ Escribe la cuota (ej: <code>3.90</code>):`
        )
        return NextResponse.json({ ok: true })
      }

      // ── Stake button tapped ─────────────────────────────────────────────
      if (cbData.startsWith('st:')) {
        const stake = parseFloat(cbData.slice(3))
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })
        const settings = await getUserSettings(supabase, userId)
        const unitValue = settings?.unit_value || 10
        const units = Math.round((stake / unitValue) * 100) / 100
        const finalData = { ...session.data, stake }
        await setSession(supabase, chatId, 'confirm', finalData)
        await editMsg(chatId, messageId,
          summaryText(finalData.bk!, finalData.comp || '', finalData.match || '', finalData.betType || 'pick', finalData.picks!, finalData.odds!, stake, units),
          {
            inline_keyboard: [[
              { text: '✅ Confirmar', callback_data: 'cf' },
              { text: '❌ Cancelar', callback_data: 'cancel' },
            ]],
          }
        )
        return NextResponse.json({ ok: true })
      }

      // ── Custom stake ────────────────────────────────────────────────────
      if (cbData === 'st_custom') {
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })
        await setSession(supabase, chatId, 'typing_stake', session.data)
        await editMsg(chatId, messageId,
          `✏️ Escribe el importe en euros (ej: <code>25</code>):`
        )
        return NextResponse.json({ ok: true })
      }

      // ── Confirm → register ──────────────────────────────────────────────
      if (cbData === 'cf') {
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })

        const { bk, comp, match, betType, picks, odds, stake } = session.data
        const settings = await getUserSettings(supabase, userId)
        const unitValue = settings?.unit_value || 10
        const units = Math.round((stake! / unitValue) * 100) / 100
        const profit = stake! * (odds! - 1)
        const total = stake! + profit
        const today = new Date().toISOString().split('T')[0]
        const pickStr = picks!.join(' + ')
        const matchName = match || 'Apuesta'
        const typeLabel = betType === 'funbet' ? '🎉 Funbet' : '🎯 Pick'

        const { error } = await supabase.from('bets').insert({
          user_id: userId, date: today,
          sport: 'Fútbol', competition: comp || '',
          match: matchName, pick: pickStr,
          bookmaker: bk, odds, units, stake,
          status: 'pending', result_amount: null,
          notes: betType === 'funbet' ? 'funbet' : null,
          event_id: session.data.matchId || null,
          league_slug: session.data.leagueSlug || null,
        })

        if (error) {
          await editMsg(chatId, messageId, `❌ Error: ${error.message}`)
          return NextResponse.json({ ok: true })
        }

        await clearSession(supabase, chatId)
        await editMsg(chatId, messageId,
          `✅ <b>¡Apuesta registrada!</b>\n\n` +
          `🏦 ${bk} | ${typeLabel} | 📌 ${pickStr} @ ${odds}\n` +
          (matchName !== 'Apuesta' ? `⚽ ${matchName}\n` : '') +
          `💵 €${stake!.toFixed(2)} (${units}u) → 🏆 cobras <b>€${total.toFixed(2)}</b>\n\n` +
          `Cuando sepas el resultado:\n<b>ganada</b> ✅  <b>perdida</b> ❌  <b>anulada</b> ↩️  <b>cashout 50</b> 💸`
        )
        return NextResponse.json({ ok: true })
      }

      // ── Settle specific bet ─────────────────────────────────────────────
      if (cbData.startsWith('sb:')) {
        const betId = cbData.slice(3)
        const session = await getSession(supabase, chatId)
        if (!session?.data.status) return NextResponse.json({ ok: true })
        const { data: bet } = await supabase.from('bets').select('*').eq('id', betId).single()
        if (!bet) return NextResponse.json({ ok: true })
        await clearSession(supabase, chatId)
        await settleBet(supabase, chatId, bet, session.data.status as string, session.data.cashoutAmount as number | null ?? null)
        await editMsg(chatId, messageId, '✅')
        return NextResponse.json({ ok: true })
      }

      if (cbData === 'cancel') {
        await clearSession(supabase, chatId)
        await editMsg(chatId, messageId, '❌ Cancelado.', mainMenuKb())
        return NextResponse.json({ ok: true })
      }

      // ── Historial ───────────────────────────────────────────────────────
      if (cbData === 'hist:back') {
        await editMsg(chatId, messageId, '🎯 ¿Qué quieres hacer?', mainMenuKb())
        return NextResponse.json({ ok: true })
      }

      if (cbData.startsWith('hist:')) {
        const period = cbData.slice(5)
        const { gte, lte } = getDateRange(period)
        const { data: bets } = await supabase
          .from('bets').select('*').eq('user_id', userId)
          .gte('date', gte).lte('date', lte)
          .order('date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(20)
        await editMsg(chatId, messageId, historialText(bets || [], period), historialKb())
        return NextResponse.json({ ok: true })
      }

      // ── Gestionar ───────────────────────────────────────────────────────
      if (cbData === 'del_list') {
        const { data: bets } = await supabase
          .from('bets').select('*').eq('user_id', userId)
          .order('created_at', { ascending: false }).limit(8)
        if (!bets?.length) {
          await editMsg(chatId, messageId, '📭 No hay apuestas para eliminar.', mainMenuKb())
        } else {
          await editMsg(chatId, messageId, '🗑️ <b>¿Qué apuesta eliminas?</b>', deleteBetsKb(bets))
        }
        return NextResponse.json({ ok: true })
      }

      if (cbData.startsWith('del:')) {
        const betId = cbData.slice(4)
        const { data: bet } = await supabase.from('bets').select('*').eq('id', betId).single()
        if (!bet) return NextResponse.json({ ok: true })
        const name = bet.match !== 'Apuesta' ? bet.match : `${bet.pick} @ ${bet.odds}`
        await editMsg(chatId, messageId,
          `🗑️ ¿Eliminar esta apuesta?\n\n<b>${name}</b>\n${bet.bookmaker} | €${bet.stake} | ${bet.status}`,
          {
            inline_keyboard: [[
              { text: '✅ Sí, eliminar', callback_data: `del_ok:${betId}` },
              { text: '❌ No', callback_data: 'del_list' },
            ]],
          }
        )
        return NextResponse.json({ ok: true })
      }

      if (cbData.startsWith('del_ok:')) {
        const betId = cbData.slice(7)
        await supabase.from('bets').delete().eq('id', betId)
        await editMsg(chatId, messageId, '🗑️ Apuesta eliminada.', mainMenuKb())
        return NextResponse.json({ ok: true })
      }

      if (cbData === 'edt_list') {
        const { data: bets } = await supabase
          .from('bets').select('*').eq('user_id', userId).eq('status', 'pending')
          .order('created_at', { ascending: false }).limit(8)
        if (!bets?.length) {
          await editMsg(chatId, messageId, '📭 No hay apuestas pendientes para editar.', mainMenuKb())
        } else {
          await editMsg(chatId, messageId, '✏️ <b>¿Qué apuesta editas?</b>', editBetsKb(bets))
        }
        return NextResponse.json({ ok: true })
      }

      if (cbData.startsWith('edt:')) {
        const betId = cbData.slice(4)
        const { data: bet } = await supabase.from('bets').select('*').eq('id', betId).single()
        if (!bet) return NextResponse.json({ ok: true })
        const name = bet.match !== 'Apuesta' ? bet.match : `${bet.pick}`
        await editMsg(chatId, messageId,
          `✏️ <b>${name}</b>\n📌 ${bet.pick} @ ${bet.odds} | €${bet.stake}\n\n¿Qué quieres cambiar?`,
          editFieldKb(betId)
        )
        return NextResponse.json({ ok: true })
      }

      if (cbData.startsWith('edt_odds:')) {
        const betId = cbData.slice(9)
        await setSession(supabase, chatId, 'typing_edit_odds', { editBetId: betId })
        await editMsg(chatId, messageId, `📊 Escribe la nueva cuota (ej: <code>2.10</code>):`)
        return NextResponse.json({ ok: true })
      }

      if (cbData.startsWith('edt_pick:')) {
        const betId = cbData.slice(9)
        await setSession(supabase, chatId, 'typing_edit_pick', { editBetId: betId })
        await editMsg(chatId, messageId, `📌 Escribe el nuevo pick (ej: <code>Over 2.5</code>):`)
        return NextResponse.json({ ok: true })
      }

      if (cbData.startsWith('edt_stake:')) {
        const betId = cbData.slice(10)
        await setSession(supabase, chatId, 'typing_edit_stake', { editBetId: betId })
        await editMsg(chatId, messageId, `💵 Escribe el nuevo importe en euros (ej: <code>25</code>):`)
        return NextResponse.json({ ok: true })
      }

      // ── Main menu actions ───────────────────────────────────────────────
      if (cbData === 'menu:nueva') {
        await clearSession(supabase, chatId)
        await editMsg(chatId, messageId, '📸 ¿En qué <b>casa de apuestas</b>?', bookmakersKb())
        return NextResponse.json({ ok: true })
      }

      if (cbData === 'menu:historial') {
        await editMsg(chatId, messageId, '📅 ¿Qué período quieres ver?', historialKb())
        return NextResponse.json({ ok: true })
      }

      if (cbData === 'menu:gestionar') {
        await editMsg(chatId, messageId, '🛠️ <b>Gestionar apuestas</b>\n\n¿Qué quieres hacer?', gestionarKb())
        return NextResponse.json({ ok: true })
      }

      if (cbData === 'menu:pendientes') {
        const { data: bets } = await supabase
          .from('bets').select('*').eq('user_id', userId).eq('status', 'pending')
          .order('created_at', { ascending: false }).limit(8)
        if (!bets?.length) {
          await editMsg(chatId, messageId, '✅ No tienes apuestas pendientes.', mainMenuKb())
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const list = bets.map((b: any, i: number) => {
            const name = b.match !== 'Apuesta' ? b.match : `${b.pick} @ ${b.odds}`
            return `${i + 1}. <b>${name}</b> — ${b.bookmaker} | €${b.stake}`
          }).join('\n')
          await editMsg(chatId, messageId, `⏳ <b>Pendientes:</b>\n\n${list}`, mainMenuKb())
        }
        return NextResponse.json({ ok: true })
      }

      if (cbData === 'menu:resumen') {
        const today = new Date().toISOString().split('T')[0]
        const { data: bets } = await supabase
          .from('bets').select('*').eq('user_id', userId).eq('date', today)
        if (!bets?.length) {
          await editMsg(chatId, messageId, '📊 Sin apuestas hoy.', mainMenuKb())
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const won   = bets.filter((b: any) => b.status === 'won')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lost  = bets.filter((b: any) => b.status === 'lost')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pend  = bets.filter((b: any) => b.status === 'pending')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const settled = bets.filter((b: any) => b.status !== 'pending')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pl = settled.reduce((s: number, b: any) => s + (b.result_amount ?? 0), 0)
          const plText = pl >= 0 ? `+€${pl.toFixed(2)}` : `-€${Math.abs(pl).toFixed(2)}`
          await editMsg(chatId, messageId,
            `📊 <b>Resumen de hoy</b>\n\n` +
            `✅ Ganadas: <b>${won.length}</b>   ❌ Perdidas: <b>${lost.length}</b>   ⏳ Pendientes: <b>${pend.length}</b>\n` +
            `💰 P&L: <b>${settled.length ? plText : '—'}</b>`,
            mainMenuKb()
          )
        }
        return NextResponse.json({ ok: true })
      }

      if (cbData === 'menu:ultimas') {
        const { data: bets } = await supabase
          .from('bets').select('*').eq('user_id', userId)
          .order('created_at', { ascending: false }).limit(5)
        if (!bets?.length) {
          await editMsg(chatId, messageId, 'No hay apuestas registradas.', mainMenuKb())
        } else {
          const e: Record<string, string> = { pending: '⏳', won: '✅', lost: '❌', void: '↩️', cashout: '💸' }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const list = bets.map((b: any) => {
            const name = b.match !== 'Apuesta' ? b.match : `${b.pick} @ ${b.odds}`
            const pl = b.result_amount != null
              ? (b.result_amount >= 0 ? ` <b>+€${b.result_amount.toFixed(2)}</b>` : ` <b>-€${Math.abs(b.result_amount).toFixed(2)}</b>`) : ''
            return `${e[b.status] || '?'} <b>${name}</b>${pl}`
          }).join('\n')
          await editMsg(chatId, messageId, `🔔 <b>Últimas 5 apuestas:</b>\n\n${list}`, mainMenuKb())
        }
        return NextResponse.json({ ok: true })
      }

      return NextResponse.json({ ok: true })
    }

    // ── Regular message ───────────────────────────────────────────────────────
    const message = body.message || body.edited_message
    if (!message) return NextResponse.json({ ok: true })

    const chatId: number = message.chat.id
    const userId = CHAT_ID_MAP[String(chatId)]

    if (!userId) {
      await sendMsg(chatId, '⚠️ Tu cuenta de Telegram no está vinculada.')
      return NextResponse.json({ ok: true })
    }

    const supabase = getSupabaseAdmin()
    const rawText: string = (message.text || '').trim()
    const textLower = rawText.toLowerCase()

    if (textLower.startsWith('/start') || textLower.startsWith('/help')) {
      await sendMsg(chatId,
        '🎯 <b>Win &amp; Dine Bot</b>\n\n' +
        'Liquida tus apuestas con:\n' +
        '• <b>ganada</b> ✅  • <b>perdida</b> ❌\n• <b>anulada</b> ↩️  • <b>cashout 50</b> 💸\n\n' +
        'Comandos:\n' +
        '• <b>/nueva</b> — registrar apuesta\n' +
        '• <b>/pendientes</b> — apuestas activas\n' +
        '• <b>/historial</b> — ver por fecha\n' +
        '• <b>/stats</b> — estadísticas generales\n' +
        '• <b>/stats Bet365</b> — stats por casa\n' +
        '• <b>/editar</b> — modificar una apuesta\n' +
        '• <b>/ultima</b> — última apuesta',
        mainMenuKb()
      )
      return NextResponse.json({ ok: true })
    }

    if (textLower.startsWith('/nueva') || textLower === '/n') {
      await clearSession(supabase, chatId)
      await sendMsg(chatId, '📋 ¿En qué <b>casa de apuestas</b>?', bookmakersKb())
      return NextResponse.json({ ok: true })
    }

    if (textLower.startsWith('/pendientes')) {
      const { data: bets } = await supabase
        .from('bets').select('*').eq('user_id', userId).eq('status', 'pending')
        .order('created_at', { ascending: false }).limit(5)
      if (!bets?.length) {
        await sendMsg(chatId, '✅ No tienes apuestas pendientes.')
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = bets.map((b: any, i: number) =>
          `${i + 1}. <b>${b.match}</b> — ${b.pick} @ ${b.odds} | €${b.stake} (${b.units}u) — ${b.bookmaker}`
        ).join('\n\n')
        await sendMsg(chatId, `📋 <b>Pendientes:</b>\n\n${list}`)
      }
      return NextResponse.json({ ok: true })
    }

    if (textLower.startsWith('/historial') || textLower === '/h') {
      await sendMsg(chatId, '📅 ¿Qué período quieres ver?', historialKb())
      return NextResponse.json({ ok: true })
    }

    if (textLower.startsWith('/stats')) {
      const parts = rawText.trim().split(/\s+/)
      const bookmaker = parts.length > 1 ? parts.slice(1).join(' ') : null
      let query = supabase.from('bets').select('*').eq('user_id', userId)
      if (bookmaker) query = query.ilike('bookmaker', `%${bookmaker}%`)
      const { data: bets } = await query.order('created_at', { ascending: false })
      await sendMsg(chatId, statsText(bets || [], bookmaker || undefined), mainMenuKb())
      return NextResponse.json({ ok: true })
    }

    if (textLower.startsWith('/editar') || textLower === '/e') {
      const { data: bets } = await supabase
        .from('bets').select('*').eq('user_id', userId).eq('status', 'pending')
        .order('created_at', { ascending: false }).limit(8)
      if (!bets?.length) {
        await sendMsg(chatId, '📭 No hay apuestas pendientes para editar.', mainMenuKb())
      } else {
        await sendMsg(chatId, '✏️ <b>¿Qué apuesta editas?</b>', editBetsKb(bets))
      }
      return NextResponse.json({ ok: true })
    }

    if (textLower.startsWith('/ultima')) {
      const { data: bet } = await supabase
        .from('bets').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(1).single()
      if (!bet) {
        await sendMsg(chatId, 'No hay apuestas aún.')
      } else {
        const e: Record<string, string> = { pending: '⏳', won: '✅', lost: '❌', void: '↩️', cashout: '💸' }
        await sendMsg(chatId,
          `${e[bet.status] || '?'} <b>${bet.match}</b>\n${bet.pick} @ ${bet.odds} | €${bet.stake} (${bet.units}u) — ${bet.bookmaker}\nEstado: <b>${bet.status}</b>`
        )
      }
      return NextResponse.json({ ok: true })
    }

    if (message.photo) {
      await clearSession(supabase, chatId)
      await sendMsg(chatId, '📸 ¿En qué <b>casa de apuestas</b>?', bookmakersKb())
      return NextResponse.json({ ok: true })
    }

    if (message.text) {
      const session = await getSession(supabase, chatId)

      // Match name typed before type selection (single bet)
      if (session?.step === 'typing_match_pre') {
        const match = rawText
        await setSession(supabase, chatId, 'type', { ...session.data, match, fixtures: undefined })
        await sendMsg(chatId,
          `⚽ <b>${match}</b>\n\n¿Qué tipo de apuesta?`,
          typeKb()
        )
        return NextResponse.json({ ok: true })
      }

      // Match name typed in MIX flow
      if (session?.step === 'typing_mix_match') {
        const mixFixtures = [...(session.data.mixFixtures || []), { match: rawText }]
        await setSession(supabase, chatId, 'mix_fixtures', { ...session.data, mixFixtures })
        await sendMsg(chatId,
          `✅ Añadido: <b>${rawText}</b>\n📋 ${mixFixtures.map(f => f.match).join(' + ')}\n\n¿Añadir otro partido?`,
          {
            inline_keyboard: [
              [{ text: '➕ Añadir otro', callback_data: 'mx_add' }],
              [{ text: `✅ Listo (${mixFixtures.length} partido${mixFixtures.length > 1 ? 's' : ''})`, callback_data: 'mx_done' }],
            ],
          }
        )
        return NextResponse.json({ ok: true })
      }

      // Custom pick text → back to category selector
      if (session?.step === 'typing_pick') {
        const picks = [...(session.data.picks || []), rawText]
        await setSession(supabase, chatId, 'picks', { ...session.data, picks, pickCategory: undefined })
        const matchLine = session.data.match ? `⚽ <b>${session.data.match}</b>\n` : ''
        await sendMsg(chatId,
          `🏦 <b>${session.data.bk}</b>\n${matchLine}\n📌 ¿Qué tipo de pick?\n\nSeleccionado: <b>${picks.join(' + ')}</b>`,
          categoryKb(picks)
        )
        return NextResponse.json({ ok: true })
      }

      // Edit bet fields
      if (session?.step === 'typing_edit_odds') {
        const odds = parseFloat(rawText.replace(',', '.'))
        if (isNaN(odds) || odds < 1.01 || odds > 500) {
          await sendMsg(chatId, '❌ Cuota inválida. Ej: <code>3.90</code>')
          return NextResponse.json({ ok: true })
        }
        await supabase.from('bets').update({ odds }).eq('id', session.data.editBetId)
        await clearSession(supabase, chatId)
        await sendMsg(chatId, `✅ Cuota actualizada a <b>${odds}</b>.`, mainMenuKb())
        return NextResponse.json({ ok: true })
      }

      if (session?.step === 'typing_edit_pick') {
        await supabase.from('bets').update({ pick: rawText }).eq('id', session.data.editBetId)
        await clearSession(supabase, chatId)
        await sendMsg(chatId, `✅ Pick actualizado a <b>${rawText}</b>.`, mainMenuKb())
        return NextResponse.json({ ok: true })
      }

      if (session?.step === 'typing_edit_stake') {
        const stake = parseFloat(rawText.replace(',', '.'))
        if (isNaN(stake) || stake <= 0) {
          await sendMsg(chatId, '❌ Importe inválido. Ej: <code>25</code>')
          return NextResponse.json({ ok: true })
        }
        const settings = await getUserSettings(supabase, userId)
        const unitValue = settings?.unit_value || 10
        const units = Math.round((stake / unitValue) * 100) / 100
        await supabase.from('bets').update({ stake, units }).eq('id', session.data.editBetId)
        await clearSession(supabase, chatId)
        await sendMsg(chatId, `✅ Importe actualizado a <b>€${stake.toFixed(2)}</b> (${units}u).`, mainMenuKb())
        return NextResponse.json({ ok: true })
      }

      // Custom odds
      if (session?.step === 'typing_odds') {
        const odds = parseFloat(rawText.replace(',', '.'))
        if (isNaN(odds) || odds < 1.01 || odds > 500) {
          await sendMsg(chatId, '❌ Cuota inválida. Ej: <code>3.90</code>')
          return NextResponse.json({ ok: true })
        }
        await setSession(supabase, chatId, 'stake', { ...session.data, odds })
        await sendMsg(chatId,
          `${session.data.picks?.join(' + ')} @ <b>${odds}</b>\n\n💵 ¿Cuánto <b>dinero</b> apuestas?`,
          stakeKb()
        )
        return NextResponse.json({ ok: true })
      }

      // Custom stake
      if (session?.step === 'typing_stake') {
        const stake = parseFloat(rawText.replace(',', '.'))
        if (isNaN(stake) || stake <= 0) {
          await sendMsg(chatId, '❌ Importe inválido. Ej: <code>5</code>')
          return NextResponse.json({ ok: true })
        }
        const settings = await getUserSettings(supabase, userId)
        const unitValue = settings?.unit_value || 10
        const units = Math.round((stake / unitValue) * 100) / 100
        const finalData = { ...session.data, stake }
        await setSession(supabase, chatId, 'confirm', finalData)
        await sendMsg(chatId,
          summaryText(finalData.bk!, finalData.comp || '', finalData.match || '', finalData.betType || 'pick', finalData.picks!, finalData.odds!, stake, units),
          {
            inline_keyboard: [[
              { text: '✅ Confirmar', callback_data: 'cf' },
              { text: '❌ Cancelar', callback_data: 'cancel' },
            ]],
          }
        )
        return NextResponse.json({ ok: true })
      }

      // ── Settle ───────────────────────────────────────────────────────────
      const settleMap: Record<string, string> = {
        ganada: 'won', gana: 'won', won: 'won',
        perdida: 'lost', pierde: 'lost', lost: 'lost',
        anulada: 'void', anulado: 'void', nula: 'void', void: 'void',
      }
      let newStatus = settleMap[textLower] || null
      let cashoutAmount: number | null = null

      if (!newStatus && textLower.startsWith('cashout')) {
        const parts = textLower.split(/\s+/)
        cashoutAmount = parts.length > 1 ? parseFloat(parts[1].replace(',', '.')) : null
        if (cashoutAmount !== null && !isNaN(cashoutAmount)) newStatus = 'cashout'
        else {
          await sendMsg(chatId, '💸 Indica el importe: <b>cashout 45.50</b>')
          return NextResponse.json({ ok: true })
        }
      }

      if (newStatus) {
        const { data: pendingBets } = await supabase
          .from('bets').select('*').eq('user_id', userId).eq('status', 'pending')
          .order('created_at', { ascending: false }).limit(8)

        if (!pendingBets?.length) {
          await sendMsg(chatId, '⚠️ No hay apuestas pendientes.')
          return NextResponse.json({ ok: true })
        }

        if (pendingBets.length === 1) {
          await settleBet(supabase, chatId, pendingBets[0], newStatus, cashoutAmount)
          return NextResponse.json({ ok: true })
        }

        await setSession(supabase, chatId, 'selecting_bet', {
          status: newStatus,
          cashoutAmount: cashoutAmount ?? undefined,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const buttons = pendingBets.map((b: any) => [{
          text: `${b.match !== 'Apuesta' ? b.match + ' — ' : ''}${b.pick} @ ${b.odds} | €${b.stake} | ${b.bookmaker}`,
          callback_data: `sb:${b.id}`,
        }])
        buttons.push([{ text: '❌ Cancelar', callback_data: 'cancel' }])
        const statusLabel: Record<string, string> = { won: '✅ Ganada', lost: '❌ Perdida', void: '↩️ Anulada', cashout: '💸 Cashout' }
        await sendMsg(chatId, `${statusLabel[newStatus]} — ¿Cuál apuesta?`, { inline_keyboard: buttons })
        return NextResponse.json({ ok: true })
      }

      await sendMsg(chatId, '🎯 ¿Qué quieres hacer?', mainMenuKb())
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Telegram webhook error:', error)
    return NextResponse.json({ ok: true })
  }
}
