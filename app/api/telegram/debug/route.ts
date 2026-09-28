import { NextRequest, NextResponse } from 'next/server'

const APIFOOTBALL_KEY = process.env.APIFOOTBALL_KEY || ''

const LEAGUE_MAP: Record<string, number> = {
  'Liga EA Sports':   140,
  'Premier League':   39,
  'Serie A':          135,
  'Bundesliga':       78,
  'Champions League': 2,
  'Copa del Rey':     556,
  'Nations League':   5,
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const comp = searchParams.get('comp') || 'Nations League'
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0]
  const now = new Date()
  const season = (now.getMonth() + 1) >= 7 ? now.getFullYear() : now.getFullYear() - 1
  const leagueId = LEAGUE_MAP[comp]

  if (!APIFOOTBALL_KEY) {
    return NextResponse.json({ error: 'APIFOOTBALL_KEY not set' })
  }

  const url = `https://v3.football.api-sports.io/fixtures?date=${date}&league=${leagueId}&season=${season}`

  try {
    const res = await fetch(url, {
      headers: { 'x-apisports-key': APIFOOTBALL_KEY },
    })
    const data = await res.json()
    return NextResponse.json({
      debug: { comp, date, season, leagueId, url, keySet: !!APIFOOTBALL_KEY },
      response: data,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) })
  }
}
