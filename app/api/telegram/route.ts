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

// ── Keyboards ─────────────────────────────────────────────────────────────────
// State flows through callback_data:
//   bk:{bk} → pk:{pick}|{bk} → od:{odds}|{pick}|{bk} → st:{stake}|{pick}|{bk}|{odds} → cf:{bk}|{odds}|{stake}|{pick}

const BOOKMAKERS = ['Bet365', 'Winamax', 'William Hill', 'Bwin', 'Betfair', 'Otro']
const COMMON_ODDS = ['1.30', '1.50', '1.70', '1.85', '2.00', '2.25', '2.50', '3.00']
const COMMON_STAKES = ['5', '10', '20', '30', '40', '50', '75', '100']

function bookmakersKb() {
  return {
    inline_keyboard: [
      BOOKMAKERS.slice(0, 3).map(b => ({ text: b, callback_data: `bk:${b}` })),
      BOOKMAKERS.slice(3).map(b => ({ text: b, callback_data: `bk:${b}` })),
    ],
  }
}

function pickKb(bk: string) {
  const picks = ['1', 'X', '2', '1X', 'X2', 'Over 2.5', 'Under 2.5', 'BTTS Sí', 'BTTS No', 'Handicap']
  return {
    inline_keyboard: [
      picks.slice(0, 5).map(p => ({ text: p, callback_data: `pk:${p}|${bk}` })),
      picks.slice(5, 8).map(p => ({ text: p, callback_data: `pk:${p}|${bk}` })),
      picks.slice(8).map(p => ({ text: p, callback_data: `pk:${p}|${bk}` })),
      [{ text: '✏️ Otro pick', callback_data: `pk_c:${bk}` }],
    ],
  }
}

function oddsKb(pick: string, bk: string) {
  const rows = []
  for (let i = 0; i < COMMON_ODDS.length; i += 4) {
    rows.push(COMMON_ODDS.slice(i, i + 4).map(o => ({
      text: o,
      callback_data: `od:${o}|${pick}|${bk}`,
    })))
  }
  rows.push([{ text: '✏️ Otra cuota', callback_data: `od_c:${pick}|${bk}` }])
  return { inline_keyboard: rows }
}

function stakeKb(pick: string, bk: string, odds: string) {
  const rows = []
  for (let i = 0; i < COMMON_STAKES.length; i += 4) {
    rows.push(COMMON_STAKES.slice(i, i + 4).map(s => ({
      text: `${s}€`,
      callback_data: `st:${s}|${pick}|${bk}|${odds}`,
    })))
  }
  rows.push([{ text: '✏️ Otro importe', callback_data: `st_c:${pick}|${bk}|${odds}` }])
  return { inline_keyboard: rows }
}

function confirmKb(bk: string, odds: string, stake: string, pick: string) {
  return {
    inline_keyboard: [[
      { text: '✅ Confirmar', callback_data: `cf:${bk}|${odds}|${stake}|${pick}` },
      { text: '❌ Cancelar', callback_data: 'cancel' },
    ]],
  }
}

function summaryText(bk: string, pick: string, odds: number, stake: number, units: number) {
  const profit = stake * (odds - 1)
  return (
    `📋 <b>Resumen</b>\n\n` +
    `🏦 ${bk}\n` +
    `📌 Pick: <b>${pick}</b>\n` +
    `📊 Cuota: <b>${odds}</b>\n` +
    `💵 Apostado: <b>€${stake.toFixed(2)}</b> (${units}u)\n` +
    `💰 Ganarías: <b>+€${profit.toFixed(2)}</b>`
  )
}

// ── Session helpers ───────────────────────────────────────────────────────────
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
  } catch { /* graceful */ }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function clearSession(supabase: any, chatId: number) {
  try { await supabase.from('bot_sessions').delete().eq('chat_id', chatId) }
  catch { /* graceful */ }
}

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

      // Step 1: bookmaker → pick
      if (cbData.startsWith('bk:')) {
        const bk = cbData.slice(3)
        await editMsg(chatId, messageId,
          `🏦 <b>${bk}</b>\n\n¿Cuál es tu <b>pick</b>?`,
          pickKb(bk)
        )
        return NextResponse.json({ ok: true })
      }

      // Step 2: pick → odds
      if (cbData.startsWith('pk:')) {
        const [pick, bk] = cbData.slice(3).split('|')
        await editMsg(chatId, messageId,
          `🏦 <b>${bk}</b> | Pick: <b>${pick}</b>\n\n¿Cuál es la <b>cuota</b>?`,
          oddsKb(pick, bk)
        )
        return NextResponse.json({ ok: true })
      }

      // Custom pick input
      if (cbData.startsWith('pk_c:')) {
        const bk = cbData.slice(5)
        await setSession(supabase, chatId, 'typing_pick', { bk })
        await editMsg(chatId, messageId,
          `🏦 <b>${bk}</b>\n\n✏️ Escribe tu pick (ej: <code>Córners Over 9.5</code>):`
        )
        return NextResponse.json({ ok: true })
      }

      // Step 3: odds → stake
      if (cbData.startsWith('od:')) {
        const [odds, pick, bk] = cbData.slice(3).split('|')
        await editMsg(chatId, messageId,
          `🏦 <b>${bk}</b> | ${pick} @ <b>${odds}</b>\n\n¿Cuánto <b>dinero</b> apuestas?`,
          stakeKb(pick, bk, odds)
        )
        return NextResponse.json({ ok: true })
      }

      // Custom odds input
      if (cbData.startsWith('od_c:')) {
        const [pick, bk] = cbData.slice(5).split('|')
        await setSession(supabase, chatId, 'typing_odds', { pick, bk })
        await editMsg(chatId, messageId,
          `🏦 <b>${bk}</b> | Pick: <b>${pick}</b>\n\n✏️ Escribe la cuota (ej: <code>1.75</code>):`
        )
        return NextResponse.json({ ok: true })
      }

      // Step 4: stake → summary + confirm
      if (cbData.startsWith('st:')) {
        const [stakeStr, pick, bk, oddsStr] = cbData.slice(3).split('|')
        const odds = parseFloat(oddsStr)
        const stake = parseFloat(stakeStr)
        const settings = await getUserSettings(supabase, userId)
        const unitValue = settings?.unit_value || 10
        const units = Math.round((stake / unitValue) * 100) / 100
        await editMsg(chatId, messageId,
          summaryText(bk, pick, odds, stake, units),
          confirmKb(bk, oddsStr, stakeStr, pick)
        )
        return NextResponse.json({ ok: true })
      }

      // Custom stake input
      if (cbData.startsWith('st_c:')) {
        const [pick, bk, odds] = cbData.slice(5).split('|')
        await setSession(supabase, chatId, 'typing_stake', { pick, bk, odds })
        await editMsg(chatId, messageId,
          `🏦 <b>${bk}</b> | ${pick} @ <b>${odds}</b>\n\n✏️ Escribe el importe en euros (ej: <code>25</code>):`
        )
        return NextResponse.json({ ok: true })
      }

      // Step 5: confirm → register, then ask for match name
      if (cbData.startsWith('cf:')) {
        const [bk, oddsStr, stakeStr, pick] = cbData.slice(3).split('|')
        const odds = parseFloat(oddsStr)
        const stake = parseFloat(stakeStr)
        const settings = await getUserSettings(supabase, userId)
        const unitValue = settings?.unit_value || 10
        const units = Math.round((stake / unitValue) * 100) / 100
        const profit = stake * (odds - 1)
        const today = new Date().toISOString().split('T')[0]

        const { data: inserted, error } = await supabase.from('bets').insert({
          user_id: userId, date: today,
          sport: 'Fútbol', competition: '',
          match: 'Apuesta', pick,
          bookmaker: bk, odds, units, stake,
          status: 'pending', result_amount: null, notes: null,
        }).select('id').single()

        if (error) {
          await editMsg(chatId, messageId, `❌ Error al guardar: ${error.message}`)
          return NextResponse.json({ ok: true })
        }

        // Store bet id to update match name
        await setSession(supabase, chatId, 'typing_match', { betId: inserted.id })

        await editMsg(chatId, messageId,
          `✅ <b>¡Registrada!</b> ${bk} | ${pick} @ ${odds} | €${stake.toFixed(2)} (${units}u) → <b>+€${profit.toFixed(2)}</b>\n\n` +
          `📝 ¿Cuál es el <b>partido</b>? Escribe el nombre o toca Saltar:`
        )
        await sendMsg(chatId, '¿Nombre del partido?', {
          inline_keyboard: [[{ text: '⏭️ Saltar', callback_data: 'skip_match' }]],
        })
        return NextResponse.json({ ok: true })
      }

      // Skip match name
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
          `${i + 1}. <b>${b.match}</b> — ${b.pick} @ ${b.odds} | €${b.stake} (${b.units}u) — ${b.bookmaker}`
        ).join('\n\n')
        await sendMsg(chatId, `📋 <b>Pendientes:</b>\n\n${list}`)
      }
      return NextResponse.json({ ok: true })
    }

    if (textLower === '/ultima') {
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

    // ── Photo → start registration ────────────────────────────────────────
    if (message.photo) {
      await sendMsg(chatId, '📸 ¿En qué <b>casa de apuestas</b>?', bookmakersKb())
      return NextResponse.json({ ok: true })
    }

    // ── Text ──────────────────────────────────────────────────────────────
    if (message.text) {
      const session = await getSession(supabase, chatId)

      // Custom pick
      if (session?.step === 'typing_pick') {
        const { bk } = session.data as { bk: string }
        await clearSession(supabase, chatId)
        await sendMsg(chatId,
          `🏦 <b>${bk}</b> | Pick: <b>${rawText}</b>\n\n¿Cuál es la <b>cuota</b>?`,
          oddsKb(rawText, bk)
        )
        return NextResponse.json({ ok: true })
      }

      // Custom odds
      if (session?.step === 'typing_odds') {
        const odds = parseFloat(rawText.replace(',', '.'))
        if (isNaN(odds) || odds < 1.01 || odds > 100) {
          await sendMsg(chatId, '❌ Cuota inválida. Ej: <code>1.75</code>')
          return NextResponse.json({ ok: true })
        }
        const { pick, bk } = session.data as { pick: string; bk: string }
        await clearSession(supabase, chatId)
        await sendMsg(chatId,
          `🏦 <b>${bk}</b> | ${pick} @ <b>${odds}</b>\n\n¿Cuánto <b>dinero</b> apuestas?`,
          stakeKb(pick, bk, String(odds))
        )
        return NextResponse.json({ ok: true })
      }

      // Custom stake
      if (session?.step === 'typing_stake') {
        const stake = parseFloat(rawText.replace(',', '.'))
        if (isNaN(stake) || stake <= 0) {
          await sendMsg(chatId, '❌ Importe inválido. Ej: <code>25</code>')
          return NextResponse.json({ ok: true })
        }
        const { pick, bk, odds } = session.data as { pick: string; bk: string; odds: string }
        const settings = await getUserSettings(supabase, userId)
        const unitValue = settings?.unit_value || 10
        const units = Math.round((stake / unitValue) * 100) / 100
        await clearSession(supabase, chatId)
        await sendMsg(chatId,
          summaryText(bk, pick, parseFloat(odds), stake, units),
          confirmKb(bk, odds, String(stake), pick)
        )
        return NextResponse.json({ ok: true })
      }

      // Match name after registration
      if (session?.step === 'typing_match') {
        const { betId } = session.data as { betId: string }
        await supabase.from('bets').update({ match: rawText }).eq('id', betId)
        await clearSession(supabase, chatId)
        await sendMsg(chatId,
          `✅ Partido guardado: <b>${rawText}</b>\n\nCuando sepas el resultado:\n<b>ganada</b> ✅  <b>perdida</b> ❌  <b>anulada</b> ↩️  <b>cashout 50</b> 💸`
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
          `${e[newStatus]} <b>${pendingBet.match}</b> actualizada: <b>${newStatus}</b>${profitText ? ` | ${profitText}` : ''}`
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
