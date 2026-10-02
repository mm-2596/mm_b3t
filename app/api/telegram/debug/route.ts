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
  const eventId = searchParams.get('event')

  // ?event=ID&slug=esp.1 → inspect lineup for a specific match
  if (eventId) {
    const slug = searchParams.get('slug') || 'uefa.nations'
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${eventId}`
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const data = await res.json()
      // Extract useful lineup info
      const rosters = data.rosters
      const rosterSummary = Array.isArray(rosters)
        ? rosters.map((r: any) => ({
            team: r.team?.shortDisplayName || r.team?.displayName,
            rosterCount: r.roster?.length,
            // Show first 3 players with all their fields to inspect structure
            samplePlayers: (r.roster || []).slice(0, 3).map((p: any) => ({
              displayName: p.athlete?.displayName,
              shortName: p.athlete?.shortName,
              starter: p.starter,
              position: p.position?.abbreviation,
              active: p.active,
              subbedIn: p.subbedIn,
              // raw keys to see what's available
              playerKeys: Object.keys(p),
            })),
          }))
        : null
      return NextResponse.json({
        debug: { eventId, slug, url },
        hasRosters: Array.isArray(rosters),
        rostersLength: rosters?.length,
        rosterSummary,
        topLevelKeys: Object.keys(data),
      })
    } catch (err) {
      return NextResponse.json({ error: String(err) })
    }
  }

  // Default: scoreboard for a competition + date
  const comp = searchParams.get('comp') || 'Nations League'
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0].replace(/-/g, '')
  const slug = LEAGUE_MAP[comp]
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${date}`

  try {
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json()
    // Also extract event IDs to make lineup debugging easier
    const events = (data.events || []).map((e: any) => ({
      id: e.id,
      name: e.name,
      date: e.date,
    }))
    return NextResponse.json({ debug: { comp, date, slug, url }, events, response: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) })
  }
}
