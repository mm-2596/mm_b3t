import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Maps chatId → userId (reverse of CHAT_ID_MAP)
const CHAT_ID_MAP: Record<string, string> = (() => {
  try { return JSON.parse(process.env.TELEGRAM_CHAT_ID_MAP || '{}') }
  catch { return {} }
})()

async function sendMsg(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

// Called daily by Vercel Cron at 19:00 UTC
export async function GET(request: NextRequest) {
  // Vercel Cron passes this header for security
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const today = new Date().toISOString().split('T')[0]

  for (const [chatId, userId] of Object.entries(CHAT_ID_MAP)) {
    // All bets from today
    const { data: todayBets } = await supabase
      .from('bets').select('*').eq('user_id', userId).eq('date', today)

    // All pending bets (any date)
    const { data: pendingBets } = await supabase
      .from('bets').select('*').eq('user_id', userId).eq('status', 'pending')
      .order('created_at', { ascending: false })

    const parts: string[] = []

    // ── Header ───────────────────────────────────────────────────────────
    parts.push(`🎯 <b>Win &amp; Dine — Resumen nocturno</b>`)

    // ── Daily balance ────────────────────────────────────────────────────
    if (todayBets?.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const won   = todayBets.filter((b: any) => b.status === 'won')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lost  = todayBets.filter((b: any) => b.status === 'lost')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const voids = todayBets.filter((b: any) => b.status === 'void')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const co    = todayBets.filter((b: any) => b.status === 'cashout')
      const settled = [...won, ...lost, ...voids, ...co]
      const pl = settled.reduce((sum: number, b: any) => sum + (b.result_amount ?? 0), 0)
      const plText = pl >= 0 ? `+€${pl.toFixed(2)}` : `-€${Math.abs(pl).toFixed(2)}`

      const bits = [`✅ ${won.length} ganadas`, `❌ ${lost.length} perdidas`]
      if (co.length) bits.push(`💸 ${co.length} cashout`)
      if (voids.length) bits.push(`↩️ ${voids.length} anuladas`)

      parts.push(
        `📊 <b>Apuestas de hoy:</b>\n` +
        bits.join(' · ') + `\n` +
        `P&L del día: <b>${settled.length ? plText : '—'}</b>`
      )
    }

    // ── Pending bets reminder ────────────────────────────────────────────
    if (pendingBets?.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = pendingBets.map((b: any, i: number) => {
        const name = b.pick !== 'Múltiples' ? b.pick : (b.competition || b.match)
        const dateTag = b.date !== today ? ` <i>(${b.date})</i>` : ' <i>(hoy)</i>'
        return `${i + 1}. ${name} @ ${b.odds}${dateTag} — ${b.bookmaker}`
      }).join('\n')

      parts.push(
        `⚠️ <b>${pendingBets.length} apuesta${pendingBets.length > 1 ? 's' : ''} sin verificar:</b>\n\n` +
        list + `\n\nLiquídalas antes de dormir 👆\n` +
        `Escribe <b>ganada</b> · <b>perdida</b> · <b>anulada</b> · <b>cashout 50</b>`
      )
    } else {
      parts.push(`Sin apuestas pendientes.\nTodo registrado y al día ✅\n\nBuenas noches 🌙`)
    }

    await sendMsg(chatId, parts.join('\n\n'))
  }

  return NextResponse.json({ ok: true, notified: Object.keys(CHAT_ID_MAP).length })
}
