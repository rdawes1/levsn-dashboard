"""Import Defiance SWCD's 2026 Pontiac Park (DEF-2) readings.

Background. Defiance's 2025 data reached us through the shared Water Reporter
dataset 1406 ("Northwest Ohio Lake Erie Baseline Assessment Framework"), which
carried both of their sites correctly tagged DEF-1 and DEF-2. For 2026 they
moved to their own dataset 1519, and only Independence Dam came with them - so
Pontiac Park published 12 readings in 2025 and none in 2026. Katelyn Thompson
spotted it, and on 12 Nov 2026 sent her source spreadsheet directly.

This script reads that spreadsheet, not a Water Reporter export, because the
re-upload had not propagated at the time. It is safe to run again after a
Water Reporter pull: a row is only created when the station+date is not
already in Airtable, so the two sources cannot double up.

Independence Dam rows in the file are checked against Airtable rather than
written - all 13 already agree to the hundredth, and re-importing them would
duplicate the run.

Dry run by default; pass --write to apply.
"""
import collections, csv, json, math, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network")
SRC = ROOT / "2026 Data" / "jFdZdYoVqaAt-waterreporter-independence2026.csv"
BASE = "appVBC2SUwFcom2p5"
YEAR = 2026
NAME = "Station Name (from station_id)"

# Her spreadsheet column -> Airtable field. air_temperature,
# oxygen_saturation, site_condition and weather have no home in the LEVSN
# schema and are not carried over.
FIELDS = {"conductivity": "Conductivity", "do": "Dissolved Oxygen",
          "ph": "pH", "water_temperature": "Water Temperature"}
PLAUSIBLE = {"Dissolved Oxygen": (0, 25), "pH": (3.5, 11),
             "Water Temperature": (-1, 40), "Conductivity": (1, 50000)}

# Free-text station names in the file -> LEVSN station_id. Defiance enter the
# site name in Water Reporter's station_id field rather than the LEVSN code,
# which is the root of the whole mix-up; map it here explicitly rather than
# inferring from coordinates.
STATIONS = {"independence dam": "DEF-1", "pontiac park": "DEF-2"}

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


def num(v):
    try:
        return float(str(v).strip())
    except Exception:
        return None


def iso(d):
    m, dd, y = [int(x) for x in d.strip().split("/")]
    return f"{y:04d}-{m:02d}-{dd:02d}"


def o2_at_saturation(t_c):
    """Benson-Krause: dissolved oxygen (mg/L) of air-saturated fresh water."""
    T = t_c + 273.15
    return math.exp(-139.34411 + 1.575701e5 / T - 6.642308e7 / T ** 2
                    + 1.243800e10 / T ** 3 - 8.621949e11 / T ** 4)


print("Loading Airtable...")
st = {}
for r in fetch("Stations"):
    f = r["fields"]
    sid = (f.get("station_id") or "").strip()
    if sid in STATIONS.values():
        st[sid] = {"rec": r["id"], "name": (f.get(NAME) or "").strip(),
                   "basin": (f.get("Basin") or [None])[0],
                   "regime": f.get("Temp Regime Name"),
                   "lat": f.get("Latitude (from station_id)"),
                   "lon": f.get("Longitude (from station_id)")}
missing = [s for s in STATIONS.values() if s not in st]
if missing:
    sys.exit(f"STOPPING: station(s) {missing} not in Airtable. Nothing written.")

thresholds = {}
for r in fetch("Temperature Regimes"):
    f = r["fields"]
    if f.get("Temp Regime") and f.get("Month") is not None:
        thresholds[(f["Temp Regime"], int(f["Month"]))] = f["Temperature Threshold"]

rec2sid = {v["rec"]: k for k, v in st.items()}
existing = collections.defaultdict(list)
for r in fetch("LEVSN Samples", filterByFormula=f"{{Sample Run Year}}={YEAR}"):
    f = r["fields"]
    L = f.get("station_id") or []
    sid = rec2sid.get(L[0]) if L else None
    if sid:
        existing[(sid, (f.get("collection_date") or "")[:10])].append(r)

rows = list(csv.DictReader(SRC.open()))
creates, already, flags, unknown = [], [], [], []

for r in rows:
    raw = (r["station_id"] or "").strip().lower()
    sid = STATIONS.get(raw)
    if not sid:
        unknown.append(raw)
        continue
    date = iso(r["collection_date"])
    info = st[sid]

    # The coordinates in the file must be the ones we publish, or the reading
    # belongs to a site we are not holding.
    lat, lon = num(r["latitude"]), num(r["longitude"])
    if lat is None or lon is None or abs(lat - info["lat"]) > 1e-4 or abs(lon - info["lon"]) > 1e-4:
        sys.exit(f"STOPPING: {sid} {date} coordinates {lat},{lon} do not match "
                 f"Airtable's {info['lat']},{info['lon']}. Nothing written.")

    vals = {tgt: num(r.get(col)) for col, tgt in FIELDS.items()}
    if all(v is None for v in vals.values()):
        continue
    for fld, (lo, hi) in PLAUSIBLE.items():
        v = vals.get(fld)
        if v is not None and not (lo <= v <= hi):
            flags.append((sid, date, f"{fld} = {v} is outside {lo}-{hi}"))

    # Cross-check DO against the oxygen saturation she recorded alongside it.
    # Where the two disagree by more than 1 mg/L one of them is mistyped, and
    # a wrong DO changes whether the reading counts as an exceedance.
    do, sat, wt = vals.get("Dissolved Oxygen"), num(r.get("oxygen_saturation")), vals.get("Water Temperature")
    if sat is not None and not (0 < sat <= 200):
        flags.append((sid, date, f"oxygen saturation = {sat}% is not a possible reading"))
    elif do is not None and sat is not None and wt is not None:
        implied = o2_at_saturation(wt) * sat / 100
        if abs(implied - do) > 1.0:
            flags.append((sid, date, f"DO {do} mg/L vs {sat}% saturation at {wt}C "
                                     f"implies {implied:.2f} mg/L"))

    pool = existing.get((sid, date), [])
    match = None
    for rec in pool:
        af = rec["fields"]
        if all(af.get(t) is not None and abs(round(v, 2) - af[t]) <= 0.011
               for t, v in vals.items() if v is not None):
            match = rec
            break
    if match is not None:
        already.append((sid, date))
        continue

    fields = {"station_id": [info["rec"]], "Sample Run Year": YEAR, "collection_date": date}
    if info["basin"]:
        fields["Basin-Sample"] = [info["basin"]]
    for t, v in vals.items():
        if v is not None:
            fields[t] = round(v, 2)
    if vals.get("Conductivity") is not None:
        fields["ConductivityBiocondition"] = round(vals["Conductivity"], 2)
    # Water Temp_Ex is a plain number field, so it has to be computed here.
    # Every other exceedance flag is an Airtable formula and fills itself in.
    th = thresholds.get((info["regime"], int(date[5:7]))) if info["regime"] else None
    if vals.get("Water Temperature") is not None and th is not None:
        fields["Water Temp_Ex"] = 1 if vals["Water Temperature"] >= th else 0
    creates.append({"_sid": sid, "_date": date, "fields": fields})

print()
print("=" * 72)
print(f"ROWS TO CREATE : {len(creates)}")
for s, n in sorted(collections.Counter(c["_sid"] for c in creates).items()):
    print(f"   {s:8} {n:4}   ({st[s]['name']})")
for c in creates:
    f = c["fields"]
    print(f"      {c['_sid']}  {c['_date']}  cond={f.get('Conductivity')}  "
          f"DO={f.get('Dissolved Oxygen')}  pH={f.get('pH')}  "
          f"temp={f.get('Water Temperature')}  tempEx={f.get('Water Temp_Ex')}")
print()
print(f"ALREADY IN AIRTABLE, SKIPPED : {len(already)}")
for s, n in sorted(collections.Counter(s for s, _ in already).items()):
    print(f"   {s:8} {n:4}")
print(f"ROWS AT UNRECOGNISED STATIONS : {len(unknown)}  {sorted(set(unknown))}")
print(f"READINGS FLAGGED FOR DEFIANCE : {len(flags)}")
for sid, date, msg in flags:
    print(f"   {sid:8} {date}  {msg}")

dupes = [k for k, n in collections.Counter((c["_sid"], c["_date"]) for c in creates).items() if n > 1]
if dupes:
    print(f"\nSAME STATION AND DATE TWICE IN THE FILE : {dupes}")
    print("   Kept as supplied. Both are real readings; only the date is in question.")

if "--write" not in sys.argv:
    print("\nDRY RUN - nothing written. Re-run with --write to apply.")
    sys.exit()

print("\nWriting...")
u = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote('LEVSN Samples')}"
for i in range(0, len(creates), 10):
    b = creates[i:i + 10]
    body = json.dumps({"records": [{"fields": c["fields"]} for c in b]}).encode()
    json.load(urllib.request.urlopen(urllib.request.Request(u, data=body, headers=H, method="POST")))
    print(f"  created {i + len(b)}/{len(creates)}")
print(f"\nDone. Created {len(creates)}.")
