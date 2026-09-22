import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Telegram chat_id → Supabase user UUID mapping (set in Vercel env vars)
// Format: {"123456789":"supabase-uuid-1","987654321":"supabase-uuid-2"}
const CHAT_ID_MAP: Record<string, string> = (() => {
  try {
    return JSON.parse(process.env.TELEGRAM_CHAT_ID_MAP || '{}')
  } catch {
    return {}
  }
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
  const arrayBuffer = await fileRes.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

async function parseBetFromImage(imageBase64: string): Promise<Record<string, string> | null> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
          },
          {
            type: 'text',
            text: `Eres un asistente de apuestas. Analiza esta captura de pantalla de una apuesta deportiva y extrae la información en formato JSON.

Extrae exactamente estos campos (en español, como aparecen en la imagen):
- match: nombre del partido o enfrentamiento (ej: "Real Madrid vs Barcelona")
- pick: la apuesta realizada (ej: "1X2 - Local", "Más de 2.5 goles", "Handicap +1.5")
- odds: cuota decimal (número, ej: 1.85)
- bookmaker: casa de apuestas (Bet365, Winamax, William Hill, u otro)
- sport: deporte (Fútbol, Tenis, Baloncesto, etc.)
- competition: nombre de la liga o torneo (ej: "La Liga", "Champions League")
- units: número de unidades apostadas (si aparece, si no pon 1)
- stake: importe apostado en euros (si aparece, si no pon null)

Responde SOLO con el JSON, sin texto adicional. Si no puedes leer algún campo, usa null.
Ejemplo: {"match":"Real Madrid vs Barcelona","pick":"1X2 - Local","odds":1.85,"bookmaker":"Bet365","sport":"Fútbol","competition":"La Liga","units":1,"stake":10}`,
          },
        ],
      },
    ],
  })

  const text = response.content.find((b) => b.type === 'text')?.text || ''

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    return JSON.parse(jsonMatch[0])
  } catch {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLastPendingBet(supabase: any, userId: string) {
  const { data } = await supabase
    .from('bets')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getUserSettings(supabase: any, userId: string) {
  const { data } = await supabase
    .from('settings')
    .select('*')
    .eq('user_id', userId)
    .single()
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
      await sendTelegramMessage(
        chatId,
        '⚠️ Tu cuenta de Telegram no está vinculada. Contacta al administrador para configurar el acceso.'
      )
      return NextResponse.json({ ok: true })
    }

    const supabase = getSupabaseAdmin()

    // ── Text command ──────────────────────────────────────────────
    if (message.text) {
      const text: string = message.text.trim().toLowerCase()

      // /start or /help
      if (text === '/start' || text === '/help') {
        await sendTelegramMessage(
          chatId,
          '🎯 <b>mm_b3t Bot</b>\n\nEnvía una <b>captura de pantalla</b> de tu apuesta y la registraré automáticamente.\n\nLuego actualiza el resultado con:\n• <b>ganada</b> ✅\n• <b>perdida</b> ❌\n• <b>anulada</b> ↩️\n• <b>cashout 50</b> 💸 (indicando el importe)\n\nOtros comandos:\n• <b>/pendientes</b> — ver apuestas pendientes\n• <b>/ultima</b> — ver última apuesta'
        )
        return NextResponse.json({ ok: true })
      }

      // /pendientes
      if (text === '/pendientes') {
        const { data: bets } = await supabase
          .from('bets')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(5)

        if (!bets || bets.length === 0) {
          await sendTelegramMessage(chatId, '✅ No tienes apuestas pendientes.')
        } else {
          const list = bets
            .map(
              (b, i) =>
                `${i + 1}. <b>${b.match}</b>\n   ${b.pick} @ ${b.odds} | €${b.stake} (${b.units}u)`
            )
            .join('\n\n')
          await sendTelegramMessage(chatId, `📋 <b>Apuestas pendientes:</b>\n\n${list}`)
        }
        return NextResponse.json({ ok: true })
      }

      // /ultima
      if (text === '/ultima') {
        const { data: bet } = await supabase
          .from('bets')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (!bet) {
          await sendTelegramMessage(chatId, 'No hay apuestas registradas aún.')
        } else {
          const statusEmoji: Record<string, string> = {
            pending: '⏳', won: '✅', lost: '❌', void: '↩️', cashout: '💸',
          }
          await sendTelegramMessage(
            chatId,
            `${statusEmoji[bet.status] || '?'} <b>${bet.match}</b>\n${bet.pick} @ ${bet.odds}\n€${bet.stake} (${bet.units}u) — ${bet.bookmaker}\nEstado: <b>${bet.status}</b>`
          )
        }
        return NextResponse.json({ ok: true })
      }

      // Settle commands: ganada / perdida / anulada / cashout <amount>
      const settleMap: Record<string, string> = {
        ganada: 'won',
        gana: 'won',
        won: 'won',
        perdida: 'lost',
        pierde: 'lost',
        lost: 'lost',
        anulada: 'void',
        anulado: 'void',
        nula: 'void',
        void: 'void',
      }

      let newStatus: string | null = settleMap[text] || null
      let cashoutAmount: number | null = null

      if (!newStatus && (text.startsWith('cashout') || text.startsWith('cash out'))) {
        const parts = text.split(/\s+/)
        cashoutAmount = parts.length > 1 ? parseFloat(parts[1].replace(',', '.')) : null
        if (!isNaN(cashoutAmount as number) && cashoutAmount !== null) {
          newStatus = 'cashout'
        } else {
          await sendTelegramMessage(chatId, '💸 Indica el importe del cashout. Ej: <b>cashout 45.50</b>')
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
        if (newStatus === 'won') {
          resultAmount = pendingBet.stake * (pendingBet.odds - 1)
        } else if (newStatus === 'lost') {
          resultAmount = -pendingBet.stake
        } else if (newStatus === 'void') {
          resultAmount = 0
        } else if (newStatus === 'cashout' && cashoutAmount !== null) {
          resultAmount = cashoutAmount - pendingBet.stake
        }

        await supabase
          .from('bets')
          .update({ status: newStatus, result_amount: resultAmount })
          .eq('id', pendingBet.id)

        const emoji: Record<string, string> = { won: '✅', lost: '❌', void: '↩️', cashout: '💸' }
        const profitText =
          resultAmount !== null
            ? resultAmount >= 0
              ? `+€${resultAmount.toFixed(2)}`
              : `-€${Math.abs(resultAmount).toFixed(2)}`
            : ''

        await sendTelegramMessage(
          chatId,
          `${emoji[newStatus]} <b>${pendingBet.match}</b> actualizada\nEstado: <b>${newStatus}</b>${profitText ? ` | ${profitText}` : ''}`
        )
        return NextResponse.json({ ok: true })
      }

      // Unrecognized text
      await sendTelegramMessage(
        chatId,
        '📸 Envía una captura de pantalla de tu apuesta, o usa:\n<b>ganada</b> | <b>perdida</b> | <b>anulada</b> | <b>cashout 50</b>'
      )
      return NextResponse.json({ ok: true })
    }

    // ── Photo message ─────────────────────────────────────────────
    if (message.photo) {
      await sendTelegramMessage(chatId, '🔍 Analizando tu apuesta...')

      // Use the highest quality photo (last in array)
      const photos: Array<{ file_id: string }> = message.photo
      const bestPhoto = photos[photos.length - 1]

      const imageBuffer = await getTelegramFile(bestPhoto.file_id)
      const imageBase64 = imageBuffer.toString('base64')

      const bet = await parseBetFromImage(imageBase64)

      if (!bet) {
        await sendTelegramMessage(
          chatId,
          '❌ No pude leer la apuesta. Asegúrate de que la captura muestre claramente el partido, cuota y stake.'
        )
        return NextResponse.json({ ok: true })
      }

      // Determine stake: use parsed stake OR calculate from units * unit_value
      let stake = bet.stake ? parseFloat(String(bet.stake)) : null
      const units = bet.units ? parseFloat(String(bet.units)) : 1

      if (!stake) {
        const settings = await getUserSettings(supabase, userId)
        const unitValue = settings?.unit_value || 10
        stake = units * unitValue
      }

      const today = new Date().toISOString().split('T')[0]

      const { error } = await supabase.from('bets').insert({
        user_id: userId,
        date: today,
        sport: bet.sport || 'Fútbol',
        competition: bet.competition || '',
        match: bet.match || 'Partido desconocido',
        pick: bet.pick || '',
        bookmaker: bet.bookmaker || 'Bet365',
        odds: parseFloat(String(bet.odds)) || 1.0,
        units: units,
        stake: stake,
        status: 'pending',
        result_amount: null,
        notes: message.caption || null,
      })

      if (error) {
        console.error('Supabase insert error:', error)
        await sendTelegramMessage(chatId, '❌ Error al guardar la apuesta. Inténtalo de nuevo.')
        return NextResponse.json({ ok: true })
      }

      await sendTelegramMessage(
        chatId,
        `✅ <b>Apuesta registrada</b>\n\n🏆 <b>${bet.match}</b>\n📌 ${bet.pick}\n📊 Cuota: <b>${bet.odds}</b>\n🏦 ${bet.bookmaker}\n💰 €${stake?.toFixed(2)} (${units}u)\n\nCuando sepas el resultado:\n<b>ganada</b> ✅ | <b>perdida</b> ❌ | <b>anulada</b> ↩️ | <b>cashout 50</b> 💸`
      )
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Telegram webhook error:', error)
    return NextResponse.json({ ok: true }) // always 200 to Telegram
  }
}
