"""Backfill coordinates on stations that have none.

A station with no lat/lon publishes everywhere EXCEPT the map: `stationRollups`
in src/lib/stats.ts skips it, so it is absent from the map markers and from the
Locations CSV export while still appearing in the Stations tab, Results and the
basin rollups. That is what partners report as "my sites are missing" - the
readings are all there, but the pin is not.

Coordinates are recovered from each organisation's own source export, never
from another organisation's file. Two guards make that safe:

  * a station already holding a coordinate is never overwritten;
  * a candidate must fall within MAX_KM of the centroid of the other stations
    the SAME organisation already has placed.

The second guard matters. Station IDs are not unique across the network:
`GC01` is River Raisin's Goose Creek in Michigan AND an unrelated site in the
Buffalo Niagara export near Niagara Falls, 500 km away. Matching on ID alone
would have moved Goose Creek to New York - the same class of error as the
Bellamy Road coordinate collision.

Dry run by default; pass --write to apply.
"""
import csv, json, math, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network")
DATA = ROOT / "2026 Data"
BASE = "appVBC2SUwFcom2p5"

# Each organisation is read ONLY from its own export.
SOURCES = {
    "Summit Soil and Water Conservation District": Path.home() / "Downloads" / "UaDKbgd2jxoE.10811--2026-11-03.182543.csv",
    "Clinton River Watershed Council": DATA / "ClintonRiver-11-5-Readings.csv",
    "Erie Soil and Water Conservation District": DATA / "Firelands-11-6-Readings.csv",
    "Buffalo Niagara Waterkeeper": DATA / "BuffaloNiagra-11-5-Readings.csv",
    "Doan Brook Watershed Partnership": DATA / "DoanBrook-11-6-Readings.csv",
    "Huron River Watershed Council": DATA / "Huron-11-6-Readings.csv",
    "Tinkers Creek Watershed Partners": DATA / "TinkersCreek-11-5-Readings.csv",
    "Defiance Soil & Water Conservation District": DATA / "Defiance-11-5-Readings.csv",
}
MAX_KM = 80.0

tok = re.search(r"pat[A-Za-z0-9.]+", (ROOT / "Token" / "::LEVSN Airtable Token").read_text()).group(0)
H = {"Authorization": "Bearer " + tok, "Content-Type": "application/json"}


def api(method, table, data=None, **q):
    u = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote(table)}"
    if q: u += "?" + urllib.parse.urlencode(q)
    body = json.dumps(data).encode() if data is not None else None
    return json.load(urllib.request.urlopen(urllib.request.Request(u, data=body, headers=H, method=method)))


def fetch(table, **q):
    out, off = [], None
    while True:
        p = dict(q, pageSize=100)
        if off: p["offset"] = off
        d = api("GET", table, **p)
        out += d["records"]; off = d.get("offset")
        if not off: return out


def km(a, b):
    (la1, lo1), (la2, lo2) = a, b
    x = math.radians(lo2 - lo1) * math.cos(math.radians((la1 + la2) / 2))
    return math.hypot(x, math.radians(la2 - la1)) * 6371


def coords_in(path):
    """station_id -> coordinate, refusing any station the file disagrees about."""
    out, bad = {}, set()
    if not path.exists(): return out
    for r in csv.DictReader(path.open(encoding="utf-8-sig")):
        sid = (r.get("station_id") or "").strip()
        la, lo = (r.get("latitude") or "").strip(), (r.get("longitude") or "").strip()
        if not sid or not la or not lo: continue
        try: pair = (round(float(la), 6), round(float(lo), 6))
        except ValueError: continue
        if sid in out and out[sid] != pair: bad.add(sid)
        out[sid] = pair
    for sid in bad: out.pop(sid, None)
    return out


stations = fetch("Stations")
placed = {}   # org -> [coords of its stations that already have one]
for r in stations:
    f = r["fields"]
    la, lo = f.get("Latitude (from station_id)"), f.get("Longitude (from station_id)")
    org = f.get("Organization (from station_id)")
    if la is not None and lo is not None and org:
        placed.setdefault(org, []).append((la, lo))

updates, skipped = [], []
for r in stations:
    f = r["fields"]
    sid = (f.get("station_id") or "").strip()
    org = f.get("Organization (from station_id)")
    if not sid or f.get("Latitude (from station_id)") is not None:
        continue
    src = SOURCES.get(org)
    cand = coords_in(src).get(sid) if src else None
    if cand is None:
        skipped.append((sid, org, "no coordinate in that organisation's export"))
        continue
    peers = placed.get(org, [])
    if peers:
        cen = (sum(p[0] for p in peers) / len(peers), sum(p[1] for p in peers) / len(peers))
        d = km(cand, cen)
        if d > MAX_KM:
            skipped.append((sid, org, f"candidate sits {d:,.0f} km from {org}'s other stations - ID collision"))
            continue
    updates.append({"id": r["id"], "fields": {"Latitude (from station_id)": cand[0],
                                              "Longitude (from station_id)": cand[1]},
                    "_sid": sid, "_org": org, "_c": cand})

print(f"{'STATION':13} {'LATITUDE':>11} {'LONGITUDE':>12}   ORGANIZATION")
for u in sorted(updates, key=lambda u: (u["_org"], u["_sid"])):
    print(f"{u['_sid']:13} {u['_c'][0]:>11} {u['_c'][1]:>12}   {u['_org']}")
print(f"\nSTATIONS TO UPDATE: {len(updates)}")
print(f"\nSTILL WITHOUT A COORDINATE: {len(skipped)}")
for sid, org, why in sorted(skipped, key=lambda s: (str(s[1]), s[0])):
    print(f"   {sid:13} {str(org):45} {why}")

if "--write" not in sys.argv:
    print("\nDRY RUN - nothing written. Re-run with --write to apply.")
    sys.exit()

for i in range(0, len(updates), 10):
    b = [{"id": u["id"], "fields": u["fields"]} for u in updates[i:i + 10]]
    api("PATCH", "Stations", data={"records": b})
    print(f"  updated {i + len(b)}/{len(updates)}")
print("\nDone.")
