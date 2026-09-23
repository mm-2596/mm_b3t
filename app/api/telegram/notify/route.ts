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

  for (const [chatId, userId] of Object.entries(CHAT_ID_MAP)) {
    const { data: bets } = await supabase
      .from('bets').select('*').eq('user_id', userId).eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (!bets?.length) continue

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = bets.map((b: any, i: number) => {
      const name = b.match !== 'Apuesta' ? b.match : `${b.pick} @ ${b.odds}`
      return `${i + 1}. <b>${name}</b> — ${b.bookmaker} | €${b.stake}`
    }).join('\n')

    await sendMsg(chatId,
      `⏳ Tienes <b>${bets.length}</b> apuesta${bets.length > 1 ? 's' : ''} pendiente${bets.length > 1 ? 's' : ''}:\n\n${list}\n\n` +
      `¿Ya tienes resultados? Escribe <b>ganada</b>, <b>perdida</b>, <b>anulada</b> o <b>cashout 50</b>`
    )
  }

  return NextResponse.json({ ok: true, notified: Object.keys(CHAT_ID_MAP).length })
}
