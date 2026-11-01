"""Developer-only downloads and normalization for public national period life tables."""
from __future__ import annotations

import datetime as dt
import hashlib
import pathlib
import ssl
import urllib.request

import certifi


def download(url: str, cache: pathlib.Path, filename: str) -> pathlib.Path:
    if not url.startswith("https://") or pathlib.Path(filename).name != filename:
        raise ValueError("Use an HTTPS source and a plain cache filename")
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / filename
    if not target.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "BiomarkerTracker-LifeTables/1.0 (public aggregate data)"})
        context = ssl.create_default_context()
        context.load_verify_locations(cafile=certifi.where())
        with urllib.request.urlopen(request, timeout=180, context=context) as response:
            content = response.read()
        target.write_bytes(content)
    return target


def table(lx_by_age: dict[int, float], e95: float) -> dict:
    missing = set(range(96)) - lx_by_age.keys()
    if missing:
        raise ValueError(f"Missing exact-age survivor rows: {sorted(missing)}")
    radix = lx_by_age[0]
    if radix <= 0:
        raise ValueError("Invalid birth radix")
    lx = [float(lx_by_age[age]) * 100_000 / radix for age in range(96)]
    if any(not (0 < x <= 100_000) for x in lx) or any(a < b for a, b in zip(lx, lx[1:])):
        raise ValueError("Invalid/non-monotone survivor counts")
    if not (0 < e95 < 10):
        raise ValueError("Invalid remaining life expectancy at 95")
    return {"lx": lx, "e95": float(e95)}


def country(name: str, publisher: str, url: str, start: int, end: int, tables: dict, note: str = "") -> dict:
    if not {"m", "f"}.issubset(tables):
        raise ValueError("Female and male national tables are required")
    source = {
        "name": publisher,
        "url": url,
        "retrieved": dt.date.today().isoformat(),
        "period": {"from": start, "to": end},
    }
    if note:
        source["note"] = note
    return {"name": name, "source": source, "tables": tables}


def receipt(path: pathlib.Path) -> dict:
    return {"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
