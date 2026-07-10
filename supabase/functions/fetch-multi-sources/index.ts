import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Telegram config ────────────────────────────────
// Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID as Supabase secrets
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID')

async function sendTelegramAlert(title: string, category: string, score: number, source: string, summary: string, siteUrl: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return
  const emoji = score >= 90 ? '🚨' : score >= 80 ? '🔥' : '📈'
  const text = [
    `${emoji} <b>${escHtml(title)}</b>`,
    `📂 ${category}  |  ⭐ ${score}/100`,
    `📡 ${source}`,
    summary ? `📝 ${escHtml(summary.slice(0, 120))}${summary.length > 120 ? '…' : ''}` : '',
    '',
    `<a href="${siteUrl}/admin">✏️ Write article</a>`,
  ].filter(Boolean).join('\n')

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
  } catch (e) {
    console.error('Telegram alert failed:', e.message)
  }
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Noise blocklist ────────────────────────────────
const NOISE_PATTERNS = [
  /^lotto result/i, /^swertres/i, /^ez2/i, /^stl result/i,
  /^pba scores?$/i, /^pba game/i,
  /^horoscope/i, /^lottery/i,
  /^wordle/i, /^connections.*today/i,
  /^what is the song/i, /^lyrics$/i,
]

function isNoise(title: string): boolean {
  return NOISE_PATTERNS.some(p => p.test(title))
}

// ── Categorizer (keyword first, then LLM for General) ──
const CATEGORY_KEYWORDS: Array<[string, RegExp]> = [
  ['Disaster', /earthquake|flood|typhoon|disaster|tsunami|storm|volcano|landslide/],
  ['Politics', /senate|congress|president|election|impeach|bill|law|govern|senator|representative|administration/],
  ['Sports', /nba|game|match|tournament|championship|sports|boxing|uaap|ncaa|pba|gilas|olympics/],
  ['Economy', /price|inflation|economy|peso|stock|market|bpo|gdp|trade deficit/],
  ['Health', /health|covid|hospital|disease|vaccine|mental|dengue|cancer/],
  ['Technology', /ai|tech|startup|gadget|phone|computer|app|digital|social media|crypto/],
  ['Entertainment', /movie|music|concert|celebrity|show|film|artist|kpop|netflix|drama/],
]

function categorize(title: string): string {
  const t = title.toLowerCase()
  for (const [, regex] of CATEGORY_KEYWORDS) {
    if (regex.test(t)) return CATEGORY_KEYWORDS.find(([, r]) => r === regex)![0]
  }
  return 'General'
}

// ── LLM categorization (only for items that fell through as General) ──
async function llmCategorize(items: Array<{ title: string }>, orKey: string): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (!orKey) return result

  const generalItems = items.filter(item => categorize(item.title) === 'General')
  if (generalItems.length === 0) return result

  // Batch up to 20 items per LLM call
  const BATCH_SIZE = 20
  for (let i = 0; i < generalItems.length; i += BATCH_SIZE) {
    const batch = generalItems.slice(i, i + BATCH_SIZE)
    const titlesJson = JSON.stringify(batch.map(item => item.title))

    const prompt = `You are a news categorizer for the Philippines. Assign exactly one category to each headline from this list: Disaster, Politics, Sports, Economy, Health, Technology, Entertainment, or General.

Rules:
- Disaster: typhoons, earthquakes, floods, storms, volcanoes, landslides
- Politics: government, congress, senate, elections, bills, laws, governance
- Sports: basketball, boxing, sports events, tournaments, athletes
- Economy: prices, inflation, business, stock market, peso, trade
- Health: diseases, hospitals, vaccines, public health, mental health
- Technology: AI, gadgets, apps, digital, social media, startups
- Entertainment: movies, music, celebrities, shows, concerts, K-pop
- General: everything else not covered above

Respond with valid JSON only: {"headlines":[{"title":"...","category":"..."}]}

Headlines: ${titlesJson}`

    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${orKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/mack0y/TrendwirePhilippines',
          'X-Title': 'TrendWire Philippines',
        },
        body: JSON.stringify({
          model: 'openrouter/free',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        }),
      })
      if (res.ok) {
        const json = await res.json()
        const raw = json.choices?.[0]?.message?.content
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed.headlines) {
            for (const h of parsed.headlines) {
              if (h.title && h.category) {
                result.set(h.title.toLowerCase(), h.category)
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('LLM categorization error:', e.message)
    }
  }
  return result
}

// ── Parse Google Trends RSS ────────────────────────
function parseGoogleTrendsTrend(xml: string): { title: string; link: string; desc: string; trafficRaw: string; newsItems: Array<{url: string; name: string}> } | null {
  const title = (/<title>(.*?)<\/title>/.exec(xml)?.[1] || '').trim()
  if (!title) return null
  const link = /<link>(.*?)<\/link>/.exec(xml)?.[1] || ''
  const desc = /<description>(.*?)<\/description>/.exec(xml)?.[1] || ''
  const trafficRaw = /<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/.exec(xml)?.[1] || ''
  
  const newsItems: Array<{url: string; name: string}> = []
  const newsRe = /<ht:news_item>([\s\S]*?)<\/ht:news_item>/g
  let n
  while ((n = newsRe.exec(xml)) !== null) {
    const newsXml = n[1]
    const url = /<ht:news_item_url>(.*?)<\/ht:news_item_url>/.exec(newsXml)?.[1] || ''
    const name = /<ht:news_item_source>(.*?)<\/ht:news_item_source>/.exec(newsXml)?.[1] || ''
    if (url) newsItems.push({ url, name })
  }
  if (link) newsItems.unshift({ url: link, name: 'Google Trends PH' })

  return { title, link, desc, trafficRaw, newsItems }
}

async function fetchGoogleTrends(): Promise<Array<{ title: string; summary: string; category: string; impact_score: number; source_links: Array<{url: string; name: string}> }>> {
  const results: Array<{ title: string; summary: string; category: string; impact_score: number; source_links: Array<{url: string; name: string}> }> = []
  const resp = await fetch('https://trends.google.com/trending/rss?geo=PH', {
    headers: { 'User-Agent': 'TrendWire-Philippines/1.0' },
  })
  if (!resp.ok) throw new Error(`Google Trends RSS fetch failed: ${resp.status}`)
  const text = await resp.text()
  const itemRe = /<item>([\s\S]*?)<\/item>/g
  let m
  while ((m = itemRe.exec(text)) !== null) {
    const parsed = parseGoogleTrendsTrend(m[1])
    if (!parsed) continue
    // Parse traffic to impact score
    const cleaned = parsed.trafficRaw.replace(/[+,]/g, '').trim()
    let volume = 0
    if (cleaned.endsWith('K')) volume = parseInt(cleaned) * 1000
    else if (cleaned.endsWith('M')) volume = parseInt(cleaned) * 1000000
    else volume = parseInt(cleaned) || 0
    let impactScore = 50
    if (volume >= 1000000) impactScore = 100
    else if (volume >= 500000) impactScore = 90
    else if (volume >= 100000) impactScore = 80
    else if (volume >= 50000) impactScore = 70
    else if (volume >= 10000) impactScore = 60
    else if (volume >= 5000) impactScore = 50
    else if (volume >= 1000) impactScore = 40
    else if (volume >= 500) impactScore = 30
    else if (volume > 0) impactScore = 20

    results.push({
      title: parsed.title,
      summary: parsed.desc,
      category: categorize(parsed.title),
      impact_score: impactScore,
      source_links: parsed.newsItems,
    })
  }
  return results
}

// ── Parse Rappler RSS ──────────────────────────────
async function fetchRapplerNews(): Promise<Array<{ title: string; summary: string; category: string; impact_score: number; source_links: Array<{url: string; name: string}> }>> {
  const results: Array<{ title: string; summary: string; category: string; impact_score: number; source_links: Array<{url: string; name: string}> }> = []
  try {
    const resp = await fetch('https://www.rappler.com/feed/', {
      headers: { 'User-Agent': 'TrendWire-Philippines/1.0' },
    })
    if (!resp.ok) throw new Error(`Rappler RSS fetch failed: ${resp.status}`)
    const text = await resp.text()
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    let m
    while ((m = itemRe.exec(text)) !== null) {
      const xml = m[1]
      const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(xml)?.[1] || /<title>(.*?)<\/title>/.exec(xml)?.[1] || '').trim()
      if (!title) continue
      const link = /<link>(.*?)<\/link>/.exec(xml)?.[1] || ''
      const descRaw = /<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(xml)?.[1] || /<description>(.*?)<\/description>/.exec(xml)?.[1] || ''
      const desc = descRaw.replace(/<[^>]+>/g, '').trim()
      // News articles get a baseline score of 50, trending/breaking get higher
      const isBreaking = /breaking|urgent|just in|latest|update/i.test(title)
      results.push({
        title,
        summary: desc.slice(0, 200),
        category: categorize(title),
        impact_score: isBreaking ? 75 : 55,
        source_links: link ? [{ url: link, name: 'Rappler' }] : [],
      })
    }
  } catch (e) {
    console.error('Rappler fetch error:', e.message)
  }
  return results
}

// ── Generic RSS news fetcher ───────────────────────
async function fetchRSSNews(url: string, sourceName: string, baseScore: number = 55): Promise<Array<{ title: string; summary: string; category: string; impact_score: number; source_links: Array<{url: string; name: string}> }>> {
  const results: Array<{ title: string; summary: string; category: string; impact_score: number; source_links: Array<{url: string; name: string}> }> = []
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'TrendWire-Philippines/1.0' },
    })
    if (!resp.ok) throw new Error(`${sourceName} RSS fetch failed: ${resp.status}`)
    const text = await resp.text()
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    let m
    while ((m = itemRe.exec(text)) !== null) {
      const xml = m[1]
      const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(xml)?.[1] || /<title>(.*?)<\/title>/.exec(xml)?.[1] || '').trim()
      if (!title) continue
      const link = /<link>(.*?)<\/link>/.exec(xml)?.[1] || ''
      const descRaw = /<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(xml)?.[1] || /<description>(.*?)<\/description>/.exec(xml)?.[1] || ''
      const desc = descRaw.replace(/<[^>]+>/g, '').trim()
      const isBreaking = /breaking|urgent|just in|latest|update/i.test(title)
      results.push({
        title,
        summary: desc.slice(0, 200),
        category: categorize(title),
        impact_score: isBreaking ? 75 : baseScore,
        source_links: link ? [{ url: link, name: sourceName }] : [],
      })
    }
  } catch (e) {
    console.error(`${sourceName} fetch error:`, e.message)
  }
  return results
}

// ── Fetch all sources ─────────────────────────────
async function fetchAllSources(): Promise<Array<{ source: string; title: string; summary: string; category: string; impact_score: number; source_links: Array<{url: string; name: string}> }>> {
  const [googleTrends, rappler, philstar, inquirer, abscbn] = await Promise.all([
    fetchGoogleTrends().catch(e => { console.error('Google Trends error:', e.message); return [] }),
    fetchRapplerNews().catch(e => { console.error('Rappler error:', e.message); return [] }),
    fetchRSSNews('https://www.philstar.com/rss/headlines', 'PhilStar').catch(e => { console.error('PhilStar error:', e.message); return [] }),
    fetchRSSNews('https://www.inquirer.net/fullfeed', 'Inquirer').catch(e => { console.error('Inquirer error:', e.message); return [] }),
    fetchRSSNews('https://news.abs-cbn.com/feed/', 'ABS-CBN').catch(e => { console.error('ABS-CBN error:', e.message); return [] }),
  ])

  const all = [
    ...googleTrends.map(t => ({ ...t, source: 'Google Trends' })),
    ...rappler.map(t => ({ ...t, source: 'Rappler' })),
    ...philstar.map(t => ({ ...t, source: 'PhilStar' })),
    ...inquirer.map(t => ({ ...t, source: 'Inquirer' })),
    ...abscbn.map(t => ({ ...t, source: 'ABS-CBN' })),
  ]
  return all
}

// ── Simple title similarity check ─────────────────
function titlesAreSimilar(a: string, b: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  const na = normalize(a)
  const nb = normalize(b)
  // Exact match
  if (na === nb) return true
  // One contains the other
  if (na.includes(nb) || nb.includes(na)) return true
  // Check word overlap
  const wa = new Set(na.split(/\s+/).filter(w => w.length > 3))
  const wb = new Set(nb.split(/\s+/).filter(w => w.length > 3))
  if (wa.size === 0 || wb.size === 0) return false
  let overlap = 0
  for (const w of wa) if (wb.has(w)) overlap++
  return overlap / Math.min(wa.size, wb.size) >= 0.6
}

// ── Deduplicate and score ─────────────────────────
function deduplicateAndScore(items: Array<{ source: string; title: string; summary: string; category: string; impact_score: number; source_links: Array<{url: string; name: string}> }>) {
  const unique: Array<typeof items[0] & { source_count: number }> = []
  
  for (const item of items) {
    const existing = unique.find(u => titlesAreSimilar(u.title, item.title))
    if (existing) {
      // Time-decay-aware boost: reduced from +15 to +8 per source.
      // This prevents runaway score inflation while still rewarding
      // multi-source coverage. Combined with the periodic time-decay
      // applied to DB-stored scores on re-discovery, older trends
      // naturally lose priority over time.
      existing.impact_score = Math.min(100, existing.impact_score + 8)
      existing.source_count++
      // Merge source links
      for (const link of item.source_links) {
        if (!existing.source_links.find(l => l.url === link.url)) {
          existing.source_links.push(link)
        }
      }
    } else {
      unique.push({ ...item, source_count: 1 })
    }
  }
  return unique
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const orKey = Deno.env.get('OPENROUTER_API_KEY') ?? ''
    const sb = createClient(url, key)

    // Get site URL for article links
    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://mack0y.github.io/TrendwirePhilippines'

    // 1. Fetch all sources
    const rawItems = await fetchAllSources()
    console.log(`Fetched ${rawItems.length} raw items from all sources`)

    // 2. Filter noise (lotto results, wordle, etc.)
    const filtered = rawItems.filter(item => !isNoise(item.title))
    console.log(`After noise filter: ${filtered.length} items (removed ${rawItems.length - filtered.length})`)

    // 3. Apply LLM categorization for items that keyword matching marked as General
    const llmCategories = await llmCategorize(filtered, orKey)
    let llmChanged = 0
    for (const item of filtered) {
      const llmCat = llmCategories.get(item.title.toLowerCase())
      if (llmCat && item.category === 'General' && llmCat !== 'General') {
        console.log(`  LLM re-categorized: "${item.title.slice(0, 50)}..." → ${llmCat} (was ${item.category})`)
        item.category = llmCat
        llmChanged++
      }
    }
    console.log(`LLM re-categorized ${llmChanged} items`)

    // 4. Deduplicate and score
    const scored = deduplicateAndScore(filtered)
    console.log(`After dedup: ${scored.length} unique items`)

    // 5. Save new trends and send alerts
    const newTrends: Array<any> = []
    const alertsSent: Array<string> = []

    for (const item of scored) {
      // Check for duplicate by exact title in DB
      const { data: existing } = await sb.from('trends').select('id, title, created_at, impact_score').eq('title', item.title).maybeSingle()
      if (existing) {
        // Trend is still appearing in feeds — apply time-decay to its score
        // so old trends naturally lose priority. Refresh updated_at so the
        // 7-day admin filter keeps it visible as long as it's actively trending.
        const ageInDays = (Date.now() - new Date(existing.created_at).getTime()) / (1000 * 86400)
        const decayFactor = Math.max(0.3, Math.exp(-ageInDays / 7)) // 7-day half-life, floor at 0.3
        const decayedScore = Math.round(existing.impact_score * decayFactor)
        const finalScore = Math.min(100, Math.max(decayedScore, item.impact_score))
        await sb.from('trends').update({
          impact_score: finalScore,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id)
        continue
      }

      // Check by similar title (fuzzy match)
      const { data: similar } = await sb.from('trends').select('id, title, created_at, impact_score').ilike('title', `%${item.title.slice(0, 30)}%`).limit(1).maybeSingle()
      if (similar) {
        // Similar trend still active — apply same time-decay treatment
        const ageInDays = (Date.now() - new Date(similar.created_at).getTime()) / (1000 * 86400)
        const decayFactor = Math.max(0.3, Math.exp(-ageInDays / 7))
        const decayedScore = Math.round(similar.impact_score * decayFactor)
        const finalScore = Math.min(100, Math.max(decayedScore, item.impact_score))
        await sb.from('trends').update({
          impact_score: finalScore,
          updated_at: new Date().toISOString(),
        }).eq('id', similar.id)
        continue
      }

      const { data: saved, error: insertErr } = await sb.from('trends').insert({
        title: item.title,
        summary: item.summary,
        category: item.category,
        impact_score: item.impact_score,
        source_links: item.source_links,
        status: 'published',
      }).select().single()

      if (saved) {
        newTrends.push(saved)
        // Send alert for high-impact trends
        if (item.impact_score >= 50) {
          await sendTelegramAlert(
            item.title,
            item.category,
            item.impact_score,
            `${item.source}${item.source_count > 1 ? ` +${item.source_count - 1} sources` : ''}`,
            item.summary,
            siteUrl,
          )
          alertsSent.push(item.title)
        }
      } else if (insertErr) {
        console.error('Insert failed:', insertErr.message, 'for:', item.title)
      }
    }

    return new Response(JSON.stringify({
      message: `Fetched ${scored.length} unique trends, ${newTrends.length} new, ${alertsSent.length} alerts sent`,
      new_trends: newTrends.length,
      alerts_sent: alertsSent.length,
      alert_titles: alertsSent,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('fetch-multi-sources error:', e.message)
    return new Response(JSON.stringify({ error: e.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
