"""Backfill Huron River Watershed Council's 2026 chloride readings.

Background. HRWC's Water Reporter dataset defines four parameters - pH
[p:3544], Conductivity [p:3545], Dissolved oxygen [p:3546] and Temperature
water [p:3547]. It has no chloride parameter. When Angie Truelsen added a
chloride column to her upload spreadsheet and re-submitted on 16 Nov 2026,
Water Reporter accepted the file but dropped the column, because an upload
column only lands if a parameter of that name already exists on the dataset.
That is why chloride shows nowhere in Water Reporter's widget, and why our
6 Nov pull (2026 Data/Huron-11-6-Readings.csv) carries no chloride either.

Water Reporter has to add the parameter before the upload route will work.
In the meantime this script takes the values straight from her spreadsheet,
exactly as we did for Summit SWCD in import_2026_summit_topup.py.

Chloride is a plain number field in Airtable; Chloride_Ex is a formula
(> 150 mg/L) and fills itself in once the value lands.

Dry run by default; pass --write to apply.
"""
import collections, csv, json, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network")
SRC = ROOT / "2026 Data" / "HuronRiverWatershedCouncil-Chloride-11-23-26.csv"
BASE = "appVBC2SUwFcom2p5"
YEAR = 2026
ORG = "Huron River Watershed Council"
ORGF = "Organization (from station_id)"
PLAUSIBLE = (0, 5000)

# Columns that must agree with Airtable before we attach chloride to a row,
# so a value cannot land on the wrong visit.
CORROBORATE = {"conductivity": "Conductivity", "dissolved_oxygen": "Dissolved Oxygen",
               "ph": "pH", "temperature": "Water Temperature"}

tok = (ROOT / "Token" / "::LEVSN Airtable Token").read_text()
import re
tok = re.search(r"pat[A-Za-z0-9.]+", tok).group(0)
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


print("Loading Airtable...")
rec2sid, mine = {}, {}
for r in fetch("Stations"):
    f = r["fields"]
    sid = (f.get("station_id") or "").strip()
    rec2sid[r["id"]] = sid
    o = f.get(ORGF)
    o = o[0] if isinstance(o, list) and o else o
    if (o or "").strip() == ORG:
        mine[sid] = {"rec": r["id"], "basin": (f.get("Basin") or [None])[0]}
if not mine:
    sys.exit(f"STOPPING: no stations found for {ORG}. Nothing written.")

at = collections.defaultdict(list)
for r in fetch("LEVSN Samples", filterByFormula=f"{{Sample Run Year}}={YEAR}"):
    f = r["fields"]
    L = f.get("station_id") or []
    sid = rec2sid.get(L[0]) if L else None
    if sid in mine:
        at[(sid, (f.get("collection_date") or "")[:10])].append(r)

rows = [r for r in csv.DictReader(SRC.open()) if (r.get("station_id") or "").strip()]
updates, creates, already, flags, skipped = [], [], [], [], []

for r in rows:
    sid = r["station_id"].strip()
    date = r["collection_date"][:10]
    if sid not in mine:
        sys.exit(f"STOPPING: {sid} is not a {ORG} station in Airtable. Nothing written.")
    cl = num(r.get("chloride"))
    if cl is None:
        continue
    if not (PLAUSIBLE[0] <= cl <= PLAUSIBLE[1]):
        sys.exit(f"STOPPING: {sid} {date} chloride {cl} is outside "
                 f"{PLAUSIBLE[0]}-{PLAUSIBLE[1]} mg/L. Nothing written.")

    # Chloride above about 0.30 x conductivity is more chloride than the
    # measured conductivity can physically carry, even as pure NaCl.
    cond = num(r.get("conductivity"))
    if cond and cl / cond > 0.30:
        flags.append((sid, date, f"chloride {cl} mg/L against conductivity {cond} uS/cm "
                                 f"(ratio {cl / cond:.2f}; above ~0.30 is not physically possible)"))

    pool = at.get((sid, date), [])
    # Narrow a date with more than one visit by the readings taken alongside.
    if len(pool) > 1:
        pool = [x for x in pool
                if all(num(r.get(c)) is None or x["fields"].get(t) is None
                       or abs(x["fields"][t] - num(r.get(c))) <= 0.011
                       for c, t in CORROBORATE.items())]
    if len(pool) > 1:
        sys.exit(f"STOPPING: {sid} {date} matches {len(pool)} Airtable rows. Nothing written.")

    if not pool:
        # A visit whose instrument readings were all blank, so no row was ever
        # created, but where a chloride strip was still read.
        fields = {"station_id": [mine[sid]["rec"]], "Sample Run Year": YEAR,
                  "collection_date": date, "Chloride": round(cl, 2)}
        if mine[sid]["basin"]:
            fields["Basin-Sample"] = [mine[sid]["basin"]]
        creates.append({"_sid": sid, "_date": date, "fields": fields})
        continue

    rec = pool[0]
    # Every reading we can compare must agree, or this is not the same visit.
    for c, t in CORROBORATE.items():
        v, a = num(r.get(c)), rec["fields"].get(t)
        if v is not None and a is not None and abs(a - v) > 0.011:
            sys.exit(f"STOPPING: {sid} {date} {t} is {a} in Airtable but {v} in the "
                     f"spreadsheet. Nothing written.")
    have = rec["fields"].get("Chloride")
    if have is not None:
        if abs(have - cl) <= 0.011:
            already.append((sid, date))
        else:
            skipped.append((sid, date, have, cl))
        continue
    updates.append({"id": rec["id"], "fields": {"Chloride": round(cl, 2)}})

print()
print("=" * 72)
print(f"CHLORIDE VALUES TO WRITE  : {len(updates)}")
print(f"ROWS TO CREATE            : {len(creates)}   (visit had no instrument readings)")
for c in creates:
    print(f"   {c['_sid']:8} {c['_date']}  chloride={c['fields']['Chloride']}")
print(f"ALREADY CORRECT, SKIPPED  : {len(already)}")
print(f"DIFFERENT VALUE IN AIRTABLE, LEFT ALONE : {len(skipped)}")
for sid, date, have, cl in skipped:
    print(f"   {sid:8} {date}  Airtable {have}  spreadsheet {cl}")
print(f"READINGS FLAGGED FOR HRWC : {len(flags)}")
for sid, date, msg in flags:
    print(f"   {sid:8} {date}  {msg}")

if "--write" not in sys.argv:
    print("\nDRY RUN - nothing written. Re-run with --write to apply.")
    sys.exit()

print("\nWriting...")
u = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote('LEVSN Samples')}"
for i in range(0, len(updates), 10):
    b = updates[i:i + 10]
    body = json.dumps({"records": b}).encode()
    json.load(urllib.request.urlopen(urllib.request.Request(u, data=body, headers=H, method="PATCH")))
    print(f"  chloride {i + len(b)}/{len(updates)}")
for i in range(0, len(creates), 10):
    b = creates[i:i + 10]
    body = json.dumps({"records": [{"fields": c["fields"]} for c in b]}).encode()
    json.load(urllib.request.urlopen(urllib.request.Request(u, data=body, headers=H, method="POST")))
    print(f"  created {i + len(b)}/{len(creates)}")
print(f"\nDone. Set Chloride on {len(updates)}, created {len(creates)}.")
