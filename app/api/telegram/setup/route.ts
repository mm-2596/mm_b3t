import { NextRequest, NextResponse } from 'next/server'

// GET /api/telegram/setup?secret=<TELEGRAM_SETUP_SECRET>
// Registers the webhook with Telegram. Run once after deploying.
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret')
  if (secret !== process.env.TELEGRAM_SETUP_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://mm-b3t.vercel.app'
  const webhookUrl = `${appUrl}/api/telegram`

  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message'] }),
    }
  )
  const data = await res.json()

  return NextResponse.json({ webhookUrl, telegram: data })
}
