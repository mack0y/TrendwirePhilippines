#!/usr/bin/env python3
"""TrendWire Philippines — Article Publisher"""
import argparse, json, os, sys, re
from datetime import datetime, timezone
from pathlib import Path

try:
    from supabase import create_client
except ImportError:
    print("❌ Run: pip install supabase"); sys.exit(1)

def create_slug(title):
    slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')
    return slug[:80]

def validate(a):
    errs = []
    if not a.get('title'): errs.append("Missing title")
    elif len(a['title']) > 65: errs.append(f"Title {len(a['title'])} chars (max 65)")
    if not a.get('content'): errs.append("Missing content")
    wc = len(a['content'].split()) if a.get('content') else 0
    if wc < 400: errs.append(f"Too short: {wc} words")
    if wc > 700: errs.append(f"Too long: {wc} words")
    for p in ['google trends','search volume','trending data','filipinos are searching']:
        if p in a.get('content','').lower(): errs.append(f"Forbidden: '{p}'")
    return errs

def main():
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--file'); g.add_argument('--json'); g.add_argument('--latest', action='store_true')
    p.add_argument('--trend-id'); p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    url = os.environ.get('SUPABASE_URL','https://nvxykufajzppjtkmbtte.supabase.co')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not key: print("❌ SUPABASE_SERVICE_KEY not set"); sys.exit(1)

    if args.file:
        a = json.load(open(args.file,'r',encoding='utf-8'))
    elif args.json:
        a = json.loads(args.json)
    else:
        drafts = sorted(Path('drafts').glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
        if not drafts: print("❌ No drafts"); sys.exit(1)
        a = json.load(open(drafts[0],'r',encoding='utf-8'))

    errs = validate(a)
    if errs:
        for e in errs: print(f"❌ {e}"); sys.exit(1)

    wc = len(a['content'].split())
    print(f"✅ Valid ({wc} words)")
    if args.dry_run: print(f"🏃 Dry run: {a['title']}"); return

    sb = create_client(url, key)
    slug = create_slug(a['title'])
    existing = sb.table('articles').select('id').eq('slug', slug).execute()
    if existing.data: slug = f"{slug}-{int(datetime.now().timestamp())}"

    rec = {
        'title': a['title'], 'slug': slug,
        'summary': a.get('summary',''), 'content': a['content'],
        'image_url': a.get('image_url',''), 'image_prompt': a.get('image_prompt',''),
        'seo_description': a.get('seo_description',''),
        'tags': a.get('tags',[]), 'category': a.get('category','General'),
        'status': 'published', 'published_at': datetime.now(timezone.utc).isoformat(),
    }
    if args.trend_id: rec['trend_id'] = args.trend_id

    r = sb.table('articles').insert(rec).execute()
    if r.data:
        print(f"✅ Published! ID: {r.data[0]['id']} | Slug: {r.data[0]['slug']}")
    else:
        print("❌ Publish failed"); sys.exit(1)

if __name__ == '__main__': main()
