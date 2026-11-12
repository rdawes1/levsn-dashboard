"""Import the Partners for Clean Streams 2026 readings (export of 12 Nov 2026).

PCS had no 2026 data at all; this is the largest gap in the season. The export
is Water Reporter's wide format and carries 2023-2025 rows that are already in
Airtable. ONLY 2026 rows are written - every earlier year is left untouched.

The column mapping was verified, not assumed: the 2025 rows in this same file
were compared against the values already stored, and match exactly.
`Temperature, water [p:3518]` (the header contains a newline) -> Water
Temperature, `Dissolved oxygen (DO) [p:3517]` -> Dissolved Oxygen in mg/L.
`Dissolved Oxygen Saturation [p:3514]` is a percentage and is NOT a LEVSN
parameter - but it is what makes the corrections below provable.

The export also contains DEF-1 and DEF-2 rows, which are Defiance SWCD's
stations, and one row with a blank station_id. All are pre-2026 and so fall
outside this import; the station guard would reject them regardless.

CORRECTIONS (approved by John, 12 Nov 2026; to be confirmed with PCS)

  Eight July temperatures were recorded in Fahrenheit. The meter's own DO
  saturation column proves it: read as Fahrenheit each one reproduces the
  recorded saturation to within 0.9 of a percentage point, while read as
  Celsius they imply 215-549% saturation. Each is converted only when the
  value in the file still matches the value audited, so a corrected or
  changed export will not be silently converted again.

  CWAT-26 on 2026-10-07 recorded dissolved oxygen of 89.2 mg/L at 16.7 C and
  92.0% saturation, which works out at 8.95 mg/L - a misplaced decimal for
  8.92. Corrected likewise, and guarded the same way.

NOT corrected: three near-zero conductivity readings (CWAT-9 5.39, CWAT-20
9.40, CWAT-11 12.40, the last with the volunteer's own note "spc off"). They
are certainly wrong for an urban Toledo stream with a median of 675 uS/cm, but
nothing in the file reconstructs the true value, so they go in as recorded and
are raised with PCS. They will drag the derived Salinity and TDS down with
them on those three readings.

CHLORIDE: this export has no chloride column, so none is written. The
2023-2025 PCS rows hold a chloride derived from conductivity; the programme's
position is that chloride should be measured by volunteers rather than
derived, so no derived value is invented here.

Dry run by default; pass --write to apply. Re-running creates nothing.
"""
import collections, csv, json, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network")
SRC = ROOT / "2026 Data" / "PartnersforCleanStreams-11-12-26.csv"
BASE = "appVBC2SUwFcom2p5"
YEAR = 2026
ORG = "Partners for Clean Streams"

FIELDS = {"Temperature, water [p:3518]": "Water Temperature",
          "Conductivity [p:3516]": "Conductivity",
          "Dissolved oxygen (DO) [p:3517]": "Dissolved Oxygen",
          "pH [p:3515]": "pH"}
PLAUSIBLE = {"Dissolved Oxygen": (0, 25), "pH": (3.5, 11),
             "Water Temperature": (-1, 40), "Conductivity": (1, 50000)}

# (station, date) -> the Fahrenheit value as it appears in the file.
FAHRENHEIT = {("CWAT-11", "2026-07-14"): 85.7, ("CWAT-20", "2026-07-14"): 88.3,
              ("CWAT-5",  "2026-07-14"): 87.9, ("CWAT-10", "2026-07-14"): 87.2,
              ("CWAT-10", "2026-07-24"): 77.6, ("CWAT-11", "2026-07-24"): 77.8,
              ("CWAT-20", "2026-07-24"): 73.6, ("CWAT-5",  "2026-07-24"): 75.5}
# (station, date) -> (recorded, corrected)
DO_FIX = {("CWAT-26", "2026-10-07"): (89.2, 8.92)}

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
other_years = sum(1 for r in csv.DictReader(SRC.open(encoding="utf-8-sig"))
                  if r["collection_date"][:4] != str(YEAR))
print(f"Source: {len(rows)} rows dated {YEAR}; {other_years} rows from other years ignored")

stations = fetch("Stations")
st = {}
for r in stations:
    f = r["fields"]
    sid = (f.get("station_id") or "").strip()
    if sid and f.get("Organization (from station_id)") == ORG:
        st.setdefault(sid, {"rec": r["id"], "basin": (f.get("Basin") or [None])[0],
                            "regime": f.get("Temp Regime Name"),
                            "lat": f.get("Latitude (from station_id)")})
thresholds = {}
for r in fetch("Temperature Regimes"):
    f = r["fields"]
    if f.get("Temp Regime") and f.get("Month") is not None:
        thresholds[(f["Temp Regime"], int(f["Month"]))] = f["Temperature Threshold"]

unknown = sorted({r["station_id"] for r in rows if r["station_id"] not in st})
if unknown:
    sys.exit(f"ABORT: {YEAR} rows reference stations that are not {ORG}'s: {unknown}")

# existing 2026 readings, so a re-run adds nothing
existing = collections.defaultdict(list)
for r in fetch("LEVSN Samples", filterByFormula=f"{{Sample Run Year}}={YEAR}"):
    f = r["fields"]
    L = f.get("station_id") or []
    if L: existing[(L[0], (f.get("collection_date") or "")[:10])].append(f)

planned, fixes, flags, skipped, empty = [], [], [], 0, 0
for r in sorted(rows, key=lambda r: (r["station_id"], r["collection_date"])):
    sid, date = r["station_id"], r["collection_date"][:10]
    vals = {t: num(r.get(c)) for c, t in FIELDS.items()}

    f_exp = FAHRENHEIT.get((sid, date))
    if f_exp is not None and vals["Water Temperature"] == f_exp:
        c = round((f_exp - 32) * 5 / 9, 2)
        fixes.append((sid, date, "Water Temperature", f_exp, c, "degF -> degC"))
        vals["Water Temperature"] = c
    d_exp = DO_FIX.get((sid, date))
    if d_exp is not None and vals["Dissolved Oxygen"] == d_exp[0]:
        fixes.append((sid, date, "Dissolved Oxygen", d_exp[0], d_exp[1], "decimal point"))
        vals["Dissolved Oxygen"] = d_exp[1]

    if all(v is None for v in vals.values()):
        empty += 1; continue
    for fld, (lo, hi) in PLAUSIBLE.items():
        v = vals.get(fld)
        if v is not None and not (lo <= v <= hi): flags.append((sid, date, fld, v))
    if any(all(abs(v - af[t]) <= 0.011 for t, v in vals.items()
               if v is not None and af.get(t) is not None)
           and any(af.get(t) is not None for t in vals)
           for af in existing.get((st[sid]["rec"], date), [])):
        skipped += 1; continue
    planned.append((sid, date, vals))

print(f"\nCORRECTIONS APPLIED : {len(fixes)}")
for sid, date, fld, was, now, why in fixes:
    print(f"   {sid:8} {date}  {fld:18} {was:>6} -> {now:<6} ({why})")
print(f"\nREADINGS TO CREATE : {len(planned)}")
if skipped: print(f"   already in Airtable, skipped : {skipped}")
if empty:   print(f"   no usable parameter, skipped : {empty}")
cov = collections.Counter()
for _, _, v in planned:
    for k, x in v.items():
        if x is not None: cov[k] += 1
for k, n in cov.most_common(): print(f"   {k:20} {n}/{len(planned)}")
print(f"\nSTATIONS : {len({p[0] for p in planned})}  "
      f"(no coordinates: {sorted(s for s in {p[0] for p in planned} if st[s]['lat'] is None) or 'none'})")
print(f"\nREMAINING IMPLAUSIBLE VALUES (imported as recorded, raise with PCS) : {len(flags)}")
for sid, date, fld, v in flags: print(f"   {sid:8} {date}  {fld:18} {v}")

# Conductivity near zero is impossible for these streams but cannot be
# reconstructed, so it is imported as recorded by decision. It falls inside the
# shared plausibility band, so it is called out separately rather than by
# narrowing a band every other importer uses.
low = sorted((sid, date, v["Conductivity"]) for sid, date, v in planned
             if v.get("Conductivity") is not None and v["Conductivity"] < 100)
print(f"\nCONDUCTIVITY BELOW 100 uS/cm (imported as recorded; drags Salinity and TDS with it) : {len(low)}")
for sid, date, v in low: print(f"   {sid:8} {date}  Conductivity       {v}")

if "--write" not in sys.argv:
    print("\nDRY RUN - nothing written. Re-run with --write to apply.")
    sys.exit()

out_rows = []
for sid, date, vals in planned:
    info = st[sid]
    f = {"station_id": [info["rec"]], "Sample Run Year": YEAR, "collection_date": date}
    if info["basin"]: f["Basin-Sample"] = [info["basin"]]
    for k, v in vals.items():
        if v is not None: f[k] = round(v, 2)
    if vals.get("Conductivity") is not None:
        f["ConductivityBiocondition"] = round(vals["Conductivity"], 2)
    wt = vals.get("Water Temperature")
    th = thresholds.get((info["regime"], int(date[5:7]))) if info["regime"] else None
    if wt and th is not None: f["Water Temp_Ex"] = 1 if wt >= th else 0
    out_rows.append(f)

print("\nWriting...")
for i in range(0, len(out_rows), 10):
    b = out_rows[i:i + 10]
    api("POST", "LEVSN Samples", data={"records": [{"fields": x} for x in b]})
    print(f"  created {i + len(b)}/{len(out_rows)}")
print(f"\nDone. Created {len(out_rows)} readings.")
