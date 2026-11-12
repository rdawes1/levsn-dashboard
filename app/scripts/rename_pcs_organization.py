"""Rename the Toledo partner to "Partners for Clean Streams".

The 31 Toledo stations carried the organisation name "Community Water Action
Toledo", which matched nothing else: their station IDs are CWAT-*, their LEBAF
station report is filed as "Clean Water Action Toledo (CWAT)", and the logo the
dashboard has always shown for them is Partners for Clean Streams. The group
refers to the programme as Partners for Clean Streams, so that is the name the
dashboard uses (confirmed by John, 12 Nov 2026).

Airtable's Meta API will neither rename nor add a singleSelect choice here -
every shape of PATCH on `options.choices` comes back 422 "Changing a field's
type or number precision is not currently supported". The record API's
`typecast` flag is the way through: writing a value that does not exist yet
creates the choice and assigns it in one call.

The old choice is left behind, unused. The dashboard builds its organisation
list from record values rather than from the schema, so an unused choice is
invisible there; delete it by hand in Airtable whenever convenient.

Dry run by default; pass --write to apply. Re-running does nothing.
"""
import json, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network")
BASE = "appVBC2SUwFcom2p5"
OLD, NEW = "Community Water Action Toledo", "Partners for Clean Streams"

tok = re.search(r"pat[A-Za-z0-9.]+", (ROOT/"Token"/"::LEVSN Airtable Token").read_text()).group(0)
H = {"Authorization": "Bearer " + tok, "Content-Type": "application/json"}

def req(method, url, data=None):
    body = json.dumps(data).encode() if data is not None else None
    return json.load(urllib.request.urlopen(urllib.request.Request(url, data=body, headers=H, method=method)))

def fetch(table):
    out, off = [], None
    while True:
        q = {"pageSize": 100} | ({"offset": off} if off else {})
        d = req("GET", f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote(table)}?{urllib.parse.urlencode(q)}")
        out += d["records"]; off = d.get("offset")
        if not off: return out

movers = [r for r in fetch("Stations") if r["fields"].get("Organization (from station_id)") == OLD]
sample_movers = [r for r in fetch("LEVSN Samples") if r["fields"].get("Sample Organization") == OLD]
print(f"STATIONS TO MOVE  : {len(movers)}   {sorted((r['fields'].get('station_id') or '') for r in movers)[:5]} ...")
print(f"READINGS TO MOVE  : {len(sample_movers)}  (per-reading credits; expected 0)")

if "--write" not in sys.argv:
    print("\nDRY RUN - nothing written. Re-run with --write to apply.")
    sys.exit()

for table, recs, field in (("Stations", movers, "Organization (from station_id)"),
                           ("LEVSN Samples", sample_movers, "Sample Organization")):
    for i in range(0, len(recs), 10):
        b = [{"id": r["id"], "fields": {field: NEW}} for r in recs[i:i + 10]]
        # typecast creates the choice on first write; see the note above.
        req("PATCH", f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote(table)}",
            {"records": b, "typecast": True})
        print(f"  {table}: moved {i + len(b)}/{len(recs)}")

left = [r for r in fetch("Stations") if r["fields"].get("Organization (from station_id)") == OLD]
now = [r for r in fetch("Stations") if r["fields"].get("Organization (from station_id)") == NEW]
print(f"\nVerify: {len(now)} stations now {NEW!r}; {len(left)} still {OLD!r}")
