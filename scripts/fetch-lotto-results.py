#!/usr/bin/env python3
"""
TrendWire Philippines — PCSO Lotto Results Scraper

Fetches daily PCSO lotto results from GMA News's LOTTO_INITIAL_DISPLAY JSON.
Smart scheduling: only scrapes after draw times (2PM, 5PM, 9PM PH time)
and skips draws already stored in the database.

Usage:
    python scripts/fetch-lotto-results.py              # scrape today
    python scripts/fetch-lotto-results.py --date 2026-06-20  # specific date
    python scripts/fetch-lotto-results.py --dry-run           # preview only
"""
import argparse, json, os, re, sys
import requests
from datetime import datetime, timezone, timedelta
from typing import Optional

# ── Draw Schedule ─────────────────────────────────
# PH Time = UTC+8. All draw times in PH timezone.
PH_OFFSET = timedelta(hours=8)

GAME_MAP = {
    '2D':   '2D Lotto (EZ2)',
    '3D':   '3D Lotto (Swertres)',
    '4D':   '4D Lotto',
    '6D':   '6D Lotto',
    '6/42': 'Lotto 6/42',
    '6/45': 'Mega Lotto 6/45',
    '6/49': 'Super Lotto 6/49',
    '6/55': 'Grand Lotto 6/55',
    '6/58': 'Ultra Lotto 6/58',
}

# Days of week: 0=Monday ... 6=Sunday
JACKPOT_SCHEDULE = {
    'Lotto 6/42':     (1, 3, 5),  # Tue, Thu, Sat
    'Mega Lotto 6/45':   (0, 2, 4),  # Mon, Wed, Fri
    'Super Lotto 6/49':  (6, 1, 3),  # Sun, Tue, Thu
    'Grand Lotto 6/55':  (0, 2, 5),  # Mon, Wed, Sat
    'Ultra Lotto 6/58':  (1, 4, 6),  # Tue, Fri, Sun
}

# Games with 3 daily draws (2PM, 5PM, 9PM)
DAILY_DRAW_TIMES = ['2PM', '5PM', '9PM']

# Games with 1 daily draw at 9PM
EVENING_DRAW_TIMES = ['9PM']


def ph_now() -> datetime:
    """Get current time in PH timezone."""
    return datetime.now(timezone.utc) + PH_OFFSET


def parse_game_type(raw_type: str) -> tuple[Optional[str], Optional[str]]:
    """
    Parse a GMA News lotto type string into (game_name, draw_time).

    Examples:
      '2D 2PM'        → ('2D Lotto (EZ2)', '2PM')
      'Swertres 5PM'  → ('3D Lotto (Swertres)', '5PM')
      '6D Lotto'      → ('6D Lotto', '9PM')
      'Grand Lotto 6/55' → ('Grand Lotto 6/55', '9PM')
    """
    t = raw_type.strip()

    # Determine draw time
    draw_time = '9PM'  # default for jackpot/evening games
    for dt in ['2PM', '5PM', '9PM']:
        if t.endswith(' ' + dt) or t == dt:
            draw_time = dt
            # Strip time suffix for game name extraction
            t = t.replace(' ' + dt, '').strip()
            break

    # Jackpot games → return as-is (they have standard names)
    for key in ['Lotto 6/42', 'Mega Lotto 6/45', 'Super Lotto 6/49',
                'Grand Lotto 6/55', 'Ultra Lotto 6/58', '6D Lotto',
                '4D Lotto']:
        if key in t or t in key:
            return key, draw_time

    # Digit games → map via GAME_MAP
    for prefix, name in GAME_MAP.items():
        if t.startswith(prefix) or prefix in t:
            return name, draw_time

    # Fallback: return raw type as game name
    return raw_type.strip(), draw_time


def parse_results(results_list: list) -> list[str]:
    """Normalize results to string list."""
    return [str(r).strip() for r in results_list if r is not None]


def is_draw_expected(game_name: str, draw_time: str, now_ph: datetime, target_date: str) -> bool:
    """
    Check if a draw should have already happened.
    For past dates, all draws are considered expected.
    For today, checks if the draw time has passed.
    """
    today_str = now_ph.strftime('%Y-%m-%d')

    # Past dates: all draws have already occurred
    if target_date < today_str:
        pass  # No time check needed for past dates
    else:
        # Today: check if the draw time has passed
        hour = now_ph.hour
        draw_hour = {'2PM': 14, '5PM': 17, '9PM': 21}.get(draw_time, 21)
        if hour < draw_hour:
            return False

    # For jackpot games, check if the target date is a draw day
    if game_name in JACKPOT_SCHEDULE:
        # Parse the target date's weekday
        target_dt = datetime.strptime(target_date, '%Y-%m-%d')
        weekday = target_dt.weekday()
        if weekday not in JACKPOT_SCHEDULE[game_name]:
            return False

    return True


def fetch_gma_lotto():
    """Fetch and parse GMA News lotto page, returning the JSON data dict."""

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    }

    resp = requests.get(
        'https://www.gmanetwork.com/news/lotto/',
        headers=headers,
        timeout=20,
    )
    resp.raise_for_status()

    # Extract LOTTO_INITIAL_DISPLAY JavaScript variable
    match = re.search(
        r'LOTTO_INITIAL_DISPLAY\s*=\s*(\{.*?\});',
        resp.text,
        re.DOTALL,
    )
    if not match:
        raise ValueError('LOTTO_INITIAL_DISPLAY not found in GMA News page')

    return json.loads(match.group(1))


def get_supabase_client():
    """Create and return a Supabase client using env vars."""
    try:
        from supabase import create_client
    except ImportError:
        print("❌ Install: pip install supabase")
        sys.exit(1)

    url = os.environ.get('SUPABASE_URL', 'https://nvxykufajzppjtkmbtte.supabase.co')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not key:
        print("❌ SUPABASE_SERVICE_KEY environment variable not set")
        sys.exit(1)

    return create_client(url, key)


def get_existing_draws(sb, draw_date: str) -> set:
    """Get set of (game_name, draw_time) already in DB for a given date."""
    result = sb.table('lotto_results') \
        .select('game_name, draw_time') \
        .eq('draw_date', draw_date) \
        .execute()
    return {(row['game_name'], row['draw_time']) for row in (result.data or [])}


def save_results(sb, entries: list[dict]) -> int:
    """Insert lotto results into Supabase. Returns count of new entries."""
    if not entries:
        return 0

    result = sb.table('lotto_results').insert(entries).execute()
    return len(result.data or [])


def main():
    parser = argparse.ArgumentParser(description='Fetch PCSO lotto results from GMA News')
    parser.add_argument('--date', help='Specific date to scrape (YYYY-MM-DD, default: today PH time)')
    parser.add_argument('--dry-run', action='store_true', help='Preview only, do not save')
    args = parser.parse_args()

    now_ph = ph_now()
    target_date = args.date or now_ph.strftime('%Y-%m-%d')

    print(f"🕐 PH Time: {now_ph.strftime('%Y-%m-%d %H:%M')}")
    print(f"📅 Target date: {target_date}")

    # 1. Fetch from GMA News
    print("\n📡 Fetching from GMA News...")
    try:
        lotto_data = fetch_gma_lotto()
    except Exception as e:
        print(f"❌ Fetch failed: {e}")
        sys.exit(1)

    # 2. Find entries for target date
    date_entries = lotto_data.get(target_date, [])
    if not date_entries:
        print(f"ℹ️  No results found for {target_date}")
        return

    print(f"📊 Found {len(date_entries)} raw entries for {target_date}")

    # 3. Parse and filter by draw schedule
    parsed = []
    skipped_schedule = 0
    for entry in date_entries:
        game_name, draw_time = parse_game_type(entry.get('type', ''))
        results = parse_results(entry.get('results', []))

        if not game_name or not results:
            continue

        # Skip draws that haven't happened yet
        if not is_draw_expected(game_name, draw_time, now_ph, target_date):
            skipped_schedule += 1
            continue

        parsed.append({
            'draw_date': target_date,
            'game_name': game_name,
            'draw_time': draw_time,
            'results': results,
            'jackpot': entry.get('jackpot', ''),
        })

    if skipped_schedule:
        print(f"⏭️  Skipped {skipped_schedule} draws (not yet scheduled/happened)")

    print(f"📋 Parsed {len(parsed)} expected draws")

    if not parsed:
        print("ℹ️  No draws to save")
        return

    # Print summary
    print("\n📈 Today's expected results:")
    for p in parsed:
        nums = ', '.join(p['results'])
        jackpot = f" — ₱{p['jackpot']}" if p.get('jackpot') else ''
        print(f"  {p['game_name']} ({p['draw_time']}): {nums}{jackpot}")

    if args.dry_run:
        print("\n🏃 Dry run — not saving to database")
        return

    # 4. Connect to Supabase and deduplicate
    sb = get_supabase_client()
    existing = get_existing_draws(sb, target_date)

    new_entries = [p for p in parsed if (p['game_name'], p['draw_time']) not in existing]

    if not new_entries:
        print("\n✅ All draws already in database — nothing new to save")
        return

    print(f"\n💾 Saving {len(new_entries)} new result(s) to Supabase...")
    count = save_results(sb, new_entries)
    print(f"✅ Saved {count} new lotto result(s)")

    if count < len(new_entries):
        print(f"⚠️  {len(new_entries) - count} entries may have been duplicates")


if __name__ == '__main__':
    # Fix Windows console encoding for emoji
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    main()
