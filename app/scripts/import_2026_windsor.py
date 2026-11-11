"""Import University of Windsor (RAEON) 2026 readings from the DataStream template.

Windsor submit on DataStream's standard template rather than a Water Reporter
export, so the shape differs: `Results-Résultats` is long format - one row per
characteristic per visit - with Excel serial dates, and `Locations-Sites`
carries the site coordinates.

Three things this handles that the other imports do not:

  * Windsor renamed their stations between 2025 and 2026. Four sites already in
    Airtable are the SAME sites at 0 m distance under old IDs (LR1, LR2, CB,
    HC1). They are renamed to Windsor's new IDs rather than duplicated, so the
    2025 readings stay attached to the site that collected them.

  * Temperature is sometimes logged a few minutes before the other probes on
    the same visit, producing two timestamps for one sample. Readings are keyed
    on station + date, which merges them; no conflicting values occur.

  * `Barom.` (mmHg) and `DOPercent_YSI` (%) are not LEVSN parameters and are
    ignored. Units of the four we do take were confirmed against the template's
    own Characteristics sheet: deg C, uS/cm, mg/L, dimensionless pH.

Basins: only 7 of the 38 sites map to an existing LEVSN basin. The rest are
Ontario watersheds with no basin record yet, and are left unset pending an
updated station report from Windsor. Their readings publish everywhere except
the By Basin rollups.

Dry run by default; pass --write to apply. Re-running creates nothing: a
station already holding a reading for that date is skipped.

Needs `pyxlsb` to read the .xlsb workbook, which the other importers do not:
    python3 -m venv .venv && .venv/bin/pip install pyxlsb
    .venv/bin/python app/scripts/import_2026_windsor.py
"""
import collections, csv, datetime, json, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network")
SRC = ROOT / "2026 Data" / "DataStream Upload Template 2.14-RAEON-2026-Field-LEVSN-YSI-Only.xlsb"
BASE = "appVBC2SUwFcom2p5"
YEAR = 2026
ORG = "University of Windsor"
NAME = "Station Name (from station_id)"

# Windsor's old ID -> their 2026 ID. Confirmed same site at 0 m in every case.
RENAMES = {"LR1": "LilRiv_1", "LR2": "LilRiv_2", "CB": "CedBea_1", "HC1": "HillMar_1"}

# The only basins assignable without guesswork: anchored by an existing Windsor
# station at the same site, or an exact waterbody name match.
BASINS = {
    "LilRiv_1": "Detroit River", "LilRiv_2": "Detroit River", "LilRiv_3": "Detroit River",
    "CedBea_1": "Cedar Creek", "CedCre_1": "Cedar Creek",
    "HillMar_2": "Hillman Creek", "DetRiv_1": "Detroit River",
}

# Every Windsor station already in Airtable carries these, and the station
# report confirms Warm for all six.
DEFAULTS = {"Temp Regime Name": "Warm", "Ecoregion (from station_id) 2": "HELP",
            "StreamSize (from station_id) 2": "Streams"}

CHARS = {"Temp": "Water Temperature", "Conduc.": "Conductivity",
         "pH": "pH", "DO_mgL": "Dissolved Oxygen"}
PLAUSIBLE = {"Dissolved Oxygen": (0, 25), "pH": (3.5, 11),
             "Water Temperature": (-1, 40), "Conductivity": (1, 50000)}

tok = re.search(r"pat[A-Za-z0-9.]+", (ROOT / "Token" / "::LEVSN Airtable Token").read_text()).group(0)
H = {"Authorization": "Bearer " + tok, "Content-Type": "application/json"}


def api(method, table, path="", data=None, **q):
    u = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote(table)}{path}"
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


def read_source():
    from pyxlsb import open_workbook
    wb = open_workbook(str(SRC))
    with wb.get_sheet("Locations-Sites") as sh:
        loc = [[c.v for c in r] for r in sh.rows()]
    with wb.get_sheet("Results-Résultats") as sh:
        res = [[c.v for c in r] for r in sh.rows()][1:]
    sites = {r[0]: {"name": r[1], "lat": r[2], "lon": r[3], "type": r[5]}
             for r in loc[1:] if r and r[0]}
    serial = lambda v: (datetime.date(1899, 12, 30) + datetime.timedelta(days=float(v))).isoformat()
    samples = collections.defaultdict(dict)
    for r in res:
        if not r or not r[0] or r[1] not in CHARS: continue
        try: samples[(r[0], serial(r[2]))][CHARS[r[1]]] = float(r[10])
        except (TypeError, ValueError): continue
    return sites, samples


print("Reading source...")
sites, samples = read_source()
print(f"  {len(sites)} sites in template, {len(samples)} samples across "
      f"{len({k[0] for k in samples})} sites with readings")

print("Loading Airtable...")
stations = fetch("Stations")
by_id = {}
for r in stations:
    sid = (r["fields"].get("station_id") or "").strip()
    if sid: by_id.setdefault(sid, r)
basins = {r["fields"].get("Basin Name"): r["id"] for r in fetch("Basins") if r["fields"].get("Basin Name")}
thresholds = {}
for r in fetch("Temperature Regimes"):
    f = r["fields"]
    if f.get("Temp Regime") and f.get("Month") is not None:
        thresholds[(f["Temp Regime"], int(f["Month"]))] = f["Temperature Threshold"]
existing_2026 = set()
for r in fetch("LEVSN Samples", filterByFormula=f"{{Sample Run Year}}={YEAR}"):
    L = r["fields"].get("station_id") or []
    if L: existing_2026.add((L[0], (r["fields"].get("collection_date") or "")[:10]))

missing_basin = sorted({b for b in BASINS.values() if b not in basins})
if missing_basin: sys.exit(f"ABORT: basins not in Airtable: {missing_basin}")

# ---- plan ------------------------------------------------------------------
renames = []
for old, new in RENAMES.items():
    rec = by_id.get(old)
    if not rec:
        print(f"  note: {old} not found, nothing to rename")
        continue
    if new in by_id and by_id[new]["id"] != rec["id"]:
        sys.exit(f"ABORT: {new} already exists separately; renaming {old} would collide")
    s = sites.get(new)
    fields = {"station_id": new}
    if s and s["name"] and (rec["fields"].get(NAME) or "").strip() != str(s["name"]).strip():
        fields[NAME] = str(s["name"]).strip()
    renames.append({"id": rec["id"], "fields": fields,
                    "_from": f"{old} ({rec['fields'].get(NAME)})", "_to": f"{new} ({fields.get(NAME, rec['fields'].get(NAME))})"})

effective = dict(by_id)
for old, new in RENAMES.items():
    if old in effective: effective[new] = effective.pop(old)

needed = sorted({k[0] for k in samples})
creates_st = []
for sid in needed:
    if sid in effective: continue
    s = sites.get(sid)
    if not s: sys.exit(f"ABORT: {sid} has readings but no row in Locations-Sites")
    f = {"station_id": sid, NAME: str(s["name"]).strip(),
         "Latitude (from station_id)": float(s["lat"]), "Longitude (from station_id)": float(s["lon"]),
         "Monitoring Location Type": s["type"], "Organization (from station_id)": ORG, **DEFAULTS}
    if sid in BASINS: f["Basin"] = [basins[BASINS[sid]]]
    creates_st.append({"_sid": sid, "fields": f})

print()
print(f"STATIONS TO RENAME : {len(renames)}")
for r in renames: print(f"   {r['_from']:40} -> {r['_to']}")
print()
print(f"STATIONS TO CREATE : {len(creates_st)}")
with_basin = sum(1 for c in creates_st if "Basin" in c["fields"])
print(f"   with a basin assigned : {with_basin}")
print(f"   basin left unset      : {len(creates_st) - with_basin}  (pending Windsor station report)")
print()

flags = []
for (sid, date), vals in samples.items():
    for fld, (lo, hi) in PLAUSIBLE.items():
        v = vals.get(fld)
        if v is not None and not (lo <= v <= hi):
            flags.append((sid, date, fld, v))

# Count what would actually be written, not what the file holds: a station
# already carrying a reading for that date is skipped, so a re-run creates
# nothing. Reporting the file's row count here would imply it duplicates.
planned = {k: v for k, v in samples.items()
           if (effective[k[0]]["id"] if k[0] in effective else None, k[1]) not in existing_2026}
already = len(samples) - len(planned)
print(f"SAMPLES TO CREATE : {len(planned)}")
if already:
    print(f"   already in Airtable, skipped : {already}")
cov = collections.Counter()
for v in planned.values():
    for f in v: cov[f] += 1
for f, n in cov.most_common(): print(f"   {f:20} {n}/{len(planned)}")
print()
print(f"IMPLAUSIBLE VALUES FLAGGED : {len(flags)}")
for sid, date, fld, v in flags: print(f"   {sid:14} {date}  {fld:18} {v}")

if "--write" not in sys.argv:
    print("\nDRY RUN - nothing written. Re-run with --write to apply.")
    sys.exit()

print("\nWriting...")
for i in range(0, len(renames), 10):
    b = [{"id": r["id"], "fields": r["fields"]} for r in renames[i:i + 10]]
    api("PATCH", "Stations", data={"records": b})
    print(f"  renamed {i + len(b)}/{len(renames)}")

made = {}
for i in range(0, len(creates_st), 10):
    b = creates_st[i:i + 10]
    out = api("POST", "Stations", data={"records": [{"fields": c["fields"]} for c in b]})
    for c, rec in zip(b, out["records"]): made[c["_sid"]] = rec["id"]
    print(f"  created stations {i + len(b)}/{len(creates_st)}")

lookup = {sid: rec["id"] for sid, rec in effective.items()}
lookup.update(made)

rows = []
for (sid, date), vals in sorted(samples.items()):
    rec = lookup.get(sid)
    if not rec: sys.exit(f"ABORT: no station record for {sid}")
    if (rec, date) in existing_2026:
        continue
    f = {"station_id": [rec], "Sample Run Year": YEAR, "collection_date": date}
    b = BASINS.get(sid)
    if b: f["Basin-Sample"] = [basins[b]]
    for k, v in vals.items(): f[k] = round(v, 2)
    if vals.get("Conductivity") is not None:
        f["ConductivityBiocondition"] = round(vals["Conductivity"], 2)
    wt = vals.get("Water Temperature")
    th = thresholds.get(("Warm", int(date[5:7])))
    if wt and th is not None: f["Water Temp_Ex"] = 1 if wt >= th else 0
    rows.append(f)

for i in range(0, len(rows), 10):
    b = rows[i:i + 10]
    api("POST", "LEVSN Samples", data={"records": [{"fields": x} for x in b]})
    print(f"  created samples {i + len(b)}/{len(rows)}")
print(f"\nDone. Renamed {len(renames)}, created {len(creates_st)} stations and {len(rows)} samples.")
