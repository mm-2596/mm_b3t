import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const CHAT_ID_MAP: Record<string, string> = (() => {
  try { return JSON.parse(process.env.TELEGRAM_CHAT_ID_MAP || '{}') }
  catch { return {} }
})()

// ─── ESPN leagues (for AI-only recommendation) ───────────────────────────────

const LEAGUES: Array<{ name: string; slug: string }> = [
  { name: 'Liga EA Sports',   slug: 'esp.1' },
  { name: 'Premier League',   slug: 'eng.1' },
  { name: 'Champions League', slug: 'uefa.champions' },
  { name: 'Serie A',          slug: 'ita.1' },
  { name: 'Bundesliga',       slug: 'ger.1' },
  { name: 'Copa del Rey',       slug: 'esp.copa_del_rey' },
  { name: 'Nations League',     slug: 'uefa.nations' },
  { name: 'Europa League',      slug: 'uefa.europa' },
  { name: 'Conference League',  slug: 'uefa.europa.conf' },
]

// ─── The Odds API sports keys ─────────────────────────────────────────────────

const ODDS_SPORTS = [
  'soccer_spain_la_liga',
  'soccer_epl',
  'soccer_uefa_champs_league',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_spain_copa_del_rey',
  'soccer_uefa_nations_league',
  'soccer_uefa_europa_league',
  'soccer_uefa_europa_conference_league',
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface Match { home: string; away: string; time: string; league: string }

interface OddsOutcome { name: string; price: number }
interface OddsMarket { key: string; outcomes: OddsOutcome[] }
interface OddsBookmaker { key: string; title: string; markets: OddsMarket[] }
interface OddsMatch {
  id: string
  sport_key: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: OddsBookmaker[]
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

interface ValueRecommendation {
  match: string
  pick: string
  pick_label: string
  real_odds: number
  bookmaker: string
  estimated_prob: number
  implied_prob: number
  edge: number
  confidence: string
  reasoning: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mainMenuKb() {
  return {
    inline_keyboard: [
      [{ text: '➕ Nueva apuesta', callback_data: 'menu:nueva' }, { text: '⏳ Pendientes', callback_data: 'menu:pendientes' }],
      [{ text: '📊 Resumen hoy', callback_data: 'menu:resumen' }, { text: '📅 Historial', callback_data: 'menu:historial' }],
      [{ text: '🛠️ Gestionar', callback_data: 'menu:gestionar' }, { text: '🔔 Últimas 5', callback_data: 'menu:ultimas' }],
      [{ text: '🔍 Analizar valor', callback_data: 'menu:valor' }],
    ],
  }
}

async function sendMsg(chatId: string, text: string, withMenu = false) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...(withMenu ? { reply_markup: mainMenuKb() } : {}),
    }),
  })
}

// ─── ESPN fixtures ────────────────────────────────────────────────────────────

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

// ─── The Odds API fixtures ────────────────────────────────────────────────────

async function fetchOddsApiMatches(todayStr: string): Promise<OddsMatch[]> {
  const key = process.env.ODDS_API_KEY
  if (!key) return []

  const allMatches: OddsMatch[] = []

  await Promise.all(
    ODDS_SPORTS.map(async (sport) => {
      try {
        const res = await fetch(
          `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${key}&regions=eu&markets=h2h&bookmakers=bet365,unibet,bwin`,
          { cache: 'no-store' }
        )
        if (!res.ok) return
        const data: OddsMatch[] = await res.json()
        const filtered = data.filter(m => m.commence_time.startsWith(todayStr))
        allMatches.push(...filtered)
      } catch { /* skip this sport */ }
    })
  )

  return allMatches
}

// ─── Football-Data.org: form enrichment ──────────────────────────────────────

const FD_COMPETITIONS = ['PD', 'PL', 'CL', 'SA', 'BL1', 'FL1', 'DED']
const FD_COMP_NAMES: Record<string, string> = {
  PD: 'Liga EA Sports', PL: 'Premier League', CL: 'Champions League',
  SA: 'Serie A', BL1: 'Bundesliga', FL1: 'Ligue 1', DED: 'Eredivisie',
}

interface EnrichedMatch extends Match {
  homeForm?: string
  awayForm?: string
  homeId?: number
  awayId?: number
}

async function fetchTeamForm(teamId: number, fdKey: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=5`,
      { headers: { 'X-Auth-Token': fdKey }, cache: 'no-store' }
    )
    if (!res.ok) return ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matches: any[] = data.matches || []
    if (!matches.length) return ''
    let goals = 0
    const results = matches.map(m => {
      const isHome = m.homeTeam.id === teamId
      const scored = isHome ? m.score.fullTime.home : m.score.fullTime.away
      const conceded = isHome ? m.score.fullTime.away : m.score.fullTime.home
      goals += scored ?? 0
      if (scored == null || conceded == null) return '?'
      if (scored > conceded) return 'V'
      if (scored < conceded) return 'D'
      return 'E'
    }).reverse()
    const avg = (goals / matches.length).toFixed(1)
    return `${results.join('-')} (${avg}gls/p)`
  } catch { return '' }
}

async function fetchEnrichedMatches(dateStr: string): Promise<EnrichedMatch[]> {
  const fdKey = process.env.FOOTBALL_DATA_API_KEY
  if (!fdKey) return []

  const allMatches: EnrichedMatch[] = []

  await Promise.all(FD_COMPETITIONS.map(async (comp) => {
    try {
      const res = await fetch(
        `https://api.football-data.org/v4/competitions/${comp}/matches?dateFrom=${dateStr}&dateTo=${dateStr}`,
        { headers: { 'X-Auth-Token': fdKey }, cache: 'no-store' }
      )
      if (!res.ok) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const m of (data.matches || []) as any[]) {
        allMatches.push({
          home: m.homeTeam.shortName || m.homeTeam.name,
          away: m.awayTeam.shortName || m.awayTeam.name,
          time: new Date(m.utcDate).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }),
          league: FD_COMP_NAMES[comp] || comp,
          homeId: m.homeTeam.id,
          awayId: m.awayTeam.id,
        })
      }
    } catch { /* skip */ }
  }))

  // Fetch form for each team in parallel (max 8 matches to stay within rate limits)
  const toEnrich = allMatches.slice(0, 8)
  await Promise.all(toEnrich.map(async (m) => {
    const [hf, af] = await Promise.all([
      m.homeId ? fetchTeamForm(m.homeId, fdKey) : Promise.resolve(''),
      m.awayId ? fetchTeamForm(m.awayId, fdKey) : Promise.resolve(''),
    ])
    m.homeForm = hf
    m.awayForm = af
  }))

  return allMatches
}

// ─── Gemini: AI-only recommendation ──────────────────────────────────────────

async function getAIRecommendation(espnMatches: Match[], enrichedMatches: EnrichedMatch[], date: string): Promise<Recommendation | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null

  // Build match list: enriched matches first (with form), then ESPN-only matches
  const enrichedNames = new Set(enrichedMatches.map(m => `${m.home}${m.away}`))
  const espnOnly = espnMatches.filter(m => !enrichedNames.has(`${m.home}${m.away}`))

  const enrichedList = enrichedMatches.map(m => {
    let line = `- ${m.league}: ${m.home} vs ${m.away} (${m.time})`
    if (m.homeForm || m.awayForm) {
      line += `\n  Forma: ${m.home} [${m.homeForm || 'N/D'}] | ${m.away} [${m.awayForm || 'N/D'}]`
    }
    return line
  }).join('\n')

  const espnList = espnOnly.map(m =>
    `- ${m.league}: ${m.home} vs ${m.away} (${m.time})`
  ).join('\n')

  const allList = [enrichedList, espnList].filter(Boolean).join('\n')
  if (!allList) return null

  const prompt =
    `Eres un analista experto en apuestas de fútbol. Hoy es ${date}.\n\n` +
    `Partidos disponibles (los que tienen "Forma" incluyen últimos 5 resultados reales V=Victoria E=Empate D=Derrota):\n${allList}\n\n` +
    `Tarea: analiza estos partidos y elige UN solo pick con el mayor valor esperado.\n` +
    `Requisitos:\n` +
    `- Cuota mínima 1.75 (en Winamax o Bet365)\n` +
    `- Elige entre: resultado (1/X/2), goles (+/-2.5, +/-1.5), o BTTS Sí/No\n` +
    `- Prioriza partidos con datos de forma real cuando estén disponibles\n` +
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

// ─── Gemini: value from real odds ─────────────────────────────────────────────

async function getValueFromOdds(matches: OddsMatch[]): Promise<ValueRecommendation | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key || !matches.length) return null

  // Build best-odds table per match
  const matchLines = matches.slice(0, 20).map(m => {
    const best: Record<string, { price: number; bm: string }> = {}
    for (const bm of m.bookmakers) {
      const h2h = bm.markets.find(mk => mk.key === 'h2h')
      if (!h2h) continue
      for (const outcome of h2h.outcomes) {
        if (!best[outcome.name] || outcome.price > best[outcome.name].price) {
          best[outcome.name] = { price: outcome.price, bm: bm.title }
        }
      }
    }
    const h = best[m.home_team]
    const d = best['Draw']
    const a = best[m.away_team]
    const hStr = h ? `${h.price}(${h.bm})` : 'N/A'
    const dStr = d ? `${d.price}(${d.bm})` : 'N/A'
    const aStr = a ? `${a.price}(${a.bm})` : 'N/A'
    return `${m.home_team} vs ${m.away_team}: 1=${hStr} X=${dStr} 2=${aStr}`
  }).join('\n')

  const prompt =
    `Eres un analista de value betting. Aquí están los partidos de hoy con cuotas reales (1X2) de casas europeas:\n\n` +
    `${matchLines}\n\n` +
    `Tarea: encuentra el pick con MAYOR ventaja real (prob. estimada > prob. implícita de la cuota).\n` +
    `Requisitos: cuota ≥ 1.75, solo picks que genuinamente tengan valor.\n\n` +
    `Responde SOLO con JSON válido:\n` +
    `{"match":"Team A vs Team B","pick":"1","pick_label":"Team A gana","real_odds":2.10,"bookmaker":"Bet365","estimated_prob":0.58,"confidence":"alta|media|baja","reasoning":"máx 20 palabras"}`

  try {
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' })
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const jsonMatch = text.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.match || !parsed.pick || !parsed.real_odds) return null

    const impliedProb = 1 / parsed.real_odds
    const edge = parsed.estimated_prob - impliedProb

    return { ...parsed, implied_prob: impliedProb, edge }
  } catch { return null }
}

// ─── Gemini: La Liga specific recommendation ──────────────────────────────────

async function getLaLigaRecommendation(
  enrichedMatches: EnrichedMatch[],
  oddsMatches: OddsMatch[],
): Promise<ValueRecommendation | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null

  // Filter La Liga matches from enriched (form data) and odds
  const laLigaEnriched = enrichedMatches.filter(m => m.league === 'Liga EA Sports')
  const laLigaOdds = oddsMatches.filter(m => m.sport_key === 'soccer_spain_la_liga')

  if (!laLigaEnriched.length && !laLigaOdds.length) return null

  // Build form lines
  const formLines = laLigaEnriched.map(m => {
    let line = `${m.home} vs ${m.away} (${m.time})`
    if (m.homeForm || m.awayForm) {
      line += `\n  Forma: ${m.home} [${m.homeForm || 'N/D'}] | ${m.away} [${m.awayForm || 'N/D'}]`
    }
    return line
  }).join('\n')

  // Build odds lines
  const oddsLines = laLigaOdds.map(m => {
    const best: Record<string, { price: number; bm: string }> = {}
    for (const bm of m.bookmakers) {
      const h2h = bm.markets.find(mk => mk.key === 'h2h')
      if (!h2h) continue
      for (const out of h2h.outcomes) {
        if (!best[out.name] || out.price > best[out.name].price)
          best[out.name] = { price: out.price, bm: bm.title }
      }
    }
    const h = best[m.home_team], d = best['Draw'], a = best[m.away_team]
    return `${m.home_team} vs ${m.away_team}: 1=${h ? `${h.price}(${h.bm})` : 'N/A'} X=${d ? `${d.price}(${d.bm})` : 'N/A'} 2=${a ? `${a.price}(${a.bm})` : 'N/A'}`
  }).join('\n')

  if (!formLines && !oddsLines) return null

  const prompt =
    `Eres un analista experto en La Liga EA Sports española.\n\n` +
    (formLines ? `Partidos de hoy con forma reciente (V=Victoria E=Empate D=Derrota):\n${formLines}\n\n` : '') +
    (oddsLines ? `Cuotas reales disponibles:\n${oddsLines}\n\n` : '') +
    `Tarea: elige el pick con MAYOR valor esperado de La Liga de hoy.\n` +
    `Requisitos: cuota ≥ 1.75, solo picks con ventaja real. Usa la forma reciente y las cuotas para fundamentar.\n\n` +
    `Responde SOLO con JSON válido:\n` +
    `{"match":"Team A vs Team B","pick":"1","pick_label":"Team A gana","real_odds":2.10,"bookmaker":"Bet365","estimated_prob":0.58,"implied_prob":0.476,"edge":0.104,"confidence":"alta|media|baja","reasoning":"máx 20 palabras"}`

  try {
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' })
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const jsonMatch = text.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.match || !parsed.pick || !parsed.real_odds) return null
    const impliedProb = parsed.implied_prob ?? 1 / parsed.real_odds
    const edge = parsed.edge ?? parsed.estimated_prob - impliedProb
    return { ...parsed, implied_prob: impliedProb, edge }
  } catch { return null }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date()
  const dateStr = today.toISOString().split('T')[0]
  const dateISO8601 = dateStr.replace(/-/g, '')
  const dateLabel = today.toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid',
  })

  // Fetch all data in parallel
  const [espnMatches, oddsMatches, enrichedMatches] = await Promise.all([
    Promise.all(LEAGUES.map(l => fetchLeagueMatches(l.slug, l.name, dateISO8601))).then(r => r.flat()),
    fetchOddsApiMatches(dateStr),
    fetchEnrichedMatches(dateStr),
  ])

  // Run all analyses in parallel
  const [aiRec, valueRec, laLigaRec] = await Promise.all([
    getAIRecommendation(espnMatches, enrichedMatches, dateStr),
    getValueFromOdds(oddsMatches),
    getLaLigaRecommendation(enrichedMatches, oddsMatches),
  ])

  const confEmoji: Record<string, string> = { alta: '🟢', media: '🟡', baja: '🔴' }

  const hasAI = !!aiRec
  const hasValue = !!valueRec
  const hasOddsApi = !!process.env.ODDS_API_KEY

  for (const chatId of Object.keys(CHAT_ID_MAP)) {
    if (!hasAI && !hasValue) {
      await sendMsg(chatId,
        `🌅 <b>Recomendación del día — ${dateLabel}</b>\n\n` +
        `⚠️ No encontré picks con suficiente valor hoy. Día de descanso 💤`,
        true
      )
      continue
    }

    const lines: string[] = [
      `🌅 <b>Recomendación del día</b>`,
      `📅 ${dateLabel}`,
    ]

    // ── Sección 1: IA pura ──
    lines.push(`\n━━━━━━━━━━━━━━━━━━`)
    lines.push(`🤖 <b>ANÁLISIS IA</b>`)
    lines.push(`━━━━━━━━━━━━━━━━━━`)

    if (aiRec) {
      const impliedProb = (1 / aiRec.odds_min) * 100
      const estProb = aiRec.probability * 100
      const edge = estProb - impliedProb
      const conf = confEmoji[aiRec.confidence] || '🟡'
      const hasRealData = enrichedMatches.length > 0
      const dataTag = hasRealData
        ? `📊 <i>Análisis con datos reales de forma</i>`
        : `⚠️ <i>Sin datos reales hoy (Europa/Conference League) — fiabilidad reducida</i>`

      lines.push(
        `📋 <b>${aiRec.match}</b>`,
        `🏆 ${aiRec.competition}`,
        `🎯 <b>${aiRec.pick_label}</b> (${aiRec.pick})`,
        ``,
        `Cuota estimada: <b>@${aiRec.odds_min}</b>`,
        `Prob. estimada: <b>${estProb.toFixed(0)}%</b>  ${conf} confianza ${aiRec.confidence}`,
        `Prob. implícita: ${impliedProb.toFixed(1)}%`,
        `📈 Ventaja estimada: <b>${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%</b>`,
        `💬 <i>${aiRec.reasoning}</i>`,
        dataTag,
      )
    } else {
      lines.push(`⚠️ Sin recomendación IA hoy`)
    }

    // ── Sección 2: Cuotas reales ──
    lines.push(`\n━━━━━━━━━━━━━━━━━━`)
    lines.push(`📊 <b>RECOMENDACIÓN THE ODDS API</b>`)
    lines.push(`━━━━━━━━━━━━━━━━━━`)

    if (!hasOddsApi) {
      lines.push(`ℹ️ <i>Añade ODDS_API_KEY para ver cuotas reales</i>`)
    } else if (valueRec) {
      const conf = confEmoji[valueRec.confidence] || '🟡'
      const edgeSign = valueRec.edge >= 0 ? '+' : ''

      lines.push(
        `📋 <b>${valueRec.match}</b>`,
        `🎯 <b>${valueRec.pick_label}</b> (${valueRec.pick})`,
        ``,
        `Cuota real: <b>@${valueRec.real_odds}</b> — ${valueRec.bookmaker}`,
        `Prob. implícita: ${(valueRec.implied_prob * 100).toFixed(1)}%`,
        `Prob. estimada IA: <b>${(valueRec.estimated_prob * 100).toFixed(0)}%</b>  ${conf} ${valueRec.confidence}`,
        `📈 Ventaja real: <b>${edgeSign}${(valueRec.edge * 100).toFixed(1)}%</b>`,
        `💬 <i>${valueRec.reasoning}</i>`,
      )
    } else {
      lines.push(`⚠️ Sin picks de valor con cuotas reales hoy`)
    }

    // ── Sección 3: La Liga específica (solo si hay partidos) ──
    if (laLigaRec) {
      const conf = confEmoji[laLigaRec.confidence] || '🟡'
      const edgeSign = laLigaRec.edge >= 0 ? '+' : ''
      lines.push(`\n━━━━━━━━━━━━━━━━━━`)
      lines.push(`🇪🇸 <b>PICK LA LIGA EA SPORTS</b>`)
      lines.push(`━━━━━━━━━━━━━━━━━━`)
      lines.push(
        `📋 <b>${laLigaRec.match}</b>`,
        `🎯 <b>${laLigaRec.pick_label}</b> (${laLigaRec.pick})`,
        ``,
        `Cuota real: <b>@${laLigaRec.real_odds}</b> — ${laLigaRec.bookmaker}`,
        `Prob. implícita: ${(laLigaRec.implied_prob * 100).toFixed(1)}%`,
        `Prob. estimada IA: <b>${(laLigaRec.estimated_prob * 100).toFixed(0)}%</b>  ${conf} ${laLigaRec.confidence}`,
        `📈 Ventaja real: <b>${edgeSign}${(laLigaRec.edge * 100).toFixed(1)}%</b>`,
        `💬 <i>${laLigaRec.reasoning}</i>`,
        `📊 <i>Con forma real + cuotas reales</i>`,
      )
    }

    lines.push(`\n⚠️ <i>Apuesta responsable — máx. 1-2 unidades</i>`)

    await sendMsg(chatId, lines.join('\n'), true)
  }

  return NextResponse.json({
    ok: true,
    espn_matches: espnMatches.length,
    enriched_matches: enrichedMatches.length,
    odds_matches: oddsMatches.length,
    ai_recommendation: aiRec?.match || null,
    value_recommendation: valueRec?.match || null,
  })
}
