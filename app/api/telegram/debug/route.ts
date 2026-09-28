import { NextRequest, NextResponse } from 'next/server'

const LEAGUE_MAP: Record<string, string> = {
  'Liga EA Sports':   'esp.1',
  'Premier League':   'eng.1',
  'Serie A':          'ita.1',
  'Bundesliga':       'ger.1',
  'Champions League': 'uefa.champions',
  'Copa del Rey':     'esp.copa_del_rey',
  'Nations League':   'uefa.nations',
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const comp = searchParams.get('comp') || 'Nations League'
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0].replace(/-/g, '')
  const slug = LEAGUE_MAP[comp]
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${date}`

  try {
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json()
    return NextResponse.json({ debug: { comp, date, slug, url }, response: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) })
  }
}
