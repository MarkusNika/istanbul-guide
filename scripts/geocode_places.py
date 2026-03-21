from __future__ import annotations

import csv
import json
import shutil
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

PLACES_CSV = DATA_DIR / "places.csv"
CACHE_JSON = DATA_DIR / "geocode-cache.json"
BACKUP_CSV = DATA_DIR / "places.csv.bak"

USER_AGENT = "istanbul-guide-geocoder/1.0 (personal trip planning)"
SLEEP_SECONDS = 1.2

# Istanbul-ish viewbox bias:
# left, top, right, bottom
ISTANBUL_VIEWBOX = "28.5,41.35,29.5,40.8"

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


def load_csv(path: Path) -> tuple[list[dict], list[str]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = reader.fieldnames or []
    return rows, fieldnames


def save_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def load_cache() -> dict:
    if CACHE_JSON.exists():
        return json.loads(CACHE_JSON.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict) -> None:
    CACHE_JSON.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def has_coords(row: dict) -> bool:
    return bool((row.get("lat") or "").strip()) and bool((row.get("lon") or "").strip())


def geocode_query(query: str) -> dict | None:
    params = {
        "q": query,
        "format": "jsonv2",
        "limit": 1,
        "countrycodes": "tr",
        "viewbox": ISTANBUL_VIEWBOX,
        "bounded": 0,
        "addressdetails": 0
    }

    url = f"{NOMINATIM_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json"
        }
    )

    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    if not data:
        return None

    top = data[0]
    return {
        "lat": top["lat"],
        "lon": top["lon"],
        "display_name": top.get("display_name", ""),
        "raw": top,
    }


def main():
    if not PLACES_CSV.exists():
        print(f"ERROR: not found: {PLACES_CSV}")
        sys.exit(1)

    rows, fieldnames = load_csv(PLACES_CSV)

    extra_fields = [
        "geocode_provider",
        "geocode_status",
        "geocode_display_name"
    ]
    for f in extra_fields:
        if f not in fieldnames:
            fieldnames.append(f)

    cache = load_cache()

    shutil.copy2(PLACES_CSV, BACKUP_CSV)
    print(f"Backup written: {BACKUP_CSV}")

    updated = 0
    skipped = 0
    failed = 0

    for idx, row in enumerate(rows, start=1):
        place_id = row.get("place_id", "")
        query = (row.get("maps_query") or row.get("name") or "").strip()

        if has_coords(row):
            row["geocode_provider"] = row.get("geocode_provider") or "existing"
            row["geocode_status"] = row.get("geocode_status") or "existing"
            skipped += 1
            print(f"[{idx}] SKIP {place_id}: already has coordinates")
            continue

        if not query:
            row["geocode_provider"] = "n/a"
            row["geocode_status"] = "no-query"
            row["geocode_display_name"] = ""
            failed += 1
            print(f"[{idx}] FAIL {place_id}: no query")
            continue

        if query in cache:
            result = cache[query]
            print(f"[{idx}] CACHE {place_id}: {query}")
        else:
            print(f"[{idx}] QUERY {place_id}: {query}")
            try:
                result = geocode_query(query)
                cache[query] = result
                save_cache(cache)
                time.sleep(SLEEP_SECONDS)
            except Exception as exc:
                result = None
                print(f"      ERROR: {exc}")

        if result:
            row["lat"] = result["lat"]
            row["lon"] = result["lon"]
            row["geocode_provider"] = "nominatim"
            row["geocode_status"] = "ok"
            row["geocode_display_name"] = result.get("display_name", "")
            updated += 1
            print(f"      -> {row['lat']}, {row['lon']}")
        else:
            row["geocode_provider"] = "nominatim"
            row["geocode_status"] = "not-found"
            row["geocode_display_name"] = ""
            failed += 1
            print("      -> not found")

    save_csv(PLACES_CSV, rows, fieldnames)
    save_cache(cache)

    print()
    print("Done.")
    print(f"Updated: {updated}")
    print(f"Skipped: {skipped}")
    print(f"Failed:  {failed}")


if __name__ == "__main__":
    main()
