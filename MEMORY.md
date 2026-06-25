# TrendWire Philippines — Project Memory

## Overview

TrendWire Philippines is an automated news publishing system that fetches trending topics from Google Trends Philippines, generates articles using AI (via OpenRouter), publishes them to Supabase, and displays them on a GitHub Pages frontend.

**Live site:** https://mack0y.github.io/TrendwirePhilippines/  
**GitHub repo:** https://github.com/mack0y/TrendwirePhilippines  
**Supabase project:** `nvxykufajzppjtkmbtte`

---

## Architecture

```
Google Trends PH RSS ──┐
                        ├──>  fetch-multi-sources (Deno)  ──>  trends table (Supabase)
Rappler RSS ───────────┘          │
                                  ├─ dedup + score cross-source
                                  └─ Telegram alerts (score ≥ 50)
                                                                   │
                                                                   ▼
                                                           generate-article (Deno)
                                                       (OpenRouter LLM, model-selectable)
                                                                   │
                                                                   ▼
                                                           articles table (draft)
                                                                   │
                                                    ┌────────────────┴────────────────┐
                                                    │                               │
                                             publish-article.py               Admin Editor
                                             (CLI / CI)                    (inline split-pane)
                                                                              │
                                                    │                    ┌────────┴──────────┐
                                                    ▼                    ▼                   ▼
                                           articles table           Edit fields       Photo section
                                           (published)           (title, summary,    (Pollinations AI
                                                    │             content, tags,      image generation
                                                    ▼             category, SEO)      or file upload)
                                           GitHub Pages                                    │
                                       (index.html → Supabase API)                                                              admin-operations
                                                                                    (Edge Function)
                                                                                  ┌────┴────┐
                                                                              Supabase      Supabase
                                                                              Storage        articles
                                                                            (article-images)  (update)
```

### Data Flow (Admin Editor)

1. **Fetch Trends** — Admin page loads trends from DB; background-fetches from Google Trends
2. **Generate** — Select a model (owl-alpha or deepseek-v4-flash), click Generate → `generate-article` Edge Function saves draft in Supabase
3. **Edit** — Split-pane editor opens inline: edit title, summary, content, tags, category, SEO description
4. **Photo** — Enter image prompt → "Generate with AI" uses free Pollinations.ai → preview → "Use This Photo" saves to Supabase Storage via `admin-operations`
5. **Save / Publish** — Save Draft calls `admin-operations update-article`; Publish flips status to `published` with content validation

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Database | Supabase (PostgreSQL) |
| Edge Functions | Deno (TypeScript) |
| AI/LLM | OpenRouter (owl-alpha / deepseek-v4-flash / openrouter/free, selectable) |
| AI Images | Pollinations.ai (free, no API key) |
| Image Storage | Supabase Storage (article-images bucket) |
| CLI tool | Python 3.11+ |
| CI/CD | GitHub Actions |
| Frontend | HTML / CSS / JavaScript (vanilla) |
| Hosting | GitHub Pages |

---

## Project Structure

```
├── .github/workflows/
│   ├── auto-fetch-trends.yml      # Fetches trends from all sources every 30 min
│   ├── publish-article.yml        # Manual/dispatch article publishing
│   └── publish-ghpages.yml        # Auto-publish latest draft on push to main
├── drafts/                           # (empty — deleted test draft)
├── scripts/
│   ├── publish-article.py         # CLI: validate & publish drafts to Supabase
│   └── test_pipeline.py           # Manual end-to-end pipeline test
├── supabase/
│   ├── functions/
│   │   ├── fetch-trends/
│   │   │   └── index.ts           # Poll Google Trends PH RSS (original, single-source)
│   │   ├── fetch-multi-sources/
│   │   │   └── index.ts           # Multi-source fetcher: Google Trends + Rappler, dedup, Telegram alerts
│   │   ├── generate-article/
│   │   │   └── index.ts           # Call OpenRouter LLM (model-selectable)
│   │   ├── admin-operations/
│   │   │   └── index.ts           # Admin CRUD: get/update/publish article + upload image
│   └── migrations/
│       ├── 0001_initial_schema.sql
│       ├── 0002_add_missing_columns.sql
│       ├── 0003_fix_trend_id_nullable.sql
│       └── 0004_article_images_bucket.sql    # Storage bucket + RLS policies
├── index.html                     # Frontend: main SPA entry point
├── style.css                      # Frontend: styles
├── app.js                         # Frontend: Supabase client + routing + admin editor
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

### Storage Bucket

**`article-images`** — Article photos
- Public read access (anyone can view images)
- Service role full access (Edge Function uploads)
- Max file size: 2 MB
- Allowed MIME types: image/jpeg, image/png, image/webp, image/gif

### Migrations Applied

1. **0001** — Initial schema: all tables, indexes, RLS policies
2. **0002** — Idempotent safety net: `ADD COLUMN IF NOT EXISTS` for `category`, `content_html`, `image_url`, `image_prompt`, `seo_description`, `tags`, `featured`, `views`, plus drop/recreate of the articles RLS policies. These columns already exist in the committed 0001, but an earlier 0001 revision was deployed to the live DB without them — 0002 guarantees they're present regardless of which 0001 was applied.
3. **0003** — Dropped `NOT NULL` constraint on `articles.trend_id` (CI publishes drafts without a trend_id)
4. **0004** — Created `article-images` storage bucket with public read & service role RLS policies (idempotent)

---

## Environment Variables

| Variable | Used By | Required |
|---|---|---|
| `SUPABASE_URL` | All functions & scripts | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions | ✅ |
| `SUPABASE_SERVICE_KEY` | Python scripts | ✅ |
| `OPENROUTER_API_KEY` | `generate-article` function | ✅ |
| `OPENROUTER_MODEL` | `generate-article` function (default: `openrouter/owl-alpha`, overrideable from frontend) | ❌ |
| `TELEGRAM_BOT_TOKEN` | `fetch-multi-sources` function | ❌ (alerts skipped if not set) |
| `TELEGRAM_CHAT_ID` | `fetch-multi-sources` function | ❌ (alerts skipped if not set) |
| `SITE_URL` | `fetch-multi-sources` function (default: GitHub Pages URL) | ❌ |
| `PAT_TOKEN` | GitHub Actions workflows (push to main) | ✅ (for workflows that commit) |

### Frontend (public, embedded in app.js)
- `SUPABASE_URL` — `https://nvxykufajzppjtkmbtte.supabase.co`
- `SUPABASE_ANON_KEY` — anon/public key for client-side reads

---

## CI/CD Workflows

### `publish-ghpages.yml`
- **Trigger:** Push to `main` or `workflow_dispatch`
- **Steps:** Checkout (with PAT) → Setup Python → Install `supabase` → Run `publish-article.py --latest` → Commit & push via `git push` with PAT
- **Secrets:** `SUPABASE_SERVICE_KEY`, `SUPABASE_URL`, `PAT_TOKEN`
- **Note:** Uses raw `git push` with `x-access-token` PAT authentication (not `stefanzweifel/git-auto-commit-action`) to bypass branch protection

### `publish-article.yml`
- **Trigger:** `workflow_dispatch` or `repository_dispatch`
- **Steps:** Same as above but accepts optional `article_file` and `trend_id` inputs
- **Note:** Also triggers a GitHub Pages deployment

### `generate-seo-assets.yml`
- **Trigger:** Cron every 6 hours or `workflow_dispatch`
- **Steps:** Checkout (with PAT) → Setup Python → Generate `sitemap.xml` + `feed.xml` → Commit & push via PAT
- **Secrets:** `SUPABASE_SERVICE_KEY`, `SUPABASE_URL`, `PAT_TOKEN`

### `generate-sitemap.yml`
- **Trigger:** Daily at 3AM PHT (7PM UTC) or `workflow_dispatch`
- **Steps:** Checkout (with PAT) → Generate static `sitemap.xml` → Commit & push via PAT
- **Secrets:** `PAT_TOKEN`

### `fetch-lotto-results.yml`
- **Trigger:** Cron hourly (6AM–2PM UTC) or `workflow_dispatch`
- **Steps:** Checkout → Setup Python → Run `fetch-lotto-results.py`
- **Secrets:** `SUPABASE_SERVICE_KEY`, `SUPABASE_URL`

### `auto-fetch-trends.yml`
- **Trigger:** Cron every 30 minutes (`*/30 * * * *`) or `workflow_dispatch`
- **Steps:** Calls `fetch-multi-sources` Edge Function via curl with `SUPABASE_ANON_KEY`
- **Secrets:** `SUPABASE_ANON_KEY`

---

## Edge Functions

### `fetch-trends` (original, single-source)
- Polls `https://trends.google.com/trending/rss?geo=PH`
- Parses RSS, auto-categorizes, deduplicates by title
- Stores with `impact_score` (0–100), `source_links` (JSONB), `status: 'published'`

### `fetch-multi-sources` (multi-source)
- Fetches from **Google Trends PH RSS** + **Rappler RSS** simultaneously
- **Deduplicates** across sources using smart title similarity matching (word overlap ≥ 60%)
- **Boosts** impact scores when the same topic appears in multiple sources (+15 per extra source)
- **Telegram alerts** sent for high-impact trends (score ≥ 50) with category, score, source count, and admin link
- Categorizes into 8 categories: General, Sports, Politics, Disaster, Economy, Health, Technology, Entertainment
- Gracefully degrades if Telegram secrets are not set (skips alerts)

### `generate-article`
- Takes `trend_id` and optional `model` (overrides `OPENROUTER_MODEL` env var)
- Builds category-specific prompt with XML-tagged sections, calls OpenRouter, saves draft to Supabase
- **Prompt structure:** `<persona>`, `<context>`, `<rules>`, `<thinking>` (CoT planning step), `<structure>` (category-specific), `<formatting>`, `<example>` (few-shot reference)
- Supported models: `openrouter/free` (default), `openrouter/owl-alpha`, `deepseek/deepseek-v4-flash`

### `admin-operations` (admin CRUD)
Consolidated admin Edge Function handling 6 actions:
| Action | Purpose |
|--------|---------|
| `get-article` | Fetch any article by ID (draft or published) |
| `update-article` | Save edits to title, summary, content, tags, category, SEO, image fields |
| `publish-article` | Flip status to published + set `published_at` |
| `delete-article` | Delete single article + its image from storage |
| `delete-articles` | Bulk delete multiple articles by IDs + their images |
| `upload-image` | Accept base64 → store in `article-images` bucket → return public URL + update article |

**Note:** This function was originally deployed as `rapid-processor`. It was renamed to `admin-operations` to match the project structure. The frontend calls it via `sb.functions.invoke('admin-operations', ...)`.

---

## Admin Dashboard (Frontend)

**URL:** `https://mack0y.github.io/TrendwirePhilippines/admin` (no public link — private)

### Features
- **📥 Fetch Latest PH Trends** button — Calls `fetch-trends` Edge Function, shows toast notification
- **🔍 Trend Search** — Client-side filter bar instantly searches trends by title/summary with ✕ clear button; status shows `"3/12 trends"` when filtered; empty state differentiates "No trends yet" vs "No matching trends"
- **🤖 Model Selector** — Dropdown to choose between `OpenRouter Free`, `Owl Alpha`, and `DeepSeek V4 Flash` for article generation
- **Impact score badges** — Trends display 🔥 (≥70), 📈 (≥40), or 📊 (<40) badge with score
- **Sort by highest score** — Trends ordered by `impact_score DESC`, then `created_at DESC`
- **Instant load** — Trends shown immediately from DB, then background-fetches from Google Trends
- **✏️ Generate Article** — Each trend has a button; clicking opens the **inline split-pane editor**
- **Toast notifications** — Fixed-position bar at top, auto-dismisses after 4s (green=success, blue=info, red=error)

### Inline Split-Pane Editor
When the editor is open, the admin splits into two columns:
- **Left sidebar:** Compact trend list (still scrollable)
- **Right pane:** Full article editor with:

| Field | Features |
|-------|----------|
| **Title** | Text input, live 65-char counter |
| **Summary** | Textarea, live 160-char counter |
| **Content** | Large textarea with ✏️ Edit / 👁️ Preview toggle tabs; Preview mode shows rendered HTML via `renderMarkdown()`; live word count (300–500 range indicator), `**text** → bold` hint in Edit mode |
| **Category** | Dropdown (General, Sports, Politics, Disaster, Economy, Health, Technology, Entertainment) |
| **Tags** | Text input, comma-separated, live preview as pills |
| **SEO Description** | Textarea, live 155-char counter |

### Photo Section
- **Image Prompt** — Textarea for DALL-E/Midjourney style prompt
- **🎨 Generate with AI** — Calls Pollinations.ai (free, no API key) → image preview with loading spinner
- **✅ Use This Photo** — Saves generated image to Supabase Storage via `admin-operations`
- **📁 Upload from Device** — File picker → validates 2 MB max → uploads to Supabase Storage
- **🗑️ Remove** — Removes the current photo
- **Note:** Publish is disabled until a photo is attached

### Action Buttons
- **💾 Save Draft** — Saves all edits via `admin-operations update-article`
- **📢 Publish** — Validates content (300–900 words) + photo required, then saves + publishes
- **✕ Close** — Closes the editor without saving

### Article Management Section
Below the trends list, the admin dashboard shows **Published Articles** and **Drafts** grouped with:
- ✅ **Checkboxes** — Select individual articles for bulk operations
- ✅ **Select All** — Checkbox in the Published section header to toggle all
- **🖱️ Click to Edit** — Click any article title (draft or published) to load it into the split-pane editor for editing; published articles show an `↗` external link to view the live version
- **🗑️ Delete (single)** — Per-article delete button with confirmation
- **🗑️ Delete Selected** — Orange bulk action bar appears when items are selected
- **✕ Clear** — Clears the current selection
- **📅 Date + Category badges** — Quick metadata for each article

### Content Validation (frontend)
- Title: max 65 characters (enforced by maxlength + visual counter)
- Content: 300–500 words (green indicator, blocks publish if <300 or >500)
- Photo: required before publishing (publish button disabled)

---

## Key Fixes

### Edge Function DB Mismatch (2026-06-19)
The `fetch-trends` Edge Function was written against a **migration schema** (`slug`, `impact_rating`, `search_volume`, `status: 'active'`) that didn't match the **live Supabase DB** columns. Fixed to match actual columns (`impact_score`, `source_links`, `status: 'published'`).

### Editor Implementation (2026-06-20)
- Built inline split-pane editor with live field counters
- Added free AI image generation via Pollinations.ai
- Created `rapid-processor` Edge Function for admin CRUD
- Added Supabase Storage bucket `article-images` for photo storage
- Added model selector (owl-alpha / deepseek-v4-flash / openrouter/free)
- Fixed tag XSS by using `escHtml()` in tag preview rendering
- Added content length validation (400–700 words) before publishing

### Multi-Source Fetching + Telegram Alerts (2026-06-21)
- **`fetch-multi-sources`** — New Edge Function that fetches from Google Trends PH + Rappler RSS simultaneously, deduplicates with smart title matching, boosts cross-source scores, and sends Telegram alerts for high-impact trends
- **`auto-fetch-trends.yml`** — New GitHub Actions workflow that runs `fetch-multi-sources` every 30 minutes
- **Hardcoded Telegram bot token fixed** — Removed fallback token from `fetch-multi-sources`, now reads from env var only
- **Telegram secrets set** — `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` configured as Supabase secrets
- **SUPABASE_ANON_KEY** — Added to GitHub secrets for the auto-fetch workflow
- **Function verified** — Tested successfully: 20 unique trends fetched, 12 new saved, 1 Telegram alert sent (earthquake)

### Landing Page Layout Overhaul (2026-06-22)
- **🌤️ Weather Widget** — Fetches Manila weather from wttr.in (free, no API key) displayed in a blue gradient card with temp, conditions, humidity, wind, feels-like. Loads in background on page load; updates in-place without full re-render.
- **📰 Latest Articles Sidebar** — Top 8 published articles in a numbered list with gold/silver/bronze badges for top 3. Shows date + category per item. Click any article → navigates to its `/article/slug` page. Sticky on desktop, responsive on tablet/mobile. Replaced the original trending sidebar (Google Trends data is now admin-only).
- **📰 Ticker Changed** — The scrolling ticker now shows latest published article titles instead of Google Trends data. Label changed from "🔥 TRENDING" to "📰 LATEST". Google Trends data is no longer visible to the public.
- **Layout Wider** — `--max-width` increased from 800px → 1100px so the sidebar doesn't squeeze the main content. `.landing-layout` flex container with `.landing-main` + `.landing-sidebar`.
- **Responsive** — Desktop (>1024px): sidebar sticks on scroll. Tablet (641–1024px): sidebar becomes 2-column grid below content. Mobile (≤640px): single column.
- **Telegram alert threshold lowered** — Changed from ≥70 to ≥50, tested successfully (3 alerts sent vs 0-1 before).
- **Cleanup** — Removed unused `searchTrendsDB('')` fetch from `renderList()` since neither the ticker nor the sidebar use trends anymore.

### Post-Launch Fixes (2026-06-21)
- **Pollinations cache-bust** — Added `_=${Date.now()}` to image URL so Regenerate produces a new image
- **Word count relaxed** — Lowered minimum from 400→300, raised max from 700→900
- **Color thresholds aligned** — Word counter green from 300–900 words (was 400–700)
- **Markdown rendering** — Added `renderMarkdown()` function that converts `**text**` → `<strong>`, handles `\n\n` + `\n` line breaks, strips unmatched `**`
- **`**text** → bold` hint** — Added note below editor content field explaining markdown syntax
- **Prompt updated** — LLM prompt word count changed to target 350 words, added explicit formatting rules (use `\n\n`, bold sparingly, no lists)
- **Default model** — Changed from `openrouter/owl-alpha` to `openrouter/free`
- **Delete article** — Added `delete-article` action to Edge Function + single delete button per article
- **Bulk delete** — Added `delete-articles` action (accepts `ids[]`), checkboxes, Select All, Delete Selected bulk bar

### Lotto Results & Date Picker (2026-06-21)
- **Lotto widget** — Added PCSO Lotto Results card to sidebar showing EZ2, Swertres, 6D, Lotto 6/42, Grand Lotto 6/55 results from Supabase `lotto_results` table
- **Date picker dropdown** — Browse last 30 days of lotto results via dropdown in the red lotto card header; selected date persists in-memory while navigating
- **Jackpot parsing fixed** — GMA News sends formatted numbers like `"4,000.00"`; `parseFloat()` chokes on commas returning `4` instead of `4000`. Added `.replace(/,/g, '')` before parsing so EZ2 shows ₱4,000 instead of "P4"
- **Sidebar reordered** — Latest Articles moved above Lotto Results (Weather → Articles → Lotto)

### Warm Background Texture (2026-06-22)
- **Color** — Changed from cool gray `#f0f2f5` to warm cream `#f2efe9` (newspaper feel)
- **Subtle texture** — 4 CSS gradient layers at 2–4% opacity: 🇵🇭 red glow from top, 🇵🇭 blue glow from right, 📰 newspaper lines at 36px, ◉ dot grid at 24px
- **Dark mode** — Matching layers at slightly higher opacity
- Content cards stay pure white with crisp shadows for readability

### SEO Overhaul (2026-06-22)
- **NewsArticle schema** — Upgraded from `Article` to `['NewsArticle', 'Article']` with rich ImageObject (1200x630 dimensions + caption)
- **OG article tags** — Added `article:published_time`, `article:modified_time`, `article:section`, `article:tag`
- **Robots meta** — Default `index, follow` on all pages; admin gets `noindex, nofollow`
- **Language** — Changed from `en` to `en-PH`; added locale meta tags
- **Preload hints** — `preconnect` + `dns-prefetch` for Supabase, jsDelivr, wttr.in
- **robots.txt** — Allows all, disallows `/admin`, links to sitemap
- **Sitemap workflow** — Daily GitHub Action (3AM PHT) generates `sitemap.xml` and commits to `main`

### Internal Linking (2026-06-22)
- **Breadcrumbs** — Visible `Home › Category › Title` navigation on article pages with crawlable `<a>` links
- **Clickable tags** — Tags link to `/?tag=keyword` — filters articles by that tag
- **Category links** — Category badges link to `/?category=...` for topical filtering
- **Related articles** — Grid of 4 same-category articles at bottom of each article page
- **Crawlable hero/cards/sidebar** — All article links changed from `<div onclick>` to `<a href>` for Googlebot crawlability
- **Tag filter page** — `/?tag=...` filter with clear button and filter notice

### Syntax Error Fix (2026-06-22)
- **Missing forEach closure** — `renderArticlesGrid()` had an unclosed `displayArticles.forEach(function(a, i) {` — all subsequent code (load more, innerHTML, animation) was inside the forEach body, causing `SyntaxError: missing ) after argument list` at the function's closing `}`
- **Fix** — Added `  })` after the grid closing div to properly close the forEach callback

### Edge Function Deployment & Image Upload Fix (2026-06-22)
- **Functions deployed** — All 4 Edge Functions (`admin-operations`, `fetch-trends`, `generate-article`, `fetch-multi-sources`) were never deployed! Ran `supabase link` + `supabase functions deploy` for each
- **URL-based image upload** — Changed `handleUseGeneratedImage()` to pass the Pollinations `image_url` directly to the Edge Function (server-side fetch) instead of downloading + base64-encoding in the browser — avoids the 1MB Supabase Functions body size limit
- **Edge Function updated** — `upload-image` case now supports both `image_url` (server-side fetch from URL) and `base64` (local file upload from browser)
- **Env vars verified** — `SUPABASE_SERVICE_ROLE_KEY` and all other secrets set on deployed functions

### Auto-Category from Trends (2026-06-22)
- `generate-article` Edge Function now saves `category: trend.category || 'General'` to the article insert — previously the trend's category was read for the LLM prompt context but never persisted to the article, so every generated article defaulted to "General" in the editor

### Image Prompt Improvement (2026-06-22)
- **Two-step extraction** — LLM now instructed to: STEP 1 extract specific visual elements from the article (who, where, what, objects), STEP 2 construct the prompt using those specifics
- **BAD vs GOOD examples** — Added contrastive examples showing generic vs article-specific prompts
- **Formula** — `[Specific subject] + [Specific action] + [Specific setting] + [Lighting] + [Mood] + [Style tags]`
- **Front page photo** — Explicit instruction: "Write a scene that would be the FRONT PAGE PHOTO for this story"

### Full Code Audit (2026-06-21)
- **CSS conflict fixed** — Old `.article-grid` / `.article-card` definitions were overriding the new masonry grid layout (articles rendered in single column instead of 2-column). Removed duplicate definitions.
- **Twitter meta tags fixed** — Dynamic `twitter:*` tags were using `property` attribute instead of `name`. Twitter parsers ignored them. Fixed `setMeta()` to use `name` for twitter tags, `property` for og tags.
- **Telegram alert link fixed** — Link used old hash routing (`/#/admin`). Changed to `/admin`.
- **JSON-LD SearchAction fixed** — Pointed to non-existent `#/search` route. Updated to `/search`.
- **Dead CSS removed** — Removed `.category-pills`, `.pill`, `.pill-active`, `.generated-result` block (replaced by category-tabs and publish modal).
- **`rapid-processor` → `admin-operations`** — Fixed all documentation references.

### Admin Dashboard Improvements (2026-06-21)
- **🖱️ Click to Edit** — Article management titles now clickable to open any draft/published article in the split-pane editor; published articles get an `↗` external link to view live
- **🔍 Trend Search Bar** — Client-side filter bar with instant title/summary matching, ✕ clear button, live filtered count in status bar, smart empty states
- **👁️ Markdown Preview Tab** — Content editor has ✏️ Edit / 👁️ Preview toggle tabs; Preview mode renders full HTML via `renderMarkdown()`; resets to Edit mode when opening new articles
- **Prompt Engineering Overhaul** — `generate-article` prompt restructured with XML-tagged sections (`<persona>`, `<context>`, `<rules>`, `<thinking>`, `<structure>`, `<formatting>`, `<example>`), added chain-of-thought planning step, positive formatting rules (relaxed bold to 3-6), few-shot example from test draft, richer persona with audience/voice
- **Removed test draft** — Deleted `drafts/jordan-clarkson-nba-finals-2026.json` so CI doesn't re-publish it on every push

---

## Cache-Busting History

| Version | Change |
|---------|--------|
| v2 | Initial deploy |
| v3 | CDN refresh |
| v4 | Impact badge fix |
| v5 | Impact falsy fix |
| v6 | Admin dashboard |
| v7 | Split-pane editor, Pollinations AI, image upload |
| v8 | Model selector |
| v9 | Delete article (single) + article management section |
| v10 | Bulk delete with checkboxes + Select All |
| v11 | Click to edit articles, trend search bar, markdown preview tab, prompt engineering overhaul |
| v12 | Multi-source trend fetching (Google Trends + Rappler), dedup, Telegram alerts, auto-fetch every 30 min |
| v13 | Full SEO overhaul: pushState routing, JSON-LD, OG/Twitter tags, sitemap/feed generation, 404.html fallback |
| v14 | Dynamic Newsroom landing page: hero carousel, reading progress, sliding category tabs, masonry grid, load more |
| v15 | Image prompt fine-tuning: Pollinations optimized prompts, style tags, model=flux, cache-bust fix |
| v16 | Full code audit: CSS conflict fix, Twitter meta fix, Telegram link fix, dead CSS removed, MEMORY.md cleanup |
| v17 | Weather widget + trending sidebar on landing page, Telegram threshold 70→50 |
| v18 | Layout widened 800→1100px, sidebar+ ticker now show published articles (not Google Trends), dead code cleanup |
| v19 | Lotto results widget in sidebar |
| v20 | Lotto date picker: browse last 30 days |
| v21 | Fix lotto jackpot parsing (comma bug) |
| v22 | Warm cream background + PH flag glow + newspaper texture |
| v23 | SEO overhaul: NewsArticle schema, OG tags, robots.txt, sitemap, preload hints |
| v24 | Internal linking: breadcrumbs, clickable tags, related articles, crawlable links |
| v25 | Fix syntax error: close unclosed forEach callback |
| v26 | Fix image upload: deploy Edge Functions, URL-based upload to avoid body size limit |
| v27 | Fix GitHub Actions push permissions (PAT_TOKEN), word count target 350, raw shell git push |

- `index.html` uses `<script src="app.js?v=N">` to force CDN refresh
- Bump `N` on each deploy
- GitHub Pages CDN can take 1–5 minutes to propagate

---

## Known Issues & Gotchas

### Resolved
- ✅ **Missing columns** — Migration 0002 added missing `articles` columns (caused `PGRST204` error)
- ✅ **trend_id NOT NULL** — Migration 0003 dropped the NOT NULL constraint (caused `23502` error when publishing without `--trend-id`)
- ✅ **Hardcoded API key** — `test_pipeline.py` previously had the service key hardcoded; now reads from env vars
- ✅ **`.env.example` stale** — Replaced Vite-style `VITE_*` names with the real vars
- ✅ **Draft re-publishing duplicates** — `publish-article.py` now moves published drafts into `drafts/published/`
- ✅ **Category naming mismatch** — Sample draft normalized from `Sports/Entertainment` to `Sports`
- ✅ **Edge Function DB mismatch** — `fetch-trends` was using wrong columns, fixed to match live DB
- ✅ **Impact score falsy bug** — Fixed `t.impact_score != null` check
- ✅ **Tag XSS** — Tag preview in editor now uses `escHtml()` escaping
- ✅ **Content validation** — Frontend blocks publish if content is <300 or >500 words

### Watch Out For
- **OpenRouter rate limit** — The free tier has a daily request cap. When exceeded, generation returns "Rate limit exceeded: free-models-per-day. Add $5 to unlock 1000 free requests/day."
- **Draft re-publishing** — Published drafts are auto-archived to `drafts/published/`. To re-publish, restore from there.
- **Stale category on live rows** — The original Clarkson article still carries `category: "Sports/Entertainment"` from before normalization.
- **Frontend cache** — The article list is cached in-memory on first load. Refresh page to see new articles.
- **GitHub Pages 404 on fresh deploy** — Can take 2–5 minutes for Pages to deploy after pushing.
- **CDN cache on frontend** — After pushing JS changes, increment `?v=N` in `index.html`.
- **Model selector reset** — Resets to default on page reload (no localStorage persistence).
- **Test drafts in DB** — After prompt verification, 2 test drafts remain in the database. Delete from admin dashboard article management.
- **Test draft deleted from filesystem** — `drafts/jordan-clarkson-nba-finals-2026.json` was removed so CI won't re-publish it, but published Clarkson articles still exist in the DB.
- **Pollinations.ai reliability** — Free AI image generation may have variable latency or occasional failures.
- **Supabase Storage free tier** — 1 GB total storage, 5 GB/month bandwidth, 2 MB max per file.

---

## Live Verification (2026-06-19)

Full end-to-end test run against production (Python 3.14 + `supabase` 2.31.0):

| Step | Result |
|---|---|
| Service-key DB access | ✅ Full read/write confirmed |
| `publish-article.py --latest --dry-run` | ✅ Valid (524 words, title 54 chars, no forbidden phrases) |
| `test_pipeline.py` full E2E | ✅ connection → fetch → generate → publish verified |
| Duplicate cleanup | ✅ Deleted 2 timestamped-slug copies; kept original |
| Frontend read path (anon key) | ✅ Returns 2 clean articles |

### Current Production State
- **2 published articles** in DB (Scotland World Cup + Jordan Clarkson — to be cleaned up from admin)
- **12 trends** in the DB
- **2 drafts** in DB (test articles from prompt verification)
- **Supabase access token** — stored in conversation (do not commit to git)

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
- Content: 300–500 words
- No forbidden phrases: "Google Trends", "search volume", "trending data", "Filipinos are searching"

---

## Running Tests

```bash
# End-to-end pipeline test (requires env vars)
python scripts/test_pipeline.py
```

This tests: connection → fetch trends → get latest trend → generate article → publish.

---

## Deployment Steps (after code changes)

```bash
# 1. Deploy/update Edge Functions
supabase functions deploy fetch-trends --project-ref nvxykufajzppjtkmbtte
supabase functions deploy fetch-multi-sources --project-ref nvxykufajzppjtkmbtte
supabase functions deploy generate-article --project-ref nvxykufajzppjtkmbtte
supabase functions deploy admin-operations --project-ref nvxykufajzppjtkmbtte

# 2. Run migrations (if new)
# Open https://supabase.com/dashboard/project/nvxykufajzppjtkmbtte/sql/new
# Paste and run any new migration files

# 3. Push to GitHub
git add -A && git commit -m "description" && git push
```

---

## Security Notes

- **Anon key in frontend** is safe — Supabase RLS restricts reads to `status = 'published'` only
- **Service role key** is NEVER used client-side; reserved for backend scripts and Edge Functions
- **GitHub Secrets** store all credentials for CI workflows
- Row-Level Security is enabled on all tables + storage bucket
