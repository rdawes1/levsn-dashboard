"""Top up the 2026 Summit run from Sarah Barrow's complete export (3 Nov 2026).

The export we first imported (Summit-11-5-Readings.csv) held 457 of the 2026
readings across 27 stations. Sarah's full export holds 647 rows across 36,
adding eight stations that had no 2026 data at all and a Chloride column the
first export did not carry.

This script does two things, and only ever adds:
  * creates the sample rows that are not in Airtable yet
  * fills Chloride on the rows that are there but lack it

Rows whose `key` AND every reading are identical are true duplicate lines in
the export and are collapsed to one. Rows that share a `key` but carry
different readings and times are two distinct samples; Water Reporter has
given them one key, which is a fault at source, but the readings themselves
are real and both are kept.

Dry run by default; pass --write to apply.
"""
import collections, csv, json, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("/Users/robertdawes/Desktop/Lake Erie Volunteer Science Network")
SRC = Path("/Users/robertdawes/Downloads/UaDKbgd2jxoE.10811--2026-11-03.182543.csv")
BASE = "appVBC2SUwFcom2p5"
YEAR = 2026
NAME = "Station Name (from station_id)"

# Sarah's export column -> Airtable field
FIELDS = {"conductivity": "Conductivity", "dissolved_oxygen": "Dissolved Oxygen",
          "temperature": "Water Temperature", "ph": "pH", "Chloride ppm": "Chloride"}
PLAUSIBLE = {"Dissolved Oxygen": (0, 25), "pH": (3.5, 11), "Water Temperature": (-1, 40),
             "Conductivity": (1, 50000), "Chloride": (0, 5000)}

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


print("Loading Airtable...")
stations = fetch("Stations")
st = {}
for r in stations:
    f = r["fields"]
    sid = (f.get("station_id") or "").strip()
    if sid:
        st.setdefault(sid, {"rec": r["id"], "name": (f.get(NAME) or "").strip(),
                            "org": f.get("Organization (from station_id)"),
                            "basin": (f.get("Basin") or [None])[0],
                            "regime": f.get("Temp Regime Name")})
thresholds = {}
for r in fetch("Temperature Regimes"):
    f = r["fields"]
    if f.get("Temp Regime") and f.get("Month") is not None:
        thresholds[(f["Temp Regime"], int(f["Month"]))] = f["Temperature Threshold"]

rec2sid = {v["rec"]: k for k, v in st.items()}
src = list(csv.DictReader(SRC.open()))
src_sids = {r["station_id"] for r in src}

existing = collections.defaultdict(list)
for r in fetch("LEVSN Samples", filterByFormula=f"{{Sample Run Year}}={YEAR}"):
    f = r["fields"]
    L = f.get("station_id") or []
    sid = rec2sid.get(L[0]) if L else None
    if sid in src_sids:
        existing[(sid, (f.get("collection_date") or "")[:10])].append(r)

# Collapse rows that are byte-identical duplicates of one another.
groups = collections.defaultdict(list)
for r in src:
    groups[(r["station_id"], r["collection_date"][:10])].append(r)

creates, updates, dupes, flags, no_station = [], [], [], [], []

for (sid, date), rws in sorted(groups.items()):
    seen = set()
    uniq = []
    for r in rws:
        sig = (r.get("key"), r["conductivity"], r["dissolved_oxygen"], r["temperature"], r["ph"], r.get("Chloride ppm"))
        if sig in seen:
            dupes.append((sid, date))
            continue
        seen.add(sig)
        uniq.append(r)

    info = st.get(sid)
    if not info:
        no_station.extend((sid, date, r) for r in uniq)
        continue

    pool = list(existing.get((sid, date), []))
    for r in uniq:
        vals = {tgt: num(r.get(col)) for col, tgt in FIELDS.items()}
        if all(v is None for v in vals.values()):
            continue
        for fld, (lo, hi) in PLAUSIBLE.items():
            v = vals.get(fld)
            if v is not None and not (lo <= v <= hi):
                flags.append((sid, date, fld, v))

        # Pair with the closest Airtable row for this station+date, if any.
        def cost(rec):
            af = rec["fields"]
            return sum(abs(round(v, 2) - af[t]) for t, v in vals.items()
                       if v is not None and af.get(t) is not None)
        match = min(pool, key=cost) if pool else None
        if match is not None:
            pool.remove(match)
            cl = vals.get("Chloride")
            if cl is not None and match["fields"].get("Chloride") is None:
                updates.append({"id": match["id"], "fields": {"Chloride": round(cl, 2)}})
            continue

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
        if wt and th is not None:
            fields["Water Temp_Ex"] = 1 if wt >= th else 0
        creates.append({"_sid": sid, "_org": info["org"], "fields": fields})

print()
print("=" * 70)
print(f"ROWS TO CREATE : {len(creates)}")
for s, n in collections.Counter(c["_sid"] for c in creates).most_common():
    print(f"   {s:8} {n:4}   ({st[s]['org']})")
print()
print(f"CHLORIDE BACKFILLS ON EXISTING ROWS : {len(updates)}")
print(f"TRUE DUPLICATE LINES COLLAPSED      : {len(dupes)}")
print(f"ROWS AT STATIONS NOT IN AIRTABLE    : {len(no_station)}  {sorted({s for s,_,_ in no_station})}")
print(f"IMPLAUSIBLE VALUES FLAGGED          : {len(flags)}")
for sid, date, fld, v in flags:
    print(f"   {sid:8} {date}  {fld:18} {v}")

if "--write" not in sys.argv:
    print("\nDRY RUN - nothing written. Re-run with --write to apply.")
    sys.exit()

print("\nWriting...")
for i in range(0, len(creates), 10):
    b = creates[i:i + 10]
    body = json.dumps({"records": [{"fields": c["fields"]} for c in b]}).encode()
    u = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote('LEVSN Samples')}"
    json.load(urllib.request.urlopen(urllib.request.Request(u, data=body, headers=H, method="POST")))
    print(f"  created {i + len(b)}/{len(creates)}")
for i in range(0, len(updates), 10):
    b = updates[i:i + 10]
    body = json.dumps({"records": b}).encode()
    u = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote('LEVSN Samples')}"
    json.load(urllib.request.urlopen(urllib.request.Request(u, data=body, headers=H, method="PATCH")))
    print(f"  chloride {i + len(b)}/{len(updates)}")
print(f"\nDone. Created {len(creates)}, backfilled Chloride on {len(updates)}.")
