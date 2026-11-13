"""Load University of Windsor's (RAEON) 2026 LEBAF station report.

When the 2026 Windsor readings were imported, only 7 of their sites could be
given a basin without guessing - the rest are Ontario watersheds with no LEVSN
basin record - and every station took the importer's blanket defaults for
stream size. The import note said this was "left unset pending an updated
station report from Windsor". Ed Millar sent that report on 13 Nov 2026, and
this applies it.

What it does, all of it from the report:

  * creates any basin the report names that LEVSN does not have yet
  * assigns each station its basin, from the report's mainstem column
  * assigns the matching basin to each of those stations' readings, which is
    what the Airtable Basins rollups are keyed on
  * corrects stream size, which the import defaulted to Streams for every site
  * applies Ed's new station names

Three IDs in the report are the ones these sites carried in 2025; Windsor
renamed them for 2026 and the renames were applied to Airtable at import, so
they are mapped here rather than asked for again. BigCre_3 is in the report
with no Airtable record, no readings and no coordinate anywhere, so it is
reported and not created - a station with no position cannot be drawn on the
map. PuceRiv_1 has three 2026 readings but no row in the report, so it keeps
no basin and is reported.

Dry run by default; pass --write to apply.
"""
import collections, csv, json, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network")
SRC = ROOT / "2026 Data" / "2026 LEBAF Station Report RAEON .csv"
BASE = "appVBC2SUwFcom2p5"
ORG_PREFIX = "University of Windsor"
NAME = "Station Name (from station_id)"
SIZE_FIELD = "StreamSize (from station_id) 2"

# The report's own vocabulary -> the Stations table's single-select options.
STREAM_SIZE = {
    "Headwater (20 Sq Mi or Less)": "Headwaters",
    "Stream (20-500 Sq Mi)": "Streams",
    "River (500+ Sq Mi)": "Rivers",
}

# Windsor's 2025 ID -> their 2026 ID, as applied by import_2026_windsor.py.
# Ed's report reverted three of these; map rather than block on it.
RENAMES = {"LR1": "LilRiv_1", "LR2": "LilRiv_2", "CB": "CedBea_1", "HC1": "HillMar_1"}

# The report says "Hillman Marsh"; LEVSN already carries these two sites under
# the existing "Hillman Creek" basin. Kept there rather than splitting the
# basin in two over a naming variant - raised with Ed, his call to change.
BASIN_ALIASES = {"Hillman Marsh": "Hillman Creek"}

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
    done = []
    for i in range(0, len(records), 10):
        b = records[i:i + 10]
        body = json.dumps({"records": b}).encode()
        r = json.load(urllib.request.urlopen(
            urllib.request.Request(u, data=body, headers=H, method=method)))
        done += r["records"]
        print(f"    {i + len(b)}/{len(records)}")
    return done


# --- read the report ---------------------------------------------------------
rows = list(csv.reader(SRC.open(encoding="utf-8-sig")))
if rows[1][2].strip() != "Water Reporter Station ID":
    sys.exit(f"STOPPING: column 2 of the header row is {rows[1][2]!r}, "
             "not 'Water Reporter Station ID'. Template changed? Nothing written.")

report = {}
for r in rows[2:]:
    if len(r) < 9 or not r[2].strip():
        continue
    sid = RENAMES.get(r[2].strip(), r[2].strip())
    mainstem = r[8].strip()
    report[sid] = {"name": r[1].strip(),
                   "size": r[4].strip(),
                   "habitat": r[6].strip(),
                   "mainstem": BASIN_ALIASES.get(mainstem, mainstem)}
print(f"Report rows: {len(report)}")

bad_size = {v["size"] for v in report.values()} - set(STREAM_SIZE)
if bad_size:
    sys.exit(f"STOPPING: unrecognised Watershed Drainage Size {bad_size}. Nothing written.")
bad_hab = {v["habitat"] for v in report.values()} - {"Warm", "Cold"}
if bad_hab:
    sys.exit(f"STOPPING: unrecognised Aquatic Habitat Type {bad_hab}. Nothing written.")

# --- read Airtable -----------------------------------------------------------
print("Loading Airtable...")
basin_id = {}
for r in fetch("Basins"):
    n = (r["fields"].get("Basin Name") or "").strip()
    if n:
        basin_id[n] = r["id"]

stations, by_sid = {}, {}
for r in fetch("Stations"):
    f = r["fields"]
    sid = (f.get("station_id") or "").strip()
    org = f.get("Organization (from station_id)")
    org = org[0] if isinstance(org, list) and org else org
    if sid and (org or "").startswith(ORG_PREFIX):
        rec = {"rec": r["id"], "sid": sid, "name": (f.get(NAME) or "").strip(),
               "basin": (f.get("Basin") or [None])[0], "size": f.get(SIZE_FIELD),
               "regime": f.get("Temp Regime Name")}
        stations[r["id"]] = rec
        by_sid[sid] = rec

samples = collections.defaultdict(list)
for s in fetch("LEVSN Samples"):
    f = s["fields"]
    L = f.get("station_id") or []
    if L and L[0] in stations:
        samples[stations[L[0]]["sid"]].append(s)

# --- work out what to change -------------------------------------------------
new_basins = sorted({v["mainstem"] for v in report.values()
                     if v["mainstem"] and v["mainstem"] not in basin_id})
not_in_airtable = sorted(k for k in report if k not in by_sid)
not_in_report = sorted(k for k in by_sid if k not in report)

print()
print("=" * 78)
print(f"BASINS TO CREATE : {len(new_basins)}  {new_basins or ''}")
print(f"IN THE REPORT BUT NOT IN AIRTABLE : {len(not_in_airtable)}")
for k in not_in_airtable:
    print(f"   {k:14} {report[k]['name']}  - no record, no readings, no coordinate: not created")
print(f"IN AIRTABLE BUT NOT IN THE REPORT : {len(not_in_report)}")
for k in not_in_report:
    print(f"   {k:14} {by_sid[k]['name']}  - {len(samples.get(k, []))} readings, basin left unset")

if "--write" in sys.argv and new_basins:
    print("\nCreating basins...")
    made = write("Basins", [{"fields": {"Basin Name": b}} for b in new_basins], method="POST")
    for r in made:
        basin_id[(r["fields"].get("Basin Name") or "").strip()] = r["id"]

st_updates, sa_updates = [], []
counts = collections.Counter()
for sid, rep in sorted(report.items()):
    rec = by_sid.get(sid)
    if not rec:
        continue
    fields, why = {}, []

    target = basin_id.get(rep["mainstem"]) if rep["mainstem"] else None
    if rep["mainstem"] and target is None:
        # Only possible on a dry run, before the basin exists.
        why.append(f"basin -> {rep['mainstem']} (to be created)")
        counts["basin"] += 1
    elif target and rec["basin"] != target:
        fields["Basin"] = [target]
        why.append(f"basin -> {rep['mainstem']}")
        counts["basin"] += 1

    want_size = STREAM_SIZE[rep["size"]]
    if rec["size"] != want_size:
        fields[SIZE_FIELD] = want_size
        why.append(f"size {rec['size']} -> {want_size}")
        counts["size"] += 1

    if rep["name"] and rec["name"] != rep["name"]:
        fields[NAME] = rep["name"]
        why.append("name")
        counts["name"] += 1

    if fields:
        st_updates.append({"id": rec["rec"], "fields": fields,
                           "_m": (sid, "; ".join(why))})

    # The Basins rollups are keyed on the readings' own basin link, so the
    # station's basin alone would leave every per-basin figure at zero.
    if target:
        for s in samples.get(sid, []):
            if (s["fields"].get("Basin-Sample") or [None])[0] != target:
                sa_updates.append({"id": s["id"], "fields": {"Basin-Sample": [target]}})
                counts["readings"] += 1

print()
print(f"STATION UPDATES : {len(st_updates)}"
      f"   (basin {counts['basin']}, stream size {counts['size']}, name {counts['name']})")
for u in st_updates:
    print(f"   {u['_m'][0]:14} {u['_m'][1]}")
print(f"\nREADING UPDATES : {len(sa_updates)}  (Basin-Sample)")
for b, n in sorted(collections.Counter(
        rep["mainstem"] for sid, rep in report.items()
        for _ in samples.get(sid, []) if sid in by_sid).items()):
    print(f"   {b:18} {n:4} readings at report sites")

if "--write" not in sys.argv:
    print("\nDRY RUN - nothing written. Re-run with --write to apply.")
    sys.exit()

if st_updates:
    print("\nUpdating stations...")
    write("Stations", [{"id": u["id"], "fields": u["fields"]} for u in st_updates])
if sa_updates:
    print("Updating readings...")
    write("LEVSN Samples", sa_updates)
print(f"\nDone. {len(new_basins)} basin(s), {len(st_updates)} stations, "
      f"{len(sa_updates)} readings.")
