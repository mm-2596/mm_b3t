import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const CHAT_ID_MAP: Record<string, string> = (() => {
  try { return JSON.parse(process.env.TELEGRAM_CHAT_ID_MAP || '{}') }
  catch { return {} }
})()

const LEAGUES: Array<{ name: string; slug: string }> = [
  { name: 'Liga EA Sports',   slug: 'esp.1' },
  { name: 'Premier League',   slug: 'eng.1' },
  { name: 'Champions League', slug: 'uefa.champions' },
  { name: 'Serie A',          slug: 'ita.1' },
  { name: 'Bundesliga',       slug: 'ger.1' },
  { name: 'Copa del Rey',     slug: 'esp.copa_del_rey' },
  { name: 'Nations League',   slug: 'uefa.nations' },
]

async function sendMsg(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

interface Match { home: string; away: string; time: string; league: string }

async function fetchLeagueMatches(slug: string, name: string, date: string): Promise<Match[]> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${date}`,
      { cache: 'no-store' }
    )
    const data = await res.json()
    if (!Array.isArray(data.events)) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.events as any[]).slice(0, 6).map((e: any) => {
      const competitors = e.competitions?.[0]?.competitors || []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const home = competitors.find((c: any) => c.homeAway === 'home')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const away = competitors.find((c: any) => c.homeAway === 'away')
      const utcDate = e.competitions?.[0]?.date || e.date
      const time = new Date(utcDate).toLocaleTimeString('es-ES', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
      })
      return {
        home: home?.team?.shortDisplayName || home?.team?.displayName || '?',
        away: away?.team?.shortDisplayName || away?.team?.displayName || '?',
        time,
        league: name,
      }
    })
  } catch { return [] }
}

interface Recommendation {
  match: string
  competition: string
  pick: string
  pick_label: string
  odds_min: number
  probability: number
  confidence: string
  reasoning: string
}

async function getRecommendation(matches: Match[], date: string): Promise<Recommendation | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key || !matches.length) return null

  const list = matches.map(m =>
    `- ${m.league}: ${m.home} vs ${m.away} (${m.time})`
  ).join('\n')

  const prompt =
    `Eres un analista experto en apuestas de fútbol. Hoy es ${date}.\n\n` +
    `Partidos disponibles:\n${list}\n\n` +
    `Tarea: analiza estos partidos y elige UN solo pick con el mayor valor esperado.\n` +
    `Requisitos:\n` +
    `- Cuota mínima 1.75 (en Winamax o Bet365)\n` +
    `- Elige entre: resultado (1/X/2), goles (+/-2.5, +/-1.5), o BTTS Sí/No\n` +
    `- Prioriza picks con alta confianza y ventaja real sobre la prob. implícita\n\n` +
    `Responde SOLO con JSON válido:\n` +
    `{"match":"Team A vs Team B","competition":"Liga EA Sports","pick":"1","pick_label":"Team A gana","odds_min":1.85,"probability":0.62,"confidence":"alta|media|baja","reasoning":"máx 20 palabras"}`

  try {
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' })
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const jsonMatch = text.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.match || !parsed.pick) return null
    return parsed
  } catch { return null }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date()
  const dateStr = today.toISOString().split('T')[0].replace(/-/g, '')
  const dateLabel = today.toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid',
  })

  // Fetch all leagues in parallel
  const allMatches = (await Promise.all(
    LEAGUES.map(l => fetchLeagueMatches(l.slug, l.name, dateStr))
  )).flat()

  if (!allMatches.length) {
    for (const chatId of Object.keys(CHAT_ID_MAP)) {
      await sendMsg(chatId,
        `🌅 <b>Recomendación del día — ${dateLabel}</b>\n\n` +
        `📭 Sin partidos hoy en las ligas monitorizadas.`
      )
    }
    return NextResponse.json({ ok: true, matches: 0 })
  }

  const rec = await getRecommendation(allMatches, today.toISOString().split('T')[0])

  for (const chatId of Object.keys(CHAT_ID_MAP)) {
    if (!rec) {
      await sendMsg(chatId,
        `🌅 <b>Recomendación del día — ${dateLabel}</b>\n\n` +
        `⚠️ No encontré un pick con suficiente valor hoy. Día de descanso 💤`
      )
      continue
    }

    const impliedProb = (1 / rec.odds_min) * 100
    const estProb = rec.probability * 100
    const edge = estProb - impliedProb
    const confEmoji: Record<string, string> = { alta: '🟢', media: '🟡', baja: '🔴' }
    const conf = confEmoji[rec.confidence] || '🟡'

    await sendMsg(chatId,
      `🌅 <b>Recomendación del día</b>\n` +
      `📅 ${dateLabel}\n\n` +
      `📋 <b>${rec.match}</b>\n` +
      `🏆 ${rec.competition}\n` +
      `🎯 <b>${rec.pick_label}</b> (${rec.pick})\n\n` +
      `Cuota mínima: <b>@${rec.odds_min}</b> — Winamax / Bet365\n` +
      `Prob. estimada: <b>${estProb.toFixed(0)}%</b>  ${conf} confianza ${rec.confidence}\n` +
      `Prob. implícita: ${impliedProb.toFixed(1)}%\n` +
      `📈 Ventaja: <b>${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%</b>\n\n` +
      `💬 <i>${rec.reasoning}</i>\n\n` +
      `⚠️ <i>Apuesta responsable — máx. 1-2 unidades</i>`
    )
  }

  return NextResponse.json({ ok: true, matches: allMatches.length, recommendation: rec?.match || null })
}
