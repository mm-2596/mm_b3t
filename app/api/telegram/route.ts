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

// ── Keyboard builders ─────────────────────────────────────────────────────────
// State is encoded entirely in callback_data — no database needed for button flow
// Format: od:{odds}|{bookmaker}  /  st:{stake}|{bookmaker}|{odds}  /  cf:{bookmaker}|{odds}|{stake}

const BOOKMAKERS = ['Bet365', 'Winamax', 'William Hill', 'Bwin', 'Betfair', 'Otro']
const COMMON_ODDS = ['1.30', '1.50', '1.70', '1.85', '2.00', '2.25', '2.50', '3.00']
const COMMON_STAKES = ['10', '20', '30', '40', '50', '75', '100', '150']

function bookmakersKb() {
  return {
    inline_keyboard: [
      BOOKMAKERS.slice(0, 3).map(b => ({ text: b, callback_data: `bk:${b}` })),
      BOOKMAKERS.slice(3).map(b => ({ text: b, callback_data: `bk:${b}` })),
    ],
  }
}

function oddsKb(bookmaker: string) {
  const rows = []
  for (let i = 0; i < COMMON_ODDS.length; i += 4) {
    rows.push(COMMON_ODDS.slice(i, i + 4).map(o => ({
      text: o,
      callback_data: `od:${o}|${bookmaker}`,
    })))
  }
  rows.push([{ text: '✏️ Otra cuota', callback_data: `od_c:${bookmaker}` }])
  return { inline_keyboard: rows }
}

function stakeKb(bookmaker: string, odds: string) {
  const rows = []
  for (let i = 0; i < COMMON_STAKES.length; i += 4) {
    rows.push(COMMON_STAKES.slice(i, i + 4).map(s => ({
      text: `${s}€`,
      callback_data: `st:${s}|${bookmaker}|${odds}`,
    })))
  }
  rows.push([{ text: '✏️ Otro importe', callback_data: `st_c:${bookmaker}|${odds}` }])
  return { inline_keyboard: rows }
}

function confirmKb(bookmaker: string, odds: string, stake: string) {
  return {
    inline_keyboard: [[
      { text: '✅ Confirmar', callback_data: `cf:${bookmaker}|${odds}|${stake}` },
      { text: '❌ Cancelar', callback_data: 'cancel' },
    ]],
  }
}

function summaryText(bookmaker: string, odds: number, stake: number) {
  const profit = stake * (odds - 1)
  const total = stake + profit
  return (
    `📋 <b>Resumen</b>\n\n` +
    `🏦 ${bookmaker}\n` +
    `📊 Cuota: <b>${odds}</b>\n` +
    `💵 Apostado: <b>€${stake.toFixed(2)}</b>\n` +
    `💰 Ganarías: <b>+€${profit.toFixed(2)}</b>\n` +
    `🏆 Total cobras: <b>€${total.toFixed(2)}</b>`
  )
}

// ── Session helpers (only needed for ✏️ custom values) ───────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSession(supabase: any, chatId: number) {
  try {
    const { data } = await supabase.from('bot_sessions').select('*').eq('chat_id', chatId).single()
    return data
  } catch { return null }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setSession(supabase: any, chatId: number, step: string, data: Record<string, unknown>) {
  try {
    await supabase.from('bot_sessions').upsert({
      chat_id: chatId, step, data, updated_at: new Date().toISOString(),
    })
  } catch { /* graceful — bot_sessions optional */ }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function clearSession(supabase: any, chatId: number) {
  try {
    await supabase.from('bot_sessions').delete().eq('chat_id', chatId)
  } catch { /* graceful */ }
}

// ── Last pending bet ──────────────────────────────────────────────────────────
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

    // ── Inline button press ───────────────────────────────────────────────────
    if (body.callback_query) {
      const cq = body.callback_query
      const chatId: number = cq.message.chat.id
      const messageId: number = cq.message.message_id
      const cbData: string = cq.data || ''
      const userId = CHAT_ID_MAP[String(chatId)]

      await answerCQ(cq.id)
      if (!userId) return NextResponse.json({ ok: true })

      const supabase = getSupabaseAdmin()

      // ── Step 1: bookmaker selected → show odds ──────────────────────────
      if (cbData.startsWith('bk:')) {
        const bookmaker = cbData.slice(3)
        await editMsg(chatId, messageId,
          `🏦 <b>${bookmaker}</b>\n\n¿Cuál es la <b>cuota</b>?`,
          oddsKb(bookmaker)
        )
        return NextResponse.json({ ok: true })
      }

      // ── Step 2: odds selected → show stakes ────────────────────────────
      if (cbData.startsWith('od:')) {
        const [oddsStr, bookmaker] = cbData.slice(3).split('|')
        const odds = parseFloat(oddsStr)
        await editMsg(chatId, messageId,
          `🏦 <b>${bookmaker}</b> | Cuota: <b>${odds}</b>\n\n¿Cuánto <b>dinero</b> apuestas?`,
          stakeKb(bookmaker, oddsStr)
        )
        return NextResponse.json({ ok: true })
      }

      // ── Step 3: stake selected → show summary + confirm ────────────────
      if (cbData.startsWith('st:')) {
        const [stakeStr, bookmaker, oddsStr] = cbData.slice(3).split('|')
        const odds = parseFloat(oddsStr)
        const stake = parseFloat(stakeStr)
        await editMsg(chatId, messageId,
          summaryText(bookmaker, odds, stake),
          confirmKb(bookmaker, oddsStr, stakeStr)
        )
        return NextResponse.json({ ok: true })
      }

      // ── Step 4: confirm → register bet ────────────────────────────────
      if (cbData.startsWith('cf:')) {
        const [bookmaker, oddsStr, stakeStr] = cbData.slice(3).split('|')
        const odds = parseFloat(oddsStr)
        const stake = parseFloat(stakeStr)
        const profit = stake * (odds - 1)
        const today = new Date().toISOString().split('T')[0]

        const { error } = await supabase.from('bets').insert({
          user_id: userId, date: today,
          sport: 'Fútbol', competition: '',
          match: 'Apuesta', pick: '',
          bookmaker, odds, units: 1, stake,
          status: 'pending', result_amount: null, notes: null,
        })

        if (error) {
          await editMsg(chatId, messageId, `❌ Error al guardar: ${error.message}`)
        } else {
          await editMsg(chatId, messageId,
            `✅ <b>¡Registrada!</b>\n\n` +
            `🏦 ${bookmaker} @ <b>${odds}</b>\n` +
            `💵 €${stake.toFixed(2)} apostado → <b>+€${profit.toFixed(2)}</b> si gana\n\n` +
            `Cuando sepas el resultado:\n<b>ganada</b> ✅  <b>perdida</b> ❌  <b>anulada</b> ↩️  <b>cashout 50</b> 💸`
          )
        }
        return NextResponse.json({ ok: true })
      }

      // ── Cancel ────────────────────────────────────────────────────────
      if (cbData === 'cancel') {
        await clearSession(supabase, chatId)
        await editMsg(chatId, messageId, '❌ Cancelado.')
        return NextResponse.json({ ok: true })
      }

      // ── Custom odds input (from bot_sessions) ─────────────────────────
      if (cbData.startsWith('od_c:')) {
        const bookmaker = cbData.slice(5)
        await setSession(supabase, chatId, 'typing_odds', { bookmaker })
        await editMsg(chatId, messageId,
          `🏦 <b>${bookmaker}</b>\n\n✏️ Escribe la cuota (ej: <code>1.75</code>):`
        )
        return NextResponse.json({ ok: true })
      }

      // ── Custom stake input (from bot_sessions) ────────────────────────
      if (cbData.startsWith('st_c:')) {
        const [bookmaker, oddsStr] = cbData.slice(5).split('|')
        await setSession(supabase, chatId, 'typing_stake', { bookmaker, odds: oddsStr })
        await editMsg(chatId, messageId,
          `🏦 <b>${bookmaker}</b> | Cuota: <b>${oddsStr}</b>\n\n✏️ Escribe el importe en euros (ej: <code>25</code>):`
        )
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

    if (textLower === '/start' || textLower === '/help') {
      await sendMsg(chatId,
        '🎯 <b>mm_b3t Bot</b>\n\n' +
        '📸 Envía una <b>foto</b> de tu apuesta para registrarla.\n\n' +
        'Resultado:\n• <b>ganada</b> ✅\n• <b>perdida</b> ❌\n• <b>anulada</b> ↩️\n• <b>cashout 50</b> 💸\n\n' +
        'Comandos:\n• <b>/pendientes</b>\n• <b>/ultima</b>'
      )
      return NextResponse.json({ ok: true })
    }

    if (textLower === '/pendientes') {
      const { data: bets } = await supabase
        .from('bets').select('*').eq('user_id', userId).eq('status', 'pending')
        .order('created_at', { ascending: false }).limit(5)
      if (!bets?.length) {
        await sendMsg(chatId, '✅ No tienes apuestas pendientes.')
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = bets.map((b: any, i: number) =>
          `${i + 1}. ${b.bookmaker} @ ${b.odds} | €${b.stake}`
        ).join('\n')
        await sendMsg(chatId, `📋 <b>Pendientes:</b>\n\n${list}`)
      }
      return NextResponse.json({ ok: true })
    }

    if (textLower === '/ultima') {
      const { data: bet } = await supabase
        .from('bets').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(1).single()
      if (!bet) {
        await sendMsg(chatId, 'No hay apuestas registradas aún.')
      } else {
        const e: Record<string, string> = { pending: '⏳', won: '✅', lost: '❌', void: '↩️', cashout: '💸' }
        await sendMsg(chatId,
          `${e[bet.status] || '?'} ${bet.bookmaker} @ ${bet.odds} | €${bet.stake}\nEstado: <b>${bet.status}</b>`
        )
      }
      return NextResponse.json({ ok: true })
    }

    // ── Photo → start registration ────────────────────────────────────────
    if (message.photo) {
      await sendMsg(chatId, '📸 ¿En qué <b>casa de apuestas</b>?', bookmakersKb())
      return NextResponse.json({ ok: true })
    }

    // ── Text ──────────────────────────────────────────────────────────────
    if (message.text) {
      const session = await getSession(supabase, chatId)

      if (session?.step === 'typing_odds') {
        const odds = parseFloat(rawText.replace(',', '.'))
        if (isNaN(odds) || odds < 1.01 || odds > 100) {
          await sendMsg(chatId, '❌ Cuota inválida. Ej: <code>1.75</code>')
          return NextResponse.json({ ok: true })
        }
        const { bookmaker } = session.data as { bookmaker: string }
        const oddsStr = String(odds)
        await clearSession(supabase, chatId)
        await sendMsg(chatId,
          `🏦 <b>${bookmaker}</b> | Cuota: <b>${odds}</b>\n\n¿Cuánto <b>dinero</b> apuestas?`,
          stakeKb(bookmaker, oddsStr)
        )
        return NextResponse.json({ ok: true })
      }

      if (session?.step === 'typing_stake') {
        const stake = parseFloat(rawText.replace(',', '.'))
        if (isNaN(stake) || stake <= 0) {
          await sendMsg(chatId, '❌ Importe inválido. Ej: <code>25</code>')
          return NextResponse.json({ ok: true })
        }
        const { bookmaker, odds } = session.data as { bookmaker: string; odds: string }
        await clearSession(supabase, chatId)
        await sendMsg(chatId,
          summaryText(bookmaker, parseFloat(odds), stake),
          confirmKb(bookmaker, odds, String(stake))
        )
        return NextResponse.json({ ok: true })
      }

      // ── Settle commands ───────────────────────────────────────────────
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
          `${e[newStatus]} Última apuesta: <b>${newStatus}</b>${profitText ? ` | ${profitText}` : ''}`
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
