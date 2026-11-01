"""Import official national period life tables for the US, whole UK and Japan.

Developer-only: requires openpyxl. Sources are pinned to the latest releases
available on 2026-11-01. No survivor rows or remaining lifetimes are estimated.
The standalone command also writes <output stem>.receipts.json with download
hashes and native e0/e65/e95 values for independent integration comparisons.
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import re

import openpyxl

from source_io import country, download, receipt, table


US_REPORT = "https://www.cdc.gov/nchs/data/nvsr/nvsr75/nvsr75-05.pdf"
US_TABLES = "https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/NVSR/75-05/"
GB_PUBLICATION = (
    "https://www.ons.gov.uk/peoplepopulationandcommunity/birthsdeathsandmarriages/"
    "lifeexpectancies/bulletins/nationallifetablesunitedkingdom/2022to2024"
)
GB_WORKBOOK = (
    "https://www.ons.gov.uk/file?uri=/peoplepopulationandcommunity/birthsdeathsandmarriages/"
    "lifeexpectancies/datasets/nationallifetablesunitedkingdomreferencetables/"
    "current/nltuk198020223.xlsx"
)
JP_PUBLICATION = "https://www.mhlw.go.jp/toukei/saikin/hw/life/life25/index.html"
JP_WORKBOOK = "https://www.mhlw.go.jp/toukei/saikin/hw/life/life25/xls/life25-12.xlsx"


def _number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Expected a native numeric table cell, got {value!r}")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"Non-finite source value: {value!r}")
    return result


def _put(lx: dict[int, float], ex: dict[int, float], age: int, survivors: object, remaining: object) -> None:
    if age in lx:
        raise ValueError(f"Duplicate exact age {age}")
    lx[age] = _number(survivors)
    ex[age] = _number(remaining)


def _finish(lx: dict[int, float], ex: dict[int, float]) -> tuple[dict, dict]:
    # table() requires every exact age 0..95; it only truncates, never fills gaps.
    if not {0, 65, 95}.issubset(ex):
        raise ValueError("Source lacks native e0, e65 or e95")
    return table(lx, ex[95]), {"e0": ex[0], "e65": ex[65], "e95": ex[95]}


def _us(path: pathlib.Path, number: int, population: str) -> tuple[dict, dict]:
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = book[f"Table {number}"]
        rows = iter(sheet.values)
        title = next(rows)[0]
        if title != f"Table {number}. Life table for {population}: United States, 2024":
            raise ValueError(f"Unexpected US population or source period: {title!r}")
        headers = next(rows)
        notation = next(rows)
        if headers[2] != "Number surviving to age x" or notation[2] != "lx" or notation[6] != "ex":
            raise ValueError("Unexpected US survivor/remaining-lifetime columns")
        lx: dict[int, float] = {}
        ex: dict[int, float] = {}
        for row in rows:
            match = re.fullmatch(r"(\d+)-(\d+)", str(row[0]))
            if not match:
                continue  # Headers, footnotes and the terminal 100-and-over row.
            age, end = map(int, match.groups())
            if end != age + 1:
                raise ValueError(f"US table is not single-age at {row[0]!r}")
            _put(lx, ex, age, row[2], row[6])
        return _finish(lx, ex)
    finally:
        book.close()


def _gb(path: pathlib.Path) -> tuple[dict, dict]:
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        rows = list(book["2022-2024"].values)
        expected = "National Life Tables, United Kingdom, period expectation of life, based on data for the years 2022-2024"
        if rows[0][0] != expected or rows[4][0] != "Males" or rows[4][7] != "Females":
            raise ValueError("Expected the whole United Kingdom 2022–2024 national table")
        if rows[5][:6] != ("age", "mx", "qx", "lx", "dx", "ex") or rows[5][7:13] != rows[5][:6]:
            raise ValueError("Unexpected UK table columns")
        tables, native = {}, {}
        for sex, offset in (("m", 0), ("f", 7)):
            lx: dict[int, float] = {}
            ex: dict[int, float] = {}
            for row in rows[6:]:
                age = row[offset]
                if isinstance(age, int) and not isinstance(age, bool):
                    _put(lx, ex, age, row[offset + 3], row[offset + 5])
            tables[sex], native[sex] = _finish(lx, ex)
        return tables, native
    finally:
        book.close()


def _jp(path: pathlib.Path) -> tuple[dict, dict]:
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        tables, native = {}, {}
        for sex, label in (("m", "男"), ("f", "女")):
            rows = list(book[f"令和７年簡易生命表（{label}）"].values)
            if str(rows[0][1]).strip() != f"令和７(2025)年簡易生命表（{label}）":
                raise ValueError("Unexpected Japanese sex or source year")
            if rows[3][1:8] != ("x", "nqx", "lx", "ndx", "nLx", "Tx", "ex"):
                raise ValueError("Unexpected Japanese life-table columns")
            lx: dict[int, float] = {}
            ex: dict[int, float] = {}
            for row in rows[5:]:
                # The annual 'abridged' publication actually supplies all exact
                # ages 0..105. Weeks/months are separate infant subdivisions,
                # not age-zero replacements; only the 年 (years) rows belong here.
                match = re.fullmatch(r"(\d+)年", str(row[1]))
                if match:
                    _put(lx, ex, int(match[1]), row[3], row[7])
            tables[sex], native[sex] = _finish(lx, ex)
        return tables, native
    finally:
        book.close()


def _collect(cache: pathlib.Path) -> tuple[dict, dict]:
    countries, evidence = {}, {}
    tables, native, sources = {}, {}, []
    for sex, number, population in (
        ("t", 1, "the total population"),
        ("m", 2, "males"),
        ("f", 3, "females"),
    ):
        url = f"{US_TABLES}Table{number:02}.xlsx"
        path = download(url, cache, f"us-2024-Table{number:02}.xlsx")
        tables[sex], native[sex] = _us(path, number, population)
        sources.append({"url": url, "sex": sex, **receipt(path)})
    countries["US"] = country(
        "United States", "CDC National Center for Health Statistics", US_REPORT,
        2024, 2024, tables,
        "Complete period tables for the total national population, all origins and races. "
        "Published 25 August 2026; official spreadsheet Tables 1–3 retain native precision. "
        "The combined-sex table is officially published, not an average of the sex-specific tables.",
    )
    evidence["US"] = {"publication": US_REPORT, "sources": sources, "native": native}

    path = download(GB_WORKBOOK, cache, "gb-nltuk198020223.xlsx")
    tables, native = _gb(path)
    countries["GB"] = country(
        "United Kingdom", "Office for National Statistics", GB_PUBLICATION,
        2022, 2024, tables,
        "Whole United Kingdom, not Great Britain or England and Wales only. "
        "Three-year national period tables, published 10 December 2025. "
        "ONS publishes female and male tables only; no combined-sex table is supplied.",
    )
    evidence["GB"] = {"publication": GB_PUBLICATION, "sources": [{"url": GB_WORKBOOK, **receipt(path)}], "native": native}

    path = download(JP_WORKBOOK, cache, "jp-life25-12.xlsx")
    tables, native = _jp(path)
    countries["JP"] = country(
        "Japan", "Ministry of Health, Labour and Welfare", JP_PUBLICATION,
        2025, 2025, tables,
        "Annual national period life tables for Japanese nationals in Japan, based on provisional vital statistics; published 24 July 2026. "
        "Despite the publication's 'abridged' name, the official workbook supplies every exact age 0–105. "
        "Infant week/month subdivisions are excluded. No official combined-sex table is supplied.",
    )
    evidence["JP"] = {"publication": JP_PUBLICATION, "sources": [{"url": JP_WORKBOOK, **receipt(path)}], "native": native}
    return countries, evidence


def collect(cache: pathlib.Path) -> dict:
    """Fetch and parse the official release-pinned national period tables."""
    return _collect(cache)[0]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    countries, evidence = _collect(args.cache)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(countries, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    receipts = args.output.with_name(args.output.stem + ".receipts.json")
    receipts.write_text(json.dumps(evidence, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}")
    print(f"Source receipts and native e0/e65/e95: {receipts}")


if __name__ == "__main__":
    main()
