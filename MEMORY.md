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
2. **0002** — Added missing columns (`category`, `content_html`, `image_url`, `image_prompt`, `seo_description`, `tags`, `featured`, `views`) + recreated RLS policies
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

## Known Issues & Gotchas

### Resolved
- ✅ **Missing columns** — Migration 0002 added missing `articles` columns (caused `PGRST204` error)
- ✅ **trend_id NOT NULL** — Migration 0003 dropped the NOT NULL constraint (caused `23502` error when publishing without `--trend-id`)
- ✅ **Hardcoded API key** — `test_pipeline.py` previously had the service key hardcoded; now reads from env vars

### Watch Out For
- **Draft re-publishing** — The CI publishes the latest draft on every push. If no new drafts exist, the same draft gets published again (with a timestamped slug). Delete or rename used drafts to avoid duplicates.
- **Frontend cache** — The article list is cached in-memory on first load. New articles won't appear until the user refreshes the page.
- **GitHub Pages 404 on fresh deploy** — Can take 2–5 minutes for Pages to deploy after enabling or pushing changes.
- **RLS for editors** — The "Admins manage articles" policy requires a matching `profiles` entry. Editors/admins must sign up through Supabase Auth first.

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
