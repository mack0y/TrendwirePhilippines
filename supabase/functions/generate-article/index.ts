import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function createSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const orKey = Deno.env.get('OPENROUTER_API_KEY') ?? ''
    const orModel = Deno.env.get('OPENROUTER_MODEL') ?? 'openrouter/owl-alpha'

    if (!orKey) throw new Error('OPENROUTER_API_KEY not set')

    const sb = createClient(url, svcKey)
    const { trend_id, model } = await req.json()
    if (!trend_id) throw new Error('trend_id required')

    const { data: trend } = await sb.from('trends').select('*').eq('id', trend_id).single()
    if (!trend) throw new Error('Trend not found')

    const { data: sources } = await sb.from('trend_sources')
      .select('*').eq('trend_id', trend_id).order('published_at', { ascending: false })

    const srcText = sources?.map(s => `- ${s.source_name}: ${s.source_url}\n  ${s.snippet||''}`).join('\n') || 'No sources.'

    const cat = trend.category || 'General'
    const isNews = ['Disaster','Politics','Economy','Global','Health'].includes(cat)
    const isSports = cat === 'Entertainment' || cat === 'Sports'
    const isEveryday = ['Food & Agriculture','Real Estate','Education','Crime','Business'].includes(cat)

    let structure = ''
    if (isNews) {
      structure = `NEWS EXPLAINER (BBC/Vox style). Sections: HEADLINE(65 chars max) → HOOK(vivid moment, NOT "trending") → WHAT HAPPENED(facts,dates,names) → WHY NOW(trigger) → BIGGER PICTURE(context/history) → WHAT THIS MEANS FOR FILIPINOS(daily life impact) → WHAT'S NEXT → BOTTOM LINE(1-2 sentences). NO section labels in output.`
    } else if (isSports) {
      structure = `SPORTS/ENTERTAINMENT RECAP. Sections: HEADLINE(exciting, 65 chars) → THE MOMENT(drama, buzzer-beater energy) → THE STORY(narrative, turning points) → WHY IT MATTERS(connection to Filipinos) → WHAT'S NEXT → BOTTOM LINE(one sentence). NO section labels in output.`
    } else if (isEveryday) {
      structure = `SERVICE JOURNALISM. Sections: HEADLINE(practical, 65 chars) → HOOK(reader concern) → WHAT CHANGED(specifics, numbers, dates) → HOW THIS AFFECTS YOU(families,workers,students,businesses) → WHAT YOU CAN DO(actionable advice) → WHAT'S NEXT → BOTTOM LINE(one thing to remember). NO section labels in output.`
    } else {
      structure = `ENGAGING EXPLAINER. Sections: HEADLINE(65 chars) → HOOK(surprising fact/question) → WHAT'S THIS ABOUT(key facts) → THE CONTEXT(background) → WHY FILIPINOS CARE(local angle) → WHAT'S NEXT → BOTTOM LINE. NO section labels in output.`
    }

    const paragraphRule = `FORMATTING:
- Separate paragraphs with TWO newlines (\n\n). Each paragraph should be 2-4 sentences.
- Use **bold** to emphasize key phrases naturally — aim for 3-6 bolded items per article.
- Use paragraphs and bold text only. No bullet points, numbered lists, or headings.`

    const fewShotExample = `EXAMPLE (style reference):

Topic: Jordan Clarkson One Win Away From Filipino NBA History
Category: Sports
Summary: The New York Knicks lead the San Antonio Spurs 3-1 in the 2026 NBA Finals after a record-breaking 29-point comeback. Jordan Clarkson is on the verge of becoming the first player of Filipino ancestry to win an NBA championship.

Output:
{
  "title": "Jordan Clarkson One Win Away From Filipino NBA History",
  "summary": "The New York Knicks lead the San Antonio Spurs 3-1 in the 2026 NBA Finals after a record-breaking 29-point comeback. Jordan Clarkson is on the verge of becoming the first player of Filipino ancestry to win an NBA championship.",
  "content": "The New York Knicks are one win away from an NBA championship, and the entire Philippines is watching.\\n\\n**Jordan Clarkson**, the Filipino-American guard who has long been a source of national pride, is on the cusp of making history. If the Knicks close out the San Antonio Spurs in Game 5 at Madison Square Garden on June 14, Clarkson becomes the **first player of Filipino ancestry to ever win an NBA title**.\\n\\nThe Knicks took a commanding 3-1 series lead after pulling off the **biggest comeback in NBA Finals history** — erasing a 29-point deficit in Game 4.\\n\\n**The Philippines has fully embraced Clarkson as one of their own.** He suited up for Gilas Pilipinas at the 2018 Asian Games, where he averaged a jaw-dropping 26 points per game.",
  "seo_description": "Jordan Clarkson and the Knicks are one win away from the 2026 NBA title. Victory would make Clarkson the first Filipino-American NBA champion.",
  "tags": ["Jordan Clarkson", "NBA Finals 2026", "Filipino basketball", "New York Knicks"],
  "image_prompt": "A dramatic wide shot of Madison Square Garden at night during an NBA Finals game"
}`

    const prompt = `<persona>
You are a senior correspondent for TrendWire Philippines, a digital news publication serving millions of Filipino readers. Your voice is conversational but authoritative — like a knowledgeable friend explaining a complex story. Write for mobile-first readers who skim headlines and read in short bursts.
</persona>

<context>
TOPIC: ${trend.title}
CATEGORY: ${cat}
SUMMARY: ${trend.summary}

SOURCES:
${srcText}
</context>

<rules>
- Write about the story itself — NOT about "trending" topics or "search data"
- Do not mention Google Trends, search volume, or traffic metrics
- Base every factual claim on the provided sources. If sources don't support a claim, omit it rather than speculate
</rules>

<thinking>
Before writing, briefly plan:
1. Core narrative angle — what's the story really about?
2. 3-5 key facts the article must include
3. The local Filipino angle — why should Filipinos care about this?
</thinking>

<structure>
${structure}
</structure>

<formatting>
${paragraphRule}

Style: Conversational Filipino English. Short paragraphs, each making the reader want to read the next. Target 300-700 words. Never sound like a textbook.
</formatting>

<example>
${fewShotExample}
</example>

Respond with valid JSON only (no markdown, no code fences):
{"title":"headline","summary":"2 sentence hook, max 160 chars","content":"full article","seo_description":"max 155 chars","tags":["t1","t2","t3","t4"],"image_prompt":"DALL-E prompt here"}`

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${orKey}`, 'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/mack0y/TrendwirePhilippines',
        'X-Title': 'TrendWire Philippines',
      },
      body: JSON.stringify({
        model: model || orModel, messages: [{ role: 'user', content: prompt }],
        temperature: 0.8, max_tokens: 3000, response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) { const e = await res.json(); throw new Error(`OpenRouter: ${e.error?.message||res.status}`) }

    const completion = await res.json()
    const raw = completion.choices?.[0]?.message?.content
    if (!raw) throw new Error('No content from LLM')

    const article = JSON.parse(raw)
    if (!article.title || !article.content) throw new Error('Missing title or content')

    const slug = createSlug(article.title)
    const { data: saved, error: saveErr } = await sb.from('articles').insert({
      trend_id, title: article.title, slug,
      summary: article.summary || '', content: article.content,
      image_prompt: article.image_prompt || '', seo_description: article.seo_description || '',
      tags: article.tags || [], status: 'draft',
    }).select().single()

    if (saveErr) throw saveErr

    return new Response(JSON.stringify({ message: 'Article generated', article: saved }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
