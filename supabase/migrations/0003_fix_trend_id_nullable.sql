-- TrendWire Philippines — Fix trend_id nullable constraint
-- The CI publishes drafts without a trend_id, so the column must allow NULL

ALTER TABLE articles ALTER COLUMN trend_id DROP NOT NULL;
