"""Collect the release-pinned national tables consumed by build.ts (developer-only)."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ca_au_nz import collect as collect_ca_au_nz
from us_gb_jp import collect as collect_us_gb_jp


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    countries = collect_ca_au_nz(args.cache / "ca-au-nz")
    additions = collect_us_gb_jp(args.cache / "us-gb-jp")
    if countries.keys() & additions.keys():
        raise ValueError("Duplicate national country codes")
    countries.update(additions)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(countries, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"Imported national period tables: {', '.join(countries)}")


if __name__ == "__main__":
    main()
