# TrendWire Philippines — Project Briefing

## Stack
- **Backend**: Supabase Edge Functions (Deno TypeScript) — 5 functions
- **LLM**: OpenRouter via Deno (article generation via LLM)
- **Scripts**: Python 3 (publishing, feed generation, sitemap, Facebook posting)
- **Frontend**: Static HTML/CSS/JS hosted on GitHub Pages
- **Database**: Supabase PostgreSQL

## Functions (supabase/functions/)
- `fetch-trends/` — Polls Google Trends PH RSS, parses, categorizes
- `fetch-multi-sources/` — Multi-source news fetching
- `generate-article/` — LLM article generation via OpenRouter
- `quality-check/` — Article validation before publishing
- `admin-operations/` — Admin CRUD operations

## Scripts (scripts/)
- `publish-article.py` — Validates and publishes articles
- `test_pipeline.py` — Pipeline testing
- `post-to-facebook.py` — Social media posting
- `generate-feed.py` / `generate-sitemap.py` — SEO feeds
- `generate-article-pages.py` — Static page generation
- `fetch-lotto-results.py` — Lotto data fetching

## Known Issues
- `OPENROUTER_API_KEY` used in Edge Functions — check secure handling
- Static site with no build step (vanilla HTML/CSS/JS)
- `package-lock.json` is only 99 bytes — likely placeholder

## For Code Reviewers
- Check API key handling in Edge Functions (Deno env vars vs hardcoded)
- Verify error handling in all functions
- Check LLM prompt injection risks in `generate-article/`
- Review Python scripts for security (file paths, subprocess calls)
- Look for hardcoded URLs or secrets in static files (app.js)

## For Testers
- Python scripts can be tested with pytest
- Edge Functions need a local Supabase setup
- No existing test files found
