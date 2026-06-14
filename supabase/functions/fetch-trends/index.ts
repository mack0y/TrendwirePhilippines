import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function createSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

function categorize(title: string) {
  const t = title.toLowerCase()
  if (/earthquake|flood|typhoon|disaster|tsunami/.test(t)) return { category: 'Disaster', impact: 'Critical' }
  if (/senate|congress|president|election|impeach/.test(t)) return { category: 'Politics', impact: 'High' }
  if (/nba|game|match|tournament|championship/.test(t)) return { category: 'Sports', impact: 'High' }
  if (/price|inflation|economy|peso/.test(t)) return { category: 'Economy', impact: 'Medium' }
  if (/health|covid|hospital|disease/.test(t)) return { category: 'Health', impact: 'Medium' }
  return { category: 'General', impact: 'Medium' }
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
      const { category, impact } = categorize(title)
      const slug = createSlug(title)

      const { data: existing } = await sb.from('trends').select('id').eq('slug', slug).single()
      if (!existing) {
        const { data: saved } = await sb.from('trends').insert({
          title, slug, summary: desc, category, impact_rating: impact, status: 'active'
        }).select().single()

        if (saved) {
          await sb.from('trend_sources').insert({
            trend_id: saved.id, source_name: 'Google Trends PH',
            source_url: link, snippet: desc,
            published_at: date ? new Date(date).toISOString() : new Date().toISOString(),
          })
          trends.push(saved)
        }
      }
    }

    return new Response(JSON.stringify({ message: `Fetched ${trends.length} new trends`, trends }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
