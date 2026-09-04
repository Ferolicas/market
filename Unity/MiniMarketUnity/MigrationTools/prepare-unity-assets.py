"""Copy only approved runtime assets into the independent Unity project.

Masters are read-only inputs.  Every copied file is hashed and recorded so the
Unity package can be reproduced without pulling the large Blender work files.
"""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[3]
UNITY = Path(__file__).resolve().parents[1]
SOURCE = PROJECT / "GameAssets"
DEST = UNITY / "Assets/StreamingAssets/Art"

CHARACTERS = {
    "AdultMale": "Characters/Store/AdultMale",
    "AdultFemale": "Characters/Store/AdultFemale",
    "Boy": "Characters/Store/Boy",
    "Girl": "Characters/Store/Girl",
    "CustomerFemale01": "Characters/Customers/CustomerFemale01",
    "CustomerFemale02": "Characters/Customers/CustomerFemale02",
    "CustomerFemale03": "Characters/Customers/CustomerFemale03",
    "CustomerMale01": "Characters/Customers/CustomerMale01",
    "CustomerMale02": "Characters/Customers/CustomerMale02",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy(source: Path, target: Path, kind: str, asset_id: str, entries: list[dict]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    entries.append({
        "id": asset_id,
        "kind": kind,
        "path": target.relative_to(UNITY / "Assets/StreamingAssets").as_posix(),
        "source": source.relative_to(PROJECT).as_posix(),
        "bytes": target.stat().st_size,
        "sha256": sha256(target),
    })


def main() -> None:
    entries: list[dict] = []
    for character_id, relative in CHARACTERS.items():
        root = SOURCE / relative
        variants = {
            "LOD0": root / f"Runtime/TripoMotionPack/Exports/{character_id}_TripoMotionPack.glb",
            "LOD1": root / f"Runtime/LOD1/{character_id}_LOD1.glb",
            "LOD2": root / f"Runtime/LOD2/{character_id}_LOD2.glb",
        }
        for lod, source in variants.items():
            copy(source, DEST / f"Characters/{character_id}/{lod}.glb", "character", f"{character_id}:{lod}", entries)
        texture_root = root / "Runtime/TripoMotionPack/Textures"
        for texture in sorted(texture_root.glob("*")):
            if texture.is_file():
                copy(texture, DEST / f"Characters/{character_id}/Textures/{texture.name}", "character-texture", f"{character_id}:texture:{texture.name}", entries)

    mosaic = SOURCE / "Environment/MosaicAssets"
    for glb in sorted(mosaic.glob("*/Exports/*.glb")):
        category = glb.parents[1].name
        kind = "hair" if category == "Hair" else "hat" if category == "Hats" else "product" if category == "Products" else "environment"
        runtime = SOURCE / f"Environment/Runtime/{category}/{glb.name}"
        asset_id = glb.stem if not any(item["id"] == glb.stem for item in entries) else f"{category}:{glb.stem}"
        copy(runtime if runtime.is_file() else glb, DEST / f"{category}/{glb.name}", kind, asset_id, entries)

    fit_manifest = SOURCE / "Characters/RoyalMatchPipeline/QC/HeadAccessoryFitManifest.json"
    copy(
        fit_manifest,
        UNITY / "Assets/StreamingAssets/Data/HeadAccessoryFitManifest.json",
        "metadata",
        "HeadAccessoryFitManifest",
        entries,
    )

    payload = {
        "schemaVersion": 1,
        "sourceRoot": str(SOURCE),
        "entries": entries,
        "counts": {
            key: sum(1 for item in entries if item["kind"] == key)
            for key in sorted({item["kind"] for item in entries})
        },
        "totalBytes": sum(item["bytes"] for item in entries),
    }
    catalog = UNITY / "Assets/StreamingAssets/Data/runtime-asset-catalog.json"
    catalog.parent.mkdir(parents=True, exist_ok=True)
    catalog.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    manifest = UNITY / "ASSET_SHA256SUMS.txt"
    manifest.write_text("".join(
        f'{item["sha256"]}  Assets/StreamingAssets/{item["path"]}\n'
        for item in sorted(entries, key=lambda value: value["path"])
    ), encoding="utf-8")
    print(json.dumps({"catalog": str(catalog), "files": len(entries), "counts": payload["counts"], "bytes": payload["totalBytes"]}, indent=2))


if __name__ == "__main__":
    main()
