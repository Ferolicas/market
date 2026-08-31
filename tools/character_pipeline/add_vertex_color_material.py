#!/usr/bin/env python3
"""Attach a PBR material to COLOR_0-only GLB primitives.

Some vertex-colour exporters omit the material entirely. Browsers generally
accept that file, but Blender and other DCC importers then ignore COLOR_0. A
white base material makes glTF's defined vertex-colour multiplication explicit.
"""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path


GLB_MAGIC = b"glTF"
JSON_CHUNK = 0x4E4F534A


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    payload = args.input.read_bytes()
    magic, version, _ = struct.unpack_from("<4sII", payload, 0)
    if magic != GLB_MAGIC or version != 2:
        raise ValueError(f"Not a glTF 2.0 binary: {args.input}")

    json_length, json_type = struct.unpack_from("<II", payload, 12)
    if json_type != JSON_CHUNK:
        raise ValueError("First GLB chunk is not JSON")
    json_start = 20
    json_end = json_start + json_length
    document = json.loads(payload[json_start:json_end].decode("utf-8"))

    material_index = len(document.setdefault("materials", []))
    document["materials"].append(
        {
            "name": "VertexColors",
            "doubleSided": False,
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.74,
            },
        }
    )
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            if "COLOR_0" in primitive.get("attributes", {}):
                primitive["material"] = material_index

    encoded_json = json.dumps(document, separators=(",", ":")).encode("utf-8")
    encoded_json += b" " * ((4 - len(encoded_json) % 4) % 4)
    remaining_chunks = payload[json_end:]
    total_length = 12 + 8 + len(encoded_json) + len(remaining_chunks)
    rebuilt = (
        struct.pack("<4sII", GLB_MAGIC, 2, total_length)
        + struct.pack("<II", len(encoded_json), JSON_CHUNK)
        + encoded_json
        + remaining_chunks
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(rebuilt)


if __name__ == "__main__":
    main()
