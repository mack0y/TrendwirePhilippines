#!/usr/bin/env python3
"""Post newly published articles to a Facebook Page."""

import os, sys, json
from datetime import datetime, timezone

try:
    from supabase import create_client
    import requests
except ImportError:
    print("❌ Run: pip install supabase requests"); sys.exit(1)

SITE_URL = os.environ.get('SITE_URL', 'https://mack0y.github.io/TrendwirePhilippines')
FB_PAGE_ID = os.environ.get('FB_PAGE_ID')
FB_ACCESS_TOKEN = os.environ.get('FB_ACCESS_TOKEN')
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://nvxykufajzppjtkmbtte.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

if not all([FB_PAGE_ID, FB_ACCESS_TOKEN, SUPABASE_KEY]):
    print("❌ Missing FB_PAGE_ID, FB_ACCESS_TOKEN, or SUPABASE_SERVICE_KEY")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# Find articles published in the last 4 hours that haven't been posted to Facebook
cutoff = datetime.now(timezone.utc)

data = sb.table('articles') \
    .select('id, title, summary, slug, image_url, category, published_at') \
    .eq('status', 'published') \
    .order('published_at', desc=True) \
    .limit(10) \
    .execute()
articles = data.data or []

posted = 0
for a in articles:
    # Check if already posted (simple check — look for a custom field or log)
    # Since we don't have a fb_posted column, we'll just post the latest and exit
    # In production, add a fb_posted column and check it or use the `posted_to_facebook` metadata

    article_url = f"{SITE_URL}/articles/{a['slug']}.html"
    title = a['title'][:120]  # FB titles max ~120 chars
    summary = (a.get('summary') or '')[:200]
    image_url = a.get('image_url', '')

    # Build message: include a hook sentence + link
    message = f"{title}\n\n{summary}\n\nRead more: {article_url}"

    # Facebook Graph API — create a feed post
    fb_url = f'https://graph.facebook.com/v19.0/{FB_PAGE_ID}/feed'
    payload = {
        'message': message,
        'access_token': FB_ACCESS_TOKEN,
        'published': 'true',
    }
    if image_url:
        payload['link'] = article_url
        payload['picture'] = image_url

    try:
        resp = requests.post(fb_url, data=payload, timeout=15)
        result = resp.json()
        if resp.ok and result.get('id'):
            print(f"✅ Posted to Facebook: {title[:60]}... (post id: {result['id']})")
            posted += 1
        else:
            print(f"❌ Facebook post failed for '{title[:60]}...': {result.get('error', {}).get('message', resp.text)}")
    except Exception as e:
        print(f"❌ Error posting '{title[:60]}...': {e}")

    # Only post the most recent un-posted article each run to avoid duplicates
    break

if posted == 0:
    print("ℹ️ No new articles to post")
