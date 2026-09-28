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
interface Fixture { home: string; away: string; time: string }

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
      return { home, away, time: toMadridTime(e.date) }
    }).filter((f: Fixture) => f.home && f.away)
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

function categoryKb(selectedPicks: string[]) {
  const rows: { text: string; callback_data: string }[][] = [
    [
      { text: '⚽ Resultado', callback_data: 'cat:resultado' },
      { text: '🥅 Goles', callback_data: 'cat:goles' },
    ],
    [
      { text: '📐 Corners', callback_data: 'cat:corners' },
      { text: '🟨 Tarjetas', callback_data: 'cat:tarjetas' },
    ],
    [{ text: '✏️ Otro pick', callback_data: 'pk_custom' }],
  ]
  if (selectedPicks.length > 0) {
    rows.push([{ text: `✅ Listo — ${selectedPicks.join(' + ')}`, callback_data: 'pk_done' }])
  }
  return { inline_keyboard: rows }
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
          const fixtures = await fetchTodayFixtures(comp)
          if (fixtures.length > 0) {
            await setSession(supabase, chatId, 'match', { ...session.data, comp, fixtures })
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
        await setSession(supabase, chatId, 'type', { ...session!.data, match, fixtures: undefined })
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
          categoryKb([])
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
        await setSession(supabase, chatId, 'picks', { ...session.data, pickCategory: undefined })
        const matchLine = session.data.match ? `⚽ <b>${session.data.match}</b>\n` : ''
        await editMsg(chatId, messageId,
          `🏦 <b>${session.data.bk}</b>\n${matchLine}\n📌 ¿Qué tipo de pick?` +
          (picks.length ? `\n\nSeleccionado: <b>${picks.join(' + ')}</b>` : ''),
          categoryKb(picks)
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

      // ── Main menu actions ───────────────────────────────────────────────
      if (cbData === 'menu:nueva') {
        await clearSession(supabase, chatId)
        await editMsg(chatId, messageId, '📸 ¿En qué <b>casa de apuestas</b>?', bookmakersKb())
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
        'Usa el menú para registrar apuestas o liquídalas con:\n\n' +
        '• <b>ganada</b> ✅\n• <b>perdida</b> ❌\n• <b>anulada</b> ↩️\n• <b>cashout 50</b> 💸\n\n' +
        'Comandos:\n• <b>/nueva</b> — registrar apuesta\n• <b>/pendientes</b>\n• <b>/ultima</b>',
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
