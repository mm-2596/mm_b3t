import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
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

async function sendTelegramMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

async function getTelegramFile(fileId: string): Promise<Buffer> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`)
  const data = await res.json()
  const filePath = data.result.file_path
  const fileRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`)
  return Buffer.from(await fileRes.arrayBuffer())
}

async function parseBetFromImage(imageBase64: string): Promise<Record<string, string> | null> {
  const prompt = `Analiza esta captura de apuesta deportiva y devuelve SOLO un JSON con estos campos:
{"match":"Equipo A vs Equipo B","pick":"tipo de apuesta","odds":1.85,"bookmaker":"Bet365","sport":"Fútbol","competition":"La Liga","units":1,"stake":null}

Reglas:
- match: nombre del partido
- pick: la selección apostada
- odds: cuota decimal (número)
- bookmaker: Bet365, Winamax, William Hill u otro
- sport: deporte
- competition: liga/torneo o null
- units: unidades si aparecen, si no 1
- stake: importe en euros si aparece, si no null
Responde SOLO el JSON, sin texto extra.`

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ],
      }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Groq error ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  const text: string = data.choices?.[0]?.message?.content || ''
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) return JSON.parse(jsonMatch[0])
  } catch { /* parse failed */ }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLastPendingBet(supabase: any, userId: string) {
  const { data } = await supabase
    .from('bets').select('*').eq('user_id', userId).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1).single()
  return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getUserSettings(supabase: any, userId: string) {
  const { data } = await supabase.from('settings').select('*').eq('user_id', userId).single()
  return data
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const message = body.message || body.edited_message
    if (!message) return NextResponse.json({ ok: true })

    const chatId: number = message.chat.id
    const userId = CHAT_ID_MAP[String(chatId)]

    if (!userId) {
      await sendTelegramMessage(chatId, '⚠️ Tu cuenta de Telegram no está vinculada.')
      return NextResponse.json({ ok: true })
    }

    const supabase = getSupabaseAdmin()
    const rawText: string = (message.text || '').trim()
    const textLower = rawText.toLowerCase()

    // ── /start /help ──────────────────────────────────────────────
    if (message.text && (textLower === '/start' || textLower === '/help')) {
      await sendTelegramMessage(chatId,
        '🎯 <b>mm_b3t Bot</b>\n\n' +
        '📸 Envía una <b>captura de pantalla</b> de tu apuesta y la registro automáticamente.\n\n' +
        'Luego actualiza el resultado:\n' +
        '• <b>ganada</b> ✅\n• <b>perdida</b> ❌\n• <b>anulada</b> ↩️\n• <b>cashout 50</b> 💸\n\n' +
        'Comandos:\n• <b>/pendientes</b> — apuestas pendientes\n• <b>/ultima</b> — última apuesta'
      )
      return NextResponse.json({ ok: true })
    }

    // ── /pendientes ───────────────────────────────────────────────
    if (message.text && textLower === '/pendientes') {
      const { data: bets } = await supabase
        .from('bets').select('*').eq('user_id', userId).eq('status', 'pending')
        .order('created_at', { ascending: false }).limit(5)

      if (!bets?.length) {
        await sendTelegramMessage(chatId, '✅ No tienes apuestas pendientes.')
      } else {
        const list = bets.map((b: any, i: number) =>
          `${i + 1}. <b>${b.match}</b>\n   ${b.pick} @ ${b.odds} | €${b.stake} (${b.units}u) — ${b.bookmaker}`
        ).join('\n\n')
        await sendTelegramMessage(chatId, `📋 <b>Apuestas pendientes:</b>\n\n${list}`)
      }
      return NextResponse.json({ ok: true })
    }

    // ── /ultima ───────────────────────────────────────────────────
    if (message.text && textLower === '/ultima') {
      const { data: bet } = await supabase
        .from('bets').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(1).single()

      if (!bet) {
        await sendTelegramMessage(chatId, 'No hay apuestas registradas aún.')
      } else {
        const e: Record<string, string> = { pending: '⏳', won: '✅', lost: '❌', void: '↩️', cashout: '💸' }
        await sendTelegramMessage(chatId,
          `${e[bet.status] || '?'} <b>${bet.match}</b>\n${bet.pick} @ ${bet.odds}\n€${bet.stake} (${bet.units}u) — ${bet.bookmaker}\nEstado: <b>${bet.status}</b>`
        )
      }
      return NextResponse.json({ ok: true })
    }

    // ── Settle commands ───────────────────────────────────────────
    if (message.text) {
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
          await sendTelegramMessage(chatId, '💸 Indica el importe: <b>cashout 45.50</b>')
          return NextResponse.json({ ok: true })
        }
      }

      if (newStatus) {
        const pendingBet = await getLastPendingBet(supabase, userId)
        if (!pendingBet) {
          await sendTelegramMessage(chatId, '⚠️ No hay apuestas pendientes para actualizar.')
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

        await sendTelegramMessage(chatId,
          `${e[newStatus]} <b>${pendingBet.match}</b> actualizada\nEstado: <b>${newStatus}</b>${profitText ? ` | ${profitText}` : ''}`
        )
        return NextResponse.json({ ok: true })
      }

      // Unrecognized text
      await sendTelegramMessage(chatId,
        '📸 Envía una captura de tu apuesta, o usa:\n<b>ganada</b> | <b>perdida</b> | <b>anulada</b> | <b>cashout 50</b>'
      )
      return NextResponse.json({ ok: true })
    }

    // ── Photo message ─────────────────────────────────────────────
    if (message.photo) {
      await sendTelegramMessage(chatId, '🔍 Analizando tu apuesta...')

      let bet: Record<string, string> | null = null
      try {
        const photos: Array<{ file_id: string }> = message.photo
        const bestPhoto = photos[photos.length - 1]
        const imageBuffer = await getTelegramFile(bestPhoto.file_id)
        bet = await parseBetFromImage(imageBuffer.toString('base64'))
      } catch (err) {
        await sendTelegramMessage(chatId, `❌ Error: ${err instanceof Error ? err.message : String(err)}`)
        return NextResponse.json({ ok: true })
      }

      if (!bet) {
        await sendTelegramMessage(chatId, '❌ No pude leer la apuesta. Intenta con una imagen más clara.')
        return NextResponse.json({ ok: true })
      }

      const units = parseFloat(String(bet.units)) || 1
      const odds = parseFloat(String(bet.odds)) || 1.0
      let stake = bet.stake && bet.stake !== 'null' ? parseFloat(String(bet.stake)) : null
      if (!stake) {
        const settings = await getUserSettings(supabase, userId)
        stake = units * (settings?.unit_value || 10)
      }

      const today = new Date().toISOString().split('T')[0]
      const { error } = await supabase.from('bets').insert({
        user_id: userId, date: today,
        sport: bet.sport || 'Fútbol', competition: bet.competition || '',
        match: bet.match || 'Partido desconocido', pick: bet.pick || '',
        bookmaker: bet.bookmaker || 'Bet365', odds, units, stake,
        status: 'pending', result_amount: null, notes: message.caption || null,
      })

      if (error) {
        await sendTelegramMessage(chatId, '❌ Error al guardar. Inténtalo de nuevo.')
        return NextResponse.json({ ok: true })
      }

      await sendTelegramMessage(chatId,
        `✅ <b>Apuesta registrada</b>\n\n🏆 <b>${bet.match}</b>\n📌 ${bet.pick}\n📊 Cuota: <b>${odds}</b>\n🏦 ${bet.bookmaker}\n💰 €${stake.toFixed(2)} (${units}u)\n\nCuando sepas el resultado:\n<b>ganada</b> ✅ | <b>perdida</b> ❌ | <b>anulada</b> ↩️ | <b>cashout 50</b> 💸`
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Telegram webhook error:', error)
    return NextResponse.json({ ok: true })
  }
}
