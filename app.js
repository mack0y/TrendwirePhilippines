/* ===== TrendWire Philippines — App ===== */

// ── Supabase Config ──────────────────────────────
const SUPABASE_URL = 'https://nvxykufajzppjtkmbtte.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52eHlrdWZhanpwcGp0a21idHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTMyMDgsImV4cCI6MjA5NjkyOTIwOH0.k4iu6e3k1Me-Nu5R5xsX4KiJNxfJ6S-THBhMNRyF7j0'

// ── State ─────────────────────────────────────────
let articles = []
let currentRoute = 'list'
let currentSlug = null

// ── Init Supabase ─────────────────────────────────
let supabase
try {
  const { createClient } = window.supabase
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: 'public' },
  })
} catch (e) {
  console.error('Failed to init Supabase:', e)
}

// ── Router ────────────────────────────────────────
function handleRoute() {
  const hash = window.location.hash.replace(/^#\//, '') || ''
  if (!hash) {
    currentRoute = 'list'
    currentSlug = null
    renderList()
  } else if (hash.startsWith('article/')) {
    currentRoute = 'article'
    currentSlug = hash.replace('article/', '')
    renderArticle(currentSlug)
  } else {
    currentRoute = 'list'
    currentSlug = null
    renderList()
  }
}

window.addEventListener('hashchange', handleRoute)

function navigate(path) {
  window.location.hash = '#/' + path
}

// ── API ───────────────────────────────────────────
async function fetchArticles() {
  if (!supabase) throw new Error('Supabase not initialized')

  const { data, error } = await supabase
    .from('articles')
    .select('id, title, slug, summary, category, tags, published_at, created_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(20)

  if (error) throw error
  return data || []
}

async function fetchArticleBySlug(slug) {
  if (!supabase) throw new Error('Supabase not initialized')

  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()

  if (error) throw error
  return data
}

// ── Format Helpers ────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function formatDateFull(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

function readingTime(content) {
  const wpm = 200
  const words = content.trim().split(/\s+/).length
  return Math.max(1, Math.ceil(words / wpm))
}

// ── Render: Loading ───────────────────────────────
function renderLoading() {
  const app = document.getElementById('app')
  app.innerHTML = `
    <div class="container">
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    </div>
  `
}

// ── Render: Error ─────────────────────────────────
function renderError(message) {
  const app = document.getElementById('app')
  app.innerHTML = `
    <div class="container">
      <div class="error-state">
        <div class="icon">⚠️</div>
        <h2>Something went wrong</h2>
        <p>${message || 'Could not load articles. Please try again.'}</p>
        <button class="retry-btn" onclick="renderList()">Try Again</button>
      </div>
    </div>
  `
}

// ── Render: Article List ──────────────────────────
async function renderList() {
  const app = document.getElementById('app')
  renderLoading()

  try {
    if (!articles.length) {
      articles = await fetchArticles()
    }

    if (!articles.length) {
      app.innerHTML = `
        <div class="container">
          <div class="empty-state">
            <div class="icon">📰</div>
            <h2>No articles yet</h2>
            <p>Published articles will appear here.</p>
          </div>
        </div>
      `
      return
    }

    app.innerHTML = `
      <div class="container">
        <h1 class="page-title">Trending Now</h1>
        <p class="page-subtitle">Latest stories from across the Philippines</p>
        <div class="article-grid">
          ${articles.map(a => `
            <div class="article-card" data-category="${a.category || 'General'}"
                 onclick="navigate('article/${a.slug}')">
              <span class="category-badge">${a.category || 'General'}</span>
              <h2>${a.title}</h2>
              <p class="summary">${a.summary || ''}</p>
              <div class="meta">
                <span class="date">📅 ${formatDate(a.published_at || a.created_at)}</span>
                <span class="read-more">Read more →</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `
  } catch (e) {
    console.error('Failed to load articles:', e)
    renderError(e.message)
  }
}

// ── Render: Article Detail ────────────────────────
async function renderArticle(slug) {
  const app = document.getElementById('app')
  renderLoading()

  try {
    const article = await fetchArticleBySlug(slug)

    if (!article) {
      app.innerHTML = `
        <div class="container">
          <div class="error-state">
            <div class="icon">🔍</div>
            <h2>Article not found</h2>
            <p>This article may have been removed or is no longer available.</p>
            <button class="retry-btn" onclick="navigate('')">Back to articles</button>
          </div>
        </div>
      `
      return
    }

    const content = article.content || ''
    const paragraphs = content.split('\n\n').filter(p => p.trim())

    app.innerHTML = `
      <div class="container">
        <div class="article-detail">
          <button class="back-btn" onclick="navigate('')">← Back to articles</button>

          <div class="article-header">
            <span class="category-badge">${article.category || 'General'}</span>
            <h1>${article.title}</h1>
            <div class="meta">
              <span>📅 ${formatDateFull(article.published_at || article.created_at)}</span>
              <span>📖 ${readingTime(content)} min read</span>
              ${article.tags?.length ? `<span>🏷️ ${article.tags.length} tags</span>` : ''}
            </div>
          </div>

          <div class="featured-image">
            ${article.image_prompt
              ? '📸 ' + article.image_prompt.slice(0, 80) + '…'
              : '📰 No image available'}
          </div>

          <div class="article-content">
            ${article.summary ? `<div class="summary-box">${article.summary}</div>` : ''}
            ${paragraphs.map(p => `<p>${p.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>`).join('')}
          </div>

          <div class="article-footer">
            ${(article.tags || []).map(t => `<span class="tag">#${t}</span>`).join('')}
          </div>
        </div>
      </div>
    `
  } catch (e) {
    console.error('Failed to load article:', e)
    renderError(e.message)
  }
}

// ── Boot ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  handleRoute()
})
