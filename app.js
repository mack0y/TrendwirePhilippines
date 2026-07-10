/* ===== TrendWire Philippines — App ===== */

// ── SEO Config ──────────────────────────────
const SITE_URL = 'https://mack0y.github.io/TrendwirePhilippines'
const SITE_NAME = 'TrendWire Philippines'
const BASE_PATH = '/TrendwirePhilippines'
const DEFAULT_OG_IMAGE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="%23CE1126"/><text x="600" y="280" font-size="160" text-anchor="middle" dominant-baseline="middle">&#x1F1F5;&#x1F1ED;</text><text x="600" y="400" font-size="48" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="white">TrendWire PH</text><text x="600" y="460" font-size="24" font-family="sans-serif" text-anchor="middle" fill="rgba(255,255,255,0.8)">Stories that move the nation</text></svg>')

// ── 404 redirect from GitHub Pages ─────────
;(function() {
  var redirect = sessionStorage.redirect
  if (redirect) {
    delete sessionStorage.redirect
    var path = redirect.replace(BASE_PATH, '') || '/'
    history.replaceState(null, '', BASE_PATH + path)
  }
  // Redirect legacy hash URLs (e.g. #/article/slug) to clean paths
  var hash = location.hash
  if (hash && hash.startsWith('#/')) {
    var cleanPath = hash.replace('#/', '') || '/'
    if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath
    history.replaceState(null, '', BASE_PATH + cleanPath)
  }
})()

// ── Supabase Config ──────────────────────────────
const SUPABASE_URL = 'https://nvxykufajzppjtkmbtte.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52eHlrdWZhanpwcGp0a21idHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTMyMDgsImV4cCI6MjA5NjkyOTIwOH0.k4iu6e3k1Me-Nu5R5xsX4KiJNxfJ6S-THBhMNRyF7j0'

// ── State ─────────────────────────────────────────
let articles = []
let currentRoute = 'list'
let currentSlug = null
let categoryFilter = ''
let tagFilter = ''
let darkMode = localStorage.getItem('tw-dark') === 'true'
let loadedCount = 0
let isLoadingMore = false
let hasMoreArticles = true
let heroInterval = null
let heroTouchStartX = 0

// ── Apply dark mode on load ────────────────────────
if (darkMode) document.documentElement.classList.add('dark')

// ── Dark mode toggle (global, called from header) ───
window.toggleDarkMode = function () {
  darkMode = !darkMode
  document.documentElement.classList.toggle('dark', darkMode)
  localStorage.setItem('tw-dark', darkMode)
  const meta = document.getElementById('theme-color')
  if (meta) meta.content = darkMode ? '#1a1a2e' : '#CE1126'
  const icon = document.querySelector('.dark-toggle-icon')
  if (icon) icon.textContent = darkMode ? '☀️' : '🌙'
}

// ── Init Supabase ─────────────────────────────────
let sb
try {
  const { createClient } = window.supabase
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: 'public' },
  })
} catch (e) {
  console.error('Failed to init Supabase:', e)
}

// ── Router (pushState-based) ──────────────────────
function handleRoute() {
  const path = location.pathname.replace(BASE_PATH, '') || '/'
  // Parse query params for tag/category filters
  var params = new URLSearchParams(location.search)
  var tagParam = params.get('tag') || ''
  var catParam = params.get('category') || ''
  tagFilter = tagParam
  if (catParam) {
    categoryFilter = catParam
  }
  updateNavActive(catParam || '')
  
  if (path === '/' || path === '') {
    currentRoute = 'list'
    currentSlug = null
    renderList()
  } else if (path.startsWith('/article/')) {
    currentRoute = 'article'
    currentSlug = path.replace('/article/', '')
    renderArticle(currentSlug)
  } else if (path === '/admin') {
    currentRoute = 'admin'
    currentSlug = null
    renderAdmin()
  } else {
    currentRoute = 'list'
    currentSlug = null
    renderList()
  }
}

window.addEventListener('popstate', handleRoute)

function navigate(path) {
  const url = BASE_PATH + path
  history.pushState(null, '', url)
  window.scrollTo(0, 0)
  handleRoute()
}

// ── SEO Helpers ───────────────────────────────────

function setMetaTags(opts) {
  const title = opts.title || SITE_NAME
  const desc = opts.description || 'Trending stories and news from across the Philippines.'
  const url = opts.url || SITE_URL + '/'
  const image = opts.image || DEFAULT_OG_IMAGE

  document.title = title

  setMeta('description', desc)
  setMeta('keywords', opts.keywords || 'Philippines news, trending PH, Filipino news')
  setMeta('robots', opts.robots || 'index, follow')

  setMeta('og:title', title)
  setMeta('og:description', desc)
  setMeta('og:url', url)
  setMeta('og:image', image)
  setMeta('og:type', opts.ogType || 'website')
  setMeta('og:site_name', SITE_NAME)

  setMeta('twitter:card', opts.twitterCard || 'summary_large_image')
  setMeta('twitter:title', title)
  setMeta('twitter:description', desc)
  setMeta('twitter:image', image)

  // Canonical
  let link = document.querySelector('link[rel="canonical"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'canonical'
    document.head.appendChild(link)
  }
  link.href = url
}

function setMeta(name, content) {
  if (!content) return
  let el = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]')
  if (!el) {
    el = document.createElement('meta')
    if (name.startsWith('og:')) {
      el.setAttribute('property', name)
    } else {
      el.setAttribute('name', name)
    }
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function injectLd(id, json) {
  let script = document.getElementById(id)
  if (!script) {
    script = document.createElement('script')
    script.type = 'application/ld+json'
    script.id = id
    document.head.appendChild(script)
  }
  script.textContent = JSON.stringify(json)
}

function removeLd(id) {
  var el = document.getElementById(id)
  if (el) el.remove()
}

function updateSeoForList() {
  setMetaTags({
    title: SITE_NAME + ' — Trending Stories & News',
    description: 'Trending stories and news from across the Philippines. Stay informed with the latest trending topics, breaking news, and in-depth articles on politics, sports, economy, and more.',
    url: SITE_URL + '/',
    keywords: 'Philippines news, trending PH, Filipino news, Pinoy news, TrendWire PH',
  })
  // Remove article-specific schema
  removeLd('ld-article')
  removeLd('ld-breadcrumb')
}

function renderRelatedSection(relatedArticles) {
  if (!relatedArticles || !relatedArticles.length) return ''
  var items = relatedArticles.map(function(a) {
    var articleUrl = BASE_PATH + '/article/' + a.slug
    return `
      <div class="related-card">
        <a href="${articleUrl}" onclick="event.preventDefault();navigate('/article/${a.slug}')">
          ${a.image_url ? `<div class="related-card-img"><img src="${a.image_url}" alt="${escHtml(a.title)}" loading="lazy"></div>` : ''}
          <div class="related-card-body">
            <span class="related-card-category">${a.category || 'General'}</span>
            <h3 class="related-card-title">${escHtml(a.title)}</h3>
          </div>
        </a>
      </div>
    `
  }).join('')
  return `
    <div class="related-section">
      <div class="related-section-header">More in ${escHtml(relatedArticles[0].category || 'General')}</div>
      <div class="related-grid">${items}</div>
    </div>
  `
}

function updateSeoForArticle(article) {
  const articleUrl = SITE_URL + '/article/' + article.slug
  const imageUrl = article.image_url || DEFAULT_OG_IMAGE
  const pubDate = article.published_at || article.created_at
  const modDate = article.updated_at || article.published_at || article.created_at
  const tags = article.tags || []

  setMetaTags({
    title: article.title + ' — ' + SITE_NAME,
    description: article.summary || article.seo_description || article.title,
    url: articleUrl,
    image: imageUrl,
    ogType: 'article',
    keywords: tags.join(', '),
  })

  // OG article-specific meta tags
  setMeta('article:published_time', pubDate)
  setMeta('article:modified_time', modDate)
  setMeta('article:section', article.category || 'General')
  // Remove old article:tag metas to prevent accumulation on re-render
  document.querySelectorAll('meta[property="article:tag"]').forEach(function(el) { el.remove() })
  tags.forEach(function(tag) { setMeta('article:tag', tag) })

  // NewsArticle schema (Google-preferred for news content)
  var imageSchema = {
    '@type': 'ImageObject',
    'url': imageUrl,
    'width': 1200,
    'height': 630,
    'caption': article.summary || article.title,
  }

  injectLd('ld-article', {
    '@context': 'https://schema.org',
    '@type': ['NewsArticle', 'Article'],
    headline: article.title,
    description: article.summary || article.seo_description || '',
    image: imageSchema,
    datePublished: pubDate,
    dateModified: modDate,
    author: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': articleUrl,
    },
    articleSection: article.category || 'General',
    keywords: tags.join(', '),
    inLanguage: 'en-PH',
    copyrightYear: new Date(pubDate).getFullYear(),
    copyrightHolder: {
      '@type': 'Organization',
      name: SITE_NAME,
    },
    isAccessibleForFree: true,
  })

  // Breadcrumb schema
  injectLd('ld-breadcrumb', {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
      { '@type': 'ListItem', position: 2, name: article.category || 'General', item: SITE_URL + '/?category=' + (article.category || 'General') },
      { '@type': 'ListItem', position: 3, name: article.title, item: articleUrl },
    ],
  })
}

// ── API ───────────────────────────────────────────
async function fetchArticles() {
  if (!sb) throw new Error('Supabase not initialized')

  const { data, error } = await sb
    .from('articles')
    .select('id, title, slug, summary, category, tags, published_at, created_at, image_url')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return data || []
}

async function fetchArticleBySlug(slug) {
  if (!sb) throw new Error('Supabase not initialized')

  const { data, error } = await sb
    .from('articles')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()

  if (error) throw error
  return data
}

async function fetchRelatedArticles(category, excludeSlug, limit) {
  if (!sb) return []
  limit = limit || 4
  var { data, error } = await sb
    .from('articles')
    .select('id, title, slug, summary, category, tags, published_at, created_at, image_url')
    .eq('status', 'published')
    .eq('category', category)
    .neq('slug', excludeSlug)
    .order('published_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

// ── Admin API ─────────────────────────────────────

/** Call the admin-operations Edge Function with an action and payload. */
async function adminOperation(action, payload = {}) {
  if (!sb) throw new Error('Supabase not initialized')
  const { data, error } = await sb.functions.invoke('admin-operations', {
    body: { action, ...payload },
  })
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

// ── Share Helpers ────────────────────────────────
const COPY_LINK_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M7.5 3.375c0-1.036.84-1.875 1.875-1.875h.375a3.75 3.75 0 013.75 3.75v1.875C13.5 8.16 12.66 9 11.625 9h-.375a3.75 3.75 0 01-3.75-3.75V3.375zm-4.5 0A2.625 2.625 0 015.625.75h.375a3.75 3.75 0 013.75 3.75v1.875c0 1.036-.84 1.875-1.875 1.875h-.375A3.75 3.75 0 013 5.625V3.375zM7.5 11.625c0-1.036.84-1.875 1.875-1.875h.375a3.75 3.75 0 013.75 3.75v1.875c0 1.036-.84 1.875-1.875 1.875h-.375a3.75 3.75 0 01-3.75-3.75V11.625z"/></svg>`
const COPY_CHECK_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`

function showCopiedFeedback(btn) {
  btn.innerHTML = COPY_CHECK_SVG
  btn.classList.add('copied')
  setTimeout(() => {
    btn.innerHTML = COPY_LINK_SVG
    btn.classList.remove('copied')
  }, 2000)
}

function copyArticleLink() {
  const url = window.location.href
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.querySelector('.share-copy')
      if (btn) showCopiedFeedback(btn)
    }).catch(() => {
      fallbackCopy(url)
    })
  } else {
    fallbackCopy(url)
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
  const btn = document.querySelector('.share-copy')
  if (btn) showCopiedFeedback(btn)
}

// ── Weather ────────────────────────────────────────
let weatherData = null
let weatherLoading = true
let weatherLocation = ''

function getUserLocation() {
  return new Promise(function(resolve) {
    if (!navigator.geolocation) { resolve(null); return }
    navigator.geolocation.getCurrentPosition(
      function(pos) {
        resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude })
      },
      function() { resolve(null) }, // Denied or error — fall back to IP
      { timeout: 5000, enableHighAccuracy: false }
    )
  })
}

async function fetchWeather(coords) {
  try {
    // Build URL: use coordinates if available, otherwise IP auto-detect
    var query = coords ? coords.lat + ',' + coords.lon : ''
    var url = 'https://wttr.in/' + query + '?format=j1'
    
    var resp = await fetch(url, {
      headers: { 'User-Agent': 'TrendWire-Philippines/1.0' },
    })
    if (!resp.ok) throw new Error('Weather fetch failed')
    
    var json = await resp.json()
    var cc = json.current_condition[0]
    
    // Extract location name from wttr.in response
    var area = json.nearest_area && json.nearest_area[0]
    var city = area && area.areaName && area.areaName[0] && area.areaName[0].value || ''
    var country = area && area.country && area.country[0] && area.country[0].value || ''
    weatherLocation = city + (country ? ', ' + country : '')
    
    weatherData = {
      temp: cc.temp_C,
      desc: cc.weatherDesc[0].value,
      humidity: cc.humidity,
      wind: cc.windspeedKmph,
      feelsLike: cc.FeelsLikeC,
      code: cc.weatherCode,
    }
  } catch (e) {
    console.error('Weather fetch error:', e.message)
    weatherData = null
    weatherLocation = ''
  }
  weatherLoading = false
}

// ── Admin / Trend Search ─────────────────────────
async function fetchFromGoogleTrends() {
  if (!sb) throw new Error('Supabase not initialized')
  const { data, error } = await sb.functions.invoke('fetch-trends', {})
  if (error) throw error
  return data
}

async function searchTrendsDB(query) {
  if (!sb) throw new Error('Supabase not initialized')

  // Only show trends from the last 7 days — prevents old high-scoring trends from dominating
  const SEVEN_DAYS_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  let q = sb
    .from('trends')
    .select('id, title, summary, category, impact_score, status, created_at')
    .gte('created_at', SEVEN_DAYS_AGO)
    .order('impact_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50)

  if (query && query.trim()) {
    q = q.or(`title.ilike.%${query}%,summary.ilike.%${query}%`)
  }

  const { data, error } = await q
  if (error) throw error
  return data || []
}

async function generateArticleFromTrend(trendId, model) {
  if (!sb) throw new Error('Supabase not initialized')

  const body = { trend_id: trendId }
  if (model) body.model = model

  const { data, error } = await sb.functions.invoke('generate-article', {
    body,
  })

  if (error) throw error
  return data
}

// ── Render: Loading ───────────────────────────────
function renderLoading() {
  const app = document.getElementById('app')
  app.innerHTML = `
    <div class="ticker-wrap">
      <div class="ticker-label" style="background:rgba(0,0,0,0.15)">🔥 LOADING</div>
      <div class="ticker-track">
        <div class="ticker-content" style="animation:none;color:rgba(255,255,255,0.5);font-size:12px;font-weight:600;padding-left:24px">
          <span>Fetching latest stories…</span>
        </div>
      </div>
    </div>
    <div class="container">
      <div class="skeleton skeleton-hero"></div>
      <div class="skeleton-grid">
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
      </div>
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

// ── Reading Progress ──────────────────────────────
let readingProgressInitialized = false

function initReadingProgress() {
  if (readingProgressInitialized) return
  readingProgressInitialized = true
  
  var bar = document.querySelector('.reading-progress')
  if (!bar) {
    bar = document.createElement('div')
    bar.className = 'reading-progress'
    document.body.appendChild(bar)
  }
  var ticking = false
  window.addEventListener('scroll', function() {
    if (!ticking) {
      requestAnimationFrame(function() {
        var scrollTop = window.scrollY || document.documentElement.scrollTop
        var docHeight = document.documentElement.scrollHeight - window.innerHeight
        if (docHeight > 0) {
          var pct = Math.min(100, (scrollTop / docHeight) * 100)
          bar.style.width = pct + '%'
          bar.classList.toggle('visible', scrollTop > 200)
        }
        ticking = false
      })
      ticking = true
    }
  })
}

// ── Hero Carousel ─────────────────────────────────
let heroCarouselSlides = []
let heroCarouselIndex = 0

function initHeroCarousel(articles, slidesData) {
  heroCarouselSlides = slidesData
  heroCarouselIndex = 0
  stopHeroCarousel()
  
  var dots = document.querySelectorAll('.hero-dot')
  if (slidesData.length <= 1) return
  
  heroInterval = setInterval(function() {
    nextHeroSlide()
  }, 5000)
  
  // Touch/swipe support
  var el = document.querySelector('.hero-carousel')
  if (el) {
    el.addEventListener('touchstart', function(e) {
      heroTouchStartX = e.touches[0].clientX
    }, { passive: true })
    el.addEventListener('touchend', function(e) {
      var diff = heroTouchStartX - e.changedTouches[0].clientX
      if (Math.abs(diff) > 50) {
        if (diff > 0) nextHeroSlide()
        else prevHeroSlide()
      }
    }, { passive: true })
    el.addEventListener('mouseenter', function() { stopHeroCarousel() })
    el.addEventListener('mouseleave', function() { startHeroCarousel() })
  }
}

function goToHeroSlide(index) {
  var slides = document.querySelectorAll('.hero-slide')
  var dots = document.querySelectorAll('.hero-dot')
  if (!slides.length) return
  heroCarouselIndex = (index + slides.length) % slides.length
  slides.forEach(function(s, i) {
    s.classList.toggle('active', i === heroCarouselIndex)
  })
  dots.forEach(function(d, i) {
    d.classList.toggle('active', i === heroCarouselIndex)
  })
}

function nextHeroSlide() { goToHeroSlide(heroCarouselIndex + 1) }
function prevHeroSlide() { goToHeroSlide(heroCarouselIndex - 1) }
function stopHeroCarousel() { if (heroInterval) { clearInterval(heroInterval); heroInterval = null } }
function startHeroCarousel() {
  stopHeroCarousel()
  if (heroCarouselSlides.length > 1) {
    heroInterval = setInterval(function() { nextHeroSlide() }, 5000)
  }
}

// ── Category Tabs ─────────────────────────────────
function initCategoryTabs(categories) {
  var wrap = document.querySelector('.category-tabs-wrap')
  if (!wrap) return
  var container = wrap.querySelector('.category-tabs')
  var indicator = wrap.querySelector('.category-tab-indicator')
  if (!container || !indicator) return
  
  function moveIndicator(btn) {
    if (!btn) return
    var wrapRect = wrap.getBoundingClientRect()
    var btnRect = btn.getBoundingClientRect()
    indicator.style.left = (btnRect.left - wrapRect.left) + 'px'
    indicator.style.width = btnRect.width + 'px'
  }
  
  var active = container.querySelector('.category-tab.active')
  if (active) moveIndicator(active)
  
  // Update on click
  container.querySelectorAll('.category-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      container.querySelectorAll('.category-tab').forEach(function(b) { b.classList.remove('active') })
      btn.classList.add('active')
      moveIndicator(btn)
      // Scroll into view
      btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    })
  })
  
  // Update on window resize
  window.addEventListener('resize', function() {
    var a = container.querySelector('.category-tab.active')
    if (a) moveIndicator(a)
  })
}

// ── Load More ─────────────────────────────────────
async function loadMoreArticles() {
  if (isLoadingMore || !hasMoreArticles) return
  isLoadingMore = true
  var btn = document.querySelector('.load-more-btn')
  if (btn) btn.disabled = true
  try {
    var nextCount = Math.min(loadedCount + 6, articles.length)
    if (nextCount <= loadedCount) {
      hasMoreArticles = false
      var wrap = document.querySelector('.load-more-wrap')
      if (wrap) {
        wrap.innerHTML = '<p class="no-more">All articles loaded</p>'
      }
      return
    }
    loadedCount = nextCount
    renderArticlesGrid()
  } catch (e) {
    console.error('Failed to load more:', e)
  } finally {
    isLoadingMore = false
    if (btn) btn.disabled = false
  }
}

// ── Lotto Results ────────────────────────────────────
let lottoResults = []
let lottoLoading = true
let lottoAvailableDates = []
let selectedLottoDate = ''

async function fetchLottoResults() {
  if (!sb) return
  try {
    // Get today's date in PH timezone
    var now = new Date()
    var phOffset = 8 * 60 * 60 * 1000
    var phNow = new Date(now.getTime() + phOffset)
    var today = phNow.toISOString().slice(0, 10)
    
    // Get date 30 days ago so we have history to browse
    var daysAgo = new Date(phNow.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10)
    
    var { data, error } = await sb
      .from('lotto_results')
      .select('*')
      .gte('draw_date', daysAgo)
      .lte('draw_date', today)
      .order('draw_date', { ascending: false })
      .order('draw_time', { ascending: false })
    
    if (error) throw error
    lottoResults = data || []
    
    // Build list of available dates (unique, sorted descending by date)
    var seen = {}
    lottoAvailableDates = []
    for (var i = 0; i < lottoResults.length; i++) {
      var d = lottoResults[i].draw_date
      if (!seen[d]) {
        seen[d] = true
        lottoAvailableDates.push(d)
      }
    }
    
    // Default to the latest available date
    if (lottoAvailableDates.length > 0 && !selectedLottoDate) {
      selectedLottoDate = lottoAvailableDates[0]
    }
  } catch (e) {
    console.error('Failed to fetch lotto results:', e.message)
    lottoResults = []
    lottoAvailableDates = []
  }
  lottoLoading = false
}

window.__selectLottoDate = function(date) {
  selectedLottoDate = date
  updateSidebarWidget('.lotto-card, .lotto-loading, .lotto-empty', renderLottoWidget)
}

function renderLottoWidget() {
  if (lottoLoading) {
    return '<div class="lotto-card"><div class="lotto-loading">⏳ Loading lotto results…</div></div>'
  }
  if (!lottoResults.length) {
    return '<div class="lotto-card"><div class="lotto-empty">🎰 No results yet today</div></div>'
  }
  
  // Use selected date or fall back to latest
  var activeDate = selectedLottoDate || lottoResults[0].draw_date
  
  // Filter results for the selected date
  var dayResults = lottoResults.filter(function(r) { return r.draw_date === activeDate })
  
  // Build date dropdown
  var dateOptions = lottoAvailableDates.map(function(d) {
    var sel = d === activeDate ? 'selected' : ''
    return '<option value="' + d + '" ' + sel + '>' + formatDateShort(d) + '</option>'
  }).join('')
  
  var dateDropdown = lottoAvailableDates.length > 1
    ? '<select class="lotto-date-select" onchange="window.__selectLottoDate(this.value)">' + dateOptions + '</select>'
    : '<span class="lotto-date-label">' + formatDateShort(activeDate) + '</span>'
  
  var items = dayResults.map(function(r) {
    var nums = (r.results || []).join(' ')
    return `
      <li class="lotto-item">
        <div class="lotto-game-row">
          <span class="lotto-game-name">${shortGameName(r.game_name)}</span>
          <span class="lotto-draw-time">${r.draw_time}</span>
        </div>
        <div class="lotto-numbers">${nums}</div>
        ${r.jackpot ? '<div class="lotto-jackpot">' + formatJackpot(r.jackpot) + '</div>' : ''}
      </li>
    `
  }).join('')
  
  return `
    <div class="lotto-card">
      <div class="lotto-header">
        <span>🎰 PCSO Lotto Results</span>
        ${dateDropdown}
      </div>
      <ul class="lotto-list">${items}</ul>
      <div class="lotto-footer">Source: PCSO via GMA News</div>
    </div>
  `
}

function shortGameName(name) {
  var short = {
    '2D Lotto (EZ2)': 'EZ2',
    '3D Lotto (Swertres)': 'Swertres',
    '4D Lotto': '4D',
    '6D Lotto': '6D',
    'Lotto 6/42': '6/42',
    'Mega Lotto 6/45': 'Mega 6/45',
    'Super Lotto 6/49': 'Super 6/49',
    'Grand Lotto 6/55': 'Grand 6/55',
    'Ultra Lotto 6/58': 'Ultra 6/58',
  }
  return short[name] || name
}

function formatJackpot(jackpot) {
  if (!jackpot) return ''
  // GMA News sends values like "4,000.00" — strip commas so parseFloat works
  var cleaned = String(jackpot).replace(/,/g, '')
  var num = parseFloat(cleaned)
  if (isNaN(num)) return ''
  if (num >= 1000000) {
    return 'Jackpot: ₱' + (num / 1000000).toFixed(1) + 'M'
  }
  // Fixed prizes like EZ2 (₱4,000) and Swertres (₱4,500)
  return 'Prize: ₱' + Number(num).toLocaleString('en-PH')
}

function formatDateShort(dateStr) {
  if (!dateStr) return ''
  var parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return months[parseInt(parts[1]) - 1] + ' ' + parseInt(parts[2])
}

// ── Render: Sidebar ─────────────────────────────────

function renderWeatherWidget() {
  if (weatherLoading) {
    return '<div class="weather-card"><div class="weather-loading">⏳ Loading weather…</div></div>'
  }
  if (!weatherData) {
    return '<div class="weather-error">🌤️ Weather unavailable <button class="weather-retry-btn" onclick="window.__retryWeather()">↻ Retry</button></div>'
  }
  var emoji = getWeatherEmoji(weatherData.code)
  var locLabel = weatherLocation || 'Unknown location'
  return `
    <div class="weather-card">
      <div class="weather-header">
        <span class="weather-label">🌏 ${escHtml(locLabel)}</span>
        <span class="weather-updated">just now</span>
      </div>
      <div class="weather-main">
        <span class="weather-temp">${weatherData.temp}<sup>°C</sup></span>
        <div class="weather-desc">${emoji} ${escHtml(weatherData.desc)}</div>
      </div>
      <div class="weather-details">
        <span>💧 ${weatherData.humidity}%</span>
        <span>🌬️ ${weatherData.wind} km/h</span>
        <span>Feels ${weatherData.feelsLike}°</span>
      </div>
    </div>
  `
}

function getWeatherEmoji(code) {
  var n = parseInt(code)
  if (n >= 200 && n < 300) return '⛈️'  // Thunderstorm
  if (n >= 300 && n < 400) return '🌦️'  // Drizzle
  if (n >= 500 && n < 600) return '🌧️'  // Rain
  if (n >= 600 && n < 700) return '❄️'   // Snow
  if (n >= 700 && n < 800) return '🌫️'  // Atmosphere (mist, fog)
  if (n === 800) return '☀️'            // Clear
  if (n > 800) return '☁️'              // Clouds
  return '🌤️'                           // Default
}

function renderLatestSidebar(articles) {
  if (!articles || !articles.length) return ''
  var top = articles.slice(0, 8)
  var items = top.map(function(a, i) {
    var articleUrl = BASE_PATH + '/article/' + a.slug
    return `
      <li class="trending-sidebar-item">
        <a href="${articleUrl}" class="sidebar-item-link" onclick="event.preventDefault();navigate('/article/${a.slug}')">
          <span class="trending-rank">${i + 1}</span>
          <div>
            <div class="trending-sidebar-title">${escHtml(a.title)}</div>
            <div class="trending-sidebar-score">📅 ${formatDate(a.published_at || a.created_at)} · ${a.category || 'General'}</div>
          </div>
        </a>
      </li>
    `
  }).join('')
  return `
    <div class="trending-sidebar">
      <div class="trending-sidebar-header">📰 Latest Articles</div>
      <ol class="trending-sidebar-list">${items}</ol>
      <a class="trending-sidebar-more" href="javascript:void(0)" onclick="navigate('/')">📖 See all articles →</a>
    </div>
  `
}

function renderSidebar(articles) {
  return `
    <aside class="landing-sidebar">
      ${renderWeatherWidget()}
      ${renderLatestSidebar(articles)}
      ${renderLottoWidget()}
    </aside>
  `
}

// ── Render: Category Tabs (separate from main render so we can re-render grid without redoing everything) ──

function renderCategoryTabs(categories) {
  return categories.length > 1 ? `
    <div class="category-tabs-wrap">
      <div class="category-tabs">
        <button class="category-tab ${!categoryFilter ? 'active' : ''}" onclick="window.__catFilterTab('')">All</button>
        ${categories.map(function(c) {
          return `<button class="category-tab ${categoryFilter === c ? 'active' : ''}" onclick="window.__catFilterTab('${escHtml(c)}')">${escHtml(c)}</button>`
        }).join('')}
      </div>
      <div class="category-tab-indicator"></div>
    </div>
  ` : ''
}

window.__catFilterTab = function(cat) {
  categoryFilter = cat
  tagFilter = ''
  var url = BASE_PATH + '/' + (cat ? '?category=' + encodeURIComponent(cat) : '')
  history.pushState(null, '', url)
  updateNavActive(cat)
  renderArticlesGrid()
}

function updateNavActive(cat) {
  var links = document.querySelectorAll('.nav-link')
  for (var i = 0; i < links.length; i++) {
    links[i].classList.toggle('active', links[i].getAttribute('data-cat') === cat)
  }
}

window.__clearTagFilter = function() {
  tagFilter = ''
  var url = BASE_PATH + '/'
  history.pushState(null, '', url)
  renderArticlesGrid()
}

// ── Shared category colors ────────────────────────────
const CAT_COLORS = {
  General: { bg: 'linear-gradient(135deg, #667eea, #764ba2)', emoji: '📰' },
  Sports: { bg: 'linear-gradient(135deg, #e53935, #ff6f00)', emoji: '🏀' },
  Politics: { bg: 'linear-gradient(135deg, #2c3e50, #4ca1af)', emoji: '🏛️' },
  Disaster: { bg: 'linear-gradient(135deg, #e65100, #f57c00)', emoji: '⚠️' },
  Economy: { bg: 'linear-gradient(135deg, #1b5e20, #43a047)', emoji: '💹' },
  Health: { bg: 'linear-gradient(135deg, #004d40, #009688)', emoji: '🏥' },
  Technology: { bg: 'linear-gradient(135deg, #283593, #5c6bc0)', emoji: '💻' },
  Entertainment: { bg: 'linear-gradient(135deg, #6a1b9a, #ab47bc)', emoji: '🎬' },
}

// ── Render: Article Grid (can be called independently for load more) ──

function renderArticlesGrid() {
  var app = document.getElementById('app')
  var gridContainer = app.querySelector('#article-grid-container')
  if (!gridContainer) return
  
  // Filter by category and/or tag
  var filtered = articles
  if (categoryFilter) {
    filtered = filtered.filter(function(a) { return (a.category || 'General').toLowerCase() === categoryFilter.toLowerCase() })
  }
  if (tagFilter) {
    filtered = filtered.filter(function(a) {
      var tags = a.tags || []
      return tags.some(function(t) { return t.toLowerCase() === tagFilter.toLowerCase() })
    })
  }
  
  var displayArticles = filtered.slice(0, loadedCount)
  
  // Build filter description for empty state
  var filterDesc = ''
  if (tagFilter) filterDesc = ' with tag "' + escHtml(tagFilter) + '"'
  else if (categoryFilter) filterDesc = ' in ' + escHtml(categoryFilter)
  
  if (!displayArticles.length) {
    gridContainer.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><h2>No articles' + filterDesc + '</h2><p>Try a different filter.</p>' + (tagFilter ? '<button class="retry-btn" onclick="window.__clearTagFilter()">Clear tag filter</button>' : '') + '</div>'
    return
  }
  
  var catColors = CAT_COLORS
  
  // Show active filter notice
  var filterNotice = tagFilter ? '<div class="filter-notice">🔍 Showing articles tagged: <strong>' + escHtml(tagFilter) + '</strong> <button class="filter-clear" onclick="window.__clearTagFilter()">✕ Clear</button></div>' : ''
  
  var gridHtml = filterNotice + '<div class="article-grid">'
  displayArticles.forEach(function(a, i) {
    var cat = catColors[a.category] || catColors.General
    var isFeatured = i === 0 && loadedCount > 1
    var imgHtml = a.image_url
      ? '<img src="' + a.image_url + '" alt="' + escHtml(a.title) + '" loading="lazy">'
      : '<span class="card-img-emoji">' + cat.emoji + '</span>'
    var articleUrl = BASE_PATH + '/article/' + a.slug
    
    gridHtml += '<div class="article-card' + (isFeatured ? ' card-featured' : '') + '" data-category="' + (a.category || 'General') + '">'
    gridHtml += '<a href="' + articleUrl + '" class="card-link" onclick="event.preventDefault();navigate(\'/article/' + a.slug + '\')">'
    gridHtml += '<div class="card-img" style="background:' + cat.bg + '">' + imgHtml + '</div>'
    gridHtml += '<div class="card-body">'
    gridHtml += '<span class="card-category-badge">' + cat.emoji + ' ' + (a.category || 'General') + '</span>'
    gridHtml += '<h2 class="card-title">' + escHtml(a.title) + '</h2>'
    gridHtml += '<p class="card-summary">' + escHtml(a.summary || '') + '</p>'
    gridHtml += '<div class="card-meta"><span>📅 ' + formatDate(a.published_at || a.created_at) + '</span><span>📖 ' + Math.max(1, Math.ceil((a.summary || '').split(/\s+/).filter(Boolean).length / 50)) + ' min</span></div>'
    gridHtml += '</div>'
    gridHtml += '</a></div>'
  })
  gridHtml += '</div>'

  // Load more button
  var hasMore = filtered.length > displayArticles.length
  gridHtml += '<div class="load-more-wrap">'
  if (isLoadingMore) {
    gridHtml += '<button class="load-more-btn" disabled><span class="load-more-spinner"></span> Loading…</button>'
  } else if (hasMore) {
    gridHtml += '<button class="load-more-btn" onclick="loadMoreArticles()">📰 Load More Articles</button>'
  } else if (loadedCount > 6) {
    gridHtml += '<p class="no-more">All articles loaded</p>'
  }
  gridHtml += '</div>'
  
  gridContainer.innerHTML = gridHtml
  
  // Animate cards
  requestAnimationFrame(function() {
    var cards = gridContainer.querySelectorAll('.article-card')
    cards.forEach(function(el, i) {
      el.style.animationDelay = (i * 0.08) + 's'
      el.classList.add('animate-in')
    })
  })
}

// ── Render: Article List ──────────────────────────
async function renderList() {
  const app = document.getElementById('app')

  // Reset SEO for homepage
  updateSeoForList()

  // Init reading progress
  initReadingProgress()

  // Update dark toggle icon in header
  const icon = document.querySelector('.dark-toggle-icon')
  if (icon) icon.textContent = darkMode ? '☀️' : '🌙'

  renderLoading()

  try {
    if (!articles.length) {
      articles = await fetchArticles()
      loadedCount = Math.min(6, articles.length)
      hasMoreArticles = articles.length > loadedCount
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

    // ── Trending ticker (shows latest published articles, not Google Trends) ──
    const tickerItems = articles.slice(0, 15).map(a => `<span class="ticker-item">${escHtml(a.title)}</span>`).join('')
    const tickerHtml = articles.length ? `
      <div class="ticker-wrap">
        <div class="ticker-label">📰 LATEST</div>
        <div class="ticker-track">
          <div class="ticker-content">
            ${tickerItems}${tickerItems}
          </div>
        </div>
      </div>
    ` : ''

    // ── Hero Carousel ──
    const heroArticles = articles.slice(0, Math.min(5, articles.length))
    
    const catColors = CAT_COLORS
    
    const heroSlidesHtml = heroArticles.map((a, i) => {
      const cat = catColors[a.category] || catColors.General
      const imgStyle = a.image_url
        ? `background-image: url(${a.image_url});`
        : `background: ${cat.bg};`
      const articleUrl = BASE_PATH + '/article/' + a.slug
      return `
        <div class="hero-slide ${i === 0 ? 'active' : ''}">
          <a href="${articleUrl}" class="hero-slide-link" onclick="event.preventDefault();navigate('/article/${a.slug}')">
            <div class="hero-slide-bg" style="${imgStyle} background-size: cover; background-position: center;"></div>
            <div class="hero-slide-overlay"></div>
            <div class="hero-slide-content">
              <span class="hero-slide-category">${cat.emoji} ${a.category || 'General'}</span>
              <h2 class="hero-slide-title">${escHtml(a.title)}</h2>
              ${a.summary ? `<p class="hero-slide-summary">${escHtml(a.summary)}</p>` : ''}
              <div class="hero-slide-meta">
                <span>📅 ${formatDate(a.published_at || a.created_at)}</span>
                <span>📖 ${Math.max(1, Math.ceil((a.summary || '').split(/\s+/).filter(Boolean).length / 50))} min read</span>
              </div>
              <span class="hero-slide-cta">Read Story →</span>
            </div>
          </a>
        </div>
      `
    }).join('')
    
    const heroDotsHtml = heroArticles.length > 1 ? `
      <div class="hero-dots">
        ${heroArticles.map((_, i) => `<button class="hero-dot ${i === 0 ? 'active' : ''}" onclick="goToHeroSlide(${i})" aria-label="Slide ${i + 1}"></button>`).join('')}
      </div>
    ` : ''
    
    const heroHtml = heroArticles.length ? `
      <div class="hero-carousel">
        <div class="hero-slides">
          ${heroSlidesHtml}
        </div>
        ${heroDotsHtml}
        ${heroArticles.length > 1 ? '<div class="hero-swipe-hint">›</div>' : ''}
      </div>
    ` : ''

    // ── Categories ──
    const categories = [...new Set(articles.map(a => a.category || 'General'))].sort()
    const tabsHtml = renderCategoryTabs(categories)
    
    // ── Filtered Articles Grid ──
    const filtered = categoryFilter
      ? articles.filter(a => (a.category || 'General').toLowerCase() === categoryFilter.toLowerCase())
      : articles
    
    const displayArticles = filtered.slice(0, loadedCount)
    
    // ── Assemble page ──
    app.innerHTML = `
      ${tickerHtml}
      <div class="container">
        <div class="landing-layout">
          <div class="landing-main">
            <div class="landing-header">
              <div>
                <h1 class="page-title">Trending Now</h1>
                <p class="page-subtitle">Latest stories from across the Philippines</p>
              </div>
              <div class="landing-article-count">${filtered.length} article${filtered.length !== 1 ? 's' : ''}</div>
            </div>
            ${heroHtml}
            <div class="section-label">Latest Stories</div>
            ${tabsHtml}
            <div id="article-grid-container"></div>
          </div>
          ${renderSidebar(articles)}
        </div>
      </div>
    `
    
    // Render grid into container
    renderArticlesGrid()
    
    // Init hero carousel after DOM
    if (heroArticles.length > 1) {
      initHeroCarousel(articles, heroArticles)
    }
    
    // Init category tabs after DOM
    if (categories.length > 1) {
      initCategoryTabs(categories)
    }

  } catch (e) {
    console.error('Failed to load articles:', e)
    renderError(e.message)
  }
}

// ── Lotto fetch on renderList ─────────────────────
// Fetch lotto results when the list page loads (separate from weather)
// so the sidebar has data even if weather is still loading.
// The lotto fetch also runs on DOMContentLoaded.

// ── Render: Admin Dashboard ───────────────────────
async function renderAdmin() {
  const app = document.getElementById('app')

  // Set SEO for admin (noindex to keep it out of search)
  setMetaTags({
    title: 'Admin Dashboard — ' + SITE_NAME,
    description: 'TrendWire Philippines admin dashboard for managing trends and articles.',
    url: SITE_URL + '/admin',
    robots: 'noindex, nofollow',
  })
  removeLd('ld-article')
  removeLd('ld-breadcrumb')

  let trends = []
  let generating = null
  let fetching = false
  let toast = null
  let trendSearch = ''

  // Articles management
  let allArticles = []
  let loadingArticles = false
  let deletingArticle = null
  let selectedIds = new Set()
  let bulkDeleting = false

  // Editor state
  let editingArticle = null
  let editorDraft = null
  let saving = false
  let publishing = false
  let imageGenerating = false
  let imagePreviewUrl = null
  let uploadedImageUrl = null
  let previewMode = false
  let publishedResult = null

  let selectedModel = 'poolside/laguna-xs-2.1:free'

  const MODELS = [
    { id: 'poolside/laguna-xs-2.1:free', label: 'Laguna XS 2.1 (free)' },
    { id: 'openrouter/free', label: 'OpenRouter Free (auto)' },
    { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  ]

  const CATEGORIES = ['General', 'Sports', 'Politics', 'Disaster', 'Economy', 'Health', 'Technology', 'Entertainment']

  async function loadArticles() {
    if (!sb) return
    loadingArticles = true
    render()
    try {
      const { data, error } = await sb
        .from('articles')
        .select('id, title, slug, category, status, published_at, created_at, summary, trend_id')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      allArticles = data || []
      loadingArticles = false
      render()
    } catch (e) {
      loadingArticles = false
      showToast('❌ Failed to load articles: ' + e.message, 'error')
      render()
    }
  }

  function handleToggleSelect(id) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id)
    } else {
      selectedIds.add(id)
    }
    render()
  }

  function handleSelectAll() {
    const selectable = allArticles.filter(a => a.status === 'published' || a.status === 'draft')
    const allSelected = selectable.every(a => selectedIds.has(a.id))
    if (allSelected) {
      selectedIds = new Set()
    } else {
      selectedIds = new Set(selectable.map(a => a.id))
    }
    render()
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return
    const count = selectedIds.size
    if (!confirm(`Delete ${count} article${count !== 1 ? 's' : ''}? This cannot be undone.`)) return
    bulkDeleting = true
    render()
    try {
      await adminOperation('delete-articles', { ids: Array.from(selectedIds) })
      allArticles = allArticles.filter(a => !selectedIds.has(a.id))
      articles = [] // Clear cached published articles
      selectedIds = new Set()
      bulkDeleting = false
      showToast(`🗑️ ${count} article${count !== 1 ? 's' : ''} deleted`, 'success')
      render()
    } catch (e) {
      bulkDeleting = false
      showToast('❌ Bulk delete failed: ' + e.message, 'error')
      render()
    }
  }

  async function handleDeleteArticle(articleId, articleTitle) {
    if (!confirm(`Delete "${articleTitle}"? This cannot be undone.`)) return
    deletingArticle = articleId
    render()
    try {
      await adminOperation('delete-article', { id: articleId })
      allArticles = allArticles.filter(a => a.id !== articleId)
      articles = [] // Clear cached published articles
      deletingArticle = null
      showToast(`🗑️ "${articleTitle}" deleted`, 'success')
      render()
    } catch (e) {
      deletingArticle = null
      showToast('❌ Delete failed: ' + e.message, 'error')
      render()
    }
  }

  async function openArticleInEditor(articleId) {
    previewMode = false
    try {
      const article = await adminOperation('get-article', { id: articleId })
      editingArticle = article
      editorDraft = {
        title: article.title || '',
        summary: article.summary || '',
        content: article.content || '',
        category: article.category || 'General',
        tags: (article.tags || []).join(', '),
        seo_description: article.seo_description || '',
        image_prompt: article.image_prompt || '',
      }
      imagePreviewUrl = article.image_url || null
      uploadedImageUrl = article.image_url || null
      render()
    } catch (e) {
      showToast('❌ Failed to load article: ' + e.message, 'error')
    }
  }

  function showToast(message, type = 'info') {
    toast = { message, type }
    render()
    setTimeout(() => { toast = null; const el = document.querySelector('.toast'); if (el) el.remove() }, 4000)
  }

  function renderQualityBadge(article) {
    if (!article || !article.quality_score) return ''
    var score = article.quality_score
    var color = score >= 8 ? '#2e7d32' : score >= 5 ? '#f9a825' : '#c62828'
    var label = score >= 8 ? 'Great' : score >= 5 ? 'Needs review' : 'Poor'
    var barWidth = (score / 10) * 100
    return `
      <div class="quality-badge" style="display:inline-flex;align-items:center;gap:8px;margin-left:8px;font-size:12px">
        <span style="display:flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;background:${color}15;color:${color};font-weight:700;border:1px solid ${color}30">
          <span style="font-size:14px">${score >= 8 ? '✅' : score >= 5 ? '⚠️' : '❌'}</span>
          ${score.toFixed(1)} ${label}
        </span>
      </div>`
  }

  async function loadFromDB() {
    try {
      trends = await searchTrendsDB('')
      render()
    } catch (e) {
      console.error('Failed to load trends from DB:', e)
    }
  }

  async function fetchTrends() {
    fetching = true
    render()
    try {
      const result = await fetchFromGoogleTrends()
      const count = result?.trends?.length ?? 0
      trends = await searchTrendsDB('')
      fetching = false
      if (count > 0) {
        showToast(`✅ ${count} new trend${count !== 1 ? 's' : ''} fetched from Google Trends PH!`, 'success')
      } else {
        showToast('✅ Trends are up to date — no new trending topics found', 'info')
      }
      render()
    } catch (e) {
      console.error('Google Trends fetch failed, refreshing from DB:', e)
      trends = await searchTrendsDB('')
      fetching = false
      showToast('⚠️ Google Trends fetch failed — showing stored trends', 'error')
      render()
    }
  }

  async function handleGenerate(trendId) {
    generating = trendId
    previewMode = false
    render()
    try {
      const result = await generateArticleFromTrend(trendId, selectedModel)
      const article = result.article
      editingArticle = article
      editorDraft = {
        title: article.title || '',
        summary: article.summary || '',
        content: article.content || '',
        category: article.category || 'General',
        tags: (article.tags || []).join(', '),
        seo_description: article.seo_description || '',
        image_prompt: article.image_prompt || '',
      }
      imagePreviewUrl = article.image_url || null
      uploadedImageUrl = article.image_url || null
      generating = null
      render()
      const wc = (article.content || '').trim().split(/\s+/).filter(Boolean).length
      if (wc < 500) {
        showToast(`⚠️ Generated content is only ${wc} words — try regenerating or expand manually before publishing.`, 'error')
      } else if (wc < 600) {
        showToast(`📝 ${wc} words — close to the 600 minimum. Consider adding more detail.`, 'info')
      } else {
        showToast(`✅ ${wc} words — ready for review!`, 'success')
      }
    } catch (e) {
      generating = null
      showToast('❌ Failed to generate: ' + e.message, 'error')
      render()
    }
  }

  async function handleSave() {
    if (!editingArticle) return
    saving = true
    render()
    try {
      const tags = editorDraft.tags
        ? editorDraft.tags.split(',').map(t => t.trim()).filter(Boolean)
        : []
      const result = await adminOperation('update-article', {
        id: editingArticle.id,
        title: editorDraft.title,
        summary: editorDraft.summary,
        content: editorDraft.content,
        category: editorDraft.category,
        tags,
        seo_description: editorDraft.seo_description,
        image_prompt: editorDraft.image_prompt,
        image_url: uploadedImageUrl || editingArticle.image_url,
      })
      editingArticle = result
      saving = false
      showToast('💾 Draft saved!', 'success')
      render()
    } catch (e) {
      saving = false
      showToast('❌ Save failed: ' + e.message, 'error')
      render()
    }
  }

  async function handlePublish() {
    if (!editingArticle) return

    // Validate content before publishing
    const words = (editorDraft.content || '').trim().split(/\s+/).filter(Boolean).length
    if (words < 600) {
      showToast(`⚠️ Content too short (${words} words). Minimum is 600 words.`, 'error')
      return
    }
    if (words > 800) {
      showToast(`⚠️ Content too long (${words} words). Maximum is 800 words.`, 'error')
      return
    }

    publishing = true
    render()
    try {
      // First save any pending edits
      if (editorDraft) {
        const tags = editorDraft.tags
          ? editorDraft.tags.split(',').map(t => t.trim()).filter(Boolean)
          : []
        await adminOperation('update-article', {
          id: editingArticle.id,
          title: editorDraft.title,
          summary: editorDraft.summary,
          content: editorDraft.content,
          category: editorDraft.category,
          tags,
          seo_description: editorDraft.seo_description,
          image_prompt: editorDraft.image_prompt,
          image_url: uploadedImageUrl || editingArticle.image_url,
        })
      }
      // Then publish
      const result = await adminOperation('publish-article', { id: editingArticle.id })
      // Clear articles cache so list refreshes
      articles = []
      publishing = false
      editingArticle = { ...editingArticle, ...result }
      // Show publish success modal instead of closing editor
      publishedResult = { id: result.id, title: result.title, slug: result.slug }
      render()
    } catch (e) {
      publishing = false
      showToast('❌ Publish failed: ' + e.message, 'error')
      render()
    }
  }

  function handleCloseEditor() {
    publishedResult = null
    editingArticle = null
    editorDraft = null
    imagePreviewUrl = null
    uploadedImageUrl = null
    render()
  }

  function handlePublishClose() {
    publishedResult = null
    editingArticle = null
    editorDraft = null
    imagePreviewUrl = null
    uploadedImageUrl = null
    render()
  }

  function handlePublishContinueEdit() {
    publishedResult = null
    // Update the article status in the management list
    allArticles = allArticles.map(a => a.id === editingArticle?.id ? { ...a, status: 'published' } : a)
    render()
  }

  function enhanceImagePrompt(rawPrompt) {
    var enhanced = rawPrompt.trim()
    // Remove any style tags the LLM may have slipped in despite instructions
    var stripTags = ['photojournalism', 'editorial photography', 'documentary style', 'sharp focus', 'high resolution', 'digital art', 'illustration', 'cinematic', 'masterpiece', '4k', 'trending']
    var promptLower = enhanced.toLowerCase()
    for (var s = 0; s < stripTags.length; s++) {
      while (promptLower.indexOf(stripTags[s]) !== -1) {
        enhanced = enhanced.slice(0, promptLower.indexOf(stripTags[s])) +
          enhanced.slice(promptLower.indexOf(stripTags[s]) + stripTags[s].length)
        promptLower = enhanced.toLowerCase()
      }
    }
    // Clean up double commas and whitespace from removed tags
    enhanced = enhanced.split(',').map(function(s) { return s.trim() }).filter(function(s) { return s }).join(', ')

    if (!enhanced) {
      enhanced = 'Philippine news scene'
    }

    // Check if location context already present — covers cities, regions, and Filipino cultural terms
    var locationPatterns = /\b(philippine|philippines|filipino|pilipinas|manila|cebu|davao|pinoy|tagalog|bisaya|mindanao|visayas|luzon|makati|quezon|pasig|taguig|pasay|mandaluyong|paranaque|baguio|iloilo|bacolod|zamboanga|palawan|boracay|siargao|bohol|leyte|jeepney|barangay|pagasa|nbi|pnp|sari.sari|gilas)\b/i
    if (!locationPatterns.test(enhanced)) {
      // Prepend "Philippine " only if prompt starts with a lowercase word (not a name)
      var firstChar = enhanced.charAt(0)
      if (firstChar >= 'a' && firstChar <= 'z') {
        enhanced = 'Philippine ' + enhanced
      }
    }
    // Auto-append news photography style tags — reduces what the LLM needs to produce
    enhanced += ', photojournalism, editorial photography, documentary style, sharp focus, high resolution'
    return enhanced
  }

  async function handleGenerateImage() {
    var rawPrompt = editorDraft?.image_prompt
    if (!rawPrompt) {
      showToast('⚠️ Please enter an image prompt first', 'error')
      return
    }
    imageGenerating = true
    imagePreviewUrl = null
    render()

    var enhancedPrompt = enhanceImagePrompt(rawPrompt)
    // Use Flux model for best photorealistic news imagery
    // _= timestamp cache-buster ensures regenerate actually produces a new image
    var url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(enhancedPrompt) +
      '?width=1280&height=720&model=flux&nofeed=true&seed=' + Math.floor(Math.random() * 2147483647) +
      '&_=' + Date.now()

    // Preload the image
    var img = new Image()
    img.onload = function() {
      imagePreviewUrl = url
      imageGenerating = false
      render()
    }
    img.onerror = function() {
      // Retry without style modifiers in case the enhanced prompt caused issues
      var fallbackUrl = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(rawPrompt.slice(0, 100)) +
        '?width=1280&height=720&nofeed=true' +
        '&_=' + Date.now()
      var fallbackImg = new Image()
      fallbackImg.onload = function() {
        imagePreviewUrl = fallbackUrl
        imageGenerating = false
        render()
      }
      fallbackImg.onerror = function() {
        imageGenerating = false
        showToast('❌ Image generation failed — try a different prompt or upload manually', 'error')
        render()
      }
      fallbackImg.src = fallbackUrl
    }
    img.src = url
  }

  async function handleUseGeneratedImage() {
    if (!imagePreviewUrl || !editingArticle) return

    try {
      showToast('⏳ Uploading image…', 'info')

      // Pass the image URL directly — the Edge Function fetches it server-side
      // This avoids the 1MB request body limit on Supabase Functions
      const result = await adminOperation('upload-image', {
        article_id: editingArticle.id,
        image_url: imagePreviewUrl,
      })

      uploadedImageUrl = result.url
      editingArticle.image_url = result.url
      showToast('✅ Photo saved!', 'success')
      render()
    } catch (e) {
      showToast('❌ Image upload failed: ' + e.message, 'error')
    }
  }

  async function handleFileUpload(file) {
    if (!editingArticle) return

    // Validate size (2 MB)
    if (file.size > 2 * 1024 * 1024) {
      showToast('⚠️ Image too large — max 2 MB', 'error')
      return
    }

    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      showToast('⏳ Uploading image…', 'info')

      const result = await adminOperation('upload-image', {
        article_id: editingArticle.id,
        base64,
      })

      uploadedImageUrl = result.url
      editingArticle.image_url = result.url
      showToast('✅ Photo uploaded!', 'success')
      render()
    } catch (e) {
      showToast('❌ Upload failed: ' + e.message, 'error')
    }
  }

  // ── Editor field updaters (called from oninput, no re-render needed) ──

  function updateField(field, value, el) {
    editorDraft[field] = value

    // Update char counter if present
    const fieldEl = el.closest('.editor-field')
    if (fieldEl) {
      const counter = fieldEl.querySelector('.char-counter')
      if (counter) {
        const max = parseInt(counter.dataset.max || '999')
        counter.textContent = `${value.length}/${max}`
      }
      const wc = fieldEl.querySelector('.word-counter')
      if (wc && field === 'content') {
        const words = value.trim().split(/\s+/).filter(Boolean).length
        wc.textContent = `${words} words`
        wc.style.color = (words >= 600 && words <= 800) ? '#2e7d32' : '#c62828'
      }
    }
  }

  function handleTagsInput(value, el) {
    editorDraft.tags = value
    const fieldEl = el.closest('.editor-field')
    if (fieldEl) {
      const preview = fieldEl.querySelector('.tag-preview')
      if (preview) {
        const tags = value.split(',').map(t => t.trim()).filter(Boolean)
        preview.innerHTML = tags.length
          ? tags.map(t => `<span class="editor-tag">${escHtml(t)}</span>`).join('')
          : ''
      }
    }
  }

  // ── Render ────────────────────────────────────────

  function render() {
    const hasEditor = editingArticle && editorDraft

    // Filter trends by search query (before headerHtml since it's referenced in status)
    const filteredTrends = trendSearch.trim()
      ? trends.filter(t =>
          t.title.toLowerCase().includes(trendSearch.toLowerCase()) ||
          (t.summary || '').toLowerCase().includes(trendSearch.toLowerCase())
        )
      : trends

    // Toolbar & header (always visible)
    const headerHtml = `
      <button class="back-btn" onclick="navigate('/')">← Back to articles</button>
      <div class="admin-header">
        <h1 class="page-title">🛠️ Admin Dashboard</h1>
        <p class="page-subtitle">Fetch trending topics from Google Trends PH and generate articles</p>
      </div>

      <div class="admin-toolbar">
        <button class="fetch-btn" onclick="renderAdmin.__fetch()" ${fetching ? 'disabled' : ''}>
          ${fetching ? '⏳ Fetching…' : '📥 Fetch Latest PH Trends'}
        </button>
        <div class="model-selector">
          <label class="model-label">🤖 Model</label>
          <select class="model-select" onchange="renderAdmin.__setModel(this.value)">
            ${MODELS.map(m => `<option value="${m.id}" ${selectedModel === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
          </select>
        </div>
        <span class="fetch-status">
          ${fetching ? '⏳ Fetching from Google Trends PH…' : trendSearch ? `${filteredTrends.length}/${trends.length} trends` : `${trends.length} trend${trends.length !== 1 ? 's' : ''} loaded`}
        </span>
      </div>

      <div class="trend-search-bar">
        <input type="text" class="trend-search-input" placeholder="🔍 Search trends..."
               value="${escHtml(trendSearch)}"
               oninput="renderAdmin.__trendSearch(this.value)">
        ${trendSearch ? `<button class="trend-search-clear" onclick="renderAdmin.__trendSearch('')">✕</button>` : ''}
      </div>
    `

    const toastHtml = toast
      ? `<div class="toast toast-${toast.type}">${toast.message}</div>`
      : ''

    // Trend cards
    // ── Articles Management Section ──
    let articlesHtml = ''
    if (allArticles.length) {
      const published = allArticles.filter(a => a.status === 'published')
      const drafts = allArticles.filter(a => a.status === 'draft')
      const selectable = allArticles.filter(a => a.status === 'published' || a.status === 'draft')
      const allSelected = selectable.length > 0 && selectable.every(a => selectedIds.has(a.id))

      const bulkBarHtml = selectedIds.size > 0 && !hasEditor ? `
        <div class="bulk-bar">
          <span class="bulk-count">${selectedIds.size} selected</span>
          <button class="bulk-delete-btn" onclick="renderAdmin.__deleteSelected()"
                  ${bulkDeleting ? 'disabled' : ''}>
            ${bulkDeleting ? '⏳ Deleting…' : '🗑️ Delete Selected'}
          </button>
          <button class="bulk-cancel-btn" onclick="renderAdmin.__clearSelection()">✕ Clear</button>
        </div>
      ` : ''

      function renderCard(a, isDraft) {
        const checked = selectedIds.has(a.id) ? 'checked' : ''
        const disabled = deletingArticle === a.id || bulkDeleting ? 'disabled' : ''
        return `
          <div class="article-manage-card ${deletingArticle === a.id ? 'deleting' : ''}">
            <label class="article-checkbox-label" onclick="event.stopPropagation()">
              <input type="checkbox" class="article-checkbox" ${checked} ${disabled}
                     onchange="renderAdmin.__toggleSelect('${a.id}')">
            </label>
            <div class="article-manage-info">
              <span class="article-manage-title ${isDraft ? 'draft-title' : ''}" style="cursor:pointer" onclick="renderAdmin.__openArticle('${a.id}')">
                ${escHtml(a.title)}
              </span>
              ${!isDraft ? `<a href="${BASE_PATH}/article/${a.slug}" target="_blank" class="manage-view-link" title="View published article">↗</a>` : ''}
              <div class="article-manage-meta">
                <span class="category-badge-sm ${a.category || 'General'}">${escHtml(a.category || 'General')}</span>
                <span>📅 ${formatDate(a.published_at || a.created_at)}</span>
              </div>
            </div>
            <button class="delete-btn" onclick="renderAdmin.__deleteArticle('${a.id}', '${escHtml(a.title).replace(/'/g, "\\'")}')"
                    ${deletingArticle === a.id ? 'disabled' : ''}>
              ${deletingArticle === a.id ? '⏳…' : '🗑️'}
            </button>
          </div>
        `
      }

      articlesHtml = `
        <div class="admin-section-divider">
          <label class="select-all-label" onclick="event.stopPropagation()">
            <input type="checkbox" class="article-checkbox" ${allSelected ? 'checked' : ''}
                   ${bulkDeleting ? 'disabled' : ''}
                   onchange="renderAdmin.__selectAll()">
          </label>
          📰 Published Articles (${published.length})
        </div>
        ${bulkBarHtml}
        ${published.length ? published.map(a => renderCard(a, false)).join('') : `<p class="admin-empty-note">No published articles</p>`}

        ${drafts.length ? `
        <div class="admin-section-divider" style="margin-top:16px">
          📝 Drafts (${drafts.length})
        </div>
        ${drafts.map(a => renderCard(a, true)).join('')}
        ` : ''}
      `
    } else if (loadingArticles) {
      articlesHtml = `<p class="admin-empty-note">⏳ Loading articles…</p>`
    } else {
      articlesHtml = `<p class="admin-empty-note">No articles yet. Generate one from a trend above.</p>`
    }

    // Build lookup of which trends already have articles
    const trendArticleMap = {}
    allArticles.forEach(a => {
      if (a.trend_id) {
        trendArticleMap[a.trend_id] = a
      }
    })

    const trendCards = filteredTrends.length
      ? (trendSearch && trends.length > filteredTrends.length
          ? `<p class="trend-search-count">${filteredTrends.length} of ${trends.length} trends match</p>`
          : ''
        ) + filteredTrends.map(t => {
          const existing = trendArticleMap[t.id]
          const statusBadge = existing
            ? `<span class="trend-status-badge trend-status-${existing.status}">${existing.status === 'published' ? '📢' : '📝'} ${existing.status}</span>`
            : ''
          return `
        <div class="trend-card ${hasEditor ? 'trend-card-compact' : ''}" data-category="${t.category || 'General'}">
          <div class="trend-info">
            <div class="trend-top">
              <span class="category-badge">${t.category || 'General'}</span>
              ${t.impact_score != null ? `<span class="impact-badge impact-${t.impact_score >= 70 ? 'high' : t.impact_score >= 40 ? 'medium' : 'low'}">${t.impact_score >= 70 ? '🔥' : t.impact_score >= 40 ? '📈' : '📊'} ${t.impact_score}</span>` : ''}
              ${statusBadge}
            </div>
            <h3>${escHtml(t.title)}</h3>
            ${t.summary ? `<p class="trend-summary">${escHtml(t.summary)}</p>` : ''}
            <span class="trend-date">📅 ${formatDate(t.created_at)}</span>
          </div>
          <button class="generate-btn" onclick="renderAdmin.__handleGenerate('${t.id}')"
                  ${generating === t.id ? 'disabled' : ''}>
            ${generating === t.id ? '⏳ Generating…' : existing ? '✅ Regenerate' : '✏️ Generate'}
          </button>
        </div>
      `}).join('')
      : `<div class="empty-state"><div class="icon">${trendSearch ? '🔍' : '📊'}</div><h2>${trendSearch ? 'No matching trends' : 'No trends yet'}</h2><p>${trendSearch ? `No trends match your search. Try different keywords.` : 'Click "Fetch Latest PH Trends" to pull trending topics from Google Trends Philippines.'}</p></div>`

    // ── Editor section ──
    let editorHtml = ''
    let modalHtml = publishedResult ? `
      <div class="modal-overlay" onclick="if(event.target===this)renderAdmin.__publishClose()">
        <div class="modal-content">
          <div class="modal-icon">🎉</div>
          <h2 class="modal-title">Published!</h2>
          <p class="modal-article-title">${escHtml(publishedResult.title)}</p>
          <p class="modal-subtitle">Your article is now live on TrendWire Philippines.</p>
          <div class="modal-actions">
            <a class="modal-btn modal-btn-primary" href="${BASE_PATH}/article/${publishedResult.slug}" target="_blank" rel="noopener noreferrer">👁️ View Article</a>
            <button class="modal-btn modal-btn-secondary" onclick="renderAdmin.__publishContinueEdit()">✏️ Continue Editing</button>
            <button class="modal-btn modal-btn-ghost" onclick="renderAdmin.__publishClose()">Close</button>
          </div>
        </div>
      </div>
    ` : ''
    if (hasEditor) {
      const d = editorDraft
      const contentWords = (d.content || '').trim().split(/\s+/).filter(Boolean).length
      const contentColor = (contentWords >= 600 && contentWords <= 800) ? '#2e7d32' : '#c62828'

      const tagsList = (d.tags || '').split(',').map(t => t.trim()).filter(Boolean)

      editorHtml = `
        <div class="editor-pane">
          <div class="editor-scroll">
            <div class="editor-header">
              <h2>✏️ Edit Article</h2>
              <span class="editor-status-badge ${editingArticle?.status === 'published' ? 'published-badge' : 'draft-badge'}">${editingArticle?.status === 'published' ? 'Published' : 'Draft'}</span>
              ${renderQualityBadge(editingArticle)}
            </div>

            <!-- Title -->
            <div class="editor-field">
              <label>
                Title
                <span class="char-counter" data-max="65">${(d.title||'').length}/65</span>
              </label>
              <input type="text" class="editor-input" value="${escHtml(d.title || '')}"
                     maxlength="65" placeholder="Article headline"
                     oninput="renderAdmin.__updateField('title', this.value, this)">
            </div>

            <!-- Summary -->
            <div class="editor-field">
              <label>
                Summary
                <span class="char-counter" data-max="160">${(d.summary||'').length}/160</span>
              </label>
              <textarea class="editor-textarea editor-textarea-sm" maxlength="160"
                        placeholder="Brief summary of the article"
                        oninput="renderAdmin.__updateField('summary', this.value, this)">${escHtml(d.summary || '')}</textarea>
            </div>

            <!-- Content -->
            <div class="editor-field">
              <div class="editor-field-top">
                <label>
                  Content
                  <span class="word-counter" style="color:${contentColor}">${contentWords} words</span>
                </label>
                <div class="editor-tabs">
                  <button class="editor-tab ${!previewMode ? 'active' : ''}" onclick="renderAdmin.__togglePreview()">✏️ Edit</button>
                  <button class="editor-tab ${previewMode ? 'active' : ''}" onclick="renderAdmin.__togglePreview()">👁️ Preview</button>
                </div>
              </div>
              ${!previewMode
                ? `<textarea class="editor-textarea editor-textarea-lg"
                          placeholder="Write your article here... Use **bold** for emphasis"
                          oninput="renderAdmin.__updateField('content', this.value, this)">${escHtml(d.content || '')}</textarea>`
                : `<div class="editor-preview">${renderMarkdown(d.content || '')}</div>`
              }
              <div class="editor-hint">
                ${contentWords < 600 ? `📝 ${contentWords} words — aim for 600-800` : contentWords > 800 ? `📝 ${contentWords} words — max is 800` : `✅ ${contentWords} words — good length`}
                ${!previewMode ? `<span style="margin-left:12px;color:var(--text-muted);font-weight:400">**text** → bold</span>` : ``}
              </div>
            </div>

            <!-- Category -->
            <div class="editor-field">
              <label>Category</label>
              <select class="editor-select" onchange="renderAdmin.__updateField('category', this.value, this)">
                ${CATEGORIES.map(c => `<option value="${c}" ${d.category === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>

            <!-- Tags -->
            <div class="editor-field">
              <label>
                Tags
                <span class="char-counter">comma-separated</span>
              </label>
              <input type="text" class="editor-input" value="${escHtml(d.tags || '')}"
                     placeholder="tag1, tag2, tag3, tag4"
                     oninput="renderAdmin.__handleTags(this.value, this)">
              <div class="tag-preview">
                ${tagsList.map(t => `<span class="editor-tag">${t}</span>`).join('')}
              </div>
            </div>

            <!-- SEO Description -->
            <div class="editor-field">
              <label>
                SEO Description
                <span class="char-counter" data-max="155">${(d.seo_description||'').length}/155</span>
              </label>
              <textarea class="editor-textarea editor-textarea-sm" maxlength="155"
                        placeholder="Meta description for search engines"
                        oninput="renderAdmin.__updateField('seo_description', this.value, this)">${escHtml(d.seo_description || '')}</textarea>
            </div>

            <!-- ── Photo Section ── -->
            <div class="editor-section-divider">
              <span>📸 Featured Photo</span>
            </div>

            <div class="editor-field">
              <label>Image Prompt</label>
              <textarea class="editor-textarea editor-textarea-sm" id="editor-image-prompt"
                        placeholder="Describe the image you want to generate..."
                        oninput="renderAdmin.__updateField('image_prompt', this.value, this)">${escHtml(d.image_prompt || '')}</textarea>
              <div class="editor-image-actions">
                <button class="gen-img-btn" onclick="renderAdmin.__generateImage()"
                        ${imageGenerating ? 'disabled' : ''}>
                  ${imageGenerating ? '⏳ Generating…' : '🎨 Generate with AI'}
                </button>
                <label class="gen-img-btn upload-btn">
                  📁 Upload from Device
                  <input type="file" accept="image/*" style="display:none"
                         onchange="renderAdmin.__handleFileUpload(this.files[0]); this.value=''">
                </label>
              </div>
            </div>

            <!-- Image Preview -->
            <div class="editor-image-preview">
              ${imageGenerating ? `
                <div class="image-preview-loading">
                  <div class="spinner"></div>
                  <p>Generating image with AI…</p>
                </div>
              ` : imagePreviewUrl && !uploadedImageUrl ? `
                <div class="image-preview-box">
                  <img src="${imagePreviewUrl}" alt="Generated preview" class="preview-img"
                       onerror="this.closest('.image-preview-box').innerHTML='<p class=\\'preview-error\\'>⚠️ Failed to load generated image</p>'">
                  <div class="preview-actions">
                    <button class="gen-img-btn use-photo-btn" onclick="renderAdmin.__useGeneratedImage()">✅ Use This Photo</button>
                    <button class="gen-img-btn secondary-btn" onclick="renderAdmin.__generateImage()">🔄 Regenerate</button>
                  </div>
                </div>
              ` : uploadedImageUrl ? `
                <div class="image-preview-box">
                  <img src="${uploadedImageUrl}" alt="Uploaded photo" class="preview-img">
                  <div class="preview-actions">
                    <span class="photo-saved-badge">✅ Photo saved</span>
                    <button class="gen-img-btn secondary-btn" onclick="renderAdmin.__removePhoto()">🗑️ Remove</button>
                  </div>
                </div>
              ` : `
                <div class="image-preview-empty">
                  <span class="preview-placeholder">📷</span>
                  <p>No photo yet — generate with AI or upload from your device</p>
                  <p class="preview-note">Every article must have a photo</p>
                </div>
              `}
            </div>

            <!-- Action Buttons -->
            <div class="editor-actions">
              <button class="editor-btn editor-btn-save" onclick="renderAdmin.__save()"
                      ${saving ? 'disabled' : ''}>
                ${saving ? '⏳ Saving…' : '💾 Save Draft'}
              </button>
              <button class="editor-btn editor-btn-publish" onclick="renderAdmin.__publish()"
                      ${publishing || !uploadedImageUrl ? 'disabled' : ''}>
                ${publishing ? '⏳ Publishing…' : '📢 Publish'}
              </button>
              <button class="editor-btn editor-btn-close" onclick="renderAdmin.__closeEditor()">
                ✕ Close
              </button>
            </div>
            ${!uploadedImageUrl ? `<p class="editor-note">⚠️ A photo is required before publishing</p>` : ''}
          </div>
        </div>
      `
    }

    // ── Assemble page ──

    if (hasEditor) {
      app.innerHTML = `
        ${toastHtml}
        ${modalHtml}
        <div class="container admin-split-layout">
          <div class="admin-sidebar">
            ${headerHtml}
            <div class="trend-list">
              ${trendCards}
            </div>
            <div class="article-manage-section">
              ${articlesHtml}
            </div>
          </div>
          ${editorHtml}
        </div>
      `
      // Scroll editor to top
      const editorScroll = document.querySelector('.editor-scroll')
      if (editorScroll) editorScroll.scrollTop = 0
    } else {
      app.innerHTML = `
        ${toastHtml}
        ${modalHtml}
        <div class="container">
          ${headerHtml}
          <div class="trend-list">
            ${trendCards}
          </div>
          <div class="article-manage-section">
            ${articlesHtml}
          </div>
        </div>
      `
    }

    // Focus the title input after render if editor just opened
    if (hasEditor) {
      const titleInput = document.querySelector('.editor-input')
      if (titleInput && !titleInput.dataset.focused) {
        titleInput.dataset.focused = 'true'
        // Don't steal focus aggressively
      }
    }
  }

  // Attach handlers
  renderAdmin.__handleGenerate = handleGenerate
  renderAdmin.__fetch = fetchTrends
  renderAdmin.__setModel = (value) => {
    selectedModel = value
    render()
  }
  renderAdmin.__updateField = updateField
  renderAdmin.__handleTags = handleTagsInput
  renderAdmin.__save = handleSave
  renderAdmin.__publish = handlePublish
  renderAdmin.__togglePreview = () => { previewMode = !previewMode; render() }
  renderAdmin.__closeEditor = handleCloseEditor
  renderAdmin.__publishClose = handlePublishClose
  renderAdmin.__publishContinueEdit = handlePublishContinueEdit
  renderAdmin.__generateImage = handleGenerateImage
  renderAdmin.__useGeneratedImage = handleUseGeneratedImage
  renderAdmin.__handleFileUpload = handleFileUpload
  renderAdmin.__deleteArticle = handleDeleteArticle
  renderAdmin.__toggleSelect = handleToggleSelect
  renderAdmin.__selectAll = handleSelectAll
  renderAdmin.__deleteSelected = handleDeleteSelected
  renderAdmin.__clearSelection = () => { selectedIds = new Set(); render() }
  renderAdmin.__trendSearch = (value) => { trendSearch = value; render() }
  renderAdmin.__openArticle = openArticleInEditor

  renderAdmin.__removePhoto = () => {
    uploadedImageUrl = null
    imagePreviewUrl = null
    editingArticle.image_url = null
    render()
  }

  // Load data
  await loadFromDB()
  loadArticles() // Load articles for management section
  fetchFromGoogleTrends().then(result => {
    if (fetching || currentRoute !== 'admin') return null
    const count = result?.trends?.length ?? 0
    if (count > 0) {
      showToast(`✅ ${count} new trend${count !== 1 ? 's' : ''} fetched from Google Trends PH!`, 'success')
      return searchTrendsDB('')
    }
    return null
  }).then(freshTrends => {
    if (fetching || currentRoute !== 'admin') return
    if (freshTrends) {
      trends = freshTrends
      render()
    }
  }).catch(() => {})
}

// Simple HTML escape helper
function escHtml(str) {
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}

// Markdown to HTML for article content
function renderMarkdown(content) {
  if (!content) return ''

  // Escape HTML first to prevent injection, then convert markdown
  let html = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Convert **text** to <strong>text</strong>
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')

  // Safety: strip any remaining unmatched ** markers
  html = html.replace(/\*{2,}/g, '')

  // Split by double newlines (paragraph breaks)
  const blocks = html.split('\n\n').filter(b => b.trim())

  if (blocks.length === 0) return ''

  return blocks.map(block => {
    // Handle single line breaks within a paragraph → <br>
    const lines = block.split('\n').filter(l => l.trim())
    return `<p>${lines.join('<br>')}</p>`
  }).join('')
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
            <button class="retry-btn" onclick="navigate('/')">Back to articles</button>
          </div>
        </div>
      `
      return
    }

    // Update SEO for this article
    updateSeoForArticle(article)

    const content = article.content || ''
    const renderedContent = renderMarkdown(content)

    const pageUrl = encodeURIComponent(SITE_URL + '/article/' + article.slug)
    const shareText = encodeURIComponent(`${article.title} — ${SITE_NAME}`)

    // Fetch related articles (same category, exclude current) — gracefully handle failure
    var relatedHtml = ''
    try {
      var relatedArticles = await fetchRelatedArticles(article.category || 'General', article.slug, 4)
      relatedHtml = relatedArticles.length ? renderRelatedSection(relatedArticles) : ''
    } catch (e) {
      console.warn('Related articles unavailable, continuing without them:', e)
    }

    var tags = article.tags || []
    var cat = article.category || 'General'
    var catSlug = cat.toLowerCase().replace(/\s+/g, '-')
    var catUrl = BASE_PATH + '/?category=' + encodeURIComponent(cat)

    app.innerHTML = `
      <div class="container">
        <div class="article-detail">
          <!-- Breadcrumb navigation -->
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="${BASE_PATH}/" onclick="event.preventDefault();navigate('/')">Home</a>
            <span class="breadcrumb-sep">›</span>
            <a href="${catUrl}" onclick="event.preventDefault();navigate('/?category=${encodeURIComponent(cat)}')">${escHtml(cat)}</a>
            <span class="breadcrumb-sep">›</span>
            <span class="breadcrumb-current">${escHtml(article.title)}</span>
          </nav>

          <button class="back-btn" onclick="navigate('/')">← Back to articles</button>

          <div class="article-header">
            <a href="${catUrl}" class="category-link" onclick="event.preventDefault();navigate('/?category=${encodeURIComponent(cat)}')">
              <span class="category-badge">${escHtml(cat)}</span>
            </a>
            <h1>${escHtml(article.title)}</h1>
            <div class="meta">
              <span>✍️ ${escHtml(article.author || 'TrendWire Staff')}</span>
              <span>📅 ${formatDateFull(article.published_at || article.created_at)}</span>
              <span>📖 ${readingTime(content)} min read</span>
              ${tags.length ? `<span>🏷️ ${tags.length} tags</span>` : ''}
            </div>
          </div>

          <div class="featured-image">
            ${article.image_url
              ? `<img src="${article.image_url}" alt="${escHtml(article.summary || article.title)} — ${SITE_NAME}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius)">`
              : article.image_prompt
                ? '📸 ' + article.image_prompt.slice(0, 80) + '…'
                : '📰 No image available'}
          </div>

          <div class="article-content">
            ${article.summary ? `<div class="summary-box">${escHtml(article.summary)}</div>` : ''}
            ${renderedContent}
          </div>

          <div class="share-bar">
            <span class="share-label">Share this article</span>
            <div class="share-buttons">
              <a class="share-btn share-twitter"
                 href="https://twitter.com/intent/tweet?text=${shareText}&url=${pageUrl}"
                 target="_blank" rel="noopener noreferrer"
                 title="Share on Twitter/X">
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              <a class="share-btn share-facebook"
                 href="https://www.facebook.com/sharer/sharer.php?u=${pageUrl}"
                 target="_blank" rel="noopener noreferrer"
                 title="Share on Facebook">
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </a>
              <button class="share-btn share-copy" onclick="copyArticleLink()" title="Copy link">
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M7.5 3.375c0-1.036.84-1.875 1.875-1.875h.375a3.75 3.75 0 013.75 3.75v1.875C13.5 8.16 12.66 9 11.625 9h-.375a3.75 3.75 0 01-3.75-3.75V3.375zm-4.5 0A2.625 2.625 0 015.625.75h.375a3.75 3.75 0 013.75 3.75v1.875c0 1.036-.84 1.875-1.875 1.875h-.375A3.75 3.75 0 013 5.625V3.375zM7.5 11.625c0-1.036.84-1.875 1.875-1.875h.375a3.75 3.75 0 013.75 3.75v1.875c0 1.036-.84 1.875-1.875 1.875h-.375a3.75 3.75 0 01-3.75-3.75V11.625z"/></svg>
              </button>
            </div>
          </div>

          <!-- Clickable tags -->
          ${tags.length ? `<div class="article-footer">
            ${tags.map(function(t) {
              var tagUrl = BASE_PATH + '/?tag=' + encodeURIComponent(t)
              return `<a href="${tagUrl}" class="tag-link" onclick="event.preventDefault();navigate('/?tag=${encodeURIComponent(t)}')">#${escHtml(t)}</a>`
            }).join('')}
          </div>` : ''}

          <!-- Related articles section -->
          ${relatedHtml}
        </div>
      </div>
    `

  // Update dark toggle icon after article render
  const icon = document.querySelector('.dark-toggle-icon')
  if (icon) icon.textContent = darkMode ? '☀️' : '🌙'
  } catch (e) {
    console.error('Failed to load article:', e)
    renderError(e.message)
  }
}

// ── Sidebar update helper (shared by weather + lotto) ──
function updateSidebarWidget(selector, renderFn) {
  if (currentRoute !== 'list') return
  var sidebar = document.querySelector('.landing-sidebar')
  if (!sidebar) return
  var existing = sidebar.querySelector(selector)
  if (existing) {
    existing.outerHTML = typeof renderFn === 'function' ? renderFn() : renderFn
  }
}

// ── Boot ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  handleRoute()
  
  // Fetch lotto results from DB (fast — local query)
  fetchLottoResults().then(function() {
    updateSidebarWidget('.lotto-card, .lotto-loading, .lotto-empty', renderLottoWidget)
  })
  
  // Fetch weather in background — get user's location first, then weather
  getUserLocation().then(function(coords) {
    return fetchWeather(coords)
  }).then(function() {
    updateSidebarWidget('.weather-card, .weather-error', renderWeatherWidget)
  })
})

window.__retryWeather = function() {
  weatherLoading = true
  updateSidebarWidget('.weather-card, .weather-error', renderWeatherWidget)
  getUserLocation().then(function(coords) {
    return fetchWeather(coords)
  }).then(function() {
    updateSidebarWidget('.weather-card, .weather-error', renderWeatherWidget)
  })
}
