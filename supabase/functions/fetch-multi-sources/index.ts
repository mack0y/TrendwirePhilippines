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
    `<a href="${siteUrl}/#/admin">✏️ Write article</a>`,
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

// ── Categorizer ────────────────────────────────────
function categorize(title: string): string {
  const t = title.toLowerCase()
  if (/earthquake|flood|typhoon|disaster|tsunami|storm|volcano|landslide/.test(t)) return 'Disaster'
  if (/senate|congress|president|election|impeach|bill|law|govern/.test(t)) return 'Politics'
  if (/nba|game|match|tournament|championship|sports|boxing|uaap|ncaa/.test(t)) return 'Sports'
  if (/price|inflation|economy|peso|stock|market|bpo/.test(t)) return 'Economy'
  if (/health|covid|hospital|disease|vaccine|mental/.test(t)) return 'Health'
  if (/ai|tech|startup|gadget|phone|computer|app|digital/.test(t)) return 'Technology'
  if (/movie|music|concert|celebrity|show|film|artist|kpop/.test(t)) return 'Entertainment'
  return 'General'
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

// ── Fetch all sources ─────────────────────────────
async function fetchAllSources(): Promise<Array<{ source: string; title: string; summary: string; category: string; impact_score: number; source_links: Array<{url: string; name: string}> }>> {
  const [googleTrends, rappler] = await Promise.all([
    fetchGoogleTrends().catch(e => { console.error('Google Trends error:', e.message); return [] }),
    fetchRapplerNews().catch(e => { console.error('Rappler error:', e.message); return [] }),
  ])

  const all = [
    ...googleTrends.map(t => ({ ...t, source: 'Google Trends' })),
    ...rappler.map(t => ({ ...t, source: 'Rappler' })),
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
      // Boost score and merge sources
      existing.impact_score = Math.min(100, existing.impact_score + 15)
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
    const sb = createClient(url, key)

    // Get site URL for article links
    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://mack0y.github.io/TrendwirePhilippines'

    // 1. Fetch all sources
    const rawItems = await fetchAllSources()
    console.log(`Fetched ${rawItems.length} raw items from all sources`)

    // 2. Deduplicate and score
    const scored = deduplicateAndScore(rawItems)
    console.log(`After dedup: ${scored.length} unique items`)

    // 3. Save new trends and send alerts
    const newTrends: Array<any> = []
    const alertsSent: Array<string> = []

    for (const item of scored) {
      // Check for duplicate by exact title in DB
      const { data: existing } = await sb.from('trends').select('id, title').eq('title', item.title).maybeSingle()
      if (existing) continue

      // Check by similar title (fuzzy match)
      const { data: similar } = await sb.from('trends').select('id, title').ilike('title', `%${item.title.slice(0, 30)}%`).limit(1).maybeSingle()
      if (similar) {
        // Titles are similar, skip
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
        if (item.impact_score >= 70) {
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
