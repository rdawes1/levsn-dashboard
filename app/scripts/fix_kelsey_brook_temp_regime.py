"""Kelsey Brook (KB1) is a warmwater stream, not coldwater.

Cuyahoga Falls' 2026 LEBAF station report gives Kelsey Brook's aquatic habitat
type as Cold, and that is what the Stations table carried. Sarah Barrow checked
with the group on 12 Nov 2026 and confirmed it is a WARMWATER stream - almost
certainly a dropdown slip on the station report.

It matters, because the regime drives two exceedance rules:

  * Water temperature, against a month-by-month threshold. Under Cold, all five
    2026 readings (18.2-24.2 C) exceeded, so the site read as 100% temperature
    exceedance. Under Warm none do.
  * Dissolved oxygen, which exceeds at <= 5 mg/L for Warm and <= 7 mg/L for
    Cold. Two readings of 6.9 mg/L exceeded under Cold; neither does under Warm.

`Dissolved Oxygen_Ex` is an Airtable formula reading the regime through the
station link, so it corrects itself. `Water Temp_Ex` is a plain number written
by the importer, so it is recomputed here.

Dry run by default; pass --write to apply.
"""
import json, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network")
BASE = "appVBC2SUwFcom2p5"
STATION, WAS, NOW = "KB1", "Cold", "Warm"

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


def patch(table, records):
    u = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote(table)}"
    for i in range(0, len(records), 10):
        json.load(urllib.request.urlopen(urllib.request.Request(
            u, data=json.dumps({"records": records[i:i + 10]}).encode(),
            headers=H, method="PATCH")))


print("Loading Airtable...")
station = next((r for r in fetch("Stations")
                if (r["fields"].get("station_id") or "").strip() == STATION), None)
if station is None:
    sys.exit(f"no station {STATION}")

current = station["fields"].get("Temp Regime Name")
if current != WAS:
    sys.exit(f"{STATION} regime is {current!r}, expected {WAS!r} - already changed? Nothing done.")

thresholds = {}
for r in fetch("Temperature Regimes"):
    f = r["fields"]
    if f.get("Temp Regime") and f.get("Month") is not None:
        thresholds[(f["Temp Regime"], int(f["Month"]))] = f["Temperature Threshold"]

samples = [r for r in fetch("LEVSN Samples")
           if (r["fields"].get("station_id") or [None])[0] == station["id"]]

updates = []
print(f"\n{STATION} ({station['fields'].get('Station Name (from station_id)')}): "
      f"{WAS} -> {NOW}\n")
print(f"{'DATE':12}{'TEMP':>7}{'DO':>7}  {'OLD THR':>8}{'OLD EX':>8}   {'NEW THR':>8}{'NEW EX':>8}   DO_EX")
for r in sorted(samples, key=lambda r: r["fields"].get("collection_date") or ""):
    f = r["fields"]
    date = (f.get("collection_date") or "")[:10]
    wt, do = f.get("Water Temperature"), f.get("Dissolved Oxygen")
    if not date or wt is None:
        continue
    m = int(date[5:7])
    old_th, new_th = thresholds.get((WAS, m)), thresholds.get((NOW, m))
    old_ex = f.get("Water Temp_Ex")
    new_ex = 1 if (new_th is not None and wt >= new_th) else 0
    do_ex = "-" if do is None else ("5->0" if do <= 7 and do > 5 else "unchanged")
    print(f"{date:12}{wt:>7}{str(do):>7}  {str(old_th):>8}{str(old_ex):>8}   "
          f"{str(new_th):>8}{new_ex:>8}   {do_ex}")
    if old_ex != new_ex:
        updates.append({"id": r["id"], "fields": {"Water Temp_Ex": new_ex}})

print(f"\nWATER TEMP EXCEEDANCE FLAGS TO CHANGE : {len(updates)} of {len(samples)}")
print("Dissolved Oxygen_Ex is an Airtable formula and recomputes itself.")

if "--write" not in sys.argv:
    print("\nDRY RUN - nothing written. Re-run with --write to apply.")
    sys.exit()

patch("Stations", [{"id": station["id"], "fields": {"Temp Regime Name": NOW}}])
print(f"\n  {STATION} regime set to {NOW}")
if updates:
    patch("LEVSN Samples", updates)
    print(f"  {len(updates)} water temperature flags cleared")
print("\nDone.")
