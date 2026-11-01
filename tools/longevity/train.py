"""Developer-only, reproducible NHANES mortality fitting; never imports participant data into the app.

Run from the repository root:
  python tools/longevity/train.py --cache <private-cache-directory>

Only aggregate model/evaluation files are written to the repository. Downloaded public-use
respondent files remain in --cache. stdout contains aggregate receipts only. No app server,
profile directory, AI service, or network endpoint other than the fixed CDC manifest is used.
The app's canonical Bun bridge calculates both PhenoAge and every design transformation.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import tempfile
import urllib.parse
import urllib.request
import warnings

import numpy as np
import pandas as pd
from lifelines import CoxPHFitter
from lifelines.exceptions import ConvergenceWarning
from pandas.io.sas.sas_xport import _parse_float_vec
from scipy.stats import t as student_t
from sklearn.metrics import roc_auc_score

ROOT = Path(__file__).resolve().parents[2]
SEED = 20261101
HORIZON = 10
PENALTIES = (0.001, 0.01, 0.1)
SOURCE_MANIFEST = [
    {
        "year": 1999,
        "name": "DEMO",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/1999/DataFiles/DEMO.xpt",
        "bytes": 11500560,
        "sha256": "a17bd1ebfd6007b8dc93f16259cb090678eb6c467a39363b7e932bba15febf89",
        "kind": "xpt",
        "filename": "DEMO.xpt"
    },
    {
        "year": 1999,
        "name": "BMX",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/1999/DataFiles/BMX.xpt",
        "bytes": 2827840,
        "sha256": "6b9bc4d998c0004fc42b213cc7f5bf347df937707f46d6d25fab926723a60500",
        "kind": "xpt",
        "filename": "BMX.xpt"
    },
    {
        "year": 1999,
        "name": "LAB18",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/1999/DataFiles/LAB18.xpt",
        "bytes": 2223120,
        "sha256": "36dc6f02045ceb61e146885bb04400fd580c9c35cc3bfc4269e314f0e06fe9c0",
        "kind": "xpt",
        "filename": "LAB18.xpt"
    },
    {
        "year": 1999,
        "name": "LAB25",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/1999/DataFiles/LAB25.xpt",
        "bytes": 1487520,
        "sha256": "f69ef53e50fb3eea6a9e03b0e1167f201ecdb6ad485793002f4f7bee100fbd45",
        "kind": "xpt",
        "filename": "LAB25.xpt"
    },
    {
        "year": 1999,
        "name": "LAB11",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/1999/DataFiles/LAB11.xpt",
        "bytes": 469040,
        "sha256": "9ed9904dfc804b50c2c08b763b43d7df702913fc010c0f877e10f9f195ee183a",
        "kind": "xpt",
        "filename": "LAB11.xpt"
    },
    {
        "year": 1999,
        "name": "SMQ",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/1999/DataFiles/SMQ.xpt",
        "bytes": 1733760,
        "sha256": "fb1505ea08e310a5cb703ccae0e220aede3da812674e9e53f832fe76e31c2ce3",
        "kind": "xpt",
        "filename": "SMQ.xpt"
    },
    {
        "year": 1999,
        "name": "PAQ",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/1999/DataFiles/PAQ.xpt",
        "bytes": 1547280,
        "sha256": "e256a0fe7fdc99fcd7fd23245b82b2aea84586ed3a65767c08b10ee68f96b8fa",
        "kind": "xpt",
        "filename": "PAQ.xpt"
    },
    {
        "year": 1999,
        "name": "PAQIAF",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/1999/DataFiles/PAQIAF.xpt",
        "bytes": 520720,
        "sha256": "092b0161df373d0b3b36d9c090cb2e9ea1a63125908bf5db35c57ddea3019c60",
        "kind": "xpt",
        "filename": "PAQIAF.xpt"
    },
    {
        "year": 1999,
        "name": "DXX",
        "url": "https://wwwn.cdc.gov/nchs/data/nhanes/public/1999/datafiles/dxx.xpt",
        "bytes": 24737440,
        "sha256": "9567c94c4a2efd3bb67817f051bec4e778c648c9a2dd222a894fe0ca78598d37",
        "kind": "xpt",
        "filename": "DXX.xpt"
    },
    {
        "year": 2001,
        "name": "DEMO_B",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2001/DataFiles/DEMO_B.xpt",
        "bytes": 3273520,
        "sha256": "6458dc2307cee244ab6ba26f70ec78c7b842ffc68e668bc43f0ab6b9737937d9",
        "kind": "xpt",
        "filename": "DEMO_B.xpt"
    },
    {
        "year": 2001,
        "name": "BMX_B",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2001/DataFiles/BMX_B.xpt",
        "bytes": 2183680,
        "sha256": "55715d4387960f88e48a2adf44da0b270a83290b1edf7c8e4ecc0eb2c29c59cf",
        "kind": "xpt",
        "filename": "BMX_B.xpt"
    },
    {
        "year": 2001,
        "name": "L40_B",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2001/DataFiles/L40_B.xpt",
        "bytes": 2448480,
        "sha256": "16f907f3a945cc24d053a9492a3f90edd3e0335f70ba047bbd9952ba6a00e182",
        "kind": "xpt",
        "filename": "L40_B.xpt"
    },
    {
        "year": 2001,
        "name": "L25_B",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2001/DataFiles/L25_B.xpt",
        "bytes": 1671760,
        "sha256": "4bce7e5622c4b79b9965d7869875e05dae547c4b222fd89db47b8efb430b85f3",
        "kind": "xpt",
        "filename": "L25_B.xpt"
    },
    {
        "year": 2001,
        "name": "L11_B",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2001/DataFiles/L11_B.xpt",
        "bytes": 446240,
        "sha256": "1a78e83a59aaa4a04aeb8ed7abeaeb4b87e9950601ac428c52fae9ce53e9bbbc",
        "kind": "xpt",
        "filename": "L11_B.xpt"
    },
    {
        "year": 2001,
        "name": "SMQ_B",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2001/DataFiles/SMQ_B.xpt",
        "bytes": 2073680,
        "sha256": "179d7ad46de9478824d475de0e6425f474b34dd4798066a552acd31b89f07fde",
        "kind": "xpt",
        "filename": "SMQ_B.xpt"
    },
    {
        "year": 2001,
        "name": "PAQ_B",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2001/DataFiles/PAQ_B.xpt",
        "bytes": 1699520,
        "sha256": "c03073bb2e50ac4a97b588947fd4b4783a3b5c43da07a9d9a53f0879ec0b9229",
        "kind": "xpt",
        "filename": "PAQ_B.xpt"
    },
    {
        "year": 2001,
        "name": "PAQIAF_B",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2001/DataFiles/PAQIAF_B.xpt",
        "bytes": 754400,
        "sha256": "f2b0e6581e060cf58e2506b0a9e9becaaaf43da53e8162742777941d651cd20f",
        "kind": "xpt",
        "filename": "PAQIAF_B.xpt"
    },
    {
        "year": 2001,
        "name": "DXX_B",
        "url": "https://wwwn.cdc.gov/nchs/data/nhanes/public/2001/datafiles/dxx_b.xpt",
        "bytes": 32695200,
        "sha256": "6eeb2dabff1fc4a33df2dfe2b46e86eb6f0986319f238f1cb8066e7d695852f6",
        "kind": "xpt",
        "filename": "DXX_B.xpt"
    },
    {
        "year": 2003,
        "name": "DEMO_C",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2003/DataFiles/DEMO_C.xpt",
        "bytes": 3569840,
        "sha256": "2a2fdb88263337bfa06f0516bfb419631595f0a0ee88fb96069bed13d1857c6f",
        "kind": "xpt",
        "filename": "DEMO_C.xpt"
    },
    {
        "year": 2003,
        "name": "BMX_C",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2003/DataFiles/BMX_C.xpt",
        "bytes": 2551120,
        "sha256": "b3d3e431b5964ea8b5807035044322fcf32f3878d814d4a844204e51c793f090",
        "kind": "xpt",
        "filename": "BMX_C.xpt"
    },
    {
        "year": 2003,
        "name": "L40_C",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2003/DataFiles/L40_C.xpt",
        "bytes": 2074960,
        "sha256": "a5642b8aa6e90ee0961562572f7152d47df67a318dd41cb164e3a2fe4aaaae4d",
        "kind": "xpt",
        "filename": "L40_C.xpt"
    },
    {
        "year": 2003,
        "name": "L25_C",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2003/DataFiles/L25_C.xpt",
        "bytes": 1545760,
        "sha256": "3231a8c24179b37014ddb7b6ec1afaa30295dcb14a917af30666be1e8ad9fb6e",
        "kind": "xpt",
        "filename": "L25_C.xpt"
    },
    {
        "year": 2003,
        "name": "L11_C",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2003/DataFiles/L11_C.xpt",
        "bytes": 295040,
        "sha256": "f8941c4561d166fe68c16194108269ba00b4bfbe2aa10b20d5bfbc0c7e521760",
        "kind": "xpt",
        "filename": "L11_C.xpt"
    },
    {
        "year": 2003,
        "name": "SMQ_C",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2003/DataFiles/SMQ_C.xpt",
        "bytes": 1932320,
        "sha256": "fbfe1e4b286ab43fdc3fd84c3830bb241b8b5ca84b3ab5902b8808e4136efc2c",
        "kind": "xpt",
        "filename": "SMQ_C.xpt"
    },
    {
        "year": 2003,
        "name": "PAQ_C",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2003/DataFiles/PAQ_C.xpt",
        "bytes": 1488000,
        "sha256": "085928dcff32acc98efc8d1d30eeceb022b56d6ab565e0572251a325a576c765",
        "kind": "xpt",
        "filename": "PAQ_C.xpt"
    },
    {
        "year": 2003,
        "name": "PAQIAF_C",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2003/DataFiles/PAQIAF_C.xpt",
        "bytes": 722320,
        "sha256": "51e7648d91f3c3be158aa43d2d6732d93f9c8aa0f6fddef7d31eb24402c71904",
        "kind": "xpt",
        "filename": "PAQIAF_C.xpt"
    },
    {
        "year": 2003,
        "name": "DXX_C",
        "url": "https://wwwn.cdc.gov/nchs/data/nhanes/public/2003/datafiles/dxx_c.xpt",
        "bytes": 30371680,
        "sha256": "8840fcaa518d7ee0c3c64e826dfb512cf0ac9be5cd00b1895a9782cb885c91df",
        "kind": "xpt",
        "filename": "DXX_C.xpt"
    },
    {
        "year": 2005,
        "name": "DEMO_D",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2005/DataFiles/DEMO_D.xpt",
        "bytes": 3566560,
        "sha256": "bf9cc79cce501b2fbe5aa8d5b403b618548d02d4aefeb528335cdd9f4c40a3af",
        "kind": "xpt",
        "filename": "DEMO_D.xpt"
    },
    {
        "year": 2005,
        "name": "BMX_D",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2005/DataFiles/BMX_D.xpt",
        "bytes": 2153760,
        "sha256": "a52909be94cf825ba8a65477a9528603576fd5fbf3abadd72549a3f15c88566e",
        "kind": "xpt",
        "filename": "BMX_D.xpt"
    },
    {
        "year": 2005,
        "name": "BIOPRO_D",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2005/DataFiles/BIOPRO_D.xpt",
        "bytes": 2072000,
        "sha256": "6de916025812b78db1b81e62f77d94d83ed8b046d9d5c8a9d584f7caec120310",
        "kind": "xpt",
        "filename": "BIOPRO_D.xpt"
    },
    {
        "year": 2005,
        "name": "CBC_D",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2005/DataFiles/CBC_D.xpt",
        "bytes": 1589600,
        "sha256": "06c68d5d40146dd606ffeb038dee1295f9a9f63009033bd78a14e0636717aad7",
        "kind": "xpt",
        "filename": "CBC_D.xpt"
    },
    {
        "year": 2005,
        "name": "CRP_D",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2005/DataFiles/CRP_D.xpt",
        "bytes": 152080,
        "sha256": "4afe7cc036d3268601dc77ba1d3d9b85bbec80c2bc0670ec554550001aa0498b",
        "kind": "xpt",
        "filename": "CRP_D.xpt"
    },
    {
        "year": 2005,
        "name": "SMQ_D",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2005/DataFiles/SMQ_D.xpt",
        "bytes": 2578880,
        "sha256": "ef82433aca1a36ba2310a624ccdbaf195e2a258a88af0f284ef2a58d36be3011",
        "kind": "xpt",
        "filename": "SMQ_D.xpt"
    },
    {
        "year": 2005,
        "name": "PAQ_D",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2005/DataFiles/PAQ_D.xpt",
        "bytes": 1511360,
        "sha256": "a2c21b90a964aaa08a854d66526b29a1a7ad009d8a26c3cc9a8c18bf70f0c0aa",
        "kind": "xpt",
        "filename": "PAQ_D.xpt"
    },
    {
        "year": 2005,
        "name": "PAQIAF_D",
        "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2005/DataFiles/PAQIAF_D.xpt",
        "bytes": 797680,
        "sha256": "486c8e7a73367be5a5efdab125ad659d4f5775a5f7143ec91882db0c819fcc96",
        "kind": "xpt",
        "filename": "PAQIAF_D.xpt"
    },
    {
        "year": 2005,
        "name": "DXX_D",
        "url": "https://wwwn.cdc.gov/nchs/data/nhanes/public/2005/datafiles/dxx_d.xpt",
        "bytes": 29517840,
        "sha256": "f5122f3660a0a90601e3f6d865a82091a80db099dd8db4efb861c6cb5310710b",
        "kind": "xpt",
        "filename": "DXX_D.xpt"
    },
    {
        "year": 1999,
        "name": "NHANES_1999_2000_MORT_2019_PUBLIC",
        "url": "https://ftp.cdc.gov/pub/health_statistics/NCHS/datalinkage/linked_mortality/NHANES_1999_2000_MORT_2019_PUBLIC.dat",
        "bytes": 487666,
        "sha256": "562bd367107add0b2b40fed36a062d8b194fca31e11aab897a0efad4bebc8b26",
        "kind": "mortality",
        "filename": "1999_2000.dat"
    },
    {
        "year": 2001,
        "name": "NHANES_2001_2002_MORT_2019_PUBLIC",
        "url": "https://ftp.cdc.gov/pub/health_statistics/NCHS/datalinkage/linked_mortality/NHANES_2001_2002_MORT_2019_PUBLIC.dat",
        "bytes": 540362,
        "sha256": "2788c8c8a02995ea5686882b5fe65b4b9cd415016031525f8a3c1a3646c47f1b",
        "kind": "mortality",
        "filename": "2001_2002.dat"
    },
    {
        "year": 2003,
        "name": "NHANES_2003_2004_MORT_2019_PUBLIC",
        "url": "https://ftp.cdc.gov/pub/health_statistics/NCHS/datalinkage/linked_mortality/NHANES_2003_2004_MORT_2019_PUBLIC.dat",
        "bytes": 495722,
        "sha256": "639f6b3292a55b112fbfc842954af3d8d32bcce287cd8ae49319e5aca1c033c0",
        "kind": "mortality",
        "filename": "2003_2004.dat"
    },
    {
        "year": 2005,
        "name": "NHANES_2005_2006_MORT_2019_PUBLIC",
        "url": "https://ftp.cdc.gov/pub/health_statistics/NCHS/datalinkage/linked_mortality/NHANES_2005_2006_MORT_2019_PUBLIC.dat",
        "bytes": 506774,
        "sha256": "69388ea13a4f395f29d9d21bc51941b9759003490d4b00f6ff12a1bc5f8dba5c",
        "kind": "mortality",
        "filename": "2005_2006.dat"
    }
]
CYCLES = {
    1999: ("", "LAB18", "LAB25", "LAB11"),
    2001: ("_B", "L40_B", "L25_B", "L11_B"),
    2003: ("_C", "L40_C", "L25_C", "L11_C"),
    2005: ("_D", "BIOPRO_D", "CBC_D", "CRP_D"),
}
AGE_TERMS = ["age10", "male", "age10_male"]
SMOKING_TERMS = ["smoking_former", "smoking_current"]
BODY_TERMS = ["body_fat10", "body_fat10_sq", "body_fat10_male", "waist_height10", "waist_height10_sq"]
VARIANTS = (
    ("body", "Body measurements and smoking", 30, True, False, False),
    ("body_activity", "Body measurements, smoking and leisure exercise", 40, True, False, True),
    ("clinical", "Blood and body measurements with smoking", 50, True, True, False),
    ("clinical_activity", "Blood, body, smoking and leisure exercise", 60, True, True, True),
    ("blood", "Blood measurements and smoking", 10, False, True, False),
    ("blood_activity", "Blood measurements, smoking and leisure exercise", 20, False, True, True),
)
DOCUMENTATION = {
    "mortalityDescription": "https://www.cdc.gov/nchs/data/datalinkage/public-use-linked-mortality-file-description.pdf",
    "mortalityDictionary": "https://www.cdc.gov/nchs/data/datalinkage/public-use-linked-mortality-files-data-dictionary.pdf",
    "mortalityReader": "https://ftp.cdc.gov/pub/health_statistics/NCHS/datalinkage/linked_mortality/R_ReadInProgramAllSurveys.R",
    "weights": "https://wwwn.cdc.gov/nchs/nhanes/tutorials/Weighting.aspx",
    "surveyVariance": "https://wwwn.cdc.gov/nchs/nhanes/tutorials/varianceestimation.aspx",
    "dxa": "https://wwwn.cdc.gov/nchs/nhanes/dxa/dxa.aspx",
    "dxaTechnical": "https://wwwn.cdc.gov/nchs/data/nhanes/public/1999/documents/dxa_techdoc.pdf",
    "dxa2005": "https://wwwn.cdc.gov/nchs/data/nhanes/public/2005/datafiles/dxx_d.htm",
}


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def require(condition: bool, message: str) -> None:
    # Messages must identify an aggregate/schema failure, never a participant key/value.
    if not condition:
        raise ValueError(message)


def validate_transport(path: Path, source: dict) -> None:
    require(path.stat().st_size == source["bytes"], f"Unexpected byte count: {path.name}")
    require(digest(path) == source["sha256"], f"Checksum mismatch: {path.name}")
    with path.open("rb") as stream:
        prefix = stream.read(160)
    if source["kind"] == "xpt":
        require(prefix.startswith(b"HEADER RECORD*******LIBRARY HEADER RECORD!!!!!!!"), f"Not SAS XPORT: {path.name}")
        require(b"SAS" in prefix[80:160], f"Missing SAS library metadata: {path.name}")
    else:
        # Full fixed-width/code validation occurs in read_mortality, without printing records.
        require(len(prefix) >= 48 and prefix[:6].strip().isdigit(), f"Not NHANES fixed-width data: {path.name}")


def obtain_sources(cache: Path) -> list[dict]:
    """Fetch only missing files, validating HTTPS origin, HTTP metadata and pinned content."""
    require(not cache.resolve().is_relative_to(ROOT), "Raw NHANES cache must be outside the repository")
    cache.mkdir(parents=True, exist_ok=True)
    transports = []
    for source in SOURCE_MANIFEST:
        path = cache / source["filename"]
        if path.exists():
            validate_transport(path, source)
            continue
        request = urllib.request.Request(source["url"], headers={"User-Agent": "BiomarkerTracker-reproducible-research/1", "Accept-Encoding": "identity"})
        temporary = None
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                final = urllib.parse.urlparse(response.geturl())
                require(response.status == 200, f"HTTP status not 200: {path.name}")
                require(final.scheme == "https" and final.hostname in {"wwwn.cdc.gov", "ftp.cdc.gov"}, f"Unexpected download origin: {path.name}")
                content_type = response.headers.get("Content-Type", "").lower()
                require("html" not in content_type and "json" not in content_type, f"Non-data Content-Type: {path.name}")
                encoding = response.headers.get("Content-Encoding", "identity").lower()
                require(encoding in {"identity", ""}, f"Unexpected transport encoding: {path.name}")
                declared = response.headers.get("Content-Length")
                require(declared is None or int(declared) == source["bytes"], f"Unexpected Content-Length: {path.name}")
                with tempfile.NamedTemporaryFile(dir=cache, prefix="download-", suffix=".partial", delete=False) as out:
                    temporary = Path(out.name)
                    for block in iter(lambda: response.read(1024 * 1024), b""):
                        out.write(block)
                validate_transport(temporary, source)
                os.replace(temporary, path)
                transports.append({"url": source["url"], "finalUrl": response.geturl(), "status": response.status, "contentType": content_type, "contentLength": declared, "sha256": source["sha256"]})
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()
    # Transport headers are local receipts, not respondent data. Existing successful files are reused.
    if transports:
        (cache / "transport-receipt.json").write_text(json.dumps(transports, indent=2) + "\n", encoding="utf-8")
    return [{k: source[k] for k in ("url", "sha256", "bytes")} for source in SOURCE_MANIFEST]


def integer_codes(series: pd.Series, allowed: set[int], name: str) -> None:
    values = series.dropna()
    require(bool(values.isin(allowed).all()), f"Unrecognized binary/codebook value in {name}")


def read_xpt(name: str, cache: Path, audit: dict) -> pd.DataFrame:
    frame = pd.read_sas(cache / (name + ".xpt"), format="xport")
    # pandas 2.2.3's IBM-double decoder turns eight zero bytes into exactly this sentinel.
    # Probe synthetic bytes, then correct only that exact encoding artifact (not small values generally).
    sentinel = float(_parse_float_vec(np.array([b"\x00" * 8], dtype="S8"))[0])
    corrected = 0
    if sentinel != 0:
        for column in frame.select_dtypes(include=[np.number]):
            mask = frame[column].eq(sentinel)
            corrected += int(mask.sum())
            frame.loc[mask, column] = 0.0
    require("SEQN" in frame and frame.SEQN.notna().all(), f"Missing identifier metadata: {name}")
    require(bool((frame.SEQN == np.floor(frame.SEQN)).all()), f"Nonintegral identifier metadata: {name}")
    frame["SEQN"] = frame.SEQN.astype(np.int64)
    audit[name] = {"rows": len(frame), "columns": list(frame.columns), "exactZeroDecoderCorrections": corrected}
    return frame


def columns(frame: pd.DataFrame, required: list[str], name: str) -> pd.DataFrame:
    require(set(required).issubset(frame.columns), f"Missing required binary columns in {name}")
    return frame[required].copy()


def one_per_person(frame: pd.DataFrame, name: str) -> None:
    require(not frame.SEQN.duplicated().any(), f"Duplicate participant keys in {name}")


def read_mortality(year: int, cache: Path) -> pd.DataFrame:
    source = next(s for s in SOURCE_MANIFEST if s["year"] == year and s["kind"] == "mortality")
    with (cache / source["filename"]).open("rt", encoding="ascii", newline="") as stream:
        records = []
        for line in stream:
            row = line.rstrip("\r\n")
            # CDC omits trailing padding: missing final "." yields width46; two-digit months width47.
            require(46 <= len(row) <= 48, f"Mortality record width exceeds official fixed-field layout: {year}")
            values = []
            for start, end in ((0, 6), (14, 15), (15, 16), (45, 48)):
                token = row[start:end].strip()
                require(token in {"", "."} or token.isdigit(), f"Invalid fixed-width numeric metadata: {year}")
                values.append(np.nan if token in {"", "."} else int(token))
            records.append(values)
    frame = pd.DataFrame(records, columns=["SEQN", "ELIGSTAT", "MORTSTAT", "PERMTH_EXM"])
    require(frame.SEQN.notna().all(), f"Missing mortality linkage key: {year}")
    frame["SEQN"] = frame.SEQN.astype(np.int64)
    one_per_person(frame, "mortality")
    integer_codes(frame.ELIGSTAT, {1, 2, 3}, "ELIGSTAT")
    integer_codes(frame.MORTSTAT, {0, 1}, "MORTSTAT")
    require(bool(frame.PERMTH_EXM.dropna().between(0, 374).all()), "Invalid public follow-up range")
    return frame


def activity_minutes(screen: pd.DataFrame, details: pd.DataFrame) -> pd.DataFrame:
    integer_codes(screen.PAD200, {1, 2, 3, 7, 9}, "PAD200")
    integer_codes(screen.PAD320, {1, 2, 3, 7, 9}, "PAD320")
    integer_codes(details.PADLEVEL, {1, 2}, "PADLEVEL")
    out = screen[["SEQN"]].copy().set_index("SEQN")
    for level, gate in ((1, "PAD320"), (2, "PAD200")):
        part = details.loc[details.PADLEVEL == level].copy()
        complete = np.isfinite(part.PADTIMES) & np.isfinite(part.PADDURAT) & (part.PADTIMES > 0) & (part.PADDURAT >= 10)
        part["valid"] = complete
        part["minutes"] = part.PADTIMES * part.PADDURAT
        totals = part.groupby("SEQN").agg(minutes=("minutes", "sum"), complete=("valid", "all"), records=("valid", "size"))
        aligned = screen.set_index("SEQN")[[gate]].join(totals)
        yes = (aligned[gate] == 1) & aligned.complete.eq(True) & aligned.records.gt(0)
        zero = aligned[gate].isin([2, 3])
        # Retain inconsistent-detail counts, but the frozen derivation respects the reported screen.
        conflict = zero & aligned.records.fillna(0).gt(0)
        result = pd.Series(np.nan, index=aligned.index)
        result.loc[zero] = 0.0
        result.loc[yes] = aligned.loc[yes, "minutes"]
        out[f"activity{level}30"] = result
        out[f"activity{level}Unable"] = aligned[gate].eq(3)
        out[f"activity{level}Conflict"] = conflict
        out[f"activity{level}YesIncomplete"] = aligned[gate].eq(1) & ~yes
    # ACTUAL minutes, vigorous once. This differs deliberately from moderate-equivalent minutes.
    out["activityWeekly"] = (out.activity130 + out.activity230) * 7 / 30
    return out.reset_index()


def stable_fold(year: int, identifier: int) -> int:
    value = f"bt-mortality-v1|{year}|{identifier}".encode("ascii")
    return int.from_bytes(hashlib.sha256(value).digest()[:8], "big") % 3


def prepare(cache: Path) -> tuple[pd.DataFrame, list[pd.DataFrame], dict, dict]:
    audits: dict = {}
    preparation: dict = {}
    bases, dxa_versions = [], [[] for _ in range(5)]
    full_design: dict[int, list[int]] = {}
    for cycle_number, (year, (suffix, chemistry_name, cbc_name, crp_name)) in enumerate(CYCLES.items(), start=1):
        demo_name = "DEMO" + suffix
        demo = read_xpt(demo_name, cache, audits)
        demo_fields = ["SEQN", "SDDSRVYR", "RIDSTATR", "RIDAGEYR", "RIAGENDR", "RIDEXPRG", "SDMVSTRA", "SDMVPSU", "WTMEC2YR"]
        if year < 2003:
            demo_fields.append("WTMEC4YR")
        base = columns(demo, demo_fields, demo_name)
        one_per_person(base, demo_name)
        integer_codes(base.SDDSRVYR, {cycle_number}, "SDDSRVYR")
        integer_codes(base.RIAGENDR, {1, 2}, "RIAGENDR")
        integer_codes(base.RIDSTATR, {1, 2}, "RIDSTATR")
        integer_codes(base.RIDEXPRG, {1, 2, 3}, "RIDEXPRG")
        require(base.SDMVSTRA.notna().all() and base.SDMVPSU.notna().all(), "Missing full-sample survey design")
        for stratum, part in base.groupby("SDMVSTRA"):
            psus = sorted(int(p) for p in part.SDMVPSU.unique())
            require(int(stratum) not in full_design, "Unexpected cross-cycle reuse of variance strata")
            full_design[int(stratum)] = psus
        base["year"] = year
        base["fold"] = [stable_fold(year, int(x)) for x in base.SEQN]
        base["key"] = [f"{year}|{int(x)}" for x in base.SEQN]
        base["weight"] = ((2 / 3) * base.WTMEC4YR if year < 2003 else (base.WTMEC2YR / 3 if year == 2003 else base.WTMEC2YR))
        base["cluster"] = [f"{int(s)}|{int(p)}" for s, p in zip(base.SDMVSTRA, base.SDMVPSU)]
        creatinine_name = "LBDSCR" if year == 2001 else "LBXSCR"
        alp_name = "LBDSAPSI" if year == 2001 else "LBXSAPSI"
        mappings = [
            ("BMX" + suffix, ["SEQN", "BMXHT", "BMXWAIST", "BMIHT", "BMIWAIST"]),
            (chemistry_name, ["SEQN", "LBDSALSI", creatinine_name, "LBDSGLSI", alp_name]),
            (cbc_name, ["SEQN", "LBXLYPCT", "LBXMCVSI", "LBXRDW", "LBXWBCSI"]),
            (crp_name, ["SEQN", "LBXCRP"]),
            ("SMQ" + suffix, ["SEQN", "SMQ020", "SMQ040"]),
            ("PAQ" + suffix, ["SEQN", "PAD200", "PAD320"]),
        ]
        for name, fields in mappings:
            frame = columns(read_xpt(name, cache, audits), fields, name)
            one_per_person(frame, name)
            base = base.merge(frame, on="SEQN", how="left", validate="one_to_one")
        activity_name = "PAQIAF" + suffix
        details = columns(read_xpt(activity_name, cache, audits), ["SEQN", "PADLEVEL", "PADTIMES", "PADDURAT", "PADACTIV"], activity_name)
        activity = activity_minutes(base[["SEQN", "PAD200", "PAD320"]], details)
        base = base.merge(activity, on="SEQN", how="left", validate="one_to_one")
        mortality = read_mortality(year, cache)
        require(set(base.SEQN) == set(mortality.SEQN), f"Demographic/mortality linkage coverage differs: {year}")
        base = base.merge(mortality, on="SEQN", validate="one_to_one")
        integer_codes(base.SMQ020, {1, 2, 7, 9}, "SMQ020")
        integer_codes(base.SMQ040, {1, 2, 3, 7, 9}, "SMQ040")
        base["age"] = base.RIDAGEYR
        base["sex"] = base.RIAGENDR.map({1: "m", 2: "f"})
        base["smoking"] = np.select([base.SMQ020.eq(2), base.SMQ020.eq(1) & base.SMQ040.eq(3), base.SMQ020.eq(1) & base.SMQ040.isin([1, 2])], ["never", "former", "current"], default="unknown")
        base["waistToHeight"] = np.where((base.BMXHT > 0) & (base.BMXWAIST > 0), base.BMXWAIST / base.BMXHT, np.nan)
        native_creatinine = base[creatinine_name]
        if year == 1999:
            standardized = 1.013 * native_creatinine + 0.147
        elif year == 2005:
            standardized = -0.016 + 0.978 * native_creatinine
        else:
            standardized = native_creatinine
        base["creatinine"] = standardized * 88.4
        base["albumin"] = base.LBDSALSI
        base["glucose"] = base.LBDSGLSI
        base["crp_hs"] = base.LBXCRP * 10  # canonical bridge uses mg/L, converts internally
        base["lymphocyte_pct"] = base.LBXLYPCT
        base["mcv"] = base.LBXMCVSI
        base["rdw"] = base.LBXRDW
        base["alp"] = base[alp_name]
        base["wbc"] = base.LBXWBCSI
        clinical_names = ["albumin", "creatinine", "glucose", "crp_hs", "lymphocyte_pct", "mcv", "rdw", "alp", "wbc"]
        positive_names = [n for n in clinical_names if n != "lymphocyte_pct"]
        base["clinicalComplete"] = np.isfinite(base[clinical_names]).all(axis=1) & base[positive_names].gt(0).all(axis=1) & base.lymphocyte_pct.between(0, 100)
        base["duration"] = np.minimum(base.PERMTH_EXM, 120).clip(lower=0.5) / 12
        base["event"] = (base.MORTSTAT.eq(1) & base.PERMTH_EXM.le(120)).astype(int)
        base["known10"] = base.event.eq(1) | base.PERMTH_EXM.ge(120)
        rules = [
            ("notMecExamined", base.RIDSTATR.eq(2)),
            ("outsideBloodAge20To84", base.age.ge(20) & base.age.lt(85)),
            ("reportedPregnancy", ~base.RIDEXPRG.eq(1)),
            ("notMortalityEligible", base.ELIGSTAT.eq(1) & base.MORTSTAT.isin([0, 1]) & np.isfinite(base.PERMTH_EXM) & base.PERMTH_EXM.ge(0)),
            ("invalidWeightOrDesign", np.isfinite(base.weight) & base.weight.gt(0) & base.SDMVSTRA.notna() & base.SDMVPSU.notna()),
            ("unknownSmokingOrSex", base.sex.isin(["m", "f"]) & base.smoking.isin(["never", "former", "current"])),
        ]
        remaining = pd.Series(True, index=base.index)
        exclusions = {}
        for reason, valid in rules:
            exclusions[reason] = int((remaining & ~valid).sum())
            remaining &= valid
        analysis = base.loc[remaining].copy().set_index("key", drop=False)
        dxa_name = "DXX" + suffix
        flags = ["DXITOTST", "DXITOTBN"] if year == 2005 else ["DXITOT"]
        dxa = columns(read_xpt(dxa_name, cache, audits), ["SEQN", "_MULT_", "DXDTOPF", "DXAEXSTS"] + flags, dxa_name)
        integer_codes(dxa["_MULT_"], {1, 2, 3, 4, 5}, "_MULT_")
        integer_codes(dxa.DXAEXSTS, {1, 2, 3, 4, 5, 6}, "DXAEXSTS")
        for flag in flags:
            integer_codes(dxa[flag], {0, 1, 2}, flag)
        require(not dxa.duplicated(["SEQN", "_MULT_"]).any(), f"Duplicate DXA imputation keys: {year}")
        sets = [set(dxa.loc[dxa["_MULT_"] == m, "SEQN"]) for m in range(1, 6)]
        require(all(x == sets[0] for x in sets[1:]), f"DXA participant sets differ across imputations: {year}")
        eligible_all = None
        per_imputation = []
        for m in range(1, 6):
            part = dxa.loc[dxa["_MULT_"] == m].set_index("SEQN")
            valid = part.DXDTOPF.gt(0) & part.DXDTOPF.lt(100) & ~part.DXAEXSTS.eq(3) & part[flags].isin([0, 1]).all(axis=1)
            good = set(part.index[valid])
            eligible_all = good if eligible_all is None else eligible_all & good
            per_imputation.append(part)
        for i, part in enumerate(per_imputation):
            version = analysis[["SEQN", "age"]].copy()
            version["bodyFat"] = version.SEQN.map(part.DXDTOPF)
            version["dxaAvailable"] = version.SEQN.isin(eligible_all) & version.age.lt(70)
            measured = part.DXAEXSTS.eq(1) & part[flags].eq(0).all(axis=1)
            version["dxaMeasured"] = version.SEQN.map(measured).eq(True)
            dxa_versions[i].append(version[["bodyFat", "dxaAvailable", "dxaMeasured"]])
        preparation[str(year)] = {
            "sourcePeople": len(base), "baseEligible": len(analysis), "sequentialExclusions": exclusions,
            "baseDeaths10": int(analysis.event.sum()), "earlyCensoredBefore10": int((~analysis.known10).sum()),
            "zeroFollowupMonths": int(analysis.PERMTH_EXM.eq(0).sum()),
            "clinicalComplete": int(analysis.clinicalComplete.sum()),
            "activityKnown": int(analysis.activityWeekly.notna().sum()), "activityZero": int(analysis.activityWeekly.eq(0).sum()),
            "activityUnableModerate": int(analysis.activity1Unable.sum()), "activityUnableVigorous": int(analysis.activity2Unable.sum()),
            "activityConflictingScreens": int((analysis.activity1Conflict | analysis.activity2Conflict).sum()),
            "activityYesIncomplete": int((analysis.activity1YesIncomplete | analysis.activity2YesIncomplete).sum()),
            "heightCommentNotStraight": int(analysis.BMIHT.eq(3).sum()),
            "crp001Native": int(analysis.LBXCRP.eq(0.01).sum()),
            "dxaCompleteAllFiveAge20To69": int(dxa_versions[0][-1].dxaAvailable.sum()),
            "dxaMeasuredAllRegionsAge20To69": int((dxa_versions[0][-1].dxaAvailable & dxa_versions[0][-1].dxaMeasured).sum()),
            "designStrata": int(base.SDMVSTRA.nunique()), "designPsus": int(base[["SDMVSTRA", "SDMVPSU"]].drop_duplicates().shape[0]),
        }
        bases.append(analysis)
    base = pd.concat(bases)
    dxas = [pd.concat(parts).reindex(base.index) for parts in dxa_versions]
    require(base.index.is_unique, "Cross-cycle participant keys are not unique")
    preparation["xptMetadata"] = audits
    return base, dxas, preparation, full_design


def bridge_design(base: pd.DataFrame, dxas: list[pd.DataFrame], bun: str) -> list[pd.DataFrame]:
    designs = []
    clinical_names = ["albumin", "creatinine", "glucose", "crp_hs", "lymphocyte_pct", "mcv", "rdw", "alp", "wbc", "age"]
    # Capture both pipes. Never expose input rows or bridge stdout to the tool transcript.
    for dxa in dxas:
        inputs = []
        for key, row in base.iterrows():
            item = {"age": float(row.age), "sex": row.sex, "smoking": row.smoking}
            for name in ("waistToHeight", "activityWeekly"):
                if np.isfinite(row[name]):
                    item[name] = float(row[name])
            if bool(dxa.loc[key, "dxaAvailable"]):
                item["bodyFat"] = float(dxa.loc[key, "bodyFat"])
            if row.clinicalComplete:
                item["clinical"] = {name: float(row[name]) for name in clinical_names}
            inputs.append(item)
        result = subprocess.run([bun, "run", "tools/longevity/features.ts"], cwd=ROOT, input=json.dumps(inputs, allow_nan=False), capture_output=True, text=True, encoding="utf-8", check=False)
        require(result.returncode == 0, "Canonical local Bun feature bridge failed; participant output withheld")
        try:
            decoded = json.loads(result.stdout)
        except json.JSONDecodeError:
            raise ValueError("Canonical bridge returned non-JSON output; participant output withheld") from None
        require(len(decoded) == len(base), "Canonical bridge output length differs")
        design = pd.DataFrame([row["design"] for row in decoded], index=base.index)
        design["phenoAgeGap"] = [row.get("phenoAgeGap", np.nan) for row in decoded]
        require(np.isfinite(design.loc[base.clinicalComplete, "phenoAgeGap"]).all(), "Clinical bridge returned missing/nonfinite PhenoAge")
        require(np.isfinite(design[AGE_TERMS + SMOKING_TERMS]).all().all(), "Canonical required design is incomplete")
        designs.append(design)
    return designs


def fit_cox(base: pd.DataFrame, design: pd.DataFrame, terms: list[str], penalty: float, zero_month: float = 0.5) -> CoxPHFitter:
    frame = design[terms].copy()
    frame["_duration"] = np.where(base.PERMTH_EXM.eq(0), zero_month / 12, base.duration)
    frame["_event"] = base.event.astype(int)
    frame["_weight"] = base.weight / base.weight.mean()
    frame["_cluster"] = base.cluster
    require(np.isfinite(frame[terms + ["_duration", "_event", "_weight"]]).all().all(), "Nonfinite Cox preparation")
    with warnings.catch_warnings():
        warnings.simplefilter("error", ConvergenceWarning)
        model = CoxPHFitter(penalizer=penalty, l1_ratio=0, baseline_estimation_method="breslow")
        model.fit(frame, "_duration", "_event", weights_col="_weight", cluster_col="_cluster", robust=True, show_progress=False, fit_options={"precision": 1e-8, "max_steps": 500, "step_size": 0.25})
    require(np.isfinite(model.params_).all(), "Nonfinite fitted coefficient")
    return model


def export_fit(model: CoxPHFitter) -> dict:
    before = model.baseline_cumulative_hazard_.loc[model.baseline_cumulative_hazard_.index <= HORIZON]
    hazard = float(before.iloc[-1, 0])
    require(math.isfinite(hazard) and hazard > 0, "Nonpositive ten-year baseline cumulative hazard")
    return {"baselineHazard10": hazard, "terms": [{"feature": term, "mean": float(model._norm_mean[term]), "coefficient": float(model.params_[term])} for term in model.params_.index]}


def predict_fit(model: CoxPHFitter, design: pd.DataFrame) -> np.ndarray:
    exported = export_fit(model)
    loghazard = np.full(len(design), math.log(exported["baselineHazard10"]))
    for term in exported["terms"]:
        loghazard += term["coefficient"] * (design[term["feature"]].to_numpy() - term["mean"])
    risk = -np.expm1(-np.exp(loghazard))
    # Actual export-equation check, not a test fixture or participant dump.
    native = 1 - model.predict_survival_function(design, times=[HORIZON]).iloc[0].to_numpy()
    require(float(np.max(np.abs(native - risk))) < 1e-10, "Exported centering/hazard disagrees with fitted prediction")
    return risk


def metrics(base: pd.DataFrame, risk: np.ndarray, multiplier: np.ndarray | None = None) -> dict:
    known = base.known10.to_numpy(dtype=bool)
    weights = base.weight.to_numpy(dtype=float)
    if multiplier is not None:
        weights = weights * multiplier
    keep = known & (weights > 0)
    y = base.event.to_numpy(dtype=int)[keep]
    w = weights[keep]
    prediction = np.asarray(risk)[keep]
    require(len(y) > 0 and np.unique(y).size == 2 and w.sum() > 0, "Insufficient observed endpoints for held-out metrics")
    return {
        "people": int(keep.sum()), "deaths": int(y.sum()), "auc": float(roc_auc_score(y, prediction, sample_weight=w)),
        "brier": float(np.average((prediction - y) ** 2, weights=w)),
        "weightedEventRate": float(np.average(y, weights=w)), "weightedMeanPrediction": float(np.average(prediction, weights=w)),
    }


def tune(base: pd.DataFrame, design: pd.DataFrame, terms: list[str]) -> tuple[float, list[dict]]:
    scores = []
    for penalty in PENALTIES:
        oof = np.full(len(base), np.nan)
        for fold in range(3):
            training = base.fold.ne(fold)
            heldout = ~training
            fitted = fit_cox(base.loc[training], design.loc[training], terms, penalty)
            oof[heldout.to_numpy()] = predict_fit(fitted, design.loc[heldout])
        result = metrics(base, oof)
        scores.append({"penalty": penalty, "weightedBrier": result["brier"], "weightedAucDescriptiveOnly": result["auc"]})
    chosen = min(scores, key=lambda row: (row["weightedBrier"], row["penalty"]))["penalty"]
    return chosen, scores


def bootstrap_pair(base: pd.DataFrame, risk: np.ndarray, comparison: np.ndarray, full_design: dict[int, list[int]], replicates: int) -> dict:
    rng = np.random.default_rng(SEED)
    design = {s: psus for s, psus in full_design.items() if 44 <= s <= 58}
    require(len(design) == 15 and all(len(psus) >= 2 for psus in design.values()), "Unexpected holdout variance-design structure")
    gains, auc_gains, model_briers, ref_briers = [], [], [], []
    row_groups = {(s, p): (base.SDMVSTRA.eq(s) & base.SDMVPSU.eq(p)).to_numpy() for s, psus in design.items() for p in psus}
    for _ in range(replicates):
        multiplier = np.zeros(len(base))
        for stratum, psus in design.items():
            # Rao-Wu rescaled PSU bootstrap, retaining all design PSUs including empty domains.
            m = len(psus)
            drawn = rng.choice(psus, size=m - 1, replace=True)
            for psu in psus:
                multiplier[row_groups[(stratum, psu)]] = np.sum(drawn == psu) * m / (m - 1)
        model_metrics = metrics(base, risk, multiplier)
        ref_metrics = metrics(base, comparison, multiplier)
        gains.append(ref_metrics["brier"] - model_metrics["brier"])
        auc_gains.append(model_metrics["auc"] - ref_metrics["auc"])
        model_briers.append(model_metrics["brier"])
        ref_briers.append(ref_metrics["brier"])
    interval = lambda x: [float(value) for value in np.quantile(x, [0.025, 0.975])]
    return {"method": "200 seeded Rao-Wu rescaled PSU-within-stratum resamples; paired fixed-model metrics; percentile 95% intervals", "replicates": replicates, "seed": SEED, "brierImprovement95": interval(gains), "aucImprovement95": interval(auc_gains), "modelBrier95": interval(model_briers), "comparisonBrier95": interval(ref_briers), "scope": "Holdout sampling uncertainty conditional on development fits and released imputations, not training uncertainty or an individual/lifetime confidence interval"}


def coefficient_uncertainty(models: list[CoxPHFitter], design_df: int) -> list[dict]:
    values = np.stack([model.params_.to_numpy() for model in models])
    # lifelines standard_errors_ contains cluster-robust SEs; variance_matrix_ is NOT that matrix.
    variances = np.stack([model.standard_errors_.to_numpy() ** 2 for model in models])
    mean = values.mean(axis=0)
    within = variances.mean(axis=0)
    between = np.var(values, axis=0, ddof=1) if len(models) > 1 else np.zeros_like(mean)
    total = within + (1 + 1 / len(models)) * between
    output = []
    for j, name in enumerate(models[0].params_.index):
        df = float(design_df)
        if len(models) > 1 and between[j] > 0:
            relative = (1 + 1 / len(models)) * between[j] / within[j]
            rubin_df = (len(models) - 1) * (1 + 1 / relative) ** 2
            df = min(df, float(rubin_df))
        half = float(student_t.ppf(0.975, df) * math.sqrt(total[j]))
        output.append({"feature": name, "pooledCoefficientDescriptiveOnly": float(mean[j]), "withinClusterVariance": float(within[j]), "betweenImputationVariance": float(between[j]), "rubinStandardError": float(math.sqrt(total[j])), "degreesOfFreedom": df, "coefficient95": [float(mean[j] - half), float(mean[j] + half)]})
    return output


def calibration_groups(base: pd.DataFrame, risk: np.ndarray) -> list[dict]:
    keep = base.known10.to_numpy(dtype=bool)
    w = base.weight.to_numpy()[keep]
    p = risk[keep]
    y = base.event.to_numpy()[keep]
    order = np.argsort(p, kind="stable")
    group = np.minimum((5 * (np.cumsum(w[order]) - 0.5 * w[order]) / w.sum()).astype(int), 4)
    result = []
    for index in range(5):
        ix = order[group == index]
        result.append({"riskFifth": index + 1, "people": len(ix), "deaths": int(y[ix].sum()), "weightedMeanPrediction": float(np.average(p[ix], weights=w[ix])), "weightedObservedRisk": float(np.average(y[ix], weights=w[ix]))})
    return result


def synthetic_oracles(models: list[CoxPHFitter], comparison: CoxPHFitter, bun: str) -> list[dict]:
    # Parent-specified invented cases. These are not selected, derived, or sampled cohort rows.
    cases = [
        {"age": 31, "sex": "m", "smoking": "never", "bodyFat": 18, "waistToHeight": 0.45, "phenoAgeGap": -3, "activityWeekly": 240},
        {"age": 31, "sex": "m", "smoking": "current", "bodyFat": 32, "waistToHeight": 0.63, "phenoAgeGap": 10, "activityWeekly": 0},
        {"age": 65, "sex": "f", "smoking": "never", "bodyFat": 30, "waistToHeight": 0.50, "phenoAgeGap": -2, "activityWeekly": 120},
        {"age": 50, "sex": "f", "smoking": "former", "bodyFat": 40, "waistToHeight": 0.60, "phenoAgeGap": 7, "activityWeekly": 80},
    ]
    result = subprocess.run([bun, "run", "tools/longevity/features.ts"], cwd=ROOT, input=json.dumps(cases), capture_output=True, text=True, encoding="utf-8", check=False)
    require(result.returncode == 0, "Synthetic canonical design bridge failed")
    design = pd.DataFrame([row["design"] for row in json.loads(result.stdout)])
    # Independent fitter output: never call predict_fit/the exported Cox equation for this oracle.
    risks = [1 - model.predict_survival_function(design, times=[10]).iloc[0].to_numpy() for model in models]
    reference = 1 - comparison.predict_survival_function(design, times=[10]).iloc[0].to_numpy()
    pooled = np.mean(risks, axis=0)
    return [{"input": case, "lifelinesRisk10": float(pooled[i]), "lifelinesPerImputationRisk10": [float(risk[i]) for risk in risks], "lifelinesComparisonRisk10": float(reference[i])} for i, case in enumerate(cases)]


def fit_variants(base: pd.DataFrame, dxas: list[pd.DataFrame], designs: list[pd.DataFrame], full_design: dict[int, list[int]], bootstrap: int, bun: str) -> tuple[list[dict], dict]:
    exported, detailed = [], {}
    design_df = sum(len(psus) - 1 for stratum, psus in full_design.items() if stratum < 44)
    for identifier, label, priority, body, clinical, activity in VARIANTS:
        terms = AGE_TERMS + SMOKING_TERMS + (BODY_TERMS if body else []) + (["pheno_gap10"] if clinical else []) + (["activity_log"] if activity else [])
        valid = pd.Series(True, index=base.index)
        if body:
            valid &= dxas[0].dxaAvailable & base.waistToHeight.notna() & base.age.lt(70)
        if clinical:
            valid &= base.clinicalComplete
        if activity:
            valid &= base.activityWeekly.notna()
        use = base.loc[valid]
        development = use.loc[use.year < 2005]
        holdout = use.loc[use.year == 2005]
        require(len(development) > 0 and len(holdout) > 0, f"Empty analysis split: {identifier}")
        versions = designs if body else designs[:1]
        penalty, cv = tune(development, versions[0].loc[development.index], terms)
        models = [fit_cox(development, version.loc[development.index], terms, penalty) for version in versions]
        comparison = fit_cox(development, versions[0].loc[development.index], AGE_TERMS, 0)
        require(comparison.params_.age10 > 0 and comparison.params_.age10 + comparison.params_.age10_male > 0, f"Comparison age slopes not increasing in both sexes: {identifier}")
        risk = np.mean([predict_fit(model, version.loc[holdout.index]) for model, version in zip(models, versions)], axis=0)
        reference = predict_fit(comparison, versions[0].loc[holdout.index])
        score, refscore = metrics(holdout, risk), metrics(holdout, reference)
        accepted = score["brier"] < refscore["brier"] and score["auc"] >= refscore["auc"]
        required = ["age", "sex", "smoking"] + (["bodyFat", "waistToHeight"] if body else []) + (["phenoAgeGap"] if clinical else []) + (["activityWeekly"] if activity else [])
        ranges = {}
        for name in required:
            if name in {"age", "sex", "smoking"}:
                continue
            if name == "bodyFat":
                series = pd.concat([dxa.loc[development.index, "bodyFat"] for dxa in dxas])
            elif name == "phenoAgeGap":
                series = versions[0].loc[development.index, "phenoAgeGap"]
            else:
                series = development[name]
            ranges[name] = [float(series.min()), float(series.max())]
        exported.append({
            "id": identifier, "label": label, "priority": priority, "required": required, "ageFrom": 20, "ageTo": 70 if body else 85,
            "ranges": ranges, "fits": [export_fit(model) for model in models], "comparison": export_fit(comparison),
            "evaluation": {"trainingPeople": len(development), "trainingDeaths": int(development.event.sum()), "testPeople": score["people"], "testDeaths": score["deaths"], "testDescription": "Untouched NHANES 2005-2006 temporal holdout; observed public-use 120-month outcomes; MEC-weighted", "auc": score["auc"], "brier": score["brier"], "baselineAuc": refscore["auc"], "baselineBrier": refscore["brier"], "weightedObservedRisk10": score["weightedEventRate"], "weightedMeanPredictedRisk10": score["weightedMeanPrediction"], "baselineWeightedMeanPredictedRisk10": refscore["weightedMeanPrediction"], "accepted": bool(accepted)},
        })
        detail = {
            "penalty": penalty, "developmentCvFirstImputation": cv,
            "imputationFits": len(models), "trainingPeopleByCycle": {str(year): int((development.year == year).sum()) for year in (1999, 2001, 2003)},
            "trainingDeathsByCycle": {str(year): int(development.loc[development.year == year, "event"].sum()) for year in (1999, 2001, 2003)},
            "trainingFoldPeople": {str(fold): int((development.fold == fold).sum()) for fold in range(3)},
            "trainingFoldDeaths": {str(fold): int(development.loc[development.fold == fold, "event"].sum()) for fold in range(3)},
            "developmentEarlyCensored": int((~development.known10).sum()), "holdoutEarlyCensored": int((~holdout.known10).sum()),
            "availabilityExclusionsFromBaseBySplit": {
                split: {
                    "basePeople": int(mask.sum()),
                    "notInVariant": int((mask & ~valid).sum()),
                    "missingBodyFatOrOutsideAge": int((mask & (~dxas[0].dxaAvailable | base.age.ge(70))).sum()) if body else 0,
                    "missingWaistToHeight": int((mask & base.waistToHeight.isna()).sum()) if body else 0,
                    "missingClinicalInputs": int((mask & ~base.clinicalComplete).sum()) if clinical else 0,
                    "missingActivity": int((mask & base.activityWeekly.isna()).sum()) if activity else 0,
                }
                for split, mask in {"development": base.year.lt(2005), "holdout": base.year.eq(2005)}.items()
            },
            "heldout": score, "ageSexComparison": refscore, "accepted": bool(accepted),
            "gate": "Weighted Brier strictly lower AND weighted AUC at least age/sex-only; prespecified; no CI significance gate and no holdout retuning",
            "pairedBootstrap": bootstrap_pair(holdout, risk, reference, full_design, bootstrap),
            "calibrationByWeightedRiskFifth": calibration_groups(holdout, risk),
            "coefficientUncertainty": coefficient_uncertainty(models, design_df),
            "coefficientUncertaintyMethod": "Per-imputation lifelines PSU-cluster robust sandwich SE; Rubin within/between variances; t df capped at development PSU-minus-stratum df. Approximate with tied times; not full survey Taylor variance. Pooled coefficients are descriptive only: app predictions pool five risks, not coefficients.",
            "developmentWeightSum": float(development.weight.sum()), "developmentWeightMean": float(development.weight.mean()),
            "holdoutWeightSum": float(holdout.weight.sum()), "holdoutWeightMean": float(holdout.weight.mean()),
            "developmentAgeRange": [float(development.age.min()), float(development.age.max())],
            "developmentZeroMonthDeaths": int((development.PERMTH_EXM.eq(0) & development.event.eq(1)).sum()),
            "holdoutZeroMonthDeaths": int((holdout.PERMTH_EXM.eq(0) & holdout.event.eq(1)).sum()),
            "syntheticInferenceOracles": synthetic_oracles(models, comparison, bun),
            "syntheticOracleMethod": "Four parent-specified invented inputs, not cohort records. Canonical shared design bridge; actual fitted lifelines predict_survival_function(times=[10]); average five risks for DXA variants. No exported equation or TS inference used as oracle.",
        }
        detail["subgroupsDescriptiveOnly"] = {}
        for subgroup, mask in {"female": holdout.sex.eq("f"), "male": holdout.sex.eq("m"), "age20To49": holdout.age.lt(50), "age50AndOver": holdout.age.ge(50)}.items():
            if holdout.loc[mask, "event"].nunique() == 2:
                detail["subgroupsDescriptiveOnly"][subgroup] = metrics(holdout.loc[mask], risk[mask.to_numpy()])
        if detail["developmentZeroMonthDeaths"]:
            sensitivities = []
            for months in (0.1, 1.0):
                changed = [fit_cox(development, version.loc[development.index], terms, penalty, months) for version in versions]
                changed_risk = np.mean([predict_fit(model, version.loc[holdout.index]) for model, version in zip(changed, versions)], axis=0)
                sensitivities.append({"zeroMonthReplacementMonths": months, "heldout": metrics(holdout, changed_risk), "maxAbsoluteRiskDifference": float(np.max(np.abs(changed_risk - risk)))})
            detail["zeroTimeSensitivity"] = sensitivities
        else:
            detail["zeroTimeSensitivity"] = {"reason": "No zero-month development deaths in this variant; replacement cannot change its fit"}
        detailed[identifier] = detail
        print(json.dumps({"variant": identifier, "penalty": penalty, "trainingPeople": len(development), "trainingDeaths": int(development.event.sum()), "testPeople": score["people"], "testDeaths": score["deaths"], "brier": score["brier"], "baselineBrier": refscore["brier"], "auc": score["auc"], "baselineAuc": refscore["auc"], "brierImprovement95": detail["pairedBootstrap"]["brierImprovement95"], "accepted": bool(accepted)}), flush=True)
    return exported, detailed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "biomarker-tracker-nhanes-mortality-v1")
    parser.add_argument("--bun", default="bun")
    parser.add_argument("--output", type=Path, default=ROOT / "knowledge/models/mortality.json")
    parser.add_argument("--evaluation", type=Path, default=ROOT / "tools/longevity/evaluation.json")
    args = parser.parse_args()
    source_receipts = obtain_sources(args.cache.resolve())
    base, dxas, preparation, design = prepare(args.cache.resolve())
    designs = bridge_design(base, dxas, args.bun)
    models, detailed = fit_variants(base, dxas, designs, design, 200, args.bun)
    versions = {name: importlib.metadata.version(name) for name in ("numpy", "scipy", "pandas", "scikit-learn", "lifelines")}
    versions["python"] = platform.python_version()
    bun_version = subprocess.run([args.bun, "--version"], capture_output=True, text=True, check=True).stdout.strip()
    versions["bun"] = bun_version
    model_file = {
        "version": "nhanes-1999-2006-cox-v1", "fittedOn": dt.datetime.now(dt.timezone.utc).date().isoformat(), "horizonYears": 10,
        "method": "MEC-weighted ridge Cox with fixed shared transforms; development 1999-2004; deterministic three-fold development-only Brier penalty selection; untouched 2005-2006 temporal holdout gate. Five separately fitted DXA imputations pooled on ten-year probability, not coefficients. Age/sex comparison on the same development participants.",
        "sources": source_receipts,
        "limitations": [
            "Ten-year heldout metrics do not validate an individual lifespan, a date of death, another country, or persistence of a risk-age difference over life.",
            "Associations are not causal effects: changing one input is not evidence of added years. Country life tables remain a separate population reference.",
            "Public-use mortality follow-up times can be perturbed; vital status is not. Ten-year labels use inclusive 120 months and are approximate.",
            "Complete-case eligible adults are not a nationally representative sample merely because MEC weights are used; no eligibility/nonresponse adjustment was supplied for this analysis.",
            "Body-fat models cover screening ages 20-69 because 2005-2006 DXA excludes older adults; blood-only models cover 20-84, excluding top-coded 85+. App ages are continuous approximations from birth month.",
            "DXA values already include CDC calibration and five released imputations; home body-fat estimates have not been calibrated to DXA. Extreme supplemental imputations are excluded.",
            "Leisure activity is recalled actual moderate-or-harder minutes in bouts of at least ten minutes over the previous 30 days; vigorous minutes counted once. Device total active time is not interchangeable.",
            "PhenoAge uses calibrated creatinine and non-fasting standard-chemistry serum glucose, not a fasting diagnostic glucose test. CRP floor values retain positive detection-limit substitutions.",
            "Per-imputation coefficient SEs are PSU-cluster robust approximations, not full survey Taylor variance, and tied public follow-up months affect sandwich accuracy. Holdout paired PSU bootstrap intervals condition on trained models.",
            "The holdout gate requires point-metric improvement only; passing is not proof of a statistically significant improvement. No per-person or lifetime confidence band is available.",
            "App carry-forward windows, recent activity summaries, questionnaire-to-device transfer, and application to other assays or repeated readings were not validated by this baseline-exam analysis.",
        ],
        "unavailableInputs": ["Compatible overnight resting RMSSD", "DunedinPACE (released DunedinPoAm is different)", "Compatible strength, balance and timed walking tests", "Device daily walking speed as a timed fitness test"],
        "models": models,
    }
    code_hashes = {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in [Path(__file__), ROOT / "tools/longevity/features.ts", ROOT / "src/core/mortalityModel.ts", ROOT / "src/core/phenoage.ts"]}
    evaluation = {
        "modelVersion": model_file["version"], "fittedOn": model_file["fittedOn"], "versions": versions,
        "command": "python tools/longevity/train.py --cache <local-cohort-cache>", "commandKind": "Portable reproduction recipe, not a machine-local invocation", "codeSha256": code_hashes,
        "seed": SEED, "sourceManifest": SOURCE_MANIFEST, "primaryDocumentation": DOCUMENTATION,
        "primaryComponentCodebooks": [source["url"][:-4] + (".pdf" if source["name"].startswith("DXX") and source["year"] < 2005 else ".htm") for source in SOURCE_MANIFEST if source["kind"] == "xpt"],
        "preparation": preparation, "variants": detailed,
        "protocol": {
            "split": "Development NHANES 1999-2000/2001-2002/2003-2004; temporal holdout 2005-2006; no holdout tuning",
            "folds": "int.from_bytes(SHA256('bt-mortality-v1|<year>|<SEQN>')[0:8], 'big') % 3, assigned before eligibility/imputation; identical across MI",
            "penalty": "L2 values 0.001,0.01,0.1; choose minimum pooled out-of-fold MEC-weighted ten-year Brier on first imputation only; refit all five when body fat is required",
            "weights": "Development: 2/3*WTMEC4YR for 1999-2002, 1/3*WTMEC2YR for 2003-2004; holdout WTMEC2YR. Normalize mean one separately in each fit, only for penalty scaling; evaluate using original weights",
            "surveyDesign": "Retain full demographic strata/PSU maps before domain restriction; PSU nested in original disjoint SDMVSTRA. Cluster-robust fitted SE; 200 paired Rao-Wu within-stratum PSU bootstrap replicates on holdout, including empty domain PSUs",
            "endpoint": "All-cause death MORTSTAT==1 and PERMTH_EXM<=120; fit min(PERMTH_EXM,120)/12; keep early censored for Cox; exclude alive <120 only from binary evaluation; death after120 is a ten-year survivor",
            "zeroTime": "Zero released follow-up retained; only Cox time changes zero to0.5month, an analyst convention not CDC guidance; sensitivity at0.1 and1month if any development zero-time deaths",
            "cox": "lifelines0.30.0 weighted partial likelihood, Efron ties, Breslow cumulative baseline hazard; ridge penalizes standardized features internally. Export params_ on original design scale plus actual _norm_mean centering and baseline cumulative hazard at10years; equation checked against native fitted predictions",
            "solver": "Uniform deterministic initial Newton step0.25, precision1e-8, max500; all convergence warnings fatal. Default step0.95 failed in clinical development folds; the same fold at0.25 converged in9iterations without changing data or model",
            "imputation": "Five independent DXA Cox fits on identical participant splits; no averaged body-fat values and no stacked independent duplicates; risk predictions averaged, coefficient uncertainty uses within/between-imputation Rubin rules",
            "activity": "PAD320 moderate/PAD200 vigorous:2No or3Unable->zero;1Yes requires all matching records valid. Missing/refused/unknown stay missing. Sum every legitimate detail row; actual(M30+V30)*7/30, vigorous once; inability/inconsistency flags retained in aggregate metadata, not fitted extra predictors",
            "creatinine": "1999 standardizedmg/dL=1.013*LBXSCR+0.147;2001 released LBDSCR unchanged;2003 LBXSCR unchanged;2005=-0.016+0.978*LBXSCR;then*88.4umol/L. Original native columns retained only in local memory",
            "crp": "Native LBXCRPmg/dL*10 to bridge canonicalmg/L; bridge PhenoAge converts internally.0.01 positive native values retained: documented floor in2003/2005, qualification uncertain in1999/2001",
            "transforms": "All medical PhenoAge/design calculations delegated via captured local Bun stdin/stdout to features.ts; no formula transcription in Python",
            "rawPredictorRanges": "Development-only min/max across five imputations when applicable; age omitted because ageFrom/ageTo defines domain; no heldout-based clipping or exclusions",
            "inferencePriority": "clinical_activity>clinical>body_activity>body>blood_activity>blood is input-coverage preference, not per-person accuracy ranking",
            "transportZeroCorrection": "Synthetic eight zero-byte IBM SAS double decodes as5.397605346934028e-79 in pandas2.2.3; normalize only exact decoder sentinel to0 at XPT import; count corrections per source",
        },
        "summary": {"accepted": [m["id"] for m in models if m["evaluation"]["accepted"]], "failed": [m["id"] for m in models if not m["evaluation"]["accepted"]], "noLifetimeValidation": True},
    }
    for path, data in ((args.output, model_file), (args.evaluation, evaluation)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"receipt": "completed", "versions": versions, "accepted": evaluation["summary"]["accepted"], "failed": evaluation["summary"]["failed"], "model": str(args.output), "modelSha256": digest(args.output), "evaluation": str(args.evaluation), "noLifetimeValidation": True}), flush=True)


if __name__ == "__main__":
    main()
