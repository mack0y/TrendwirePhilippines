#!/usr/bin/env python3
"""Generate static HTML files for all published articles (pre-rendering for SEO)."""

import os, sys
from datetime import datetime, timezone
from xml.sax.saxutils import escape

try:
    from supabase import create_client
except ImportError:
    print("❌ Run: pip install supabase"); sys.exit(1)

SITE_URL = os.environ.get('SITE_URL', 'https://mack0y.github.io/TrendwirePhilippines')
BASE = '/TrendwirePhilippines'
SITE_NAME = 'TrendWire Philippines'
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://nvxykufajzppjtkmbtte.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
if not SUPABASE_KEY:
    print("❌ SUPABASE_SERVICE_KEY not set"); sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

HEADER = f'''<!DOCTYPE html>
<html lang="en-PH">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#CE1126">
  <link rel="stylesheet" href="{BASE}/style.css">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="{BASE}/" class="logo">
        <span class="flag">🇵🇭</span>
        <span>TrendWire <span class="accent">PH</span></span>
      </a>
    </div>
  </header>

  <nav class="main-nav" aria-label="Main navigation">
    <div class="nav-inner">
      <a href="{BASE}/" class="nav-link">Home</a>
      <a href="{BASE}/?category=Disaster" class="nav-link">Disaster</a>
      <a href="{BASE}/?category=Politics" class="nav-link">Politics</a>
      <a href="{BASE}/?category=Sports" class="nav-link">Sports</a>
      <a href="{BASE}/?category=Economy" class="nav-link">Economy</a>
      <a href="{BASE}/?category=Health" class="nav-link">Health</a>
      <a href="{BASE}/?category=Technology" class="nav-link">Technology</a>
      <a href="{BASE}/?category=Entertainment" class="nav-link">Entertainment</a>
      <a href="{BASE}/?category=General" class="nav-link">General</a>
    </div>
  </nav>'''

FOOTER = f'''
  <footer class="site-footer">
    <div class="footer-links">
      <a href="{BASE}/">Home</a>
      <span class="footer-sep">·</span>
      <a href="{BASE}/privacy-policy.html">Privacy Policy</a>
      <span class="footer-sep">·</span>
      <a href="{BASE}/about.html">About</a>
      <span class="footer-sep">·</span>
      <a href="{BASE}/contact.html">Contact</a>
    </div>
    <p class="footer-copy">© {datetime.now().year} <a href="https://github.com/mack0y/TrendwirePhilippines">{SITE_NAME}</a>. All rights reserved.</p>
  </footer>
</body>
</html>'''

def esc(s):
    return escape(str(s or ''))

def render_markdown(text):
    if not text:
        return ''
    import re
    # Bold
    text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', text)
    # Paragraphs
    paragraphs = text.split('\n\n')
    return '<p>' + '</p><p>'.join(esc(p) for p in paragraphs) + '</p>'

def fmt_date(d):
    if not d:
        return ''
    try:
        dt = datetime.fromisoformat(d.replace('Z', '+00:00'))
        return dt.strftime('%B %d, %Y at %I:%M %p')
    except:
        return str(d)

def reading_time(text):
    wc = len(text.split())
    return max(1, round(wc / 200))

def generate_article_page(a):
    slug = a['slug']
    title = esc(a['title'])
    summary = esc(a.get('summary', ''))
    content_html = render_markdown(a.get('content', ''))
    author = esc(a.get('author', 'TrendWire Staff'))
    pub_date = fmt_date(a.get('published_at') or a.get('created_at'))
    cat = esc(a.get('category', 'General'))
    tags = a.get('tags', [])
    tags_html = ''.join(f'<a href="{BASE}/?tag={esc(t)}" class="tag-link">#{esc(t)}</a> ' for t in tags)
    read_time = reading_time(a.get('content', ''))
    image_url = a.get('image_url', '')
    image_html = f'<img src="{image_url}" alt="{title}" style="width:100%;border-radius:12px">' if image_url else ''
    seo_desc = esc(a.get('seo_description', '') or summary or title)
    article_url = f'{SITE_URL}/articles/{slug}.html'
    og_image = image_url or f'{SITE_URL}/og-default.png'

    ld_json = f'''{{
      "@context": "https://schema.org",
      "@type": ["NewsArticle", "Article"],
      "headline": "{esc(a['title'])}",
      "description": "{seo_desc}",
      "datePublished": "{a.get('published_at') or a.get('created_at') or ''}",
      "dateModified": "{a.get('updated_at') or a.get('published_at') or a.get('created_at') or ''}",
      "author": {{"@type": "Organization", "name": "{SITE_NAME}"}},
      "publisher": {{"@type": "Organization", "name": "{SITE_NAME}"}},
      "mainEntityOfPage": {{"@type": "WebPage", "@id": "{article_url}"}},
      "articleSection": "{cat}",
      "keywords": "{', '.join(tags)}",
      "inLanguage": "en-PH",
      "isAccessibleForFree": true
    }}'''

    meta_tags = f'''
    <title>{title} — {SITE_NAME}</title>
    <meta name="description" content="{seo_desc}">
    <link rel="canonical" href="{article_url}">
    <meta property="og:title" content="{title}">
    <meta property="og:description" content="{seo_desc}">
    <meta property="og:url" content="{article_url}">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="{SITE_NAME}">
    <meta property="og:locale" content="en_PH">
    <meta property="og:image" content="{og_image}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{title}">
    <meta name="twitter:description" content="{seo_desc}">
    <script type="application/ld+json">{ld_json}</script>'''

    page = HEADER + meta_tags + f'''
  <main>
    <div class="container">
      <div class="article-detail">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <a href="{BASE}/">Home</a>
          <span class="breadcrumb-sep">›</span>
          <a href="{BASE}/?category={cat}">{cat}</a>
          <span class="breadcrumb-sep">›</span>
          <span class="breadcrumb-current">{title}</span>
        </nav>

        <div class="article-header">
          <span class="category-badge">{cat}</span>
          <h1>{title}</h1>
          <div class="meta">
            <span>✍️ {author}</span>
            <span>📅 {pub_date}</span>
            <span>📖 {read_time} min read</span>
            {f'<span>🏷️ {len(tags)} tags</span>' if tags else ''}
          </div>
        </div>

        {f'<div class="featured-image">{image_html}</div>' if image_html else ''}

        <div class="article-content">
          {f'<div class="summary-box">{summary}</div>' if summary else ''}
          {content_html}
        </div>

        {f'<div class="tags-section">{tags_html}</div>' if tags_html else ''}
      </div>
    </div>
  </main>''' + FOOTER

    return page

def main():
    data = sb.table('articles') \
        .select('*') \
        .eq('status', 'published') \
        .order('published_at', desc=True) \
        .execute()
    articles = data.data or []
    print(f"📄 Generating pages for {len(articles)} published articles...")

    out_dir = 'articles'
    os.makedirs(out_dir, exist_ok=True)

    count = 0
    for a in articles:
        slug = a['slug']
        html = generate_article_page(a)
        filepath = os.path.join(out_dir, f'{slug}.html')
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(html)
        count += 1
        if count % 10 == 0:
            print(f"  Generated {count}/{len(articles)}")

    print(f"✅ Generated {count} static article pages in articles/")

    # Update .nojekyll so GitHub Pages serves the articles/ directory
    with open('.nojekyll', 'a'):
        pass

if __name__ == '__main__':
    main()
