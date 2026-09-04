"""Deterministic, Unity-independent QC for every runtime GLB and manifest."""
from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STREAMING = ROOT / "Assets/StreamingAssets"
REPORT_DIR = ROOT / "QC"
CHARACTERS = ["AdultMale", "AdultFemale", "Boy", "Girl", "CustomerFemale01", "CustomerFemale02", "CustomerFemale03", "CustomerMale01", "CustomerMale02"]
EXPECTED_MORPHS = ["Blink_L", "Blink_R", "MouthOpen", "JawOpen", "Surprise", "EyeWide_L", "EyeWide_R", "BrowUp_L", "BrowUp_R", "BrowDown_L", "BrowDown_R", "Smile", "CheekUp", "Frown", "MouthNarrow", "Confused"]


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def glb_json(path: Path) -> dict:
    with path.open("rb") as handle:
        header = handle.read(12)
        magic, version, _ = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2:
            raise ValueError(f"GLB inválido: {path}")
        length, chunk_type = struct.unpack("<II", handle.read(8))
        if chunk_type != 0x4E4F534A:
            raise ValueError(f"Primer chunk no es JSON: {path}")
        return json.loads(handle.read(length).decode("utf-8").rstrip("\x00 "))


def audit_glb(path: Path) -> dict:
    data = glb_json(path)
    triangles = vertices = 0
    morph_names: list[str] = []
    for mesh in data.get("meshes", []):
        morph_names.extend(mesh.get("extras", {}).get("targetNames", []))
        for primitive in mesh.get("primitives", []):
            position = primitive.get("attributes", {}).get("POSITION")
            if position is not None:
                vertices += data["accessors"][position].get("count", 0)
            indices = primitive.get("indices")
            if indices is not None:
                triangles += data["accessors"][indices].get("count", 0) // 3
    animations = [item.get("name", "") for item in data.get("animations", [])]
    animated_nodes = {channel.get("target", {}).get("node") for animation in data.get("animations", []) for channel in animation.get("channels", [])}
    animated_nodes.discard(None)
    bones = max((len(item.get("joints", [])) for item in data.get("skins", [])), default=0)
    return {
        "path": path.relative_to(ROOT).as_posix(), "bytes": path.stat().st_size, "sha256": digest(path),
        "vertices": vertices, "triangles": triangles, "meshes": len(data.get("meshes", [])),
        "materials": len(data.get("materials", [])), "animations": animations, "animationCount": len(animations),
        "boneCount": bones, "animatedNodeCount": len(animated_nodes), "morphs": sorted(set(morph_names)), "morphCount": len(set(morph_names)),
    }


def main() -> None:
    catalog = json.loads((STREAMING / "Data/runtime-asset-catalog.json").read_text())
    entries = catalog["entries"]
    results: dict[str, dict] = {}
    errors: list[str] = []
    ids = [entry["id"].casefold() for entry in entries]
    duplicate_ids = sorted({entry_id for entry_id in ids if ids.count(entry_id) > 1})
    if duplicate_ids: errors.append(f"IDs duplicados en catálogo: {', '.join(duplicate_ids)}")
    for character in CHARACTERS:
        lods = {}
        for lod in (0, 1, 2):
            result = audit_glb(STREAMING / f"Art/Characters/{character}/LOD{lod}.glb")
            lods[f"LOD{lod}"] = result
            if result["boneCount"] != 50: errors.append(f"{character} LOD{lod}: {result['boneCount']} huesos")
            if result["morphs"] != sorted(EXPECTED_MORPHS): errors.append(f"{character} LOD{lod}: morphs inesperados")
        if lods["LOD0"]["animationCount"] != 47: errors.append(f"{character}: LOD0 no contiene 47 acciones")
        motion = audit_glb(STREAMING / f"Art/Characters/{character}/Motion.glb")
        if motion["animationCount"] != 47: errors.append(f"{character}: Motion no contiene 47 acciones")
        if motion["animatedNodeCount"] != 50: errors.append(f"{character}: Motion anima {motion['animatedNodeCount']} huesos, se esperaban 50")
        if motion["triangles"] != 0: errors.append(f"{character}: Motion contiene geometría")
        lods["Motion"] = motion
        results[character] = lods
    fit = json.loads((STREAMING / "Data/HeadAccessoryFitManifest.json").read_text())
    fit_counts = {item["character"]: {"hair": len(item["fits"]["Hair"]), "hats": len(item["fits"]["Hats"])} for item in fit["characters"]}
    for character in CHARACTERS:
        if fit_counts.get(character) != {"hair": 16, "hats": 12}: errors.append(f"{character}: encajes incompletos")
    payload = {
        "schemaVersion": 1, "unityVersion": "6000.3.23f1", "characters": results,
        "catalogCounts": catalog["counts"], "catalogFiles": len(entries), "catalogBytes": catalog["totalBytes"],
        "headAccessoryFits": fit_counts, "duplicateIds": duplicate_ids, "checks": {"passed": not errors, "errors": errors},
    }
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / "RUNTIME_ASSET_AUDIT.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    lines = ["# Runtime asset audit", "", f"- Result: {'PASS' if not errors else 'FAIL'}", f"- Catalog: {len(entries)} files / {catalog['totalBytes']} bytes", ""]
    lines += ["| Character | LOD0 tris | LOD1 tris | LOD2 tris | LOD0 actions | Morphs | Bones |", "|---|---:|---:|---:|---:|---:|---:|"]
    for character, lods in results.items():
        lines.append(f"| {character} | {lods['LOD0']['triangles']} | {lods['LOD1']['triangles']} | {lods['LOD2']['triangles']} | {lods['LOD0']['animationCount']} | {lods['LOD0']['morphCount']} | {lods['LOD0']['boneCount']} |")
    if errors: lines += ["", "## Errors", ""] + [f"- {item}" for item in errors]
    (REPORT_DIR / "RUNTIME_ASSET_AUDIT.md").write_text("\n".join(lines) + "\n")
    print(json.dumps({"passed": not errors, "characters": len(results), "files": len(entries), "errors": errors}, ensure_ascii=False))
    raise SystemExit(0 if not errors else 1)


if __name__ == "__main__":
    main()
