# Architecture Debrief — TrendWire Philippines

**Reviewer**: Hermes Agent (architect)  
**Date**: 2026-07-10  
**Scope**: Centralized config, project structure, env var management, build pipeline  
**Prerequisite reading**: BRIEFING.md, DEBRIEF-code-reviewer.md, DEBRIEF-coder.md

---

## Table of Contents

1. [Hardcoded Supabase URL — Complete Inventory](#1-hardcoded-supabase-url--complete-inventory)
2. [Recommendation: Centralized Configuration](#2-recommendation-centralized-configuration)
3. [Project Structure Assessment](#3-project-structure-assessment)
4. [Environment Variable Management](#4-environment-variable-management)
5. [Build Pipeline Strategy](#5-build-pipeline-strategy)
6. [Implementation Plan](#6-implementation-plan)
7. [Risk Register](#7-risk-register)

---

## 1. Hardcoded Supabase URL — Complete Inventory

### 1.1 Files That Hardcode the URL (need centralization)

| # | File | Line(s) | Pattern | Risk |
|---|------|---------|---------|------|
| 1 | `scripts/publish-article.py` | 57 | `os.environ.get('SUPABASE_URL','https://nvxyk...')` | Fallback masks missing env var |
| 2 | `scripts/post-to-facebook.py` | 16 | `os.environ.get('SUPABASE_URL', 'https://nvxyk...')` | Fallback masks missing env var |
| 3 | `scripts/generate-article-pages.py` | 16 | `os.environ.get('SUPABASE_URL', 'https://nvxyk...')` | Fallback masks missing env var |
| 4 | `scripts/generate-sitemap.py` | 13 | `os.environ.get('SUPABASE_URL', 'https://nvxyk...')` | Fallback masks missing env var |
| 5 | `scripts/generate-feed.py` | 16 | `os.environ.get('SUPABASE_URL', 'https://nvxyk...')` | Fallback masks missing env var |
| 6 | `scripts/fetch-lotto-results.py` | 163 | `os.environ.get('SUPABASE_URL', 'https://nvxyk...')` | Fallback masks missing env var |
| 7 | `app.js` | 27 | `const SUPABASE_URL = 'https://nvxyk...'` | **No env var at all** — must be inlined for static site |
| 8 | `index.html` | 34, 37 | `<link rel="preconnect" href="...">` and `<link rel="dns-prefetch">` | Must match the actual Supabase URL for perf |
| 9 | `feed.xml` | 22, 36, 49, 63, … | Generated artifact with storage URLs in `<media:content>` | Not source code, but shows URL pervades data too |

**Total: 8 source-code locations + generated artifacts.**

### 1.2 Files That Do NOT Hardcode (reference models)

| File | Pattern | Status |
|------|---------|--------|
| `scripts/test_pipeline.py` | `os.environ.get("SUPABASE_URL")` — **no fallback**, fails if unset | ✅ Correct |
| All 5 Edge Functions | `Deno.env.get('SUPABASE_URL') ?? ''` — no hardcoded value | ✅ Correct |
| All 3 GitHub Actions workflows | `${{ secrets.SUPABASE_URL }}` | ✅ Correct |
| `.env.example` | `SUPABASE_URL=https://your-project.supabase.co` — placeholder | ✅ Acceptable |

### 1.3 The Real Problem Isn't Just Duplication

The pattern `os.environ.get('VAR', 'https://hardcoded...')` in every Python script is **defensive coding gone wrong**:

- **It masks deployment errors.** If `SUPABASE_URL` is accidentally unset in CI, the script silently connects to the wrong project instead of failing fast.
- **It creates silent drift.** The project ref gets copy-pasted across 6 files. When someone forks the project, they must find and replace all 6 locations — easy to miss one.
- **It's a documentation liability.** Every new Python script will copy the same pattern.

The Edge Functions got it right: `Deno.env.get('SUPABASE_URL') ?? ''` with no fallback. The `test_pipeline.py` also got it right: no fallback, fail fast.

---

## 2. Recommendation: Centralized Configuration

### 2.1 Architecture Decision: Three Config Layers (not one)

This project has **three fundamentally different runtimes** that need config:

| Layer | Runtime | Config Mechanism | Audience |
|-------|---------|------------------|----------|
| **Python scripts** | CLI / CI runner | OS environment + `.env` file | Developers, CI |
| **Edge Functions** | Deno on Supabase | `supabase secrets set` (managed by Supabase) | Supabase platform |
| **Frontend JS** | Browser (static) | Inlined at build time or script tag | End-users |

A single `.env` file cannot serve all three. The approach must be runtime-aware.

### 2.2 Recommendation: `scripts/config.py` for Python

Create a single `scripts/config.py` module that all Python scripts import:

```python
"""scripts/config.py — Centralized config for TrendWire Python scripts."""
import os
import sys

def require_env(var: str) -> str:
    """Get an env var or exit with a clear error — NEVER fall back to hardcoded defaults."""
    val = os.environ.get(var)
    if not val:
        print(f"❌ {var} is not set. Set it in your environment or .env file.")
        sys.exit(1)
    return val

# ── Required ──
SUPABASE_URL = require_env('SUPABASE_URL')
SUPABASE_SERVICE_KEY = require_env('SUPABASE_SERVICE_KEY')

# ── Optional with documented defaults ──
SITE_URL = os.environ.get('SITE_URL', 'https://mack0y.github.io/TrendwirePhilippines')
```

Then each Python script becomes:

```python
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY, SITE_URL
```

**Benefits:**
- Single source of truth for env var names and required/optional classification
- Fail-fast on missing required vars
- Easy to add `.env` file loading (with `python-dotenv`) in one place
- Hardcoded fallbacks eliminated from all 6 scripts

### 2.3 Recommendation: `config.js` for the Frontend

Since this is a **static site with no build step**, `config.js` must be a plain JS file loaded as a `<script>` tag before `app.js`:

```javascript
/* config.js — TrendWire frontend configuration */
/* WARNING: Values here are public (served to browsers). Never put secrets here. */
const CONFIG = {
  SUPABASE_URL: 'https://nvxykufajzppjtkmbtte.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbG...F7j0',
  SITE_URL: 'https://mack0y.github.io/TrendwirePhilippines',
  SITE_NAME: 'TrendWire Philippines',
  BASE_PATH: '/TrendwirePhilippines',
}
```

In `index.html`:
```html
<script src="config.js"></script>
<script src="app.js"></script>
```

In `app.js`:
```javascript
const SUPABASE_URL = CONFIG.SUPABASE_URL
const SUPABASE_ANON_KEY = CONFIG.SUPABASE_ANON_KEY
// ... etc
```

**For `index.html` preconnect/dns-prefetch**: These should reference `CONFIG.SUPABASE_URL` too. Since they can't be dynamic without a build step, add a comment referencing `config.js`:

```html
<!-- IMPORTANT: When changing SUPABASE_URL, update config.js AND the URL below -->
  <link rel="preconnect" href="https://nvxykufajzppjtkmbtte.supabase.co">
  <link rel="dns-prefetch" href="https://nvxykufajzppjtkmbtte.supabase.co">
```

### 2.4 Recommendation: Edge Function Env Vars

Already well-implemented. One improvement: add runtime validation at the top of each function:

```typescript
function requireEnv(name: string): string {
  const val = Deno.env.get(name)
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

const url = requireEnv('SUPABASE_URL')
const svcKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
```

This makes failing-fast explicit and avoids the `?? ''` pattern that silently passes an empty string to `createClient()`.

---

## 3. Project Structure Assessment

### 3.1 Current State

```
TrendwirePhilippines/
├── .github/workflows/          # 7 CI/CD workflows
├── articles/                   # Generated static HTML pages
├── drafts/                     # Draft article JSON files
├── scripts/                    # 7 Python scripts (flat, no package)
├── supabase/
│   ├── functions/              # 5 Edge Functions
│   │   ├── fetch-trends/
│   │   ├── fetch-multi-sources/
│   │   ├── generate-article/
│   │   ├── quality-check/
│   │   └── admin-operations/
│   └── migrations/             # 3 SQL migrations
├── app.js                      # 2351 lines — monolithic SPA
├── index.html                  # Entry point
├── style.css                   # All styles
├── config.js                   # ❌ Does not exist yet
├── feed.xml                    # Generated RSS
├── sitemap.xml                 # Generated sitemap
├── .env.example                # Template for local dev
├── .gitignore
├── MEMORY.md                   # Project memory (618 lines)
├── BRIEFING.md, DEBRIEF-*.md   # Project docs
└── README.md
```

### 3.2 Observations

**Strengths:**
- Clean separation between runtimes (Python scripts, Deno Edge Functions, static frontend)
- Good migration folder (numbered, with `_initial_schema.sql` idiom)
- Edge Functions are well-structured with distinct responsibilities
- Documentation is comprehensive (MEMORY.md, README.md, BRIEFING.md)

**Structural Issues:**

**1. `app.js` is a monolith (2351 lines).**
It conflates: SPA router, state management, DOM rendering, admin panel, Supabase queries, infinite scroll, dark mode, search, tag filtering, hero carousel, and more. This is the single biggest quality bottleneck. Any bug or feature change risks cascading side effects.

**2. No build step = no guardrails.**
- No type checking (TypeScript not used in frontend)
- No module system (all globals, implicit dependencies)
- No tree shaking (entire app.js loaded on every page)
- No CSS preprocessing
- No automated testing

**3. Generated artifacts tracked in git.**
`articles/`, `feed.xml`, `sitemap.xml` are generated by scripts but live in the repo root. This works for GitHub Pages (which publishes the repo root), but it means:
- Generated files pollute git history
- Merge conflicts on generated XML
- No clear distinction between source and output

**4. `supabase/functions/` — no shared utilities.**
Each Edge Function independently declares CORS headers, env var reads, Supabase client init. A shared utility library would reduce duplication.

### 3.3 Recommendation: Structural Changes

**Phase 1 (Low effort, high impact):**

```
supabase/functions/_shared/        # Shared Deno utilities (import via URLs)
├── cors.ts                        # corsHeaders constant + handleCORS helper
├── env.ts                         # requireEnv() helper
├── supabase.ts                    # getSupabaseClient() factory
└── types.ts                       # Shared TypeScript types
```

Each function's `index.ts` then becomes:
```typescript
import { corsHeaders } from '../_shared/cors.ts'
import { requireEnv } from '../_shared/env.ts'
import { getClient } from '../_shared/supabase.ts'

const sb = getClient()
```

**Phase 2 (Medium effort):**

Split `app.js` into modules loaded by a concatenation step:

```
js/
├── config.js                  # (moved from root)
├── supabase-client.js         # Supabase query helpers
├── router.js                  # SPA route handling
├── state.js                   # Application state management
├── components/
│   ├── article-list.js        # Article listing + infinite scroll
│   ├── article-detail.js      # Single article view
│   ├── admin-panel.js         # Admin editor
│   ├── hero-carousel.js       # Hero section
│   └── search.js              # Search + filters
├── utils/
│   ├── dom.js                 # DOM helpers
│   ├── format.js              # Date/number formatting
│   └── slug.js                # URL slug utilities
└── app.js                     # Bootstrap (imports + init)
```

Use a simple concatenation tool (esbuild with `--bundle` or even a Makefile with `cat`) to produce a single `bundle.js`. This doesn't require a full build framework — just one dependency.

**Phase 3 (If project grows):**

- Move generated files to `_site/` or `dist/` directory
- Add `_site/` to `.gitignore`
- Configure GitHub Pages to serve from `_site/`
- Add a `Makefile` or npm script for the pipeline: `config → generate-pages → bundle-js → copy-to-dist`

---

## 4. Environment Variable Management

### 4.1 Current Inventory

| Variable | Python Scripts | Edge Functions | Frontend | CI/CD |
|----------|---------------|----------------|----------|-------|
| `SUPABASE_URL` | os.environ.get (fallback) | Deno.env.get | Hardcoded in app.js | GitHub Secret |
| `SUPABASE_SERVICE_KEY` | os.environ.get (required) | — | — | GitHub Secret |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Deno.env.get | — | — |
| `SUPABASE_ANON_KEY` | — | — | Hardcoded in app.js | GitHub Secret |
| `OPENROUTER_API_KEY` | — | Deno.env.get | — | — |
| `OPENROUTER_MODEL` | — | Deno.env.get (optional) | — | — |
| `SITE_URL` | os.environ.get (fallback) | Deno.env.get (fallback) | Hardcoded | GitHub Secret |
| `ADMIN_SECRET_KEY` | — | Deno.env.get | Hardcoded? | — |
| `TELEGRAM_BOT_TOKEN` | — | Deno.env.get | — | — |
| `TELEGRAM_CHAT_ID` | — | Deno.env.get | — | — |
| `FB_PAGE_ID` | os.environ.get | — | — | — |
| `FB_ACCESS_TOKEN` | os.environ.get | — | — | — |
| `PAT_TOKEN` | — | — | — | GitHub Secret |

### 4.2 Problems

**1. Two different keys for the same thing.**
- Python scripts use `SUPABASE_SERVICE_KEY`
- Edge Functions use `SUPABASE_SERVICE_ROLE_KEY`
- They contain the **same value** (the Supabase service role JWT)
- `.env.example` even says: `# same value as SUPABASE_SERVICE_KEY`
- This is a maintenance trap — when rotating keys, you must remember to update both names in different places

**2. Frontend secrets vs. env vars.**
`app.js` must hardcode `SUPABASE_URL` and `SUPABASE_ANON_KEY` because it runs in the browser where `Deno.env` and `process.env` don't exist. This is correct for a static site, but it means:
- Changing the Supabase project requires editing JS source code
- No way to have different configs for dev/staging/prod without a build step
- The hardcoded values must be excluded from linter "no hardcoded secrets" rules (they're public by design)

**3. No `.env` loading in Python scripts.**
Scripts use `os.environ.get()` directly. They don't use `python-dotenv` or any `.env` loader. This means:
- Developers must manually export variables before running
- No automatic `.env` → `os.environ` bridge
- The `.env.example` documents the format, but there's no code to load it

**4. Fallback defaults create silent success on failure.**
The pattern `os.environ.get('SUPABASE_URL', 'https://hardcoded...')` means if someone accidentally unsets the variable, the script silently connects to production — this is the opposite of what you want.

### 4.3 Recommendation: Env Var Strategy

**For Python Scripts:**

```python
# scripts/config.py (new)
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv is optional

def require_env(var: str) -> str:
    val = os.environ.get(var)
    if not val:
        print(f"❌ Required env var {var} is not set.")
        print(f"   Copy .env.example to .env and fill it in, or export the variable.")
        sys.exit(1)
    return val

# ── Required (fail fast if missing) ──
SUPABASE_URL = require_env('SUPABASE_URL')
SUPABASE_SERVICE_KEY = require_env('SUPABASE_SERVICE_KEY')
```

Then add `python-dotenv` as a dependency:
```bash
pip install python-dotenv
```

**Unify the key alias:**
Keep `SUPABASE_SERVICE_KEY` (Python scripts) and `SUPABASE_SERVICE_ROLE_KEY` (Edge Functions) as they are — they're in different runtimes. But add a comment in the Edge Functions and document the relationship:

```typescript
// SUPABASE_SERVICE_ROLE_KEY has the same value as SUPABASE_SERVICE_KEY (used by Python scripts)
// Both are the Supabase service_role JWT
```

**For Local Development:**

```bash
# Set up local dev
cp .env.example .env
export $(cat .env | xargs)    # or use dotenv
python scripts/publish-article.py --latest
```

Or better, add a small shell script:
```bash
#!/usr/bin/env bash
# scripts/run.sh — Load .env and run a script
set -a
source .env
set +a
python "scripts/$@"
```

**For Edge Functions:**

The current pattern works. Two improvements:
1. Add a `requireEnv` helper (as shown in §2.4) to replace `?? ''`
2. Add a shared `_shared/env.ts` module if multiple functions need the same pattern

**For the Frontend:**

Three options ranked by effort:

| Option | Effort | Pros | Cons |
|--------|--------|------|------|
| **A. `config.js` script** (recommended now) | 15 min | Zero build step, works today, explicit single source | Still hardcoded in git, no env-dependent switching |
| **B. GitHub Actions env substitution** | 2 hrs | Dev/staging/prod via vars | Requires CI step, still in git |
| **C. Runtime env injection via `<meta>` tags** | 30 min | Config comes from HTML, no JS changes for URL updates | Awkward for keys, more indirection |

**Recommendation: Implement Option A now (`config.js`), then Option B (env substitution in CI) when multiple environments are needed.**

---

## 5. Build Pipeline Strategy

### 5.1 Current Architecture

```
[Git Push] → [GitHub Actions] → [Python scripts] → [Generated artifacts] → [Commit + Push to gh-pages]
```

This works but has no build step for the **frontend** itself. The frontend is served as raw source from the repo root.

### 5.2 Should You Add a Build Step?

**Short answer: Not yet.** The current setup (static HTML/CSS/JS served by GitHub Pages) is:
- Fast (zero build time)
- Simple (no framework to maintain)
- Cheap (free hosting)
- Reliable (no server-side rendering, no CDN config)

**When to add one:**
- When `app.js` exceeds 3000 lines
- When you need TypeScript, JSX, or CSS preprocessing
- When you need to test the frontend (even unit tests need module resolution)
- When you need multiple environments (dev/staging/prod with different Supabase URLs)

### 5.3 Lightweight Build Pipeline (if/when needed)

The simplest path to a build step without adding a framework:

```bash
# Install esbuild (single binary, no runtime)
npm install -g esbuild

# Bundle frontend
esbuild js/app.js --bundle --minify --outfile=dist/bundle.js

# Copy static assets
cp index.html style.css dist/
cp -r articles/ dist/
```

This gives you:
- Module system (ES imports in source, single bundle in output)
- Tree shaking
- Minification
- Source maps
- No framework lock-in

---

## 6. Implementation Plan

### Phase 1 — Quick Wins (30 min)

1. **Create `scripts/config.py`** with `require_env()` helper
2. **Update all 6 Python scripts** to `from config import SUPABASE_URL, ...`
3. **Remove hardcoded fallback URLs** from all Python scripts

### Phase 2 — Frontend Config (30 min)

4. **Create `config.js`** with CONFIG object
5. **Update `index.html`** to load `config.js` before `app.js`
6. **Update `app.js`** to use `CONFIG.SUPABASE_URL` instead of hardcoded literal
7. **Add comment** to `index.html` preconnect/dns-prefetch linking to `config.js`

### Phase 3 — Env Var Hygiene (1 hr)

8. **Add `python-dotenv` to requirements** and `load_dotenv()` to `config.py`
9. **Update `.env.example`** to document both `SUPABASE_SERVICE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` and their relationship
10. **Add `requireEnv` helper** to Edge Functions (optional but recommended)
11. **Create Edge Function `_shared/` directory** with cors.ts, env.ts, supabase.ts

### Phase 4 — App.js Modulariation (2-3 hrs — only if warranted)

12. **Split `app.js`** into logical modules under `js/`
13. **Add esbuild** for bundling
14. **Update CI/CD** to run the build step before deploying

### Phase 5 — Generated Artifacts (30 min)

15. **Create `output/` or `dist/` directory** for generated files
16. **Update Python scripts** to write to the output directory
17. **Update `publish-ghpages.yml`** to copy output to root

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Forgetting to update `config.js` when Supabase project changes | Medium | High (site breaks) | Add `config.js` to onboarding checklist; comment in `index.html` linking to it |
| Breaking Python imports during `config.py` migration | Medium | Medium | Do one script at a time, test each |
| Edge Function `_shared/` import paths breaking on deploy | Low | Medium | Test locally with `supabase functions serve` before deploying |
| Generated output directory breaks GitHub Pages deployment | Low | High | Only change output strategy when ready; test in a branch first |
| `python-dotenv` missing in CI | Low | Medium | Add to `requirements.txt`; CI `pip install` already covers dependencies |
| Different values for `SERVICE_KEY` vs `SERVICE_ROLE_KEY` | Low | High | Document they're the same value; add a validation comment at each usage |

---

## Summary

**The hardcoded Supabase URL problem is a symptom, not the root cause.** The root cause is that configuration is scattered across three runtimes (Python CLI, Deno Edge Functions, browser JS) with no shared abstraction layer.

**Fix with three files:**
1. `scripts/config.py` — single source of truth for Python scripts
2. `config.js` — single source of truth for frontend JS
3. `supabase/functions/_shared/env.ts` — shared helper for Edge Functions

**Do not add a full build pipeline yet.** The static site architecture is appropriate for this project's scale. The `config.js` approach gives you centralization without a build step.

**The biggest structural risk** is `app.js` at 2351 lines doing everything. Centralizing the config is a necessary first step, but the app will benefit from modularization as it grows.
