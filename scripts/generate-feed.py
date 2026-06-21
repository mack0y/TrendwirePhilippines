#!/usr/bin/env python3
"""Generate RSS/Atom feed from published articles in Supabase."""

import os, sys
from datetime import datetime, timezone
from xml.sax.saxutils import escape

try:
    from supabase import create_client
except ImportError:
    print("❌ Run: pip install supabase"); sys.exit(1)

SITE_URL = os.environ.get('SITE_URL', 'https://mack0y.github.io/TrendwirePhilippines')
SITE_NAME = 'TrendWire Philippines'
SITE_DESC = 'Trending stories and news from across the Philippines'
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://nvxykufajzppjtkmbtte.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
if not SUPABASE_KEY:
    print("❌ SUPABASE_SERVICE_KEY not set"); sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

data = sb.table('articles') \
    .select('slug, title, summary, category, tags, image_url, published_at, created_at') \
    .eq('status', 'published') \
    .order('published_at', desc=True) \
    .limit(50) \
    .execute()
articles = data.data or []

now = datetime.now(timezone.utc).strftime('%a, %d %b %Y %H:%M:%S +0000')

def fmt_rss_date(d):
    if not d: return now
    try:
        dt = datetime.fromisoformat(d.replace('Z', '+00:00'))
        return dt.strftime('%a, %d %b %Y %H:%M:%S +0000')
    except:
        return now

lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    f'<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">',
    f'  <channel>',
    f'    <title>{escape(SITE_NAME)}</title>',
    f'    <link>{SITE_URL}/</link>',
    f'    <description>{escape(SITE_DESC)}</description>',
    f'    <language>en-ph</language>',
    f'    <lastBuildDate>{now}</lastBuildDate>',
    f'    <atom:link href="{SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>',
]

for a in articles:
    pub_date = fmt_rss_date(a.get('published_at') or a.get('created_at'))
    article_url = f"{SITE_URL}/article/{a['slug']}"
    summary = escape(a.get('summary', '') or '')
    image = a.get('image_url', '')
    tags = a.get('tags', [])
    
    lines.append(f'    <item>')
    lines.append(f'      <title>{escape(a["title"])}</title>')
    lines.append(f'      <link>{article_url}</link>')
    lines.append(f'      <guid isPermaLink="true">{article_url}</guid>')
    lines.append(f'      <pubDate>{pub_date}</pubDate>')
    lines.append(f'      <description>{summary}</description>')
    if a.get('category'):
        lines.append(f'      <category>{escape(a["category"])}</category>')
    for tag in tags:
        lines.append(f'      <category>{escape(tag)}</category>')
    if image:
        lines.append(f'      <media:content url="{escape(image)}" medium="image"/>')
    lines.append(f'    </item>')

lines.append('  </channel>')
lines.append('</rss>')

output = '\n'.join(lines)

with open('feed.xml', 'w', encoding='utf-8') as f:
    f.write(output)
    f.write('\n')

print(f"✅ feed.xml generated — {len(articles)} articles")
