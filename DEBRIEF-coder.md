# Code Fix Debrief — TrendWire Philippines (app.js)

**Fixed by**: Hermes Agent (coder)
**Date**: 2026-07-10
**Scope**: 4 confirmed bugs from code review — XSS, resilience, dark mode UI

---

## Fixes Applied

### 1. XSS — article.title raw in H1 (`app.js:2258`)
| Before | After |
|--------|-------|
| `<h1>${article.title}</h1>` | `<h1>${escHtml(article.title)}</h1>` |

**Impact**: Critical. Unescaped `article.title` in innerHTML allowed stored XSS via article title field. An attacker with write access to the `articles` table could inject `<img src=x onerror=stealCookies()>`.

### 2. XSS — article.summary raw in summary box (`app.js:2276`)
| Before | After |
|--------|-------|
| `${article.summary ? `<div class="summary-box">${article.summary}</div>` : ''}` | `${article.summary ? `<div class="summary-box">${escHtml(article.summary)}</div>` : ''}` |

**Impact**: Critical. Same vector as #1 but via summary field. The `escHtml()` function already existed at line 2166 — it just wasn't being applied consistently.

### 3. Related articles failure crashes entire article page (`app.js:2226-2233`)
| Before | After |
|--------|-------|
| `var relatedArticles = await fetchRelatedArticles(...)` (no try/catch) | `var relatedHtml = ''; try { ... } catch (e) { console.warn(...) }` |

**Impact**: Medium. If `fetchRelatedArticles()` threw (network error, Supabase down), the outer try/catch at line 2318 would call `renderError()` and replace the entire article with an error screen. Now the related section silently degrades to empty.

### 4. Dark mode toggle icon not updating on article pages (`app.js:2315-2317`)
Added after the `app.innerHTML =` assignment in `renderArticle()`:
```javascript
const icon = document.querySelector('.dark-toggle-icon')
if (icon) icon.textContent = darkMode ? '☀️' : '🌙'
```

**Impact**: Low. When navigating directly to an article page (deep link), dark mode CSS applied correctly but the toggle icon showed the wrong emoji. This matches the pattern already used in `renderList()` at line 1058-1059.

---

## Verification

| # | Fix | Line | Verified |
|---|-----|------|----------|
| 1 | `escHtml(article.title)` | 2258 | ✅ |
| 2 | `escHtml(article.summary)` | 2276 | ✅ |
| 3 | try/catch around `fetchRelatedArticles()` | 2226-2233 | ✅ |
| 4 | Dark icon update in `renderArticle()` | 2315-2317 | ✅ |

All changes tested by reading the file after patching. XSS fixes use the existing `escHtml()` DOM-based sanitizer (line 2166). Dark mode icon follows the same pattern as `renderList()`.

---

## Transferable Patterns Saved

See `sanitize-innerhtml-interpolations` skill in memory:
- Always wrap every user/content string in `escHtml()` when interpolating into `innerHTML` template literals.
- Wrap optional async operations in their own `try/catch` — don't let non-critical features crash the entire page.
- SPA page renderers must re-apply UI state (dark mode icon, active nav) after replacing DOM.
- When a sanitizer function already exists but isn't used everywhere, audit all `innerHTML` assignments.
