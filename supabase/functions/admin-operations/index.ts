import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const sb = createClient(url, key)

    const { action, ...payload } = await req.json()

    switch (action) {

      case 'get-article': {
        const { id } = payload
        const { data, error } = await sb.from('articles').select('*').eq('id', id).single()
        if (error) throw error
        return new Response(JSON.stringify(data),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      case 'update-article': {
        const { id, ...fields } = payload
        const updates: Record<string, unknown> = {}
        const allowed = ['title', 'summary', 'content', 'category', 'tags',
          'seo_description', 'image_prompt', 'image_url']
        for (const key of allowed) {
          if (fields[key] !== undefined) updates[key] = fields[key]
        }
        const { data, error } = await sb.from('articles')
          .update(updates).eq('id', id).select().single()
        if (error) throw error
        return new Response(JSON.stringify(data),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      case 'publish-article': {
        const { id } = payload
        const { data, error } = await sb.from('articles')
          .update({ status: 'published', published_at: new Date().toISOString() })
          .eq('id', id).select().single()
        if (error) throw error
        return new Response(JSON.stringify(data),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      case 'upload-image': {
        const { article_id, base64 } = payload
        const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
        if (!matches || !matches[2]) throw new Error('Invalid base64 image data')

        const contentType = matches[1]
        const base64Data = matches[2]
        const binaryStr = atob(base64Data)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i)
        }

        // Ensure bucket exists (idempotent)
        const { data: buckets } = await sb.storage.listBuckets()
        if (!buckets?.find((b: { name: string }) => b.name === 'article-images')) {
          await sb.storage.createBucket('article-images', {
            public: true,
            fileSizeLimit: 2097152, // 2 MB
          })
        }

        const ext = contentType === 'image/png' ? 'png' : 'jpg'
        const path = `${article_id}/${Date.now()}.${ext}`

        const { error: uploadError } = await sb.storage
          .from('article-images')
          .upload(path, bytes, { contentType, upsert: false })

        if (uploadError) throw uploadError

        const { data: urlData } = sb.storage
          .from('article-images')
          .getPublicUrl(path)

        // Update the article's image_url in DB
        await sb.from('articles').update({ image_url: urlData.publicUrl }).eq('id', article_id)

        return new Response(JSON.stringify({ url: urlData.publicUrl }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      default:
        throw new Error(`Unknown action: ${action}`)
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
