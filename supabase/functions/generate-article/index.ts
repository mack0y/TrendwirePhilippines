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
    const orModel = Deno.env.get('OPENROUTER_MODEL') ?? 'poolside/laguna-xs-2.1:free'

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

    const fewShotExample = `EXAMPLE (style reference — note the word count):

Topic: Jordan Clarkson One Win Away From Filipino NBA History
Category: Sports
Summary: The New York Knicks lead the San Antonio Spurs 3-1 in the 2026 NBA Finals after a record-breaking 29-point comeback. Jordan Clarkson is on the verge of becoming the first player of Filipino ancestry to win an NBA championship.

Output:
{
  "title": "Jordan Clarkson One Win Away From Filipino NBA History",
  "summary": "The New York Knicks lead the San Antonio Spurs 3-1 in the 2026 NBA Finals after a record-breaking 29-point comeback. Jordan Clarkson is on the verge of becoming the first player of Filipino ancestry to win an NBA championship.",
  "content": "The New York Knicks are one win away from an NBA championship, and the entire Philippines is watching every second of it. Madison Square Garden is electrified, and millions of Filipino fans from Manila to Mindanao are staying up past midnight to witness history in the making.\\n\\n**Jordan Clarkson**, the Filipino-American guard who has long been a source of national pride for the Philippines, is on the cusp of achieving something no one of Filipino ancestry has ever done before. If the Knicks close out the San Antonio Spurs in Game 5 on their home floor, Clarkson will become the **first player of Filipino descent to ever win an NBA championship** — a milestone that would resonate far beyond basketball.\\n\\nThe Knicks took a commanding 3-1 series lead after pulling off the **biggest comeback in NBA Finals history**. Down by 29 points in the third quarter, New York mounted a furious rally capped by a Clarkson three-pointer that sent the Garden into a deafening roar. The comeback has been hailed as one of the greatest moments in NBA playoff history, drawing comparisons to the 2016 Cavaliers' historic reverse sweep.\\n\\n**Clarkson's connection to the Philippines runs deep.** He suited up for Gilas Pilipinas at the 2018 Asian Games in Jakarta, where he averaged a jaw-dropping 26 points per game and instantly became a national icon. His decision to represent the Philippines on the international stage cemented his bond with Filipino basketball fans, who have followed his NBA career ever since. Local basketball courts across the country have murals of Clarkson in both his Knicks jersey and the Gilas uniform, a testament to his dual legacy.\\n\\n**The social media response has been overwhelming.** Philippine Twitter trends have consistently featured Clarkson-related hashtags throughout the Finals, with fans sharing videos of watch parties in barangays, universities, and even inside jeepneys equipped with small televisions. The Philippine Basketball Association (PBA) has publicly congratulated Clarkson, and several government officials have hinted at a hero's welcome should he return to the country with an NBA ring.\\n\\nGame 5 tips off at 8 PM Manila time on June 14 at Madison Square Garden. If the Knicks win, Clarkson will not only be an NBA champion but also a permanent bridge between the world's biggest basketball league and the country that loves the game more than almost anywhere else on earth.",
  "seo_description": "Jordan Clarkson and the Knicks are one win away from the 2026 NBA title. Victory would make Clarkson the first Filipino-American NBA champion.",
  "tags": ["Jordan Clarkson", "NBA Finals 2026", "Filipino basketball", "New York Knicks"],
  "image_prompt": "freeze-frame of Jordan Clarkson mid-release on a three-pointer, Madison Square Garden crowd on feet waving Filipino flags, arena floodlights, confetti starting to fall"
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
- CRITICAL: The content field MUST be between 600 and 800 words. Count your words before finalizing. Articles under 600 words get rejected.
- Sign the article with: "-- TrendWire Staff" at the very end (after the bottom line) as the author credit. Do NOT include "By [name]" anywhere else.
- In the "WHAT'S NEXT" or "BOTTOM LINE" section, naturally mention 1-2 related stories or topics with phrases like "in related news" or "this follows" — this helps readers discover similar coverage.
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

Style: Conversational Filipino English. Short paragraphs, each making the reader want to read the next. Aim for 650-800 words, ABSOLUTE MINIMUM is 600 words. Never sound like a textbook.
</formatting>

<example>
${fewShotExample}
</example>

<image_prompt>
Generate a single photorealistic news photo prompt for THIS specific article. Style tags will be appended later — focus ALL 20-40 words on scene details only.

STEP 1 — Extract visual elements:
- Who: the key subject (name, expression, what they're doing)
- Where: exact location (place name, environment, time of day)
- What: the single frozen moment that tells the whole story
- Background: what fills the frame behind the subject

STEP 2 — Composition (choose one):
- WIDE: "aerial wide shot" or "ground-level wide" — establishes scale and environment
- MEDIUM: "waist-level medium shot" — subject + context
- CLOSE: "close-up" or "tight portrait" — emotion and detail
- ACTION: "freeze-frame" or "mid-action capture" — peak moment

STEP 3 — Apply category-specific visual rules:
- Disaster: wide shot, rescue/response personnel in frame, damage/aftermath visible, overcast or emergency lighting
- Sports: freeze-frame peak action, athlete in motion with expression, crowd or venue in background, stadium floodlights
- Politics/Government: podium or press conference framing, flag or institutional backdrop, speaker at lectern or crowd reaction
- Business/Economy: interior workspace shot, person at desk/screen, professional ambient lighting, documents or data in frame
- Health: clinical/clean setting, medical workers or patients, natural or fluorescent lighting, equipment visible
- Entertainment: red carpet or stage lighting, subject in spotlight, vibrant colors, crowd or press in background
- Crime/Legal: courthouse or police line exterior, aftermath clean-up, evidence markers, natural daylight
- Food/Agriculture: market stall or farm field, fresh produce, golden hour or morning light, seller's hands in frame
- Education/Science: classroom or lab setting, students/teachers engaged, bright overhead light, books or equipment
- Technology: device or screen as focal point, user interaction, cool blue/white ambient light, modern interior
- General: street-level realism, candid everyday moment, soft natural light

Step 4 — Lighting by setting:
- Outdoor day: "overcast soft light, even exposure"
- Outdoor night: "ambient street/neon light, high contrast shadows"
- Indoor event: "stage spotlight, warm tungsten light"
- Indoor workplace: "fluorescent overhead, cool ambient"
- Emergency/night disaster: "flashlight or floodlight illumination, dark surroundings"
- Sports: "stadium floodlight, bright even light on subject"

Rules:
- MUST use specific article details — names, places, events. Not generic descriptions.
- 20-40 words. Do NOT include style tags (they are appended automatically).
- No quotation marks, no markdown.
- The prompt must be a single comma-separated phrase, not a sentence.
- DO NOT include: "masterpiece", "digital art", "illustration", "4k", "trending", "cinematic"
- For negative/unpleasant topics: show aftermath, response, or symbolic representation — NOT graphic violence
- Include Filipino visual context where relevant (jeepney, tricycle, sari-sari store, Philippine flag, street food vendor, plaza, basketball court, palm trees)

BAD examples (generic — DON'T do this):
"a basketball game with crowd cheering"
"flooded street in Manila"
"a politician speaking at an event"

GOOD examples (specific — DO this, without style tags):
"wide shot of Marikina City residents wading chest-deep through floodwater carrying belongings, submerged jeepneys, emergency boat in mid-ground, overcast afternoon light"
"freeze-frame of Jordan Clarkson mid-three-point release, Madison Square Garden crowd on feet in background, Filipino flags waving, arena floodlight on subject"
"close-up of PAGASA meteorologist pointing at radar screen showing Super Typhoon Bavi, red warning overlay on monitor, office fluorescent light, tense expression"
</image_prompt>

Respond with valid JSON only (no markdown, no code fences):
{"title":"headline","summary":"2 sentence hook, max 160 chars","content":"full article (600-800 words, ends with '-- TrendWire Staff')","seo_description":"max 155 chars","tags":["t1","t2","t3","t4"],"image_prompt":"specific scene details only, no style tags — composition, subject, action, setting, lighting as comma-separated phrase"}`

    async function callLLM(messages: Array<{role: string; content: string}>, retryLabel: string): Promise<any> {
      const maxAttempts = 3
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const msgs = [...messages]
        if (attempt > 1) {
          msgs.push({ role: 'user', content: 'You MUST respond with valid JSON only. No other text. Follow the exact JSON format specified earlier.' })
        }
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${orKey}`, 'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/mack0y/TrendwirePhilippines',
            'X-Title': 'TrendWire Philippines',
          },
          body: JSON.stringify({
            model: model || orModel, messages: msgs,
            temperature: 0.8, max_tokens: 3000, response_format: { type: 'json_object' },
          }),
        })

        if (!res.ok) { const e = await res.json(); throw new Error(`OpenRouter ${retryLabel}: ${e.error?.message||res.status}`) }

        const completion = await res.json()
        const raw = completion.choices?.[0]?.message?.content
        if (!raw) throw new Error(`No content from LLM (${retryLabel})`)

        try {
          const parsed = JSON.parse(raw)
          if (!parsed.title || !parsed.content) throw new Error(`Missing title or content`)
          return parsed
        } catch (e) {
          if (attempt === maxAttempts) throw new Error(`Invalid JSON after ${maxAttempts} attempts (${retryLabel}): ${raw.slice(0, 100)}`)
          console.log(`JSON parse failed attempt ${attempt}, retrying...`)
        }
      }
    }

    function wordCount(text: string): number {
      return text.trim().split(/\s+/).filter(Boolean).length
    }

    // First attempt
    let article = await callLLM([{ role: 'user', content: prompt }], 'first attempt')
    let wc = wordCount(article.content)

    // If too short, retry with a stronger instruction
    if (wc < 600) {
      console.log(`Article too short (${wc} words), requesting expansion...`)
      const expandPrompt = `The previous article was only ${wc} words, which is too short. Rewrite the following article to be between 650 and 800 words. Keep the same title, summary, and tags. Expand every section with more details, examples, context, and analysis. Use the same style and format. End with '-- TrendWire Staff'.\n\nTitle: ${article.title}\n\nCurrent Content:\n${article.content}`
      article = await callLLM([
        { role: 'user', content: prompt },
        { role: 'assistant', content: JSON.stringify(article) },
        { role: 'user', content: expandPrompt },
      ], 'expansion')
      wc = wordCount(article.content)
      console.log(`Expanded article word count: ${wc}`)
    }

    if (!article.title || !article.content) throw new Error('Missing title or content')

    let slug = createSlug(article.title)
    // Handle slug conflict by appending a timestamp
    const { data: existingSlug } = await sb.from('articles').select('id').eq('slug', slug).maybeSingle()
    if (existingSlug) {
      slug = slug + '-' + Date.now()
    }
    const { data: saved, error: saveErr } = await sb.from('articles').insert({
      trend_id, title: article.title, slug,
      category: trend.category || 'General',
      summary: article.summary || '', content: article.content,
      image_prompt: article.image_prompt || '', seo_description: article.seo_description || '',
      tags: article.tags || [], status: 'draft', author: 'TrendWire Staff',
    }).select().single()

    if (saveErr) throw saveErr

    // Fire-and-forget quality check (don't block the response)
    const qcUrl = `${url}/functions/v1/quality-check`
    fetch(qcUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${svcKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ article_id: saved.id, model: model || orModel }),
    }).catch(e => console.error('Quality check call failed:', e.message))

    return new Response(JSON.stringify({ message: 'Article generated', article: saved }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
