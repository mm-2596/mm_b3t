import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const CHAT_ID_MAP: Record<string, string> = (() => {
  try { return JSON.parse(process.env.TELEGRAM_CHAT_ID_MAP || '{}') }
  catch { return {} }
})()

// Reverse map: userId → chatId
const USER_TO_CHAT: Record<string, string> = Object.fromEntries(
  Object.entries(CHAT_ID_MAP).map(([chat, user]) => [user, chat])
)

async function sendMsg(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

async function isMatchCompleted(leagueSlug: string, eventId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/summary?event=${eventId}`,
      { cache: 'no-store' }
    )
    const data = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (data.header?.competitions as any[])?.[0]?.status
    return status?.type?.completed === true || status?.type?.name === 'STATUS_FINAL'
  } catch { return false }
}

// Called by Vercel Cron every 2 hours
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const notified: string[] = []
  const reminded: string[] = []

  for (const [chatId, userId] of Object.entries(CHAT_ID_MAP)) {
    // ── 1. Auto-notify: pending bets with ESPN event_id where match is done ──
    const { data: withEvent } = await supabase
      .from('bets').select('*')
      .eq('user_id', userId).eq('status', 'pending')
      .not('event_id', 'is', null)

    if (withEvent?.length) {
      const completed = []
      for (const bet of withEvent) {
        if (await isMatchCompleted(bet.league_slug, bet.event_id)) {
          completed.push(bet)
        }
      }
      if (completed.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = completed.map((b: any) => {
          const name = b.match !== 'Apuesta' ? b.match : `${b.pick} @ ${b.odds}`
          return `• <b>${name}</b> @ ${b.odds} — €${b.stake}`
        }).join('\n')
        await sendMsg(chatId,
          `⚽ <b>¡Partido terminado!</b> Tienes ${completed.length} apuesta${completed.length > 1 ? 's' : ''} por liquidar:\n\n` +
          list +
          `\n\nEscribe <b>ganada</b> · <b>perdida</b> · <b>anulada</b> · <b>cashout 50</b>`
        )
        notified.push(userId)
      }
    }

    // ── 2. Reminder: pending bets older than 24h without event_id ────────────
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: stale } = await supabase
      .from('bets').select('*')
      .eq('user_id', userId).eq('status', 'pending')
      .is('event_id', null)
      .lt('created_at', cutoff)

    if (stale?.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = stale.map((b: any) => {
        const name = b.match !== 'Apuesta' ? b.match : `${b.pick} @ ${b.odds}`
        return `• <b>${name}</b> @ ${b.odds} — €${b.stake} (${b.date})`
      }).join('\n')
      await sendMsg(chatId,
        `⏰ <b>Recordatorio</b> — Tienes ${stale.length} apuesta${stale.length > 1 ? 's' : ''} pendiente${stale.length > 1 ? 's' : ''} de más de 24h:\n\n` +
        list +
        `\n\nEscribe <b>ganada</b> · <b>perdida</b> · <b>anulada</b> · <b>cashout 50</b>`
      )
      reminded.push(userId)
    }
  }

  return NextResponse.json({ ok: true, notified, reminded })
}
