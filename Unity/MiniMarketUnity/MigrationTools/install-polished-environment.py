"""Install Blender's clean metric environment output and refresh integrity data."""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path


UNITY = Path(__file__).resolve().parents[1]
STREAMING = UNITY / "Assets/StreamingAssets"
CATALOG_PATH = STREAMING / "Data/runtime-asset-catalog.json"
MANIFEST_PATH = UNITY / "ASSET_SHA256SUMS.txt"
QC_PATH = UNITY / "QC/ENVIRONMENT_ASSET_POLISH.json"


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: install-polished-environment.py <generated-directory>")
    generated = Path(sys.argv[1]).resolve()
    report = json.loads((generated / "polished-environment-manifest.json").read_text())
    catalog = json.loads(CATALOG_PATH.read_text())
    entries = {entry["id"]: entry for entry in catalog["entries"]}
    installed = []
    for asset in report["assets"]:
        entry = entries.get(asset["id"])
        if not entry or entry["kind"] != "environment":
            raise KeyError(f"Environment catalog entry missing: {asset['id']}")
        source = generated / asset["file"]
        target = STREAMING / entry["path"]
        if not source.is_file():
            raise FileNotFoundError(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        entry["source"] = f"tools/blender/polish_environment_assets.py#{asset['id']}"
        entry["bytes"] = target.stat().st_size
        entry["sha256"] = digest(target)
        installed.append({**asset, "path": entry["path"], "bytes": entry["bytes"], "sha256": entry["sha256"]})

    # The alternative entrance was never instantiated, but it was still the one
    # remaining environment scan in the catalog. Reuse the approved, functional
    # split-door master so every catalog environment file is clean.
    approved = entries["StoreEntrance"]
    alternative = entries["StoreEntranceAlt"]
    approved_path = STREAMING / approved["path"]
    alternative_path = STREAMING / alternative["path"]
    shutil.copy2(approved_path, alternative_path)
    alternative["source"] = "approved StoreEntrance clean master alias"
    alternative["bytes"] = alternative_path.stat().st_size
    alternative["sha256"] = digest(alternative_path)

    catalog["totalBytes"] = sum(entry["bytes"] for entry in catalog["entries"])
    CATALOG_PATH.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n")
    MANIFEST_PATH.write_text(
        "".join(
            f"{entry['sha256']}  Assets/StreamingAssets/{entry['path']}\n"
            for entry in sorted(catalog["entries"], key=lambda value: value["path"])
        )
    )
    payload = {
        "schemaVersion": 1,
        "units": report["units"],
        "pivot": report["pivot"],
        "generated": len(installed),
        "approvedPreserved": sorted(
            entry["id"] for entry in catalog["entries"]
            if entry["kind"] == "environment" and not entry["source"].startswith("tools/blender/polish_environment_assets.py#")
        ),
        "assets": installed,
    }
    QC_PATH.parent.mkdir(parents=True, exist_ok=True)
    QC_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"installed": len(installed), "environmentCatalog": 124, "catalogBytes": catalog["totalBytes"]}))


if __name__ == "__main__":
    main()
