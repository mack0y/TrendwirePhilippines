import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FORBIDDEN = ['google trends', 'search volume', 'trending data', 'filipinos are searching', 'according to google']

function checkForbidden(content: string, title: string): string[] {
  const issues: string[] = []
  const text = (title + ' ' + content).toLowerCase()
  for (const phrase of FORBIDDEN) {
    if (text.includes(phrase)) {
      issues.push(`Contains forbidden phrase: "${phrase}"`)
    }
  }
  return issues
}

function checkHeadlineFit(title: string, summary: string, content: string): string[] {
  const issues: string[] = []
  const contentStart = content.slice(0, 200).toLowerCase()
  const titleLower = title.toLowerCase()
  const summaryLower = summary.toLowerCase()
  const titleWords = titleLower.split(/\s+/).filter(w => w.length > 3)
  let titleWordsInContent = 0
  for (const w of titleWords) {
    if (contentStart.includes(w) || summaryLower.includes(w)) {
      titleWordsInContent++
    }
  }
  if (titleWords.length > 0 && titleWordsInContent < Math.ceil(titleWords.length * 0.4)) {
    issues.push(`Headline keywords missing from article intro (${titleWordsInContent}/${titleWords.length} found)`)
  }
  // Check summary matches content
  const summaryKey = summaryLower.split(/\s+/).filter(w => w.length > 4)
  let summaryKeysInContent = 0
  for (const w of summaryKey) {
    if (content.slice(0, 500).toLowerCase().includes(w)) {
      summaryKeysInContent++
    }
  }
  if (summaryKey.length > 0 && summaryKeysInContent < Math.ceil(summaryKey.length * 0.5)) {
    issues.push(`Summary claims not reflected in article content (${summaryKeysInContent}/${summaryKey.length} key terms found)`)
  }
  return issues
}

function checkNaturalness(text: string): { score: number; issues: string[] } {
  const issues: string[] = []
  const lower = text.toLowerCase()
  // Penalize robotic transitions
  const robotic = [/^moreover/i, /^furthermore/i, /^in addition/i, /^consequently/i, /^nevertheless/i, /^notably/i, /^it is important to note/i]
  for (const r of robotic) {
    if (r.test(lower)) issues.push(`Robotic transition: "${r.source.replace(/^\/\^|\/i$/g, '')}"`)
  }
  // Penalize generic filler
  if ((lower.match(/this means that/g) || []).length > 2) issues.push('Overused: "this means that"')
  if ((lower.match(/in other words/g) || []).length > 1) issues.push('Overused: "in other words"')
  // Check sentence length variation
  const sentences = text.split(/[.!?]+/).filter(Boolean)
  const longSentences = sentences.filter(s => s.split(/\s+/).length > 35)
  if (longSentences.length > sentences.length * 0.3) {
    issues.push(`Too many long sentences (${longSentences.length}/${sentences.length} over 35 words)`)
  }
  const veryShort = sentences.filter(s => s.split(/\s+/).length < 4)
  if (veryShort.length > sentences.length * 0.2) {
    issues.push(`Too many very short sentences (${veryShort.length}/${sentences.length} under 4 words)`)
  }
  let score = 10
  score -= issues.length * 1.5
  return { score: Math.max(0, Math.round(score * 10) / 10), issues }
}

function checkSpecificity(text: string): { score: number; issues: string[] } {
  const issues: string[] = []
  // Count specific elements
  const numbers = text.match(/\d+/g)
  const hasNumbers = numbers && numbers.length >= 3
  const hasNames = /[A-Z][a-z]+ [A-Z][a-z]+/.test(text)  // Capitalized names
  const hasDates = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i.test(text)
  const hasLocations = /\b(Manila|Cebu|Davao|Luzon|Visayas|Mindanao|Philippine|Filipino|PAGASA|NBI|PNP|Congress|Senate)\b/i.test(text)
  const hasPercents = /%\d+|\d+%/.test(text)
  if (!hasNumbers) issues.push('Lacks specific numbers or statistics')
  if (!hasNames) issues.push('No named individuals or organizations')
  if (!hasDates) issues.push('No specific dates mentioned')
  if (!hasLocations) issues.push('No Philippine location context')
  let score = 2
  if (hasNumbers) score += 2
  if (hasNames) score += 2
  if (hasDates) score += 2
  if (hasLocations) score += 2
  if (hasPercents) score += 1
  return { score: Math.min(10, score), issues }
}

function checkStructure(text: string): { score: number; issues: string[] } {
  const issues: string[] = []
  const paragraphs = text.split('\n\n').filter(Boolean)
  // Check paragraph length
  if (paragraphs.length < 5) issues.push(`Only ${paragraphs.length} paragraphs — aim for at least 6`)
  if (paragraphs.length > 15) issues.push(`Too many paragraphs (${paragraphs.length})`)
  // Check bold usage
  const boldItems = text.match(/\*\*(.*?)\*\*/g)
  if (!boldItems || boldItems.length < 2) issues.push('Use **bold** to emphasize key phrases (aim for 3-6)')
  if (boldItems && boldItems.length > 8) issues.push(`Too many bold items (${boldItems.length}) — aim for 3-6`)
  // Check for section labels that leaked
  if (/^(what happened|why now|bigger picture|what this means|what's next|bottom line|the moment|the story|why it matters|hook|section):/im.test(text)) {
    issues.push('Section label leaked into output')
  }
  // Check for bullet points
  if (/^[-*]\s/m.test(text)) issues.push('Bullet points found — use paragraphs only')
  let score = 10
  score -= issues.length * 2
  if (paragraphs.length < 5) score -= 2
  return { score: Math.max(0, Math.round(score * 10) / 10), issues }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { article_id, model } = await req.json()
    if (!article_id) throw new Error('article_id required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const orKey = Deno.env.get('OPENROUTER_API_KEY') ?? ''
    const sb = createClient(supabaseUrl, supabaseKey)

    // Fetch the article
    const { data: article } = await sb.from('articles').select('*').eq('id', article_id).single()
    if (!article) throw new Error('Article not found')

    const { title, summary, content, tags } = article

    // Run rubric checks
    const forbiddenIssues = checkForbidden(content, title)
    const headlineIssues = checkHeadlineFit(title, summary, content)
    const natural = checkNaturalness(content)
    const specific = checkSpecificity(content)
    const struct = checkStructure(content)
    const llmIssues: string[] = []

    // LLM pass: ask the model to rate naturalness and check for AI-sounding patterns
    let llmScore = 10
    if (orKey) {
      try {
        const llmPrompt = `You are a news editor. Rate this article's quality on a scale of 0-10 for each criterion. Be strict — this is for a professional news site.

CRITERIA:
1. Naturalness (0-10): Sounds like a Filipino journalist wrote it, not AI. Penalize stiff phrasing, robotic transitions, unnatural word choices.
2. Compliance (0-10): No mention of "Google Trends", "search volume", "trending data", "filipinos are searching", or similar forbidden SEO terms.
3. Specificity (0-10): Rich with specific facts: names, places, dates, numbers, quotes. Not vague or generic.
4. Structure (0-10): Clean paragraph flow, appropriate **bold** emphasis 3-6 items, no section labels, no bullet points.
5. Headline Fit (0-10): Title accurately reflects content. Summary matches what the article actually says.

For each criterion below 7, explain why in 1 sentence.

TITLE: ${title.slice(0, 100)}
SUMMARY: ${summary.slice(0, 200)}
CONTENT: ${content.slice(0, 3000)}

Respond with valid JSON only:
{"naturalness":8,"compliance":10,"specificity":7,"structure":8,"headline_fit":9,"issues":["Brief issue description if any criteria below 7"]}`

        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${orKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/mack0y/TrendwirePhilippines',
            'X-Title': 'TrendWire Philippines',
          },
          body: JSON.stringify({
            model: model || 'openrouter/free',
            messages: [{ role: 'user', content: llmPrompt }],
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
            if (parsed.naturalness !== undefined) {
              llmScore = (parsed.naturalness + parsed.compliance + parsed.specificity + parsed.structure + parsed.headline_fit) / 5
              if (parsed.issues && Array.isArray(parsed.issues)) {
                llmIssues.push(...parsed.issues)
              }
            }
          }
        }
      } catch (e) {
        console.error('LLM quality check error:', e.message)
      }
    }

    // Compute overall score: 30% heuristic + 70% LLM (when available)
    const heuristicScore = (natural.score + specific.score + struct.score) / 3
    const llmWeighted = orKey ? (llmScore) : heuristicScore
    const overallBase = heuristicScore * 0.3 + llmWeighted * 0.7

    // Apply penalties for forbidden terms and headline mismatch
    const totalPenalty = forbiddenIssues.length * 1.0 + headlineIssues.length * 0.5
    const overallScore = Math.max(0, Math.round((overallBase - totalPenalty) * 10) / 10)

    const allIssues = [
      ...forbiddenIssues,
      ...headlineIssues,
      ...natural.issues,
      ...specific.issues,
      ...struct.issues,
      ...llmIssues,
    ]

    const details = {
      naturalness: natural.score,
      specificity: specific.score,
      structure: struct.score,
      forbidden: forbiddenIssues.length === 0 ? 10 : Math.max(0, 10 - forbiddenIssues.length * 2),
      headline_fit: headlineIssues.length === 0 ? 10 : Math.max(0, 10 - headlineIssues.length * 2),
      llm_score: orKey ? llmScore : null,
      issues: allIssues.slice(0, 10),
    }

    // Determine action
    let action = 'flag'
    if (overallScore >= 8.0) {
      action = 'publish'
    } else if (overallScore < 5.0) {
      action = 'reject'
    }

    // Update article in DB
    const update: Record<string, unknown> = {
      quality_score: overallScore,
      quality_details: details,
    }
    if (action === 'publish' && article.status === 'draft') {
      update.status = 'published'
      update.published_at = new Date().toISOString()
    }

    await sb.from('articles').update(update).eq('id', article_id)

    return new Response(JSON.stringify({
      article_id,
      score: overallScore,
      action,
      details,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
