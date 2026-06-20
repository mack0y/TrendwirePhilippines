-- TrendWire Philippines — Create article-images storage bucket
-- Run this in the Supabase SQL Editor after deploying admin-operations function.
-- The Edge Function can auto-create the bucket on first use, but this migration
-- ensures the bucket and its RLS policies exist before any uploads happen.

-- Create the bucket (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'article-images',
  'article-images',
  true,
  2097152, -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- Allow public read access to article images (so they display on the frontend)
DROP POLICY IF EXISTS "Public read access" ON storage.objects;
CREATE POLICY "Public read access"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'article-images');

-- Allow service role (Edge Function) full access
DROP POLICY IF EXISTS "Service role full access" ON storage.objects;
CREATE POLICY "Service role full access"
  ON storage.objects FOR ALL
  USING (bucket_id = 'article-images' AND auth.role() = 'service_role');
