"""Official national period tables for Canada, Australia and New Zealand.

Developer-only ingestion; all retained ages are native single-year source rows.
Run with --cache PATH --output PATH. Receipts and native ex anchors are written
alongside downloads in ca_au_nz_receipts.json, never into the country schema.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
from pathlib import Path
import re
import zipfile

import openpyxl

from source_io import country, download, receipt, table

CA_URL = "https://www150.statcan.gc.ca/n1/en/tbl/csv/13100837-eng.zip"
CA_PAGE = "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1310083701"
AU_URL = "https://www.abs.gov.au/statistics/people/population/life-expectancy/2022-2024/3302055001DO001_20222024.xlsx"
AU_PAGE = "https://www.abs.gov.au/statistics/people/population/life-expectancy/2022-2024"
NZ_URL = "https://www.stats.govt.nz/assets/Uploads/National-and-subnational-period-life-tables/National-and-subnational-period-life-tables-2022-2024/Download-data/new-zealand-period-life-tables-2022-2024.csv"
NZ_PAGE = "https://www.stats.govt.nz/information-releases/national-and-subnational-period-life-tables-2022-2024"


def _put(values: dict[int, float], age: int, value: object) -> None:
    if age in values:
        raise ValueError(f"Duplicate exact-age source row: {age}")
    values[age] = float(value)


def _finish(lx: dict, ex: dict) -> tuple[dict, dict]:
    tables = {}
    anchors = {}
    for sex in lx:
        tables[sex] = table(lx[sex], ex[sex][95])
        anchors[sex] = {f"e{age}": ex[sex][age] for age in (0, 65, 95)}
    return tables, anchors


def _canada(path: Path) -> tuple[dict, dict]:
    sexes = {"Males": "m", "Females": "f", "Both sexes": "t"}
    lx = {s: {} for s in sexes.values()}
    ex = {s: {} for s in sexes.values()}
    # Pin the reviewed release period. A changed source must not silently switch
    # the source period or use a partially available newer national table.
    with zipfile.ZipFile(path) as archive:
        with archive.open("13100837.csv") as stream:
            for row in csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig")):
                if row["GEO"] != "Canada" or row["REF_DATE"] != "2024":
                    continue
                age_match = re.fullmatch(r"(\d+) years?", row["Age group"])
                if not age_match or row["Sex"] not in sexes:
                    continue
                age = int(age_match[1])
                if age > 95:
                    continue
                sex = sexes[row["Sex"]]
                if row["Element"] == "Number of survivors at age x (lx)":
                    _put(lx[sex], age, row["VALUE"])
                elif row["Element"] == "Life expectancy (in years) at age x (ex)":
                    _put(ex[sex], age, row["VALUE"])
    tables, anchors = _finish(lx, ex)
    return country("Canada", "Statistics Canada", CA_PAGE, 2024, 2024, tables,
                   "Complete single-year national period life table, table 13-10-0837-01. "
                   "2024 estimates are preliminary and subject to late death registrations; "
                   "both-sex table is officially published. Released 13 January 2026."), anchors


def _australia(path: Path) -> tuple[dict, dict]:
    lx = {"m": {}, "f": {}}
    ex = {"m": {}, "f": {}}
    workbook = openpyxl.load_workbook(path, data_only=True, read_only=True)
    try:
        sheet = workbook["Table 9"]
        if "Australia" not in str(sheet.cell(3, 1).value):
            raise ValueError("ABS Table 9 is not the national table")
        if tuple(sheet.cell(6, c).value for c in (2, 5, 6, 9)) != ("lx", "ex", "lx", "ex"):
            raise ValueError("Unexpected ABS survivor/expectancy columns")
        for row in sheet.iter_rows(min_row=8, max_col=9, values_only=True):
            age = row[0]
            if not isinstance(age, int) or not 0 <= age <= 95:
                continue
            for sex, lcol, ecol in (("m", 1, 4), ("f", 5, 8)):
                _put(lx[sex], age, row[lcol])
                _put(ex[sex], age, row[ecol])
    finally:
        workbook.close()
    tables, anchors = _finish(lx, ex)
    return country("Australia", "Australian Bureau of Statistics", AU_PAGE,
                   2022, 2024, tables,
                   "Complete national period life table, datacube Table 9; includes Other Territories. "
                   "Released 11 November 2025. No combined-sex table is published in this datacube."), anchors


def _new_zealand(path: Path) -> tuple[dict, dict]:
    sexes = {"Male": "m", "Female": "f"}
    lx = {s: {} for s in sexes.values()}
    ex = {s: {} for s in sexes.values()}
    with path.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            # These are the publisher's central (median) estimates, not the
            # uncertainty bounds, ethnic subgroup tables or cohort projections.
            if (row["ethnic"] != "NZ total" or row["quantile"] != "50%"
                    or row["time"] != "2022-2024" or row["sex"] not in sexes
                    or not row["age"].isdigit()):
                continue
            age = int(row["age"])
            if age > 95:
                continue
            sex = sexes[row["sex"]]
            if row["measure"] == "lx":
                _put(lx[sex], age, row["value"])
            elif row["measure"] == "ex":
                _put(ex[sex], age, row["value"])
    tables, anchors = _finish(lx, ex)
    return country("New Zealand", "Stats NZ", NZ_PAGE, 2022, 2024, tables,
                   "Complete national period life table, NZ total, published median (50% quantile) estimates. "
                   "Released 30 July 2025. No combined-sex table is published in this download."), anchors


def collect(cache: Path) -> dict:
    result = {}
    receipts = {}
    for code, url, filename, parse in (
        ("CA", CA_URL, "ca-13100837-eng.zip", _canada),
        ("AU", AU_URL, "au-3302055001DO001-20222024.xlsx", _australia),
        ("NZ", NZ_URL, "nz-period-life-tables-2022-2024.csv", _new_zealand),
    ):
        path = download(url, cache, filename)
        result[code], anchors = parse(path)
        receipts[code] = {**receipt(path), "url": url, "nativeExpectancy": anchors}
    (cache / "ca_au_nz_receipts.json").write_text(
        json.dumps(receipts, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    data = collect(args.cache)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n", encoding="utf-8")
