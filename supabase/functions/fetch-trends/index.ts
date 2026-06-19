import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function categorize(title: string) {
  const t = title.toLowerCase()
  if (/earthquake|flood|typhoon|disaster|tsunami/.test(t)) return 'Disaster'
  if (/senate|congress|president|election|impeach/.test(t)) return 'Politics'
  if (/nba|game|match|tournament|championship/.test(t)) return 'Sports'
  if (/price|inflation|economy|peso/.test(t)) return 'Economy'
  if (/health|covid|hospital|disease/.test(t)) return 'Health'
  return 'General'
}

function parseTraffic(traffic: string): number {
  // Convert Google Trends traffic string ("500+", "10K+", "1M+") to impact_score (0-100)
  const cleaned = traffic.replace(/[+,]/g, '').trim()
  let volume = 0
  if (cleaned.endsWith('K')) volume = parseInt(cleaned) * 1000
  else if (cleaned.endsWith('M')) volume = parseInt(cleaned) * 1000000
  else volume = parseInt(cleaned) || 0

  if (volume >= 1000000) return 100
  if (volume >= 500000) return 90
  if (volume >= 100000) return 80
  if (volume >= 50000) return 70
  if (volume >= 10000) return 60
  if (volume >= 5000) return 50
  if (volume >= 1000) return 40
  if (volume >= 500) return 30
  if (volume > 0) return 20
  return 50
}

function extractNewsItems(xml: string): Array<{url: string; name: string}> {
  const items: Array<{url: string; name: string}> = []
  const newsRe = /<ht:news_item>([\s\S]*?)<\/ht:news_item>/g
  let n
  while ((n = newsRe.exec(xml)) !== null) {
    const newsXml = n[1]
    const url = /<ht:news_item_url>(.*?)<\/ht:news_item_url>/.exec(newsXml)?.[1] || ''
    const name = /<ht:news_item_source>(.*?)<\/ht:news_item_source>/.exec(newsXml)?.[1] || ''
    if (url) items.push({ url, name })
  }
  return items
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const sb = createClient(url, key)

    const rss = await fetch('https://trends.google.com/trending/rss?geo=PH',
      { headers: { 'User-Agent': 'TrendWire-Philippines/1.0' } })
    if (!rss.ok) throw new Error(`RSS fetch failed: ${rss.status}`)

    const text = await rss.text()
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    const trends: any[] = []
    let m

    while ((m = itemRe.exec(text)) !== null) {
      const xml = m[1]
      const title = (/<title>(.*?)<\/title>/.exec(xml)?.[1] || '').trim()
      if (!title) continue

      const link = /<link>(.*?)<\/link>/.exec(xml)?.[1] || ''
      const desc = /<description>(.*?)<\/description>/.exec(xml)?.[1] || ''
      const trafficRaw = /<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/.exec(xml)?.[1] || ''
      const impactScore = parseTraffic(trafficRaw)
      const category = categorize(title)
      const sourceLinks = extractNewsItems(xml)
      if (link) sourceLinks.unshift({ url: link, name: 'Google Trends PH' })

      // Check for duplicate by exact title
      const { data: existing } = await sb.from('trends').select('id').eq('title', title).maybeSingle()
      if (existing) continue

      const { data: saved, error: insertErr } = await sb.from('trends').insert({
        title,
        summary: desc,
        category,
        impact_score: impactScore,
        source_links: sourceLinks,
        status: 'published',
      }).select().single()

      if (saved) {
        trends.push(saved)
      } else if (insertErr) {
        console.error('Insert failed:', insertErr.message, 'for:', title)
      }
    }

    return new Response(JSON.stringify({ message: `Fetched ${trends.length} new trends`, trends }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('fetch-trends error:', e.message)
    return new Response(JSON.stringify({ error: e.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
