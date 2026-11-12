"""Correct StonyPoint_2 2026-08-31 dissolved oxygen.

Ed Miller (University of Windsor) checked the field sheet on 12 Nov 2026 after
we flagged the reading: the DO% saturation and DO mg/L columns were transposed
when the field sheet was typed into the spreadsheet. The true reading is
2.77 mg/L; 31.3 was the saturation percentage, which LEVSN does not record.

`Dissolved Oxygen_Ex` is an Airtable formula, so correcting the value is enough
for the exceedance to follow - and 2.77 is below the 5 mg/L warm-water
threshold, so this reading becomes an exceedance where 31.3 was not.

Matched on the record id AND the current value, so a re-run after the fix, or
against a row someone has since edited, does nothing.

Dry run by default; pass --write to apply.
"""
import json, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network")
BASE = "appVBC2SUwFcom2p5"
TARGET = "recoY6T7Tyeymlk8G"
STATION, DATE, WAS, NOW = "StonyPoint_2", "2026-08-31", 31.3, 2.77

tok = re.search(r"pat[A-Za-z0-9.]+", (ROOT/"Token"/"::LEVSN Airtable Token").read_text()).group(0)
H = {"Authorization": "Bearer " + tok, "Content-Type": "application/json"}

def api(method, table, path="", data=None):
    u = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote(table)}{path}"
    body = json.dumps(data).encode() if data is not None else None
    return json.load(urllib.request.urlopen(urllib.request.Request(u, data=body, headers=H, method=method)))

r = api("GET", "LEVSN Samples", f"/{TARGET}")
f = r["fields"]
if f.get("Dissolved Oxygen") != WAS:
    sys.exit(f"ABORT: DO reads {f.get('Dissolved Oxygen')!r}, expected {WAS} - already corrected, leaving it alone")
if (f.get("collection_date") or "")[:10] != DATE:
    sys.exit(f"ABORT: record {TARGET} is dated {f.get('collection_date')!r}, expected {DATE}")

print(f"{STATION}  {DATE}  record {TARGET}")
print(f"   Dissolved Oxygen     {WAS}  ->  {NOW} mg/L   (31.3 was DO% saturation)")
print(f"   Temp Regime          {f.get('Temp Regime')}")
print(f"   Dissolved Oxygen_Ex  {f.get('Dissolved Oxygen_Ex')}  -> expect 1  (formula: 2.77 <= 5 Warm)")
print("   unchanged: " + ", ".join(f"{k}={f[k]}" for k in ("Water Temperature", "Conductivity", "pH") if k in f))

if "--write" not in sys.argv:
    print("\nDRY RUN - nothing written. Re-run with --write to apply.")
    sys.exit()

api("PATCH", "LEVSN Samples", data={"records": [{"id": TARGET, "fields": {"Dissolved Oxygen": NOW}}]})
after = api("GET", "LEVSN Samples", f"/{TARGET}")["fields"]
print(f"\nWritten. Dissolved Oxygen = {after.get('Dissolved Oxygen')}, "
      f"Dissolved Oxygen_Ex = {after.get('Dissolved Oxygen_Ex')}")
