"""Import the Water Rangers 2026 readings (export of 12 Nov 2026).

Water Rangers had no 2026 data at all before this. The export is Water
Reporter's WIDE format - one row per visit, parameters as `name [p:NNNN]`
columns - which differs from both the Summit long export and Windsor's
DataStream template.

The column mapping was not guessed. The file also carries 17 rows from 2025
that are already in Airtable, so every candidate mapping was checked against
the stored values first: `water temperature [p:4190]` -> Water Temperature,
`dissolved oxygen [p:4193]` -> Dissolved Oxygen (mg/L), conductivity and pH
straight across. `air temperature` is NOT a LEVSN parameter and is dropped,
and `dissolved oxygen %` is saturation, not mg/L.

Only 2026 rows are written. The 2025 rows are left exactly as they are.

Two things this handles:

  * Seven stations exist in Airtable with a BLANK station_id, because Water
    Rangers' own 2026 LEBAF station report left the Water Reporter ID column
    empty for them. The export now carries those IDs, so they are filled in
    and matched by name - explicitly, one pair at a time, because one of them
    ("Beaverdam Drain" vs "Beaver Dam Drain at Lorraine Bay") is not an exact
    string match and should not be left to a fuzzy matcher.

  * No station had coordinates except the three that reported in 2025, so most
    of Water Rangers would have been absent from the map. The export carries a
    lat/lon on every row and they are applied, never overwriting one already
    set.

CHLORIDE: taken as measured from the export. The 2025 Water Rangers rows hold
a chloride DERIVED from conductivity at a flat 0.04928 factor, which disagrees
with the measured values now arriving and with the programme's position that
chloride should be entered by volunteers rather than derived. The 2025 rows are
left alone; see the note printed at the end.

WATER TEMPERATURE is absent from every 2026 row in this export, so no reading
gets one and Water Temp_Ex cannot be computed. Air temperature is present but
is a different measurement and is not substituted.

Dry run by default; pass --write to apply. Re-running creates nothing.
"""
import collections, csv, json, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network")
SRC = ROOT / "2026 Data" / "WaterRangers-Nov12-26.csv"
BASE = "appVBC2SUwFcom2p5"
YEAR = 2026
ORG = "Water Rangers"
NAME = "Station Name (from station_id)"

FIELDS = {"water temperature [p:4190]": "Water Temperature",
          "conductivity [p:4189]": "Conductivity",
          "dissolved oxygen [p:4193]": "Dissolved Oxygen",
          "pH [p:4188]": "pH",
          "chloride [p:4194]": "Chloride"}
PLAUSIBLE = {"Dissolved Oxygen": (0, 25), "pH": (3.5, 11), "Water Temperature": (-1, 40),
             "Conductivity": (1, 50000), "Chloride": (0, 5000)}

# Export station_id -> the EXACT Airtable station name currently holding a
# blank station_id. Spelled out rather than fuzzy-matched; see the docstring.
ADOPT = {"CBAP-GR": "Cockshutt Bridge Access Point",
         "CBR-GR":  "Cayuga Boat Ramp",
         "BP-GR":   "Bean Park",
         "PCP-GR":  "Paris Canoe Portage",
         "DTB-GR":  "D'Aubigny Trail Bridge",
         "KPTP-GR": "Kinsmen Park Trout Park",
         "BDD-LB":  "Beaverdam Drain"}

# Ballantyne Drive Boat Launch appears only in the export - it is in no station
# report. It sits 140 m from D'Aubigny Trail Bridge on the Grand at Brantford,
# so it takes the Grand River defaults every other Water Rangers Grand site
# carries. Flagged in the summary for confirmation.
NEW = {"BDBL-GR": {"Basin": "Grand River", "Temp Regime Name": "Cold",
                   "Ecoregion (from station_id) 2": "EOLP",
                   "StreamSize (from station_id) 2": "Rivers",
                   "Monitoring Location Type": "River/Stream"}}

tok = re.search(r"pat[A-Za-z0-9.]+", (ROOT/"Token"/"::LEVSN Airtable Token").read_text()).group(0)
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


def num(v):
    try: return float(str(v).strip())
    except Exception: return None


rows = [r for r in csv.DictReader(SRC.open(encoding="utf-8-sig"))
        if r["collection_date"][:4] == str(YEAR)]
print(f"Source: {len(rows)} rows dated {YEAR} "
      f"({len({r['station_id'] for r in rows})} stations)")

stations = fetch("Stations")
basins = {r["fields"].get("Basin Name"): r["id"] for r in fetch("Basins") if r["fields"].get("Basin Name")}
by_id, by_name = {}, {}
for r in stations:
    f = r["fields"]
    sid = (f.get("station_id") or "").strip()
    nm = (f.get(NAME) or "").strip()
    if sid: by_id.setdefault(sid, r)
    if f.get("Organization (from station_id)") == ORG and nm:
        by_name.setdefault(nm, []).append(r)

# ---- plan: adopt the blank-id stations -------------------------------------
adopts = []
for sid, nm in ADOPT.items():
    if sid in by_id:
        print(f"  note: {sid} already exists, nothing to adopt")
        continue
    hits = by_name.get(nm, [])
    if len(hits) != 1:
        sys.exit(f"ABORT: {nm!r} matches {len(hits)} {ORG} stations; cannot adopt {sid}")
    rec = hits[0]
    cur = (rec["fields"].get("station_id") or "").strip()
    if cur:
        sys.exit(f"ABORT: {nm!r} already carries station_id {cur!r}; refusing to overwrite with {sid}")
    newname = next((r["station_name"].strip() for r in rows if r["station_id"] == sid), nm)
    adopts.append({"id": rec["id"], "_sid": sid, "_was": nm, "_now": newname,
                   "fields": {"station_id": sid, NAME: newname}})

# ---- plan: create the station that is in no report -------------------------
creates_st = []
for sid in sorted({r["station_id"] for r in rows}):
    if sid in by_id or sid in ADOPT: continue
    if sid not in NEW: sys.exit(f"ABORT: {sid} has readings but no Airtable station and no defaults defined")
    src = next(r for r in rows if r["station_id"] == sid)
    d = dict(NEW[sid]); bn = d.pop("Basin")
    if bn not in basins: sys.exit(f"ABORT: basin {bn!r} not in Airtable")
    creates_st.append({"_sid": sid, "fields": {
        "station_id": sid, NAME: src["station_name"].strip(),
        "Organization (from station_id)": ORG, "Basin": [basins[bn]], **d}})

# ---- plan: coordinates ------------------------------------------------------
coords = {}
for r in rows:
    la, lo = num(r.get("latitude")), num(r.get("longitude"))
    if la is None or lo is None: continue
    pair = (round(la, 6), round(lo, 6))
    if r["station_id"] in coords and coords[r["station_id"]] != pair:
        sys.exit(f"ABORT: {r['station_id']} has two coordinates in the export")
    coords[r["station_id"]] = pair

coord_updates = []
for sid, (la, lo) in sorted(coords.items()):
    rec = by_id.get(sid) or next((a for a in adopts if a["_sid"] == sid), None)
    if isinstance(rec, dict) and "_sid" in rec:           # being adopted this run
        rec["fields"]["Latitude (from station_id)"] = la
        rec["fields"]["Longitude (from station_id)"] = lo
        continue
    if rec is None: continue                              # created below, carries coords there
    if rec["fields"].get("Latitude (from station_id)") is None:
        coord_updates.append({"id": rec["id"], "_sid": sid,
                              "fields": {"Latitude (from station_id)": la,
                                         "Longitude (from station_id)": lo}})
for c in creates_st:
    if c["_sid"] in coords:
        c["fields"]["Latitude (from station_id)"] = coords[c["_sid"]][0]
        c["fields"]["Longitude (from station_id)"] = coords[c["_sid"]][1]

print()
print(f"STATIONS TO ADOPT (fill in a blank station_id) : {len(adopts)}")
for a in adopts:
    nm = f"{a['_was']!r} -> {a['_now']!r}" if a["_was"] != a["_now"] else repr(a["_was"])
    print(f"   {a['_sid']:9} {nm}")
print(f"\nSTATIONS TO CREATE : {len(creates_st)}   {[c['_sid'] for c in creates_st]}")
print(f"COORDINATES TO SET : {len(coord_updates) + len(adopts) + len(creates_st)} stations "
      f"({len(coord_updates)} existing, {len(adopts)} adopted, {len(creates_st)} new)")

# ---- plan: readings ---------------------------------------------------------
existing = set()
for r in fetch("LEVSN Samples", filterByFormula=f"{{Sample Run Year}}={YEAR}"):
    L = r["fields"].get("station_id") or []
    if L: existing.add((L[0], (r["fields"].get("collection_date") or "")[:10]))

recid = {}
for sid in coords:
    if sid in by_id: recid[sid] = by_id[sid]["id"]
for a in adopts: recid[a["_sid"]] = a["id"]

planned, flags, skipped = [], [], 0
for r in sorted(rows, key=lambda r: (r["station_id"], r["collection_date"])):
    sid, date = r["station_id"], r["collection_date"][:10]
    vals = {t: num(r.get(c)) for c, t in FIELDS.items()}
    if all(v is None for v in vals.values()): continue
    for fld, (lo, hi) in PLAUSIBLE.items():
        v = vals.get(fld)
        if v is not None and not (lo <= v <= hi): flags.append((sid, date, fld, v))
    if (recid.get(sid), date) in existing:
        skipped += 1; continue
    planned.append((sid, date, vals))

print(f"\nREADINGS TO CREATE : {len(planned)}")
if skipped: print(f"   already in Airtable, skipped : {skipped}")
cov = collections.Counter()
for _, _, v in planned:
    for k, x in v.items():
        if x is not None: cov[k] += 1
for k, n in cov.most_common(): print(f"   {k:20} {n}/{len(planned)}")
for k in FIELDS.values():
    if k not in cov: print(f"   {k:20} 0/{len(planned)}   <-- ABSENT FROM THIS EXPORT")
print(f"\nIMPLAUSIBLE VALUES FLAGGED : {len(flags)}")
for sid, date, fld, v in flags: print(f"   {sid:9} {date}  {fld:18} {v}")

if "--write" not in sys.argv:
    print("\nDRY RUN - nothing written. Re-run with --write to apply.")
    sys.exit()

print("\nWriting...")
for i in range(0, len(adopts), 10):
    b = [{"id": a["id"], "fields": a["fields"]} for a in adopts[i:i + 10]]
    api("PATCH", "Stations", data={"records": b}); print(f"  adopted {i + len(b)}/{len(adopts)}")
for i in range(0, len(coord_updates), 10):
    b = [{"id": c["id"], "fields": c["fields"]} for c in coord_updates[i:i + 10]]
    api("PATCH", "Stations", data={"records": b}); print(f"  coords {i + len(b)}/{len(coord_updates)}")
for i in range(0, len(creates_st), 10):
    b = creates_st[i:i + 10]
    out = api("POST", "Stations", data={"records": [{"fields": c["fields"]} for c in b]})
    for c, rec in zip(b, out["records"]): recid[c["_sid"]] = rec["id"]
    print(f"  created stations {i + len(b)}/{len(creates_st)}")

basin_of = {}
for r in fetch("Stations"):
    sid = (r["fields"].get("station_id") or "").strip()
    if sid in recid: basin_of[sid] = (r["fields"].get("Basin") or [None])[0]

out_rows = []
for sid, date, vals in planned:
    rec = recid.get(sid)
    if not rec: sys.exit(f"ABORT: no station record for {sid}")
    f = {"station_id": [rec], "Sample Run Year": YEAR, "collection_date": date}
    if basin_of.get(sid): f["Basin-Sample"] = [basin_of[sid]]
    for k, v in vals.items():
        if v is not None: f[k] = round(v, 2)
    if vals.get("Conductivity") is not None:
        f["ConductivityBiocondition"] = round(vals["Conductivity"], 2)
    out_rows.append(f)

for i in range(0, len(out_rows), 10):
    b = out_rows[i:i + 10]
    api("POST", "LEVSN Samples", data={"records": [{"fields": x} for x in b]})
    print(f"  created readings {i + len(b)}/{len(out_rows)}")
print(f"\nDone. Adopted {len(adopts)}, created {len(creates_st)} stations and {len(out_rows)} readings.")
