#!/usr/bin/env python3
"""TrendWire Philippines — End-to-end pipeline test.

Runs the full chain against the live project:
  1. Connection check
  2. Fetch latest PH trends (Edge Function)
  3. Grab the newest trend
  4. Generate an article via OpenRouter (Edge Function)
  5. Flip that draft to 'published' and VERIFY it actually changed
"""
import os
import urllib.request, urllib.error, json, sys
from datetime import datetime, timezone

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SVC_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SVC_KEY:
    print("❌ Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables")
    sys.exit(1)

HEADERS = {
    "apikey": SVC_KEY,
    "Authorization": f"Bearer {SVC_KEY}",
    "Content-Type": "application/json",
}

def api(method, path, data=None, extra_headers=None):
    body = json.dumps(data).encode() if data else None
    headers = dict(HEADERS)
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(f"{SUPABASE_URL}{path}", data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req)
        raw = resp.read()
        return json.loads(raw) if raw else []
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  ❌ {e.code}: {err[:200]}")
        return None
    except Exception as e:
        print(f"  ❌ {e}")
        return None

def now_iso():
    return datetime.now(timezone.utc).isoformat()

print("=" * 50)
print("🟠 Full Pipeline Test")
print("=" * 50)

print("\n📶 1. Test connection...")
conn = api("GET", "/rest/v1/trends?select=id&limit=1")
print("✅ OK" if conn is not None else "❌ Fail")
if conn is None:
    sys.exit(1)

print("\n🔎 2. Fetch latest PH trends...")
fetch = api("POST", "/functions/v1/fetch-trends", {})
print(f"{fetch.get('message','ok')} ({len(fetch.get('trends', []))} trends)" if fetch else "❌ Fetch failed")

print("\n🆕 3. Grab newest trend...")
newest = api("GET", "/rest/v1/trends?select=id,title,category&order=created_at.desc&limit=1")
trend = newest[0] if newest else None
print(f"{trend['title']} [{trend['category']}]" if trend else "No trend found")
if not trend:
    print("❌ Cannot continue without a trend"); sys.exit(1)

print("\n✏️ 4. Generate article via LLM...")
gen = api("POST", "/functions/v1/generate-article", {"trend_id": trend['id']})
article = gen.get('article') if gen else None
print(f"Article '{article['title']}' status: {article['status']}" if article else "Generation failed")
if not article:
    print("❌ Cannot continue without a generated article"); sys.exit(1)

print("\n🚀 5. Publish article (flip draft → published)...")
# Use Prefer=return=representation so PostgREST returns the updated row,
# letting us verify the status actually changed instead of guessing.
pub = api(
    "PATCH",
    f"/rest/v1/articles?id=eq.{article['id']}&select=id,status",
    {"status": "published", "published_at": now_iso()},
    extra_headers={"Prefer": "return=representation"},
)
if pub and isinstance(pub, list) and len(pub) > 0 and pub[0].get("status") == "published":
    print("✅ Published (verified)")
else:
    print(f"❌ Publish failed — response: {pub}")
    sys.exit(1)

print("\n✅ Test completed")
