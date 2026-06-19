-- TrendWire Philippines — Ensure all article columns exist
-- History: the columns below were already part of 0001_initial_schema.sql,
-- but an earlier version of 0001 deployed to the live database was missing them.
-- This migration is idempotent (safe to re-run) and guarantees the articles
-- table has every column the Edge Functions and publish script expect,
-- regardless of which 0001 revision was applied.
-- It also recreates the RLS policies so SELECT/ALL access is consistent.

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS content_html    TEXT,
  ADD COLUMN IF NOT EXISTS image_url       TEXT,
  ADD COLUMN IF NOT EXISTS image_prompt    TEXT,
  ADD COLUMN IF NOT EXISTS seo_description TEXT,
  ADD COLUMN IF NOT EXISTS tags            TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS category        TEXT DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS featured        BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS views           INTEGER DEFAULT 0;

-- Recreate RLS policies defensively (drop-then-create so re-runs don't error).
DROP POLICY IF EXISTS "Published articles viewable by everyone" ON articles;
DROP POLICY IF EXISTS "Admins manage articles" ON articles;

CREATE POLICY "Published articles viewable by everyone"
  ON articles FOR SELECT
  USING (status = 'published');

CREATE POLICY "Admins manage articles"
  ON articles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'editor')
    )
  );
