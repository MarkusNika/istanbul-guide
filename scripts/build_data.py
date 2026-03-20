from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

DAYS_CSV = DATA_DIR / "days.csv"
PLACES_CSV = DATA_DIR / "places.csv"
SCHEDULE_CSV = DATA_DIR / "schedule.csv"

GUIDE_JSON = DATA_DIR / "guide.json"
PLACES_GEOJSON = DATA_DIR / "places.geojson"
DAY_GEOJSON_DIR = DATA_DIR / "days"

DAY_GEOJSON_DIR.mkdir(parents=True, exist_ok=True)


def read_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def gmaps_url(query: str) -> str:
    return f"https://www.google.com/maps/search/?api=1&query={quote(query)}"


def apple_maps_url(query: str) -> str:
    return f"http://maps.apple.com/?q={quote(query)}"


def as_bool(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def parse_float_or_none(value: str):
    value = (value or "").strip()
    if not value:
        return None
    return float(value)


days_rows = read_csv(DAYS_CSV)
places_rows = read_csv(PLACES_CSV)
schedule_rows = read_csv(SCHEDULE_CSV)

# --- Validation -------------------------------------------------------------

days = {}
for row in days_rows:
    day_id = row["day_id"]
    if day_id in days:
        raise ValueError(f"Duplicate day_id in days.csv: {day_id}")
    days[day_id] = row

places = {}
for row in places_rows:
    place_id = row["place_id"]
    if place_id in places:
        raise ValueError(f"Duplicate place_id in places.csv: {place_id}")
    places[place_id] = row

missing_place_refs = []
missing_day_refs = []

for row in schedule_rows:
    if row["day_id"] not in days:
        missing_day_refs.append(row["day_id"])
    if row["place_id"] not in places:
        missing_place_refs.append(row["place_id"])

if missing_day_refs:
    raise ValueError(f"schedule.csv references missing day_id(s): {sorted(set(missing_day_refs))}")

if missing_place_refs:
    raise ValueError(f"schedule.csv references missing place_id(s): {sorted(set(missing_place_refs))}")

# sort schedule per day
schedule_by_day = defaultdict(list)
for row in schedule_rows:
    row = dict(row)
    row["seq"] = int(row["seq"])
    row["travel_min"] = int(row["travel_min"])
    schedule_by_day[row["day_id"]].append(row)

for day_id in schedule_by_day:
    schedule_by_day[day_id].sort(key=lambda r: r["seq"])


def place_summary(place_row: dict) -> dict:
    lat = parse_float_or_none(place_row.get("lat", ""))
    lon = parse_float_or_none(place_row.get("lon", ""))
    tags = [t for t in (place_row.get("tags", "") or "").split(";") if t]

    return {
        "place_id": place_row["place_id"],
        "name": place_row["name"],
        "type": place_row["type"],
        "area": place_row["area"],
        "maps_query": place_row["maps_query"],
        "maps_url": gmaps_url(place_row["maps_query"]),
        "apple_maps_url": apple_maps_url(place_row["maps_query"]),
        "lat": lat,
        "lon": lon,
        "has_coordinates": lat is not None and lon is not None,
        "image_query": place_row.get("image_query", ""),
        "tags": tags,
    }


place_index = {pid: place_summary(row) for pid, row in places.items()}

# --- guide.json -------------------------------------------------------------

guide = {
    "trip": {
        "title": "Istanbul 2026",
        "hotel_place_id": "HOTEL",
        "hotel_name": places.get("HOTEL", {}).get("name", "Hotel"),
        "start_date": min(d["date"] for d in days_rows),
        "end_date": max(d["date"] for d in days_rows),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "default_center": {
            "lat": 41.0082,
            "lon": 28.9784,
            "zoom": 12
        }
    },
    "places": place_index,
    "days": []
}

for day_row in days_rows:
    day_id = day_row["day_id"]
    items = []

    for row in schedule_by_day.get(day_id, []):
        place = place_index[row["place_id"]]

        items.append({
            "seq": row["seq"],
            "time_from": row["time_from"],
            "time_to": row["time_to"],
            "activity_title": row["activity_title"],
            "with_daughter": as_bool(row["with_daughter"]),
            "priority": row["priority"],
            "transport_from_prev": row["transport_from_prev"],
            "travel_min": row["travel_min"],
            "notes": row["notes"],
            "place": place
        })

    must_count = sum(1 for item in items if item["priority"] == "must")
    daughter_count = sum(1 for item in items if item["with_daughter"])

    guide["days"].append({
        "day_id": day_row["day_id"],
        "date": day_row["date"],
        "label": day_row["label"],
        "theme": day_row["theme"],
        "color": day_row["color"],
        "is_travel_day": as_bool(day_row["is_travel_day"]),
        "stats": {
            "items": len(items),
            "must_count": must_count,
            "daughter_count": daughter_count
        },
        "items": items
    })

GUIDE_JSON.write_text(
    json.dumps(guide, ensure_ascii=False, indent=2),
    encoding="utf-8"
)

# --- places.geojson ---------------------------------------------------------

place_features = []
for pid, place in place_index.items():
    if not place["has_coordinates"]:
        continue

    place_features.append({
        "type": "Feature",
        "id": pid,
        "geometry": {
            "type": "Point",
            "coordinates": [place["lon"], place["lat"]]
        },
        "properties": {
            "place_id": pid,
            "name": place["name"],
            "type": place["type"],
            "area": place["area"],
            "maps_query": place["maps_query"],
            "maps_url": place["maps_url"],
            "apple_maps_url": place["apple_maps_url"],
            "image_query": place["image_query"],
            "tags": place["tags"]
        }
    })

PLACES_GEOJSON.write_text(
    json.dumps({
        "type": "FeatureCollection",
        "features": place_features
    }, ensure_ascii=False, indent=2),
    encoding="utf-8"
)

# --- day GeoJSON ------------------------------------------------------------

for day in guide["days"]:
    features = []
    route_coords = []

    for item in day["items"]:
        place = item["place"]
        if not place["has_coordinates"]:
            continue

        features.append({
            "type": "Feature",
            "id": f'{day["day_id"]}-{item["seq"]}-{place["place_id"]}',
            "geometry": {
                "type": "Point",
                "coordinates": [place["lon"], place["lat"]]
            },
            "properties": {
                "day_id": day["day_id"],
                "seq": item["seq"],
                "time_from": item["time_from"],
                "time_to": item["time_to"],
                "activity_title": item["activity_title"],
                "with_daughter": item["with_daughter"],
                "priority": item["priority"],
                "transport_from_prev": item["transport_from_prev"],
                "travel_min": item["travel_min"],
                "notes": item["notes"],
                "place_id": place["place_id"],
                "name": place["name"],
                "type": place["type"],
                "area": place["area"],
                "maps_query": place["maps_query"],
                "maps_url": place["maps_url"]
            }
        })

        route_coords.append([place["lon"], place["lat"]])

    if len(route_coords) >= 2:
        features.append({
            "type": "Feature",
            "id": f'{day["day_id"]}-route',
            "geometry": {
                "type": "LineString",
                "coordinates": route_coords
            },
            "properties": {
                "day_id": day["day_id"],
                "label": day["label"],
                "theme": day["theme"],
                "type": "route",
                "color": day["color"]
            }
        })

    (DAY_GEOJSON_DIR / f'{day["day_id"]}.geojson').write_text(
        json.dumps({
            "type": "FeatureCollection",
            "features": features
        }, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

print("OK: guide.json, places.geojson, data/days/*.geojson erzeugt.")
