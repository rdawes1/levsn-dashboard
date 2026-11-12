"""Put River Raisin's stations on the map.

River Raisin sent their readings as a monthly spreadsheet rather than a Water
Reporter export, and their LEBAF station report carries HUC codes but no
coordinates, so every one of their stations published everywhere except the
map. Sarah Barrow passed on the coordinates from the group on 12 Nov 2026.

They arrived as degrees.minutes.seconds with no hemisphere - "GC01-Lat-42.3.38,
Long-84.19.31" - so they are converted here rather than by hand, and the
longitudes are negated for Michigan. The conversion is confirmed by a landmark:
RR01 is named "Norvell Lake-River Raisin" and converts to 42.0994, -84.2233,
which is Norvell Lake in Jackson County.

Dry run by default; pass --write to apply.
"""
import json, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network")
BASE = "appVBC2SUwFcom2p5"
ORG = "River Raisin"

# Exactly as supplied, deg.min.sec. Longitudes are west, so negated below.
#
# The fourth was labelled IC01, and goes to IC02. River Raisin keep two
# stations both named "Iron Creek": IC01 has never carried a reading in any
# year and does not appear in their own 2026 LEBAF station report, while IC02
# holds the six 2026 readings and is the one Sarah listed as missing from the
# map. Their station report gives IC02 the HUC-12 041000020106, the Iron Creek
# sub-watershed this coordinate falls in. Confirmed with John on 12 Nov 2026
# and flagged back to River Raisin for them to correct if it is wrong.
SUPPLIED = {
    "GC01": ("42.3.38", "84.19.31"),
    "RR01": ("42.5.58", "84.13.24"),
    "RR02": ("42.7.53", "84.8.47"),
    "IC02": ("42.5.49", "84.6.44"),
}

# The headwaters of the River Raisin, generously drawn: Jackson, Lenawee and
# Washtenaw counties out to the river mouth at Monroe. A coordinate outside
# this box means the conversion or the hemisphere is wrong, which is how a
# Michigan creek ends up in the Indian Ocean or in Ontario.
BOX = {"lat": (41.5, 42.5), "lon": (-84.6, -83.3)}

tok = re.search(r"pat[A-Za-z0-9.]+", (ROOT / "Token" / "::LEVSN Airtable Token").read_text()).group(0)
H = {"Authorization": "Bearer " + tok, "Content-Type": "application/json"}


def fetch(table, **q):
    out, off = [], None
    while True:
        p = dict(q, pageSize=100)
        if off:
            p["offset"] = off
        u = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote(table)}?{urllib.parse.urlencode(p)}"
        d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=H)))
        out += d["records"]
        off = d.get("offset")
        if not off:
            return out


def dms(s: str) -> float:
    """'42.3.38' -> 42.060556. Degrees, minutes, seconds separated by dots."""
    parts = [float(p) for p in s.split(".")]
    while len(parts) < 3:
        parts.append(0.0)
    d, m, sec = parts[:3]
    return round(d + m / 60 + sec / 3600, 6)


print("Loading Airtable...")
stations = [r for r in fetch("Stations")
            if r["fields"].get("Organization (from station_id)") == ORG]
by_sid = {(r["fields"].get("station_id") or "").strip(): r for r in stations}

updates, refused, already = [], [], []
for sid, (la_s, lo_s) in sorted(SUPPLIED.items()):
    rec = by_sid.get(sid)
    if rec is None:
        refused.append((sid, f"no station with that id belongs to {ORG}"))
        continue
    la, lo = dms(la_s), -dms(lo_s)
    if not (BOX["lat"][0] <= la <= BOX["lat"][1] and BOX["lon"][0] <= lo <= BOX["lon"][1]):
        refused.append((sid, f"{la}, {lo} falls outside the River Raisin watershed"))
        continue
    f = rec["fields"]
    if f.get("Latitude (from station_id)") is not None:
        already.append((sid, f.get("Latitude (from station_id)"), f.get("Longitude (from station_id)")))
        continue
    updates.append({"id": rec["id"], "_sid": sid, "_c": (la, lo),
                    "_name": f.get("Station Name (from station_id)"),
                    "fields": {"Latitude (from station_id)": la,
                               "Longitude (from station_id)": lo}})

print()
print(f"{'STATION':9}{'SUPPLIED (D.M.S)':24}{'LATITUDE':>12}{'LONGITUDE':>12}   STATION NAME")
for u in updates:
    print(f"{u['_sid']:9}{SUPPLIED[u['_sid']][0] + ' / ' + SUPPLIED[u['_sid']][1]:24}"
          f"{u['_c'][0]:>12}{u['_c'][1]:>12}   {u['_name']}")
print(f"\nTO UPDATE: {len(updates)}")
if already:
    print(f"ALREADY PLACED, LEFT ALONE: {already}")
if refused:
    print(f"REFUSED: {len(refused)}")
    for sid, why in refused:
        print(f"   {sid:9} {why}")

# Anything belonging to this organisation that is still unplaced afterwards.
left = sorted(sid for sid, r in by_sid.items()
              if r["fields"].get("Latitude (from station_id)") is None
              and sid not in {u["_sid"] for u in updates})
print(f"\nSTILL WITHOUT A COORDINATE AFTER THIS: {len(left)}  {left}")

if "--write" not in sys.argv:
    print("\nDRY RUN - nothing written. Re-run with --write to apply.")
    sys.exit()

u = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote('Stations')}"
for i in range(0, len(updates), 10):
    b = [{"id": c["id"], "fields": c["fields"]} for c in updates[i:i + 10]]
    json.load(urllib.request.urlopen(urllib.request.Request(
        u, data=json.dumps({"records": b}).encode(), headers=H, method="PATCH")))
    print(f"  updated {i + len(b)}/{len(updates)}")
print("\nDone.")
