#!/usr/bin/env python3
"""Generate sitemap.xml from published articles in Supabase."""

import os, sys
from datetime import datetime, timezone

try:
    from supabase import create_client
except ImportError:
    print("❌ Run: pip install supabase"); sys.exit(1)

SITE_URL = os.environ.get('SITE_URL', 'https://mack0y.github.io/TrendwirePhilippines')
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://nvxykufajzppjtkmbtte.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
if not SUPABASE_KEY:
    print("❌ SUPABASE_SERVICE_KEY not set"); sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# Fetch all published articles
data = sb.table('articles').select('slug, updated_at, published_at, category').eq('status', 'published').order('published_at', desc=True).execute()
articles = data.data or []

now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00')

lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    f'  <url><loc>{SITE_URL}/</loc><lastmod>{now}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>',
    # Admin intentionally excluded (noindex)
]

for a in articles:
    lastmod = (a.get('updated_at') or a.get('published_at') or now).replace('+00:00', '+00:00') if a.get('updated_at') or a.get('published_at') else now
    priority = '0.8' if a.get('category') in ('Disaster', 'Politics') else '0.6'
    # SPA route
    lines.append(f'  <url><loc>{SITE_URL}/article/{a["slug"]}</loc><lastmod>{lastmod}</lastmod><changefreq>weekly</changefreq><priority>{priority}</priority></url>')
    # Pre-rendered static page
    lines.append(f'  <url><loc>{SITE_URL}/articles/{a["slug"]}.html</loc><lastmod>{lastmod}</lastmod><changefreq>weekly</changefreq><priority>{priority}</priority></url>')

lines.append('</urlset>')

output = '\n'.join(lines)

# Write to file
with open('sitemap.xml', 'w', encoding='utf-8') as f:
    f.write(output)
    f.write('\n')

print(f"✅ sitemap.xml generated — {len(articles)} articles")
