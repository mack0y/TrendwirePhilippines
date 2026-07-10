import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/*
 * Authentication: Checks for a bearer token in the Authorization header.
 * Set ADMIN_SECRET_KEY in your Supabase Edge Function secrets to protect
 * this endpoint. Requests without a valid token receive a 401 response.
 * Upgrade path: Replace the simple token check with Supabase Auth JWT
 * verification once a login flow is built into the admin dashboard.
 */

function checkAuth(req: Request): void {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Missing or malformed Authorization header. Pass a Bearer token.')
  }
  const token = authHeader.slice('Bearer '.length)
  const adminSecret = Deno.env.get('ADMIN_SECRET_KEY')
  if (!adminSecret) {
    throw new AuthError('ADMIN_SECRET_KEY not configured on the server. Set it in Edge Function secrets.')
  }
  if (token !== adminSecret) {
    throw new AuthError('Invalid admin token.')
  }
}

class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Authenticate every request before processing
    checkAuth(req)

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
          'seo_description', 'image_prompt', 'image_url', 'author']
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
        // Only set published_at if it's not already set (preserve original publish date on re-publish)
        const { data: existing } = await sb.from('articles')
          .select('published_at').eq('id', id).maybeSingle()
        const published_at = existing?.published_at || new Date().toISOString()
        const { data, error } = await sb.from('articles')
          .update({ status: 'published', published_at })
          .eq('id', id).select().single()
        if (error) throw error
        return new Response(JSON.stringify(data),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      case 'delete-article': {
        const { id } = payload
        if (!id) throw new Error('id required')
        // Delete the article's image from storage if it exists
        const { data: article } = await sb.from('articles').select('id, image_url').eq('id', id).maybeSingle()
        if (article?.image_url) {
          const pathMatch = article.image_url.match(/\/article-images\/(.+)$/)
          if (pathMatch) {
            await sb.storage.from('article-images').remove([pathMatch[1]])
              .catch(() => {}) // don't fail if image removal fails
          }
        }
        // Delete the article (or skip if already deleted)
        if (article) {
          const { error } = await sb.from('articles').delete().eq('id', id)
          if (error) throw error
        }
        return new Response(JSON.stringify({ success: true, id }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      case 'delete-articles': {
        const { ids } = payload
        if (!ids || !Array.isArray(ids) || !ids.length) throw new Error('ids array required')
        // Delete images from storage for all articles
        const { data: articles } = await sb.from('articles').select('id, image_url').in('id', ids)
        if (articles) {
          for (const article of articles) {
            if (article.image_url) {
              const pathMatch = article.image_url.match(/\/article-images\/(.+)$/)
              if (pathMatch) {
                await sb.storage.from('article-images').remove([pathMatch[1]])
                  .catch(() => {})
              }
            }
          }
        }
        // Bulk delete all articles
        const { error } = await sb.from('articles').delete().in('id', ids)
        if (error) throw error
        return new Response(JSON.stringify({ success: true, deleted: ids.length }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      case 'upload-image': {
        const { article_id, image_url, base64 } = payload

        // Support both: pass image URL (Edge Function fetches it) or pass base64 directly
        let bytes: Uint8Array
        let contentType = 'image/jpeg'

        if (image_url) {
          // Fetch from URL server-side — avoids request body size limits
          const imgResp = await fetch(image_url)
          if (!imgResp.ok) throw new Error('Failed to fetch image from URL')
          const imgBuffer = await imgResp.arrayBuffer()
          bytes = new Uint8Array(imgBuffer)
          const ct = imgResp.headers.get('content-type') || ''
          if (ct) contentType = ct
        } else if (base64) {
          // Legacy: base64 data passed from the browser
          const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
          if (!matches || !matches[2]) throw new Error('Invalid base64 image data')
          contentType = matches[1]
          const base64Data = matches[2]
          const binaryStr = atob(base64Data)
          bytes = new Uint8Array(binaryStr.length)
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i)
          }
        } else {
          throw new Error('Either image_url or base64 is required')
        }

        // Ensure bucket exists (idempotent)
        const { data: buckets } = await sb.storage.listBuckets()
        if (!buckets?.find((b: { name: string }) => b.name === 'article-images')) {
          await sb.storage.createBucket('article-images', {
            public: true,
            fileSizeLimit: 2097152, // 2 MB
          })
        }

        const ext = contentType.includes('png') ? 'png' : 'jpg'
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
    const status = e instanceof AuthError ? 401 : 500
    return new Response(JSON.stringify({ error: e.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status })
  }
})
