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

// ── Session ───────────────────────────────────────────────────────────────────
interface SessionData {
  bk?: string
  picks?: string[]
  odds?: number
  stake?: number
  betId?: string
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
const QUICK_PICKS = ['1', 'X', '2', '1X', 'X2', 'Over 2.5', 'Under 2.5', 'BTTS Sí', 'BTTS No', 'Handicap']
const COMMON_ODDS = ['1.30', '1.50', '1.70', '1.85', '2.00', '2.25', '2.50', '3.00']
const COMMON_STAKES = ['5', '10', '15', '20', '30', '40', '50', '75', '100']

function bookmakersKb() {
  return {
    inline_keyboard: [
      BOOKMAKERS.slice(0, 3).map(b => ({ text: b, callback_data: `bk:${b}` })),
      BOOKMAKERS.slice(3).map(b => ({ text: b, callback_data: `bk:${b}` })),
    ],
  }
}

function pickGridKb(selectedPicks: string[]) {
  const rows = []
  for (let i = 0; i < QUICK_PICKS.length; i += 5) {
    rows.push(QUICK_PICKS.slice(i, i + 5).map(p => ({
      text: selectedPicks.includes(p) ? `✅ ${p}` : p,
      callback_data: `pk:${p}`,
    })))
  }
  rows.push([
    { text: '✏️ Otro pick', callback_data: 'pk_custom' },
  ])
  if (selectedPicks.length > 0) {
    rows.push([{ text: `✅ Listo (${selectedPicks.join(' + ')})`, callback_data: 'pk_done' }])
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

function summaryText(bk: string, picks: string[], odds: number, stake: number, units: number) {
  const profit = stake * (odds - 1)
  const total = stake + profit
  return (
    `📋 <b>Resumen de la apuesta</b>\n\n` +
    `🏦 ${bk}\n` +
    `📌 Pick: <b>${picks.join(' + ')}</b>\n` +
    `📊 Cuota: <b>${odds}</b>\n` +
    `💵 Apostado: <b>€${stake.toFixed(2)}</b> (${units}u)\n` +
    `💰 Ganancias: <b>+€${profit.toFixed(2)}</b>\n` +
    `🏆 Total a cobrar: <b>€${total.toFixed(2)}</b>`
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getUserSettings(supabase: any, userId: string) {
  const { data } = await supabase.from('settings').select('*').eq('user_id', userId).single()
  return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLastPendingBet(supabase: any, userId: string) {
  const { data } = await supabase
    .from('bets').select('*').eq('user_id', userId).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1).single()
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
        await setSession(supabase, chatId, 'picks', { bk, picks: [] })
        await editMsg(chatId, messageId,
          `🏦 <b>${bk}</b>\n\n📌 ¿Cuál es tu <b>pick</b>? (puedes elegir varios para combinadas)`,
          pickGridKb([])
        )
        return NextResponse.json({ ok: true })
      }

      // ── Pick button tapped ──────────────────────────────────────────────
      if (cbData.startsWith('pk:')) {
        const pick = cbData.slice(3)
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })

        const picks = session.data.picks || []
        // Toggle: if already selected, remove it; else add it
        const newPicks = picks.includes(pick)
          ? picks.filter((p: string) => p !== pick)
          : [...picks, pick]

        await setSession(supabase, chatId, 'picks', { ...session.data, picks: newPicks })
        await editMsg(chatId, messageId,
          `🏦 <b>${session.data.bk}</b>\n\n📌 ¿Cuál es tu <b>pick</b>? (puedes elegir varios para combinadas)\n` +
          (newPicks.length > 0 ? `\nSeleccionado: <b>${newPicks.join(' + ')}</b>` : ''),
          pickGridKb(newPicks)
        )
        return NextResponse.json({ ok: true })
      }

      // ── Custom pick ─────────────────────────────────────────────────────
      if (cbData === 'pk_custom') {
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })
        await setSession(supabase, chatId, 'typing_pick', session.data)
        await editMsg(chatId, messageId,
          `🏦 <b>${session.data.bk}</b>\n\n✏️ Escribe el pick (ej: <code>Córners Más 3.5 + BTTS</code>):`
        )
        return NextResponse.json({ ok: true })
      }

      // ── Picks done → show odds ──────────────────────────────────────────
      if (cbData === 'pk_done') {
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk || !session.data.picks?.length) return NextResponse.json({ ok: true })

        await setSession(supabase, chatId, 'odds', session.data)
        await editMsg(chatId, messageId,
          `🏦 <b>${session.data.bk}</b>\n📌 <b>${session.data.picks.join(' + ')}</b>\n\n📊 ¿Cuál es la <b>cuota</b>?`,
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
          `🏦 <b>${session.data.bk}</b> | ${session.data.picks?.join(' + ')}\n\n✏️ Escribe la cuota (ej: <code>3.90</code>):`
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
          summaryText(finalData.bk!, finalData.picks!, finalData.odds!, stake, units),
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
          `🏦 <b>${session.data.bk}</b> | ${session.data.picks?.join(' + ')} @ <b>${session.data.odds}</b>\n\n✏️ Escribe el importe en euros (ej: <code>25</code>):`
        )
        return NextResponse.json({ ok: true })
      }

      // ── Confirm → register ──────────────────────────────────────────────
      if (cbData === 'cf') {
        const session = await getSession(supabase, chatId)
        if (!session?.data.bk) return NextResponse.json({ ok: true })

        const { bk, picks, odds, stake } = session.data
        const settings = await getUserSettings(supabase, userId)
        const unitValue = settings?.unit_value || 10
        const units = Math.round((stake! / unitValue) * 100) / 100
        const profit = stake! * (odds! - 1)
        const total = stake! + profit
        const today = new Date().toISOString().split('T')[0]
        const pickStr = picks!.join(' + ')

        const { data: inserted, error } = await supabase.from('bets').insert({
          user_id: userId, date: today,
          sport: 'Fútbol', competition: '',
          match: 'Apuesta', pick: pickStr,
          bookmaker: bk, odds, units, stake,
          status: 'pending', result_amount: null, notes: null,
        }).select('id').single()

        if (error) {
          await editMsg(chatId, messageId, `❌ Error: ${error.message}`)
          return NextResponse.json({ ok: true })
        }

        await setSession(supabase, chatId, 'typing_match', { betId: inserted.id })
        await editMsg(chatId, messageId,
          `✅ <b>¡Apuesta registrada!</b>\n\n` +
          `🏦 ${bk} | 📌 ${pickStr} @ ${odds}\n` +
          `💵 €${stake!.toFixed(2)} (${units}u) → 🏆 cobras <b>€${total.toFixed(2)}</b>\n\n` +
          `📝 ¿Nombre del partido?`
        )
        await sendMsg(chatId, 'Escribe el partido o salta:', {
          inline_keyboard: [[{ text: '⏭️ Saltar', callback_data: 'skip_match' }]],
        })
        return NextResponse.json({ ok: true })
      }

      // ── Skip match ──────────────────────────────────────────────────────
      if (cbData === 'skip_match') {
        await clearSession(supabase, chatId)
        await editMsg(chatId, messageId,
          `⏭️ Listo. Cuando sepas el resultado:\n<b>ganada</b> ✅  <b>perdida</b> ❌  <b>anulada</b> ↩️  <b>cashout 50</b> 💸`
        )
        return NextResponse.json({ ok: true })
      }

      if (cbData === 'cancel') {
        await clearSession(supabase, chatId)
        await editMsg(chatId, messageId, '❌ Cancelado.')
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
        '🎯 <b>mm_b3t Bot</b>\n\n' +
        '📸 Envía una <b>foto</b> o escribe <b>/nueva</b> para registrar una apuesta.\n\n' +
        'Resultado:\n• <b>ganada</b> ✅\n• <b>perdida</b> ❌\n• <b>anulada</b> ↩️\n• <b>cashout 50</b> 💸\n\n' +
        'Comandos:\n• <b>/nueva</b> — registrar apuesta\n• <b>/pendientes</b>\n• <b>/ultima</b>'
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

      // Custom pick text
      if (session?.step === 'typing_pick') {
        const picks = [...(session.data.picks || []), rawText]
        await setSession(supabase, chatId, 'odds', { ...session.data, picks })
        await sendMsg(chatId,
          `🏦 <b>${session.data.bk}</b>\n📌 <b>${picks.join(' + ')}</b>\n\n📊 ¿Cuál es la <b>cuota</b>?`,
          oddsKb()
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
          `🏦 <b>${session.data.bk}</b> | ${session.data.picks?.join(' + ')} @ <b>${odds}</b>\n\n💵 ¿Cuánto <b>dinero</b> apuestas?`,
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
          summaryText(finalData.bk!, finalData.picks!, finalData.odds!, stake, units),
          {
            inline_keyboard: [[
              { text: '✅ Confirmar', callback_data: 'cf' },
              { text: '❌ Cancelar', callback_data: 'cancel' },
            ]],
          }
        )
        return NextResponse.json({ ok: true })
      }

      // Match name after registration
      if (session?.step === 'typing_match') {
        const { betId } = session.data
        await supabase.from('bets').update({ match: rawText }).eq('id', betId)
        await clearSession(supabase, chatId)
        await sendMsg(chatId,
          `⚽ <b>${rawText}</b> guardado.\n\nCuando sepas el resultado:\n<b>ganada</b> ✅  <b>perdida</b> ❌  <b>anulada</b> ↩️  <b>cashout 50</b> 💸`
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
        const pendingBet = await getLastPendingBet(supabase, userId)
        if (!pendingBet) {
          await sendMsg(chatId, '⚠️ No hay apuestas pendientes.')
          return NextResponse.json({ ok: true })
        }
        let resultAmount: number | null = null
        if (newStatus === 'won') resultAmount = pendingBet.stake * (pendingBet.odds - 1)
        else if (newStatus === 'lost') resultAmount = -pendingBet.stake
        else if (newStatus === 'void') resultAmount = 0
        else if (newStatus === 'cashout' && cashoutAmount !== null) resultAmount = cashoutAmount - pendingBet.stake

        await supabase.from('bets').update({ status: newStatus, result_amount: resultAmount }).eq('id', pendingBet.id)

        const e: Record<string, string> = { won: '✅', lost: '❌', void: '↩️', cashout: '💸' }
        const profitText = resultAmount !== null
          ? (resultAmount >= 0 ? `+€${resultAmount.toFixed(2)}` : `-€${Math.abs(resultAmount).toFixed(2)}`) : ''
        await sendMsg(chatId,
          `${e[newStatus]} <b>${pendingBet.match}</b> — ${newStatus}${profitText ? ` | ${profitText}` : ''}`
        )
        return NextResponse.json({ ok: true })
      }

      await sendMsg(chatId,
        '📸 Envía una foto de tu apuesta, o:\n<b>ganada</b> | <b>perdida</b> | <b>anulada</b> | <b>cashout 50</b>'
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Telegram webhook error:', error)
    return NextResponse.json({ ok: true })
  }
}
