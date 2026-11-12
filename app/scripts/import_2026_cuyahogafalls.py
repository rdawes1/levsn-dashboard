"""Import the 2026 City of Cuyahoga Falls run, and put KB1 on the map.

Cuyahoga Falls sent two files for the same five readings: the Water Reporter
wide export (`CityofCuyahoga-11-12-26.csv`, one column per parameter with a
`[p:NNNN]` suffix) and the source rows they imported into Water Reporter
(`CityofCuyahota-SourcedataImport.csv`). This reads the export and checks every
value against the source file, so a transcription slip between the two would
stop the import rather than reach Airtable.

KB1 already exists as a Station but carries no latitude or longitude, which is
why Kelsey Brook would publish everywhere except the map - the same fault that
hid Summit's and River Raisin's sites. The coordinate comes from Cuyahoga
Falls' own export.

Dry run by default; pass --write to apply.
"""
import collections, csv, json, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network")
DATA = ROOT / "2026 Data"
SRC = DATA / "CityofCuyahoga-11-12-26.csv"
CHECK = DATA / "CityofCuyahota-SourcedataImport.csv"
BASE = "appVBC2SUwFcom2p5"
YEAR = 2026
ORG = "City of Cuyahoga Falls"

# Water Reporter column -> Airtable field. The `[p:NNNN]` suffix is this
# dataset's parameter id and differs for every organisation.
FIELDS = {"conductivity [p:4224]": "Conductivity",
          "dissolved_oxygen [p:4225]": "Dissolved Oxygen",
          "ph [p:4226]": "pH",
          "temperature [p:4227]": "Water Temperature"}
# The same readings in the source-import file, under their plain names.
CHECK_FIELDS = {"conductivity": "Conductivity", "dissolved_oxygen": "Dissolved Oxygen",
                "ph": "pH", "temperature": "Water Temperature"}

PLAUSIBLE = {"Dissolved Oxygen": (0, 25), "pH": (3.5, 11),
             "Water Temperature": (-1, 40), "Conductivity": (1, 50000)}

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


def num(v):
    try:
        return float(str(v).strip())
    except Exception:
        return None


# ---------------------------------------------------------------- read source
rows = list(csv.DictReader(SRC.open()))
readings, coords = {}, {}
for r in rows:
    sid, date = r["station_id"].strip(), r["collection_date"][:10]
    readings[(sid, date)] = {tgt: num(r.get(col)) for col, tgt in FIELDS.items()}
    la, lo = num(r.get("latitude")), num(r.get("longitude"))
    if la is not None and lo is not None:
        coords.setdefault(sid, (la, lo))

# Cross-check against the source-import file they sent alongside.
mismatches = []
for r in csv.DictReader(CHECK.open()):
    key = (r["station_id"].strip(), r["collection_date"][:10])
    have = readings.get(key)
    if have is None:
        mismatches.append((key, "present in the source file but not in the export"))
        continue
    for col, tgt in CHECK_FIELDS.items():
        a, b = num(r.get(col)), have.get(tgt)
        if a is not None and b is not None and abs(a - b) > 0.011:
            mismatches.append((key, f"{tgt}: export {b} vs source {a}"))

# ------------------------------------------------------------- read Airtable
print("Loading Airtable...")
stations = fetch("Stations")
st = {}
for r in stations:
    f = r["fields"]
    sid = (f.get("station_id") or "").strip()
    if sid:
        st.setdefault(sid, {
            "rec": r["id"], "org": f.get("Organization (from station_id)"),
            "name": f.get("Station Name (from station_id)"),
            "basin": (f.get("Basin") or [None])[0],
            "regime": f.get("Temp Regime Name"),
            "lat": f.get("Latitude (from station_id)"),
            "lon": f.get("Longitude (from station_id)")})

thresholds = {}
for r in fetch("Temperature Regimes"):
    f = r["fields"]
    if f.get("Temp Regime") and f.get("Month") is not None:
        thresholds[(f["Temp Regime"], int(f["Month"]))] = f["Temperature Threshold"]

rec2sid = {v["rec"]: k for k, v in st.items()}
existing = set()
for r in fetch("LEVSN Samples", filterByFormula=f"{{Sample Run Year}}={YEAR}"):
    f = r["fields"]
    L = f.get("station_id") or []
    sid = rec2sid.get(L[0]) if L else None
    if sid in {k[0] for k in readings}:
        existing.add((sid, (f.get("collection_date") or "")[:10]))

# ----------------------------------------------------------------- build work
creates, skipped, flags, no_station, coord_updates = [], [], [], [], []

for sid, (la, lo) in sorted(coords.items()):
    info = st.get(sid)
    if info and info["lat"] is None and info["lon"] is None:
        coord_updates.append({"id": info["rec"], "_sid": sid, "_c": (la, lo),
                              "fields": {"Latitude (from station_id)": la,
                                         "Longitude (from station_id)": lo}})

for (sid, date), vals in sorted(readings.items()):
    info = st.get(sid)
    if not info:
        no_station.append((sid, date))
        continue
    if (sid, date) in existing:
        skipped.append((sid, date))
        continue
    for fld, (lo_, hi) in PLAUSIBLE.items():
        v = vals.get(fld)
        if v is not None and not (lo_ <= v <= hi):
            flags.append((sid, date, fld, v))

    fields = {"station_id": [info["rec"]], "Sample Run Year": YEAR, "collection_date": date}
    if info["basin"]:
        fields["Basin-Sample"] = [info["basin"]]
    for t, v in vals.items():
        if v is not None:
            fields[t] = round(v, 2)
    if vals.get("Conductivity") is not None:
        fields["ConductivityBiocondition"] = round(vals["Conductivity"], 2)
    wt = vals.get("Water Temperature")
    th = thresholds.get((info["regime"], int(date[5:7]))) if info["regime"] else None
    if wt is not None and th is not None:
        fields["Water Temp_Ex"] = 1 if wt >= th else 0
    creates.append({"_sid": sid, "_date": date, "_regime": info["regime"],
                    "_th": th, "fields": fields})

# --------------------------------------------------------------------- report
print()
print("=" * 78)
print(f"SOURCE : {SRC.name}  ({len(rows)} rows)")
print(f"CHECK  : {CHECK.name}")
print()
print(f"CROSS-FILE MISMATCHES : {len(mismatches)}")
for key, why in mismatches:
    print(f"   {key[0]:8} {key[1]}  {why}")
print()
print(f"COORDINATES TO SET : {len(coord_updates)}")
for u in coord_updates:
    print(f"   {u['_sid']:8} {u['_c'][0]}, {u['_c'][1]}   ({st[u['_sid']]['name']})")
print()
print(f"READINGS TO CREATE : {len(creates)}")
print(f"   {'STATION':9}{'DATE':12}{'COND':>8}{'DO':>7}{'pH':>7}{'TEMP':>7}{'REGIME':>8}{'THR':>5}  TEMP_EX")
for c in creates:
    f = c["fields"]
    print(f"   {c['_sid']:9}{c['_date']:12}"
          f"{f.get('Conductivity', ''):>8}{f.get('Dissolved Oxygen', ''):>7}"
          f"{f.get('pH', ''):>7}{f.get('Water Temperature', ''):>7}"
          f"{str(c['_regime']):>8}{str(c['_th']):>5}  {f.get('Water Temp_Ex', '-')}")
print()
print(f"ALREADY IN AIRTABLE, SKIPPED : {len(skipped)}  {skipped}")
print(f"STATIONS NOT IN AIRTABLE     : {len(no_station)}  {sorted({s for s, _ in no_station})}")
print(f"IMPLAUSIBLE VALUES FLAGGED   : {len(flags)}")
for sid, date, fld, v in flags:
    print(f"   {sid:8} {date}  {fld:18} {v}")

if mismatches:
    print("\nSTOPPING: the two files Cuyahoga Falls sent do not agree. Nothing written.")
    sys.exit(1)

if "--write" not in sys.argv:
    print("\nDRY RUN - nothing written. Re-run with --write to apply.")
    sys.exit()

print("\nWriting...")
u = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote('Stations')}"
for i in range(0, len(coord_updates), 10):
    b = [{"id": c["id"], "fields": c["fields"]} for c in coord_updates[i:i + 10]]
    json.load(urllib.request.urlopen(urllib.request.Request(
        u, data=json.dumps({"records": b}).encode(), headers=H, method="PATCH")))
    print(f"  coordinates {i + len(b)}/{len(coord_updates)}")

u = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote('LEVSN Samples')}"
for i in range(0, len(creates), 10):
    b = [{"fields": c["fields"]} for c in creates[i:i + 10]]
    json.load(urllib.request.urlopen(urllib.request.Request(
        u, data=json.dumps({"records": b}).encode(), headers=H, method="POST")))
    print(f"  created {i + len(b)}/{len(creates)}")
print(f"\nDone. {len(coord_updates)} station(s) placed, {len(creates)} readings created.")
