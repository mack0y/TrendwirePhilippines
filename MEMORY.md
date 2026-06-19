# TrendWire Philippines — Project Memory

## Overview

TrendWire Philippines is an automated news publishing system that fetches trending topics from Google Trends Philippines, generates articles using AI (via OpenRouter), publishes them to Supabase, and displays them on a GitHub Pages frontend.

**Live site:** https://mack0y.github.io/TrendwirePhilippines/  
**GitHub repo:** https://github.com/mack0y/TrendwirePhilippines  
**Supabase project:** `nvxykufajzppjtkmbtte`

---

## Architecture

```
Google Trends PH RSS  ──>  fetch-trends (Deno)  ──>  trends table (Supabase)
                                                          │
                                                          ▼
                                                  generate-article (Deno)
                                              (OpenRouter LLM → owl-alpha)
                                                          │
                                                          ▼
                                                  articles table (draft)
                                                          │
                                                          ▼
                                                  publish-article.py (CLI/CI)
                                                          │
                                                          ▼
                                                  articles table (published)
                                                          │
                                                          ▼
                                                  GitHub Pages frontend
                                              (index.html → Supabase API)
```

### Data Flow

1. **Fetch** — `fetch-trends` Edge Function polls `https://trends.google.com/trending/rss?geo=PH`, parses RSS, auto-categorizes trends, deduplicates by slug, stores new trends with source URLs in Supabase.
2. **Generate** — `generate-article` Edge Function takes a `trend_id`, fetches trend + sources, builds a category-specific prompt, calls OpenRouter's `owl-alpha` model, saves the AI-generated article as **draft** in Supabase.
3. **Publish** — `publish-article.py` CLI tool validates draft JSON files (title ≤ 65 chars, content 400–700 words, no forbidden phrases), inserts as **published** into Supabase.
4. **Display** — Static frontend on GitHub Pages fetches published articles from Supabase via the anon key (RLS-protected, read-only).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Database | Supabase (PostgreSQL) |
| Edge Functions | Deno (TypeScript) |
| AI/LLM | OpenRouter → owl-alpha |
| CLI tool | Python 3.11+ |
| CI/CD | GitHub Actions |
| Frontend | HTML / CSS / JavaScript (vanilla) |
| Hosting | GitHub Pages |

---

## Project Structure

```
├── .github/workflows/
│   ├── publish-article.yml        # Manual/dispatch article publishing
│   └── publish-ghpages.yml        # Auto-publish latest draft on push to main
├── drafts/
│   └── jordan-clarkson-nba-finals-2026.json   # Sample draft article
├── scripts/
│   ├── publish-article.py         # CLI: validate & publish drafts to Supabase
│   └── test_pipeline.py           # Manual end-to-end pipeline test
├── supabase/
│   ├── functions/
│   │   ├── fetch-trends/
│   │   │   └── index.ts           # Poll Google Trends PH RSS
│   │   └── generate-article/
│   │       └── index.ts           # Call OpenRouter LLM to write articles
│   └── migrations/
│       ├── 0001_initial_schema.sql
│       ├── 0002_add_missing_columns.sql
│       └── 0003_fix_trend_id_nullable.sql
├── index.html                     # Frontend: main SPA entry point
├── style.css                      # Frontend: styles
├── app.js                         # Frontend: Supabase client + routing
├── README.md
├── MEMORY.md                      # This file
└── .gitignore
```

---

## Database Schema (Supabase)

### Tables

**`profiles`** — User accounts (linked to `auth.users`)
- `id` (UUID, PK), `email`, `full_name`, `role` (reader|editor|admin), `avatar_url`
- RLS: SELECT for everyone

**`trends`** — Trending topics from Google Trends PH
- `id` (UUID, PK), `title`, `slug` (unique), `summary`, `category`, `impact_rating` (Low|Medium|High|Critical), `search_volume`, `status` (active|archived|used), `published_at`
- RLS: SELECT for everyone

**`trend_sources`** — Source URLs per trend
- `id` (UUID, PK), `trend_id` (FK → trends), `source_name`, `source_url`, `snippet`, `published_at`
- RLS: SELECT for everyone

**`articles`** — Published and draft articles
- `id` (UUID, PK), `trend_id` (FK → trends, nullable), `title`, `slug` (unique), `summary`, `content`, `content_html`, `image_url`, `image_prompt`, `seo_description`, `tags` (TEXT[]), `category`, `status` (draft|review|published|archived), `featured`, `views`, `published_at`
- RLS: SELECT for published articles only (anon), ALL for admin/editor roles

### Migrations Applied

1. **0001** — Initial schema: all tables, indexes, RLS policies
2. **0002** — Idempotent safety net: `ADD COLUMN IF NOT EXISTS` for `category`, `content_html`, `image_url`, `image_prompt`, `seo_description`, `tags`, `featured`, `views`, plus drop/recreate of the articles RLS policies. These columns already exist in the committed 0001, but an earlier 0001 revision was deployed to the live DB without them — 0002 guarantees they're present regardless of which 0001 was applied.
3. **0003** — Dropped `NOT NULL` constraint on `articles.trend_id` (CI publishes drafts without a trend_id)

---

## Environment Variables

| Variable | Used By | Required |
|---|---|---|
| `SUPABASE_URL` | All functions & scripts | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions | ✅ |
| `SUPABASE_SERVICE_KEY` | Python scripts | ✅ |
| `OPENROUTER_API_KEY` | `generate-article` function | ✅ |
| `OPENROUTER_MODEL` | `generate-article` function (default: `openrouter/owl-alpha`) | ❌ |

### Frontend (public, embedded in app.js)
- `SUPABASE_URL` — `https://nvxykufajzppjtkmbtte.supabase.co`
- `SUPABASE_ANON_KEY` — anon/public key for client-side reads

---

## CI/CD Workflows

### `publish-ghpages.yml`
- **Trigger:** Push to `main` or `workflow_dispatch`
- **Steps:** Checkout → Setup Python → Install `supabase` → Run `publish-article.py --latest` → Commit changes
- **Secrets:** `SUPABASE_SERVICE_KEY`, `SUPABASE_URL`

### `publish-article.yml`
- **Trigger:** `workflow_dispatch` or `repository_dispatch`
- **Steps:** Same as above but accepts optional `article_file` and `trend_id` inputs
- **Note:** Also triggers a GitHub Pages deployment

---

## Key Fixes: Edge Function DB Mismatch

### The Problem

The `fetch-trends` Edge Function was written against a **migration schema** (`slug`, `impact_rating`, `search_volume`, `status: 'active'`) that didn't match the **live Supabase DB** columns. The live trends table has:

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK, auto-generated |
| `title` | TEXT | Trend title from RSS |
| `summary` | TEXT | Description from RSS |
| `category` | TEXT | Auto-categorized (Sports, Politics, etc.) |
| `impact_score` | INTEGER | 0–100, derived from `ht:approx_traffic` |
| `source_links` | JSONB | Array of `{url, name}` objects from RSS news items |
| `status` | TEXT | **Must be `'published'`** (check constraint, not `'active'`) |
| `created_at` | TIMESTAMPTZ | Auto |
| `updated_at` | TIMESTAMPTZ | Auto |

**Missing from live DB** (present in migration): `slug` ❌, `impact_rating` ❌, `search_volume` ❌, `published_at` ❌

### The Fix (2026-06-19)

The Edge Function was rewritten to:
- Match actual live DB columns: `title`, `summary`, `category`, `impact_score`, `source_links`, `status: 'published'`
- Use `title` for duplicate detection (exact match via `.eq()`)
- Parse `ht:approx_traffic` from RSS → convert to `impact_score` (0–100 scale)
- Parse `ht:news_item` tags → store as `source_links` array (no separate `trend_sources` table)
- Added debug logging to diagnose insert failures
- Deployed via `supabase functions deploy fetch-trends --project-ref nvxykufajzppjtkmbtte`

---

## Admin Dashboard (Frontend)

**URL:** `https://mack0y.github.io/TrendwirePhilippines/#/admin` (no public link — private)

### Features
- **📥 Fetch Latest PH Trends** button — Calls `fetch-trends` Edge Function, shows toast notification with count
- **Impact score badges** — Trends display 🔥 (≥70), 📈 (≥40), or 📊 (<40) badge with score
- **Sort by highest score** — Trends ordered by `impact_score DESC`, then `created_at DESC`
- **Instant load** — Trends shown immediately from DB, then background-fetches from Google Trends
- **✏️ Generate Article** — Each trend has a button that calls `generate-article` Edge Function
- **Article result** — Green success box with title, word count, tags, category after generation
- **Toast notifications** — Fixed-position bar at top, auto-dismisses after 4s (green=success, blue=info, red=error)

### Files Edited
- `app.js` — Added `fetchFromGoogleTrends()`, `searchTrendsDB()`, `renderAdmin()` with full admin dashboard | `showToast()` for notifications
- `style.css` — Added `.admin-toolbar`, `.fetch-btn`, `.toast`, `.impact-badge` styles
- `index.html` — Cache-bust `?v=N` increment on each deploy

### Cache-Busting
- `index.html` uses `<script src="app.js?v=N">` to force CDN refresh
- Bump `N` on each deploy: v2 → v3 → v4 → v5 → v6

---

## Known Issues & Gotchas

### Resolved
- ✅ **Missing columns** — Migration 0002 added missing `articles` columns (caused `PGRST204` error)
- ✅ **trend_id NOT NULL** — Migration 0003 dropped the NOT NULL constraint (caused `23502` error when publishing without `--trend-id`)
- ✅ **Hardcoded API key** — `test_pipeline.py` previously had the service key hardcoded; now reads from env vars
- ✅ **`.env.example` stale** — Replaced Vite-style `VITE_*` names with the real vars (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`) the scripts/functions actually read
- ✅ **Missing migration in git** — `0002_add_missing_columns.sql` is now committed (idempotent `IF NOT EXISTS` form)
- ✅ **Draft re-publishing duplicates** — `publish-article.py` now moves published drafts into `drafts/published/`, so `--latest` skips them; `--latest` with no unpublished drafts exits cleanly instead of erroring
- ✅ **`test_pipeline.py` false success** — Publish step now sends an ISO timestamp (not literal `now()`), uses `Prefer: return=representation`, and verifies the returned row's `status === 'published'`
- ✅ **Category naming mismatch** — Sample draft normalized from `Sports/Entertainment` to `Sports` (matches `fetch-trends` output and `generate-article` prompt branching)
- ✅ **Edge Function DB mismatch** — `fetch-trends` was using `slug`, `impact_rating`, `search_volume`, `status: 'active'` which don't exist in live DB. Fixed to use actual columns (`impact_score`, `source_links`, `status: 'published'`)
- ✅ **Impact score falsy bug** — `t.impact_score ? ... : ''` skipped score 0. Fixed to `t.impact_score != null`

### Watch Out For
- **Draft re-publishing** — Fixed: published drafts are auto-archived to `drafts/published/`. (Old behavior re-published the latest draft on every push with a timestamped slug.) If you ever want to re-publish, restore a draft from `drafts/published/` into `drafts/`.
- **Stale category on live rows** — The original Clarkson article (`8b559233…`) still carries `category: "Sports/Entertainment"` from before the draft was normalized to `Sports`. Cosmetic only — it displays fine, but won't match `generate-article` branching. Patch the row if you want consistency.
- **Frontend cache** — The article list is cached in-memory on first load. New articles won't appear until the user refreshes the page.
- **GitHub Pages 404 on fresh deploy** — Can take 2–5 minutes for Pages to deploy after enabling or pushing changes.
- **RLS for editors** — The "Admins manage articles" policy requires a matching `profiles` entry. Editors/admins must sign up through Supabase Auth first.
- **CDN cache on frontend** — After pushing JS changes, increment `?v=N` in `index.html` to force browser cache bust. GitHub Pages CDN can take 1–5 minutes to propagate.

---

## Live Verification (2026-06-19)

Full end-to-end test run against production (Python 3.14 + `supabase` 2.31.0):

| Step | Result |
|---|---|
| Service-key DB access | ✅ Full read/write confirmed |
| `publish-article.py --latest --dry-run` | ✅ Valid (524 words, title 54 chars, no forbidden phrases) |
| `test_pipeline.py` full E2E | ✅ connection → fetch trends (0 new, dedup ok) → grabbed "haiti vs scotland [Technology]" → owl-alpha generated *"Scotland Fans Gear Up in Beijing for World Cup Return"* → publish **verified** (`status === 'published'` via returned row) |
| Duplicate cleanup | ✅ Deleted 2 timestamped-slug Clarkson copies; kept original `8b559233…`. Articles went 4 → 2 |
| Frontend read path (anon key) | ✅ Returns 2 clean, fully-populated articles |

**Fix #5 (publish verification) proven live** — the test printed `✅ Published (verified)`, which only fires when the returned row's status is confirmed. The old code would have reported success on a no-op PATCH.

### Current Production State
- **2 published articles:**
  1. `scotland-fans-gear-up-in-beijing-for-world-cup-return` (2026-06-19, generated by owl-alpha during this test)
  2. `jordan-clarkson-one-win-away-from-filipino-nba-history` (2026-06-14, original — deduped)
- **11 trends** in the DB (all from June 19, 2026 — fetched by fixed Edge Function)
- **0 drafts** in DB
- **Old trends cleaned up** — 10 stale NBA-related trends from June 14 deleted via temporary Edge Function
- **Supabase access token** — stored in conversation for Edge Function deploys (do not commit to git)

---

## Publishing a Draft (Manual)

```bash
# From latest draft
python scripts/publish-article.py --latest

# From specific file
python scripts/publish-article.py --file drafts/my-article.json

# Dry run
python scripts/publish-article.py --latest --dry-run
```

### Validation Rules
- Title: max 65 characters
- Content: 400–700 words
- No forbidden phrases: "Google Trends", "search volume", "trending data", "Filipinos are searching"

---

## Running Tests

```bash
# End-to-end pipeline test (requires env vars)
python scripts/test_pipeline.py
```

This tests: connection → fetch trends → get latest trend → generate article → publish.

---

## Adding a New Article Manually

1. Create a JSON file in `drafts/` following the format in `jordan-clarkson-nba-finals-2026.json`
2. Push to `main` — the CI will auto-publish it
3. Verify it appears on the live site

Or publish manually:
```bash
python scripts/publish-article.py --file drafts/my-article.json
```

---

## Security Notes

- **Anon key in frontend** is safe — Supabase RLS restricts reads to `status = 'published'` only
- **Service role key** is NEVER used client-side; reserved for backend scripts and Edge Functions
- **GitHub Secrets** store all credentials for CI workflows
- Row-Level Security is enabled on all tables
