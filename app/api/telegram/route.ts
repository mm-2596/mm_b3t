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

const BOOKMAKERS = ['Bet365', 'Winamax', 'William Hill', 'Bwin', 'Betfair', 'Otro']
const COMMON_ODDS = ['1.30', '1.50', '1.70', '1.85', '2.00', '2.50', '3.00', '✏️']
const COMMON_STAKES = ['10', '20', '30', '50', '100', '✏️']

function bookmakersKb() {
  return {
    inline_keyboard: [
      BOOKMAKERS.slice(0, 3).map(b => ({ text: b, callback_data: `bk:${b}` })),
      BOOKMAKERS.slice(3).map(b => ({ text: b, callback_data: `bk:${b}` })),
    ],
  }
}

function oddsKb() {
  return {
    inline_keyboard: [
      COMMON_ODDS.slice(0, 4).map(o => ({ text: o === '✏️' ? '✏️ Otra' : o, callback_data: `od:${o}` })),
      COMMON_ODDS.slice(4).map(o => ({ text: o === '✏️' ? '✏️ Otra' : o, callback_data: `od:${o}` })),
    ],
  }
}

function stakeKb() {
  return {
    inline_keyboard: [
      COMMON_STAKES.slice(0, 3).map(s => ({ text: s === '✏️' ? '✏️ Otro' : `${s}€`, callback_data: `st:${s}` })),
      COMMON_STAKES.slice(3).map(s => ({ text: s === '✏️' ? '✏️ Otro' : `${s}€`, callback_data: `st:${s}` })),
    ],
  }
}

function confirmKb() {
  return {
    inline_keyboard: [[
      { text: '✅ Confirmar', callback_data: 'confirm' },
      { text: '❌ Cancelar', callback_data: 'cancel' },
    ]],
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSession(supabase: any, chatId: number) {
  const { data } = await supabase.from('bot_sessions').select('*').eq('chat_id', chatId).single()
  return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setSession(supabase: any, chatId: number, step: string, data: Record<string, unknown>) {
  await supabase.from('bot_sessions').upsert({
    chat_id: chatId, step, data, updated_at: new Date().toISOString(),
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function clearSession(supabase: any, chatId: number) {
  await supabase.from('bot_sessions').delete().eq('chat_id', chatId)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLastPendingBet(supabase: any, userId: string) {
  const { data } = await supabase
    .from('bets').select('*').eq('user_id', userId).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1).single()
  return data
}

function summaryText(d: Record<string, unknown>) {
  const odds = Number(d.odds)
  const stake = Number(d.stake)
  const profit = stake * (odds - 1)
  const total = stake + profit
  return (
    `📋 <b>Resumen de la apuesta</b>\n\n` +
    `🏦 ${d.bookmaker}\n` +
    `📊 Cuota: <b>${odds}</b>\n` +
    `💵 Apostado: <b>€${stake.toFixed(2)}</b>\n` +
    `💰 Ganarías: <b>+€${profit.toFixed(2)}</b>\n` +
    `🏆 Total: <b>€${total.toFixed(2)}</b>`
  )
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // ── Inline button press ───────────────────────────────────────
    if (body.callback_query) {
      const cq = body.callback_query
      const chatId: number = cq.message.chat.id
      const messageId: number = cq.message.message_id
      const cbData: string = cq.data || ''
      const userId = CHAT_ID_MAP[String(chatId)]

      await answerCQ(cq.id)
      if (!userId) return NextResponse.json({ ok: true })

      const supabase = getSupabaseAdmin()

      // Bookmaker selected → ask odds
      if (cbData.startsWith('bk:')) {
        const bookmaker = cbData.slice(3)
        await setSession(supabase, chatId, 'odds', { bookmaker })
        await editMsg(chatId, messageId,
          `🏦 <b>${bookmaker}</b>\n\n¿Cuál es la <b>cuota</b>?`,
          oddsKb()
        )
        return NextResponse.json({ ok: true })
      }

      // Odds selected
      if (cbData.startsWith('od:')) {
        const val = cbData.slice(3)
        const session = await getSession(supabase, chatId)
        if (!session) return NextResponse.json({ ok: true })

        if (val === '✏️') {
          await setSession(supabase, chatId, 'typing_odds', session.data)
          await editMsg(chatId, messageId,
            `🏦 <b>${session.data.bookmaker}</b>\n\n✏️ Escribe la cuota (ej: <code>1.75</code>):`
          )
          return NextResponse.json({ ok: true })
        }

        const odds = parseFloat(val)
        await setSession(supabase, chatId, 'stake', { ...session.data, odds })
        await editMsg(chatId, messageId,
          `🏦 <b>${session.data.bookmaker}</b> | Cuota: <b>${odds}</b>\n\n¿Cuánto <b>dinero</b> apuestas?`,
          stakeKb()
        )
        return NextResponse.json({ ok: true })
      }

      // Stake selected
      if (cbData.startsWith('st:')) {
        const val = cbData.slice(3)
        const session = await getSession(supabase, chatId)
        if (!session) return NextResponse.json({ ok: true })

        if (val === '✏️') {
          await setSession(supabase, chatId, 'typing_stake', session.data)
          await editMsg(chatId, messageId,
            `🏦 <b>${session.data.bookmaker}</b> | Cuota: <b>${session.data.odds}</b>\n\n✏️ Escribe el importe en euros (ej: <code>25</code>):`
          )
          return NextResponse.json({ ok: true })
        }

        const stake = parseFloat(val)
        const finalData = { ...session.data, stake }
        await setSession(supabase, chatId, 'confirm', finalData)
        await editMsg(chatId, messageId, summaryText(finalData as Record<string, unknown>), confirmKb())
        return NextResponse.json({ ok: true })
      }

      // Confirm → register bet
      if (cbData === 'confirm') {
        const session = await getSession(supabase, chatId)
        if (!session) return NextResponse.json({ ok: true })

        const { bookmaker, odds, stake } = session.data as Record<string, unknown>
        const stakeNum = Number(stake)
        const oddsNum = Number(odds)
        const profit = stakeNum * (oddsNum - 1)
        const today = new Date().toISOString().split('T')[0]

        const { error } = await supabase.from('bets').insert({
          user_id: userId, date: today,
          sport: 'Fútbol', competition: '',
          match: 'Apuesta', pick: '',
          bookmaker, odds: oddsNum,
          units: 1, stake: stakeNum,
          status: 'pending', result_amount: null, notes: null,
        })

        await clearSession(supabase, chatId)

        if (error) {
          await editMsg(chatId, messageId, '❌ Error al guardar. Inténtalo de nuevo.')
        } else {
          await editMsg(chatId, messageId,
            `✅ <b>Registrada</b> | ${bookmaker} @ ${oddsNum} | €${stakeNum.toFixed(2)} → +€${profit.toFixed(2)}\n\n` +
            `<b>ganada</b> ✅  <b>perdida</b> ❌  <b>anulada</b> ↩️  <b>cashout 50</b> 💸`
          )
        }
        return NextResponse.json({ ok: true })
      }

      // Cancel
      if (cbData === 'cancel') {
        const supabase2 = getSupabaseAdmin()
        await clearSession(supabase2, chatId)
        await editMsg(chatId, messageId, '❌ Apuesta cancelada.')
        return NextResponse.json({ ok: true })
      }

      return NextResponse.json({ ok: true })
    }

    // ── Regular message ───────────────────────────────────────────
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

    // ── /start /help ──────────────────────────────────────────────
    if (textLower === '/start' || textLower === '/help') {
      await sendMsg(chatId,
        '🎯 <b>mm_b3t Bot</b>\n\n' +
        '📸 Envía una <b>foto</b> de tu apuesta para registrarla.\n\n' +
        'Resultado:\n• <b>ganada</b> ✅\n• <b>perdida</b> ❌\n• <b>anulada</b> ↩️\n• <b>cashout 50</b> 💸\n\n' +
        'Comandos:\n• <b>/pendientes</b> — apuestas pendientes\n• <b>/ultima</b> — última apuesta'
      )
      return NextResponse.json({ ok: true })
    }

    // ── /pendientes ───────────────────────────────────────────────
    if (textLower === '/pendientes') {
      const { data: bets } = await supabase
        .from('bets').select('*').eq('user_id', userId).eq('status', 'pending')
        .order('created_at', { ascending: false }).limit(5)

      if (!bets?.length) {
        await sendMsg(chatId, '✅ No tienes apuestas pendientes.')
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = bets.map((b: any, i: number) =>
          `${i + 1}. <b>${b.match}</b>\n   ${b.pick || '—'} @ ${b.odds} | €${b.stake} — ${b.bookmaker}`
        ).join('\n\n')
        await sendMsg(chatId, `📋 <b>Apuestas pendientes:</b>\n\n${list}`)
      }
      return NextResponse.json({ ok: true })
    }

    // ── /ultima ───────────────────────────────────────────────────
    if (textLower === '/ultima') {
      const { data: bet } = await supabase
        .from('bets').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(1).single()

      if (!bet) {
        await sendMsg(chatId, 'No hay apuestas registradas aún.')
      } else {
        const e: Record<string, string> = { pending: '⏳', won: '✅', lost: '❌', void: '↩️', cashout: '💸' }
        await sendMsg(chatId,
          `${e[bet.status] || '?'} ${bet.pick || 'Apuesta'} @ ${bet.odds}\n€${bet.stake} — ${bet.bookmaker}\nEstado: <b>${bet.status}</b>`
        )
      }
      return NextResponse.json({ ok: true })
    }

    // ── Photo → start registration ────────────────────────────────
    if (message.photo) {
      await clearSession(supabase, chatId)
      await sendMsg(chatId, '📸 ¡Foto recibida! ¿En qué <b>casa de apuestas</b>?', bookmakersKb())
      return NextResponse.json({ ok: true })
    }

    // ── Text ──────────────────────────────────────────────────────
    if (message.text) {
      const session = await getSession(supabase, chatId)

      // Typing custom odds
      if (session?.step === 'typing_odds') {
        const odds = parseFloat(rawText.replace(',', '.'))
        if (isNaN(odds) || odds < 1.01 || odds > 100) {
          await sendMsg(chatId, '❌ Cuota inválida. Escribe un número como <code>1.75</code>')
          return NextResponse.json({ ok: true })
        }
        await setSession(supabase, chatId, 'stake', { ...session.data, odds })
        await sendMsg(chatId,
          `🏦 <b>${session.data.bookmaker}</b> | Cuota: <b>${odds}</b>\n\n¿Cuánto <b>dinero</b> apuestas?`,
          stakeKb()
        )
        return NextResponse.json({ ok: true })
      }

      // Typing custom stake
      if (session?.step === 'typing_stake') {
        const stake = parseFloat(rawText.replace(',', '.'))
        if (isNaN(stake) || stake <= 0) {
          await sendMsg(chatId, '❌ Importe inválido. Escribe un número como <code>25</code>')
          return NextResponse.json({ ok: true })
        }
        const finalData = { ...session.data, stake }
        await setSession(supabase, chatId, 'confirm', finalData)
        await sendMsg(chatId, summaryText(finalData as Record<string, unknown>), confirmKb())
        return NextResponse.json({ ok: true })
      }

      // ── Settle commands ───────────────────────────────────────
      const settleMap: Record<string, string> = {
        ganada: 'won', gana: 'won', won: 'won',
        perdida: 'lost', pierde: 'lost', lost: 'lost',
        anulada: 'void', anulado: 'void', nula: 'void', void: 'void',
      }
      let newStatus: string | null = settleMap[textLower] || null
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
          await sendMsg(chatId, '⚠️ No hay apuestas pendientes para actualizar.')
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
          `${e[newStatus]} Última apuesta actualizada: <b>${newStatus}</b>${profitText ? ` | ${profitText}` : ''}`
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
