# TrendWire Philippines 🇵🇭

Automated news publisher that fetches trending topics from Google Trends Philippines, generates well-written articles using AI, and publishes them — all on autopilot.

## How It Works

```
Google Trends PH RSS  ──>  fetch-trends  ──>  trends table
                          (Deno Edge Function)       │
                                                      ▼
                                              generate-article
                                          (OpenRouter LLM via Deno)
                                                      │
                                                      ▼
                                              articles table (draft)
                                                      │
                                                      ▼
                                              publish-article.py
                                                  (CLI / CI)
                                                      │
                                                      ▼
                                              articles table (published)
                                                      │
                                                      ▼
                                              GitHub Pages
```

1. **Fetch** — A Supabase Edge Function polls Google Trends Philippines RSS, parses trending topics, auto-categorizes them (Disaster, Politics, Sports, Economy, Health, General), and stores new trends in the database.
2. **Generate** — Another Edge Function takes a trend, builds a category-specific prompt (news explainer, sports recap, service journalism, etc.), sends it to an LLM via OpenRouter, and saves the result as a **draft** article.
3. **Publish** — A Python CLI script validates the article (word count, forbidden phrases, title length) and publishes it to Supabase.

## Prerequisites

- [Supabase](https://supabase.com) project
- [OpenRouter](https://openrouter.ai) API key
- Python 3.11+
- (Optional) [Deno](https://deno.com) for local Edge Function development

## Setup

### 1. Supabase Project

Create a Supabase project and open the [SQL Editor](https://supabase.com/dashboard/project/_/sql/new). Copy the contents of `supabase/migrations/0001_initial_schema.sql` and paste them in, then click **Run** to set up the database schema.

This creates four tables:
- `profiles` — user accounts with roles (reader, editor, admin)
- `trends` — trending topics fetched from Google Trends PH
- `trend_sources` — source URLs and snippets per trend
- `articles` — generated articles with status tracking (draft → review → published)

### 2. Deploy Edge Functions

Deploy the two Supabase Edge Functions using the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase functions deploy fetch-trends
supabase functions deploy generate-article
```

Set the required secrets:

```bash
supabase secrets set SUPABASE_URL=<your-project-url>
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
supabase secrets set OPENROUTER_API_KEY=<your-openrouter-key>
supabase secrets set OPENROUTER_MODEL=poolside/laguna-xs-2.1:free  # optional, default
```

### 3. Environment Variables

Copy the following into a `.env` file for local scripts:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

### 4. Install Python Dependencies

```bash
pip install supabase
```

## Usage

### Manual: Publish a Draft Article

The `publish-article.py` script validates and publishes articles to Supabase. On a successful publish from a file (`--latest` or `--file`), the draft is automatically moved into `drafts/published/` so it won't be re-published by the next CI run.

```bash
# Publish the latest unpublished draft from the drafts/ folder
python scripts/publish-article.py --latest

# Publish a specific draft file
python scripts/publish-article.py --file drafts/my-article.json

# Publish inline JSON
python scripts/publish-article.py --json '{"title": "...", "content": "..."}'

# Dry run (validate without publishing)
python scripts/publish-article.py --latest --dry-run
```

Validation checks:
- Title ≤ 65 characters
- Content between 400–700 words
- No forbidden phrases (e.g., "Google Trends", "search volume")

### End-to-End Pipeline Test

```bash
python scripts/test_pipeline.py
```

This runs the full pipeline: connection check → fetch trends → get latest trend → generate article → publish.

### Draft Format

Draft articles are JSON files in the `drafts/` directory. See `drafts/jordan-clarkson-nba-finals-2026.json` for an example:

```json
{
  "title": "Article headline (max 65 chars)",
  "summary": "Two-sentence summary (max 160 chars)",
  "content": "Full article in markdown (400-700 words)",
  "seo_description": "SEO meta description (max 155 chars)",
  "tags": ["tag1", "tag2", "tag3", "tag4"],
  "image_prompt": "DALL-E / Midjourney image prompt",
  "category": "Sports/Entertainment"
}
```

## Automated Pipeline (CI/CD)

### On Push to `main`

The `publish-ghpages.yml` workflow automatically:
1. Reads the latest draft from `drafts/`
2. Validates and publishes it to Supabase
3. Commits any changes back

### Manual Trigger

The `publish-article.yml` workflow can be triggered manually via the GitHub Actions UI or via `repository_dispatch`.

## Project Structure

```
├── .github/workflows/
│   ├── publish-article.yml       # Manual/dispatch article publishing
│   └── publish-ghpages.yml       # Auto-publish on push to main
├── drafts/                        # Draft article JSON files
│   └── jordan-clarkson-nba-finals-2026.json
├── scripts/
│   ├── publish-article.py         # CLI tool to validate & publish drafts
│   └── test_pipeline.py           # End-to-end pipeline test
├── supabase/
│   ├── functions/
│   │   ├── fetch-trends/          # Edge Function: polls Google Trends PH RSS
│   │   │   └── index.ts
│   │   └── generate-article/      # Edge Function: calls LLM to write articles
│   │       └── index.ts
│   └── migrations/
│       ├── 0001_initial_schema.sql     # Tables, indexes, RLS
│       ├── 0002_add_missing_columns.sql # Idempotent safety net for articles columns
│       └── 0003_fix_trend_id_nullable.sql
├── .gitignore
└── README.md
```

## Environment Variables Reference

| Variable | Used By | Required |
|---|---|---|
| `SUPABASE_URL` | All functions & scripts | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions | ✅ |
| `SUPABASE_SERVICE_KEY` | Python scripts | ✅ |
| `OPENROUTER_API_KEY` | `generate-article` function | ✅ |
| `OPENROUTER_MODEL` | `generate-article` function | ❌ (default: `poolside/laguna-xs-2.1:free`) |

## Security Notes

- The `SUPABASE_SERVICE_KEY` has full access to your database — never commit it to version control
- Use `.env` files locally and GitHub Secrets in CI
- Never hardcode credentials (use environment variables)
- The database uses Row-Level Security (RLS) to restrict article reads to published status
