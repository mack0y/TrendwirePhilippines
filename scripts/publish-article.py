#!/usr/bin/env python3
"""TrendWire Philippines — Article Publisher"""
import argparse, json, os, sys, re
from datetime import datetime, timezone
from pathlib import Path

try:
    from supabase import create_client
except ImportError:
    print("❌ Run: pip install supabase"); sys.exit(1)

DRAFTS_DIR = Path('drafts')
PUBLISHED_DIR = DRAFTS_DIR / 'published'

def create_slug(title):
    slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')
    return slug[:80]

def validate(a):
    errs = []
    if not a.get('title'): errs.append("Missing title")
    elif len(a['title']) > 65: errs.append(f"Title {len(a['title'])} chars (max 65)")
    if not a.get('content'): errs.append("Missing content")
    wc = len(a['content'].split()) if a.get('content') else 0
    if wc < 600: errs.append(f"Too short: {wc} words (min 600)")
    if wc > 800: errs.append(f"Too long: {wc} words (max 800)")
    for p in ['google trends','search volume','trending data','filipinos are searching']:
        if p in a.get('content','').lower(): errs.append(f"Forbidden: '{p}'")
    return errs

def latest_draft_path():
    """Newest unpublished draft in drafts/ (top-level only, skips drafts/published/)."""
    drafts = sorted(
        DRAFTS_DIR.glob('*.json'),
        key=lambda p: p.stat().st_mtime, reverse=True
    )
    return drafts[0] if drafts else None

def archive_draft(path: Path):
    """Move a successfully published draft into drafts/published/ so --latest won't re-publish it."""
    PUBLISHED_DIR.mkdir(parents=True, exist_ok=True)
    dest = PUBLISHED_DIR / path.name
    if dest.exists():
        # Avoid clobbering an earlier archived draft with the same name.
        stem, suffix = path.stem, path.suffix
        dest = PUBLISHED_DIR / f"{stem}-{int(datetime.now().timestamp())}{suffix}"
    path.rename(dest)
    print(f"📦 Archived draft → {dest}")

def main():
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--file'); g.add_argument('--json'); g.add_argument('--latest', action='store_true')
    p.add_argument('--trend-id'); p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    url = os.environ.get('SUPABASE_URL','https://nvxykufajzppjtkmbtte.supabase.co')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not key: print("❌ SUPABASE_SERVICE_KEY not set"); sys.exit(1)

    source_path = None
    if args.file:
        source_path = Path(args.file)
        a = json.load(open(source_path,'r',encoding='utf-8'))
    elif args.json:
        a = json.loads(args.json)
    else:
        source_path = latest_draft_path()
        if not source_path:
            print("ℹ️  No unpublished drafts in drafts/ — nothing to publish.")
            sys.exit(0)
        a = json.load(open(source_path,'r',encoding='utf-8'))

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
        # Only auto-archive when published from a file on disk (--latest / --file).
        if source_path and source_path.exists():
            archive_draft(source_path)
    else:
        print("❌ Publish failed"); sys.exit(1)

if __name__ == '__main__': main()
