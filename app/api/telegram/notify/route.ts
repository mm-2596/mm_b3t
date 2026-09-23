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

    const messages: string[] = []

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pend  = todayBets.filter((b: any) => b.status === 'pending')

      const settled = [...won, ...lost, ...voids, ...co]
      const pl = settled.reduce((sum: number, b: any) => sum + (b.result_amount ?? 0), 0)
      const plText = pl >= 0 ? `+€${pl.toFixed(2)}` : `-€${Math.abs(pl).toFixed(2)}`

      messages.push(
        `📊 <b>Balance de hoy</b>\n\n` +
        `✅ Ganadas: <b>${won.length}</b>   ❌ Perdidas: <b>${lost.length}</b>   ↩️ Anuladas: <b>${voids.length}</b>${co.length ? `   💸 Cashout: ${co.length}` : ''}\n` +
        `⏳ Pendientes hoy: <b>${pend.length}</b>\n` +
        `💰 P&L del día: <b>${settled.length ? plText : '—'}</b>`
      )
    }

    // ── Pending bets reminder ────────────────────────────────────────────
    if (pendingBets?.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = pendingBets.map((b: any, i: number) => {
        const name = b.match !== 'Apuesta' ? b.match : `${b.pick} @ ${b.odds}`
        const age = b.date !== today ? ` <i>(${b.date})</i>` : ''
        return `${i + 1}. <b>${name}</b>${age} — ${b.bookmaker} | €${b.stake}`
      }).join('\n')

      messages.push(
        `⏳ <b>${pendingBets.length} apuesta${pendingBets.length > 1 ? 's' : ''} pendiente${pendingBets.length > 1 ? 's' : ''}</b>:\n\n${list}\n\n` +
        `Escribe <b>ganada</b>, <b>perdida</b>, <b>anulada</b> o <b>cashout 50</b>`
      )
    } else if (!todayBets?.length) {
      messages.push(`✅ <b>Sin pendientes</b> — todo al día 👌`)
    }

    await sendMsg(chatId, messages.join('\n\n──────────────\n\n'))
  }

  return NextResponse.json({ ok: true, notified: Object.keys(CHAT_ID_MAP).length })
}
