/* ===== TrendWire Philippines — App ===== */

// ── Supabase Config ──────────────────────────────
const SUPABASE_URL = 'https://nvxykufajzppjtkmbtte.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52eHlrdWZhanpwcGp0a21idHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTMyMDgsImV4cCI6MjA5NjkyOTIwOH0.k4iu6e3k1Me-Nu5R5xsX4KiJNxfJ6S-THBhMNRyF7j0'

// ── State ─────────────────────────────────────────
let articles = []
let currentRoute = 'list'
let currentSlug = null

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
  } else if (hash === 'admin') {
    currentRoute = 'admin'
    currentSlug = null
    renderAdmin()
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
  if (!sb) throw new Error('Supabase not initialized')

  const { data, error } = await sb
    .from('articles')
    .select('id, title, slug, summary, category, tags, published_at, created_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(20)

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

// ── Admin API ─────────────────────────────────────

/** Call the admin-operations Edge Function with an action and payload. */
async function adminOperation(action, payload = {}) {
  if (!sb) throw new Error('Supabase not initialized')
  const { data, error } = await sb.functions.invoke('rapid-processor', {
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

// ── Admin / Trend Search ─────────────────────────
async function fetchFromGoogleTrends() {
  if (!sb) throw new Error('Supabase not initialized')
  const { data, error } = await sb.functions.invoke('fetch-trends', {})
  if (error) throw error
  return data
}

async function searchTrendsDB(query) {
  if (!sb) throw new Error('Supabase not initialized')

  let q = sb
    .from('trends')
    .select('id, title, summary, category, impact_score, status, created_at')
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

// ── Render: Admin Dashboard ───────────────────────
async function renderAdmin() {
  const app = document.getElementById('app')
  let trends = []
  let generating = null
  let fetching = false
  let toast = null

  // Editor state
  let editingArticle = null
  let editorDraft = null
  let saving = false
  let publishing = false
  let imageGenerating = false
  let imagePreviewUrl = null
  let uploadedImageUrl = null

  let selectedModel = 'openrouter/free'

  const MODELS = [
    { id: 'openrouter/free', label: 'OpenRouter Free (auto)' },
    { id: 'openrouter/owl-alpha', label: 'Owl Alpha' },
    { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  ]

  const CATEGORIES = ['General', 'Sports', 'Politics', 'Disaster', 'Economy', 'Health', 'Technology', 'Entertainment']

  function showToast(message, type = 'info') {
    toast = { message, type }
    render()
    setTimeout(() => { toast = null; const el = document.querySelector('.toast'); if (el) el.remove() }, 4000)
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
    if (words < 400) {
      showToast(`⚠️ Content too short (${words} words). Minimum 400 required.`, 'error')
      return
    }
    if (words > 700) {
      showToast(`⚠️ Content too long (${words} words). Maximum 700 recommended.`, 'error')
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
      editingArticle = null
      editorDraft = null
      imagePreviewUrl = null
      uploadedImageUrl = null
      showToast(`✅ Published! "${result.title}" is now live`, 'success')
      render()
    } catch (e) {
      publishing = false
      showToast('❌ Publish failed: ' + e.message, 'error')
      render()
    }
  }

  function handleCloseEditor() {
    editingArticle = null
    editorDraft = null
    imagePreviewUrl = null
    uploadedImageUrl = null
    render()
  }

  async function handleGenerateImage() {
    const prompt = editorDraft?.image_prompt
    if (!prompt) {
      showToast('⚠️ Please enter an image prompt first', 'error')
      return
    }
    imageGenerating = true
    imagePreviewUrl = null
    render()

    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1280&height=720&nofeed=true`

    // Preload the image
    const img = new Image()
    img.onload = () => {
      imagePreviewUrl = url
      imageGenerating = false
      render()
    }
    img.onerror = () => {
      imageGenerating = false
      showToast('❌ Image generation failed — try again or upload manually', 'error')
      render()
    }
    img.src = url
  }

  async function handleUseGeneratedImage() {
    if (!imagePreviewUrl || !editingArticle) return

    try {
      // Fetch the generated image and convert to base64
      const resp = await fetch(imagePreviewUrl)
      if (!resp.ok) throw new Error('Failed to fetch generated image')
      const blob = await resp.blob()

      // Convert blob to base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })

      showToast('⏳ Uploading image…', 'info')

      const result = await adminOperation('upload-image', {
        article_id: editingArticle.id,
        base64,
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
        wc.style.color = (words >= 400 && words <= 700) ? '#2e7d32' : '#c62828'
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

    // Toolbar & header (always visible)
    const headerHtml = `
      <button class="back-btn" onclick="navigate('')">← Back to articles</button>
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
          ${fetching ? '⏳ Fetching from Google Trends PH…' : `${trends.length} trend${trends.length !== 1 ? 's' : ''} loaded`}
        </span>
      </div>
    `

    const toastHtml = toast
      ? `<div class="toast toast-${toast.type}">${toast.message}</div>`
      : ''

    // Trend cards
    const trendCards = trends.length
      ? trends.map(t => `
        <div class="trend-card ${hasEditor ? 'trend-card-compact' : ''}" data-category="${t.category || 'General'}">
          <div class="trend-info">
            <div class="trend-top">
              <span class="category-badge">${t.category || 'General'}</span>
              ${t.impact_score != null ? `<span class="impact-badge impact-${t.impact_score >= 70 ? 'high' : t.impact_score >= 40 ? 'medium' : 'low'}">${t.impact_score >= 70 ? '🔥' : t.impact_score >= 40 ? '📈' : '📊'} ${t.impact_score}</span>` : ''}
            </div>
            <h3>${t.title}</h3>
            ${t.summary ? `<p class="trend-summary">${t.summary}</p>` : ''}
            <span class="trend-date">📅 ${formatDate(t.created_at)}</span>
          </div>
          <button class="generate-btn" onclick="renderAdmin.__handleGenerate('${t.id}')"
                  ${generating === t.id ? 'disabled' : ''}>
            ${generating === t.id ? '⏳ Generating…' : '✏️ Generate'}
          </button>
        </div>
      `).join('')
      : `<div class="empty-state"><div class="icon">📊</div><h2>No trends yet</h2><p>Click "Fetch Latest PH Trends" to pull trending topics from Google Trends Philippines.</p></div>`

    // ── Editor section ──
    let editorHtml = ''
    if (hasEditor) {
      const d = editorDraft
      const contentWords = (d.content || '').trim().split(/\s+/).filter(Boolean).length
      const contentColor = (contentWords >= 400 && contentWords <= 700) ? '#2e7d32' : '#c62828'

      const tagsList = (d.tags || '').split(',').map(t => t.trim()).filter(Boolean)

      editorHtml = `
        <div class="editor-pane">
          <div class="editor-scroll">
            <div class="editor-header">
              <h2>✏️ Edit Article</h2>
              <span class="editor-status-badge draft-badge">Draft</span>
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
              <label>
                Content
                <span class="word-counter" style="color:${contentColor}">${contentWords} words</span>
              </label>
              <textarea class="editor-textarea editor-textarea-lg"
                        placeholder="Article body in markdown..."
                        oninput="renderAdmin.__updateField('content', this.value, this)">${escHtml(d.content || '')}</textarea>
              <div class="editor-hint">
                ${contentWords < 400 ? '⚠️ Minimum 400 words required' : contentWords > 700 ? '⚠️ Maximum 700 words recommended' : '✅ Target word count met'}
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
        <div class="container admin-split-layout">
          <div class="admin-sidebar">
            ${headerHtml}
            <div class="trend-list">
              ${trendCards}
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
        <div class="container">
          ${headerHtml}
          <div class="trend-list">
            ${trendCards}
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
  renderAdmin.__closeEditor = handleCloseEditor
  renderAdmin.__generateImage = handleGenerateImage
  renderAdmin.__useGeneratedImage = handleUseGeneratedImage
  renderAdmin.__handleFileUpload = handleFileUpload
  renderAdmin.__removePhoto = () => {
    uploadedImageUrl = null
    imagePreviewUrl = null
    editingArticle.image_url = null
    render()
  }

  // Load data
  await loadFromDB()
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
            <button class="retry-btn" onclick="navigate('')">Back to articles</button>
          </div>
        </div>
      `
      return
    }

    const content = article.content || ''
    const renderedContent = renderMarkdown(content)

    const pageUrl = encodeURIComponent(window.location.href)
    const shareText = encodeURIComponent(`${article.title} — TrendWire Philippines`)

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
            ${article.image_url
              ? `<img src="${article.image_url}" alt="${article.title}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius)">`
              : article.image_prompt
                ? '📸 ' + article.image_prompt.slice(0, 80) + '…'
                : '📰 No image available'}
          </div>

          <div class="article-content">
            ${article.summary ? `<div class="summary-box">${article.summary}</div>` : ''}
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
