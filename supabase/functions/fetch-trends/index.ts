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
  // "500+" → 500, "10K+" → 10000, "1M+" → 1000000
  const cleaned = traffic.replace(/[+,]/g, '').trim()
  if (cleaned.endsWith('K')) return parseInt(cleaned) * 1000
  if (cleaned.endsWith('M')) return parseInt(cleaned) * 1000000
  const num = parseInt(cleaned)
  return isNaN(num) ? 0 : num
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
      const date = /<pubDate>(.*?)<\/pubDate>/.exec(xml)?.[1] || ''
      const trafficRaw = /<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/.exec(xml)?.[1] || ''
      const searchVolume = parseTraffic(trafficRaw)
      const category = categorize(title)

      // Check for duplicate by title (slug column doesn't exist in live DB)
      const { data: existing } = await sb.from('trends').select('id').ilike('title', title).maybeSingle()
      if (!existing) {
        const { data: saved, error: insertErr } = await sb.from('trends').insert({
          title,
          summary: desc,
          category,
          search_volume: searchVolume,
          status: 'active',
        }).select().single()

        if (saved) {
          await sb.from('trend_sources').insert({
            trend_id: saved.id, source_name: 'Google Trends PH',
            source_url: link, snippet: desc,
            published_at: date ? new Date(date).toISOString() : new Date().toISOString(),
          })
          trends.push(saved)
        } else if (insertErr) {
          console.error('Insert failed:', insertErr.message)
        }
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
