-- Add author and quality_score columns to articles
ALTER TABLE articles ADD COLUMN IF NOT EXISTS author TEXT DEFAULT 'TrendWire Staff';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS quality_score REAL;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS quality_details JSONB;
