"""
Import the 2026 sampling run into the LEVSN Airtable base.

    python3 app/scripts/import_2026.py            # dry run: writes nothing
    python3 app/scripts/import_2026.py --write    # create the records

Reads the per-organisation exports in "2026 Data", keeps only readings dated
2026, matches each to a station already in Airtable, and builds LEVSN Samples
records. A dry run writes a full preview CSV so every row can be checked before
anything is created.

Decisions behind this script (agreed 5 Nov 2026):

  * Only stations already in Airtable are imported. Buffalo Niagara's export
    covers their whole monitoring programme (77 stations in 2026); the 64 that
    are not LEVSN sites are skipped and listed in the preview.
  * ConductivityBiocondition is set equal to Conductivity. Airtable computes
    Salinity - a parameter the dashboard shows - from Biocondition, not from
    Conductivity, and the two are identical in all 1,585 of the 2025 samples.
  * Water Temp_Ex is computed with the same rule as the base's own Airtable
    script: match collection_month + Temp Regime in Temperature Regimes, then
    1 when waterTemp >= threshold, else 0. Blank temperature, or no matching
    regime row, leaves it unset, exactly as the script does.
  * River Raisin's workbook is monthly, so each reading is dated the 15th;
    temperatures are Fahrenheit and converted; SPEC is used as Conductivity.

Everything else Airtable computes itself: TDS, Salinity, and every other
exceedance flag are formulas and must not be written.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "2026 Data"
OUT = Path("/tmp/claude-501")

BASE = "appVBC2SUwFcom2p5"
T_STATIONS = "tblmIktd5JMIUhbK2"
T_SAMPLES = "tblWxcml55EzTJBrf"
T_REGIMES = "tbltItKylK7eTtjoq"

YEAR = 2026

# Columns to read from each export. Keys are the Airtable field to populate;
# values are the column name as it appears before " [p:...]" in that file.
# Doan Brook has two "Dissolved Oxygen" columns, so its DO is pinned by full
# header - only [p:4068] carries 2026 values.
SOURCES: dict[str, dict] = {
    "BuffaloNiagra-11-5-Readings.csv": {
        "org": "Buffalo Niagara Waterkeeper",
        "map": {
            "Conductivity": "Conductivity",
            "Dissolved Oxygen": "Dissolved Oxygen (mg/L)",
            "Water Temperature": "Temperature",
            "pH": "pH",
        },
    },
    "ClintonRiver-11-5-Readings.csv": {
        "org": "Clinton River Watershed Council",
        "map": {
            "Conductivity": "Conductivity",
            "Dissolved Oxygen": "Do",
            "Water Temperature": "Water temp",
            "pH": "Ph",
            "Chloride": "Chloride",
        },
    },
    "Defiance-11-5-Readings.csv": {
        "org": "Defiance Soil & Water Conservation District",
        "map": {
            "Conductivity": "Conductivity",
            "Dissolved Oxygen": "Do",
            "Water Temperature": "Water temperature",
            "pH": "Ph",
        },
    },
    "DoanBrook-11-6-Readings.csv": {
        "org": "Doan Brook Watershed Partnership",
        "map": {
            "Conductivity": "SPC",
            "Dissolved Oxygen": "Dissolved Oxygen [p:4068]",
            "Water Temperature": "Water Temperature",
            "pH": "pH",
        },
    },
    "Firelands-11-6-Readings.csv": {
        "org": "Erie Soil and Water Conservation District",
        "map": {
            "Conductivity": "Conductivity",
            "Dissolved Oxygen": "Dissolved Oxygen",
            "Water Temperature": "Temperature",
            "pH": "pH",
        },
    },
    "Huron-11-6-Readings.csv": {
        "org": "Huron River Watershed Council",
        "map": {
            "Conductivity": "Conductivity",
            "Dissolved Oxygen": "Dissolved oxygen (DO)",
            "Water Temperature": "Temperature, water",
            "pH": "pH",
        },
    },
    "Summit-11-5-Readings.csv": {
        "org": "Summit Soil and Water Conservation District",
        "map": {
            "Conductivity": "Conductivity",
            "Dissolved Oxygen": "Dissolved oxygen (DO)",
            "Water Temperature": "Temperature, water",
            "pH": "pH",
        },
    },
    "TinkersCreek-11-5-Readings.csv": {
        "org": "Tinkers Creek Watershed Partners",
        "map": {
            "Conductivity": "Conductivity",
            "Dissolved Oxygen": "Dissolved oxygen (DO)",
            "Water Temperature": "Temperature, water",
            "pH": "pH",
        },
    },
}

RIVER_RAISIN = "RiverRaisin-11-5-Readings.xlsx"
MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "april": 4, "apr": 4, "may": 5, "june": 6,
    "jun": 6, "july": 7, "jul": 7, "aug": 8, "sept": 9, "sep": 9, "oct": 10,
    "nov": 11, "dec": 12,
}

# Physically implausible readings, flagged in the preview rather than dropped.
PLAUSIBLE = {
    "Dissolved Oxygen": (0, 25),      # mg/L; saturation tops out around 15
    "pH": (3.5, 11),
    "Water Temperature": (-1, 40),    # Celsius
    "Conductivity": (1, 50000),       # uS/cm
    "Chloride": (0, 5000),            # mg/L
}


def norm(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").strip().lower())


def token() -> str:
    raw = (ROOT / "Token" / "::LEVSN Airtable Token").read_text()
    m = re.search(r"pat[A-Za-z0-9]{14}\.[A-Za-z0-9]{64}", raw)
    if not m:
        sys.exit("Could not find an Airtable token in Token/::LEVSN Airtable Token")
    return m.group(0)


def api(path: str, tok: str, method="GET", body=None):
    req = urllib.request.Request(
        f"https://api.airtable.com/v0/{path}",
        data=json.dumps(body).encode() if body else None,
        method=method,
        headers={
            "Authorization": f"Bearer {tok}",
            **({"Content-Type": "application/json"} if body else {}),
        },
    )
    return json.load(urllib.request.urlopen(req))


def fetch_all(table: str, tok: str) -> list[dict]:
    out, offset = [], None
    while True:
        q = {"pageSize": "100"}
        if offset:
            q["offset"] = offset
        page = api(f"{BASE}/{table}?{urllib.parse.urlencode(q)}", tok)
        out += page["records"]
        offset = page.get("offset")
        if not offset:
            return out
        time.sleep(0.22)


def num(v):
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f if f == f and abs(f) != float("inf") else None


def read_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def resolve(headers, wanted: str) -> str:
    """Find the one column matching `wanted`, by full header or by the name
    before ' [p:'. Ambiguity is a hard error rather than a silent guess."""
    if wanted in headers:
        return wanted
    hits = [h for h in headers if h.split(" [p:")[0].split(" [f:")[0].strip() == wanted]
    if len(hits) == 1:
        return hits[0]
    raise SystemExit(f"column {wanted!r} matched {len(hits)} headers: {hits}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="actually create records")
    args = ap.parse_args()

    tok = token()
    OUT.mkdir(parents=True, exist_ok=True)

    print("Loading Airtable...")
    stations = fetch_all(T_STATIONS, tok)
    regimes = fetch_all(T_REGIMES, tok)
    existing = fetch_all(T_SAMPLES, tok)

    already = sum(1 for r in existing if r["fields"].get("Sample Run Year") == YEAR)
    if already:
        print(f"\n!! Airtable already holds {already} samples for {YEAR}.")
        print("   Re-running would duplicate them. Stopping.")
        sys.exit(1)

    by_id, by_name = {}, {}
    for r in stations:
        f = r["fields"]
        info = {
            "rec": r["id"],
            "station_id": (f.get("station_id") or "").strip(),
            "name": (f.get("Station Name (from station_id)") or "").strip(),
            "org": f.get("Organization (from station_id)"),
            "basin": (f.get("Basin") or [None])[0],
            "regime": f.get("Temp Regime Name"),
        }
        if info["station_id"]:
            by_id.setdefault(norm(info["station_id"]), info)
        if info["name"]:
            by_name.setdefault(norm(info["name"]), info)

    thresholds = {}
    for r in regimes:
        f = r["fields"]
        if f.get("Temp Regime") and f.get("Month") is not None:
            thresholds[(f["Temp Regime"], int(f["Month"]))] = f["Temperature Threshold"]

    rows: list[dict] = []
    skipped: list[dict] = []
    flags: list[dict] = []

    def add(src, org, sid, sname, date, month, values):
        hit = by_id.get(norm(sid)) or by_name.get(norm(sname))
        if not hit:
            skipped.append({"source": src, "station_id": sid, "station_name": sname,
                            "date": date, "reason": "station not in Airtable"})
            return
        if not any(v is not None for v in values.values()):
            skipped.append({"source": src, "station_id": sid, "station_name": sname,
                            "date": date, "reason": "no usable parameter values"})
            return

        for field, (lo, hi) in PLAUSIBLE.items():
            v = values.get(field)
            if v is not None and not (lo <= v <= hi):
                flags.append({"source": src, "station_id": hit["station_id"], "date": date,
                              "field": field, "value": v,
                              "note": f"outside plausible range {lo}-{hi}"})

        fields = {
            "station_id": [hit["rec"]],
            "Sample Run Year": YEAR,
            "collection_date": date,
        }
        if hit["basin"]:
            fields["Basin-Sample"] = [hit["basin"]]
        # Every measurement field in Airtable stores 2 decimals; round here so
        # the stored value matches what is displayed (some exports carry
        # artefacts of unit conversion, e.g. 19.27777778).
        for field, v in values.items():
            if v is not None:
                fields[field] = round(v, 2)
        # Airtable computes Salinity and TDS from Biocondition, so mirror
        # Conductivity into it exactly as every prior year does.
        if values.get("Conductivity") is not None:
            fields["ConductivityBiocondition"] = round(values["Conductivity"], 2)

        wt = values.get("Water Temperature")
        th = thresholds.get((hit["regime"], month)) if hit["regime"] else None
        if wt and th is not None:
            fields["Water Temp_Ex"] = 1 if wt >= th else 0

        rows.append({"_src": src, "_org": org, "_sid": hit["station_id"],
                     "_name": hit["name"], "fields": fields})

    # ---- Water Reporter exports -------------------------------------------
    for fname, spec in SOURCES.items():
        path = DATA / fname
        if not path.exists():
            print(f"  !! missing {fname}")
            continue
        data = read_csv(path)
        if not data:
            continue
        cols = {k: resolve(data[0].keys(), v) for k, v in spec["map"].items()}
        kept = 0
        for r in data:
            date = str(r.get("collection_date") or "")[:10]
            if not date.startswith(str(YEAR)):
                continue
            kept += 1
            add(fname, spec["org"], (r.get("station_id") or "").strip(),
                (r.get("station_name") or "").strip(), date, int(date[5:7]),
                {k: num(r.get(c)) for k, c in cols.items()})
        print(f"  {fname:36} {kept:5} rows dated {YEAR}")

    # ---- River Raisin: months down, stations across ------------------------
    rr = DATA / RIVER_RAISIN
    if rr.exists():
        ws = openpyxl.load_workbook(rr, data_only=True)["2026"]
        starts = [c for c in range(1, ws.max_column + 1)
                  if isinstance(ws.cell(2, c).value, str) and ws.cell(2, c).value.strip()]
        blocks = []
        for i, c0 in enumerate(starts):
            c1 = starts[i + 1] - 1 if i + 1 < len(starts) else ws.max_column
            hdr = {str(ws.cell(3, c).value or "").strip(): c for c in range(c0, c1 + 1)}
            label = ws.cell(2, c0).value.strip()
            sid = label.replace("Test Site", "").strip()
            blocks.append((sid, hdr))
        kept = 0
        for r in range(4, ws.max_row + 1):
            mon = MONTHS.get(norm(ws.cell(r, 1).value)[:5]) or MONTHS.get(norm(ws.cell(r, 1).value))
            if not mon:
                continue
            for sid, hdr in blocks:
                def cell(name):
                    c = hdr.get(name)
                    return num(ws.cell(r, c).value) if c else None
                tempF = cell("Temp")
                vals = {
                    "Conductivity": cell("SPEC"),
                    "Dissolved Oxygen": cell("DO mg"),
                    # Fahrenheit in this workbook; everyone else reports Celsius.
                    "Water Temperature": (tempF - 32) * 5 / 9 if tempF is not None else None,
                    "pH": cell("PH"),
                }
                if not any(v is not None for v in vals.values()):
                    continue
                kept += 1
                # Monthly sheet with no collection dates; mid-month placeholder.
                add(RIVER_RAISIN, "River Raisin", sid, "", f"{YEAR}-{mon:02d}-15", mon, vals)
        print(f"  {RIVER_RAISIN:36} {kept:5} readings dated {YEAR}")

    # ---- preview -----------------------------------------------------------
    print(f"\n{'='*70}\nRECORDS TO CREATE: {len(rows)}")
    per_org = Counter(r["_org"] for r in rows)
    for org, n in per_org.most_common():
        print(f"   {n:5}  {org}")

    filled = Counter()
    for r in rows:
        for k in r["fields"]:
            filled[k] += 1
    print("\nfield coverage:")
    for k, n in filled.most_common():
        print(f"   {k:28} {n:5} / {len(rows)}")

    print(f"\nSKIPPED: {len(skipped)}")
    for reason, n in Counter(s["reason"] for s in skipped).most_common():
        print(f"   {n:5}  {reason}")

    print(f"\nIMPLAUSIBLE VALUES FLAGGED: {len(flags)}")
    for f in flags[:15]:
        print(f"   {f['station_id']:10} {f['date']}  {f['field']:20} {f['value']}")
    if len(flags) > 15:
        print(f"   ... and {len(flags)-15} more")

    with open(OUT / "import_2026_preview.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["source", "organization", "station_id", "station_name", "collection_date",
                    "Conductivity", "ConductivityBiocondition", "Dissolved Oxygen",
                    "Water Temperature", "Water Temp_Ex", "pH", "Chloride"])
        for r in rows:
            f = r["fields"]
            w.writerow([r["_src"], r["_org"], r["_sid"], r["_name"], f["collection_date"],
                        f.get("Conductivity"), f.get("ConductivityBiocondition"),
                        f.get("Dissolved Oxygen"), f.get("Water Temperature"),
                        f.get("Water Temp_Ex"), f.get("pH"), f.get("Chloride")])
    with open(OUT / "import_2026_skipped.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["source", "station_id", "station_name", "date", "reason"])
        w.writeheader()
        w.writerows(skipped)
    with open(OUT / "import_2026_flags.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["source", "station_id", "date", "field", "value", "note"])
        w.writeheader()
        w.writerows(flags)
    print(f"\npreview  -> {OUT/'import_2026_preview.csv'}")
    print(f"skipped  -> {OUT/'import_2026_skipped.csv'}")
    print(f"flagged  -> {OUT/'import_2026_flags.csv'}")

    if not args.write:
        print("\nDRY RUN - nothing written. Re-run with --write to create these records.")
        return

    print(f"\nCreating {len(rows)} records...")
    created = 0
    for i in range(0, len(rows), 10):
        batch = [{"fields": r["fields"]} for r in rows[i:i + 10]]
        try:
            res = api(f"{BASE}/{T_SAMPLES}", tok, "POST", {"records": batch})
            created += len(res["records"])
            print(f"   batch {i//10+1:3}: +{len(res['records'])}  (total {created})")
        except urllib.error.HTTPError as e:
            print(f"   batch {i//10+1} FAILED {e.code}: {e.read().decode()[:400]}")
            print(f"   stopped after {created} records")
            sys.exit(1)
        time.sleep(0.3)
    print(f"\nDone. Created {created} samples for {YEAR}.")


if __name__ == "__main__":
    main()
