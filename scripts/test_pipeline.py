#!/usr/bin/env python3
import os
import urllib.request, json, sys

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

def api(method, path, data=None):
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(f"{SUPABASE_URL}{path}", data=body, headers=HEADERS, method=method)
    try:
        resp = urllib.request.urlopen(req)
        raw = resp.read()
        return json.loads(raw) if raw else []
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  \u274c {e.code}: {err[:200]}")
        return None

print("="*50)
print("🟠 Full Pipeline Test")
print("="*50)

print("\n📶 1. Test connection...")
conn = api("GET", "/rest/v1/trends?select=id&limit=1")
print("✅ OK" if conn is not None else "❌ Fail")

print("\n🔎 2. Fetch latest PH trends...")
fetch = api("POST", "/functions/v1/fetch-trends", {})
print(f"{fetch.get('message','ok')} ({len(fetch.get('trends',[]))} trends)")

print("\n🆕 3. Grab newest trend...")
newest = api("GET", "/rest/v1/trends?select=id,title,category&order=created_at.desc&limit=1")
trend = newest[0] if newest else None
print(f"{trend['title']} [{trend['category']}]" if trend else "No trend found")

print("\n✏️ 4. Generate article via owl‑alpha...")
gen = api("POST", "/functions/v1/generate-article", {"trend_id": trend['id']})
article = gen.get('article') if gen else None
print(f"Article '{article['title']}' status: {article['status']}" if article else "Generation failed")

print("\n🚀 5. Publish article...")
pub = api("PATCH", f"/rest/v1/articles?id=eq.{article['id']}", {"status": "published", "published_at": "now()"})
print("✅ Published" if pub is not None else "❌ Publish failed")

print("\n✅ Test completed")
