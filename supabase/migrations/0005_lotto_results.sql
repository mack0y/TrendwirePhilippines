-- TrendWire Philippines — Lotto Results Table
-- Stores PCSO draw results scraped from GMA News

CREATE TABLE IF NOT EXISTS lotto_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  draw_date DATE NOT NULL,
  game_name TEXT NOT NULL,
  draw_time TEXT NOT NULL,          -- '2PM', '5PM', or '9PM'
  results TEXT[] NOT NULL,           -- winning numbers as string array
  jackpot TEXT,                      -- prize amount (text to handle decimals)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(draw_date, game_name, draw_time)
);

-- Index for fast lookups by date (most common query)
CREATE INDEX IF NOT EXISTS idx_lotto_results_date ON lotto_results(draw_date DESC);
CREATE INDEX IF NOT EXISTS idx_lotto_results_game ON lotto_results(game_name);

-- RLS: everyone can read, only service role can write
ALTER TABLE lotto_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view lotto results" ON lotto_results
  FOR SELECT USING (true);

CREATE POLICY "Service role manages lotto results" ON lotto_results
  FOR ALL USING (auth.role() = 'service_role');
