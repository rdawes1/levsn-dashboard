"""Name BR03 and top up its readings from Buffalo Niagara Waterkeeper's export.

BR03 sits in Airtable with a blank Station Name - one of three Buffalo Niagara
sites that do - which showed up when the 2026 station list was pulled for
Sarah's GIS maps. John supplied the name and coordinates on 23 Nov 2026, along
with a Water Reporter export covering 2025 and 2026.

Of the nine readings in that export, eight are already in Airtable and agree
to the hundredth. Only 28 Oct 2026 is new.

Two things in the export are reported rather than acted on:

  * The 13 May 2025 row carries 43.0802, -78.95984, about 24 km north of every
    other row at this station. Coordinates live on the station record, not the
    reading, so this does not affect anything imported - but it is wrong at
    source and Buffalo Niagara should know.

  * Dissolved oxygen is cross-checked against the saturation recorded beside
    it. A disagreement means one of the two was mistyped, and a wrong DO
    changes whether a reading counts as an exceedance.

Dry run by default; pass --write to apply.
"""
import collections, csv, json, math, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network")
SRC = Path("/Users/robertdawes/Downloads/BR03 uploaded 2025-2026.csv")
BASE = "appVBC2SUwFcom2p5"
STATION = "BR03"
NAME_FIELD = "Station Name (from station_id)"
NAME = "Buffalo River @ Red Jacket Park"
LAT, LON = 42.86322, -78.85079

FIELDS = {"conductivity": "Conductivity", "dissolved_oxygen": "Dissolved Oxygen",
          "ph": "pH", "temperature": "Water Temperature"}
PLAUSIBLE = {"Dissolved Oxygen": (0, 25), "pH": (3.5, 11),
             "Water Temperature": (-1, 40), "Conductivity": (1, 50000)}

tok = re.search(r"pat[A-Za-z0-9.]+",
                (ROOT / "Token" / "::LEVSN Airtable Token").read_text()).group(0)
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


def write(table, records, method="PATCH"):
    u = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote(table)}"
    for i in range(0, len(records), 10):
        b = records[i:i + 10]
        json.load(urllib.request.urlopen(urllib.request.Request(
            u, data=json.dumps({"records": b}).encode(), headers=H, method=method)))
        print(f"    {i + len(b)}/{len(records)}")


def num(v):
    try:
        return float(str(v).strip())
    except Exception:
        return None


def iso(d):
    m, dd, y = [int(x) for x in d.strip().split(" ")[0].split("/")]
    return f"{y:04d}-{m:02d}-{dd:02d}"


def o2_at_saturation(t_c):
    """Benson-Krause: dissolved oxygen (mg/L) of air-saturated fresh water."""
    T = t_c + 273.15
    return math.exp(-139.34411 + 1.575701e5 / T - 6.642308e7 / T ** 2
                    + 1.243800e10 / T ** 3 - 8.621949e11 / T ** 4)


def metres(a, b):
    R = 6371000
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(h))


print("Loading Airtable...")
station = None
for r in fetch("Stations"):
    if (r["fields"].get("station_id") or "").strip() == STATION:
        if station:
            sys.exit(f"STOPPING: more than one station record for {STATION}. Nothing written.")
        station = r
if not station:
    sys.exit(f"STOPPING: no station record for {STATION}. Nothing written.")

sf = station["fields"]
at_lat, at_lon = sf.get("Latitude (from station_id)"), sf.get("Longitude (from station_id)")
if at_lat is None or at_lon is None or metres((at_lat, at_lon), (LAT, LON)) > 10:
    sys.exit(f"STOPPING: Airtable holds {STATION} at {at_lat},{at_lon}, not {LAT},{LON}. "
             "Nothing written.")

thresholds = {}
for r in fetch("Temperature Regimes"):
    f = r["fields"]
    if f.get("Temp Regime") and f.get("Month") is not None:
        thresholds[(f["Temp Regime"], int(f["Month"]))] = f["Temperature Threshold"]
regime = sf.get("Temp Regime Name")
basin = (sf.get("Basin") or [None])[0]

existing = collections.defaultdict(list)
for s in fetch("LEVSN Samples"):
    L = s["fields"].get("station_id") or []
    if L and L[0] == station["id"]:
        existing[(s["fields"].get("collection_date") or "")[:10]].append(s)

rows = [r for r in csv.DictReader(SRC.open()) if (r.get("station_id") or "").strip()]
off_site, flags, creates, matched = [], [], [], []

for r in rows:
    if r["station_id"].strip() != STATION:
        sys.exit(f"STOPPING: export contains station {r['station_id']!r}, expected only "
                 f"{STATION}. Nothing written.")
    date = iso(r["collection_date"])
    rlat, rlon = num(r["latitude"]), num(r["longitude"])
    if rlat is not None and rlon is not None and metres((rlat, rlon), (LAT, LON)) > 100:
        off_site.append((date, rlat, rlon, metres((rlat, rlon), (LAT, LON))))

    vals = {tgt: num(r.get(col)) for col, tgt in FIELDS.items()}
    if all(v is None for v in vals.values()):
        continue
    for fld, (lo, hi) in PLAUSIBLE.items():
        v = vals.get(fld)
        if v is not None and not (lo <= v <= hi):
            flags.append((date, f"{fld} = {v} is outside {lo}-{hi}"))
    do, sat, wt = (vals.get("Dissolved Oxygen"), num(r.get("dissolved_oxygen_saturation")),
                   vals.get("Water Temperature"))
    if sat is not None and not (0 < sat <= 200):
        flags.append((date, f"oxygen saturation = {sat}% is not a possible reading"))
    elif None not in (do, sat, wt):
        implied = o2_at_saturation(wt) * sat / 100
        if abs(implied - do) > 1.0:
            flags.append((date, f"DO {do} mg/L vs {sat}% saturation at {wt}C "
                                f"implies {implied:.2f} mg/L"))

    hit = None
    for rec in existing.get(date, []):
        af = rec["fields"]
        if all(af.get(t) is not None and abs(round(v, 2) - af[t]) <= 0.011
               for t, v in vals.items() if v is not None):
            hit = rec
            break
    if hit is not None:
        matched.append(date)
        continue

    year = int(date[:4])
    fields = {"station_id": [station["id"]], "Sample Run Year": year, "collection_date": date}
    if basin:
        fields["Basin-Sample"] = [basin]
    for t, v in vals.items():
        if v is not None:
            fields[t] = round(v, 2)
    if vals.get("Conductivity") is not None:
        fields["ConductivityBiocondition"] = round(vals["Conductivity"], 2)
    th = thresholds.get((regime, int(date[5:7]))) if regime else None
    if vals.get("Water Temperature") is not None and th is not None:
        fields["Water Temp_Ex"] = 1 if vals["Water Temperature"] >= th else 0
    creates.append({"_date": date, "fields": fields})

name_now = (sf.get(NAME_FIELD) or "").strip()
rename = name_now != NAME

print()
print("=" * 72)
print(f"STATION {STATION}  ({sf.get('Organization (from station_id)')})")
print(f"   coordinates   {at_lat}, {at_lon}  - matches, unchanged")
print(f"   temp regime   {regime}")
print(f"   name          {name_now or '(blank)'!r} -> {NAME!r}" if rename
      else f"   name          {NAME!r} already set")
print()
print(f"EXPORT ROWS                  : {len(rows)}")
print(f"ALREADY IN AIRTABLE, SKIPPED : {len(matched)}  {sorted(matched)}")
print(f"ROWS TO CREATE               : {len(creates)}")
for c in creates:
    f = c["fields"]
    print(f"   {c['_date']}  cond={f.get('Conductivity')}  DO={f.get('Dissolved Oxygen')}  "
          f"pH={f.get('pH')}  temp={f.get('Water Temperature')}  tempEx={f.get('Water Temp_Ex')}")
print()
print(f"READINGS LOGGED AWAY FROM THE SITE : {len(off_site)}")
for d, la, lo, m in off_site:
    print(f"   {d}  {la}, {lo}  - {m/1000:.1f} km from the station. Reported, not imported;")
    print(f"      coordinates are held on the station record, so nothing here is affected.")
print(f"READINGS FLAGGED FOR THE ORGANISATION : {len(flags)}")
for d, msg in flags:
    print(f"   {d}  {msg}")

if "--write" not in sys.argv:
    print("\nDRY RUN - nothing written. Re-run with --write to apply.")
    sys.exit()

if rename:
    print("\nNaming the station...")
    write("Stations", [{"id": station["id"], "fields": {NAME_FIELD: NAME}}])
if creates:
    print("Creating readings...")
    write("LEVSN Samples", [{"fields": c["fields"]} for c in creates], method="POST")
print(f"\nDone. {'Named the station. ' if rename else ''}Created {len(creates)}.")
