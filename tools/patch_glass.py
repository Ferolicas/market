"""Retune the entrance glass in place, without touching geometry.

At alpha 0.26 with a near-mirror roughness the pane washed out to a flat pale
panel: the specular sheen covered whatever was behind it, so the glass read as
white board. Lowering the opacity and letting the surface scatter a little
turns the sheen into a highlight instead of a cover.
"""
import json, struct, sys
from pathlib import Path

path = Path(sys.argv[1])
raw = path.read_bytes()
magic, version, length = struct.unpack_from("<III", raw, 0)
json_len, json_type = struct.unpack_from("<II", raw, 12)
doc = json.loads(raw[20:20 + json_len])
rest = raw[20 + json_len:]

changed = []
for material in doc.get("materials", []):
    if material.get("name") != "cristal":
        continue
    pbr = material.setdefault("pbrMetallicRoughness", {})
    colour = pbr.get("baseColorFactor", [1, 1, 1, 1])
    # A cool, barely tinted pane at low opacity, and enough roughness that the
    # highlight stays a highlight.
    # The pane is 2185 faces across 0.046 of thickness -- a crinkled slab,
    # not a sheet -- so a sightline crosses several surfaces and each one
    # blends again. At 0.13 the stack came out milky white; the opacity is
    # set for the stack, not for one layer.
    pbr["baseColorFactor"] = [0.60, 0.71, 0.74, 0.035]
    pbr["roughnessFactor"] = 0.38
    pbr["metallicFactor"] = 0.0
    material["alphaMode"] = "BLEND"
    # Front faces only: rendered double sided, a pane blends its own colour
    # twice and comes out milkier than its alpha says.
    material["doubleSided"] = False
    # Without this the pane defaults to a specular factor of 1.0 while every
    # other surface on the entrance sits at 0.56, so the glass mirrored the sky
    # and read as white board no matter how low its opacity went.
    material.setdefault("extensions", {})["KHR_materials_specular"] = {
        "specularFactor": 0.10
    }
    changed.append((colour, pbr["baseColorFactor"]))

if not changed:
    raise SystemExit("no se encontro el material cristal")

used = doc.setdefault("extensionsUsed", [])
if "KHR_materials_specular" not in used:
    used.append("KHR_materials_specular")

blob = json.dumps(doc, separators=(",", ":")).encode("utf-8")
blob += b" " * ((4 - len(blob) % 4) % 4)
out = struct.pack("<II", len(blob), 0x4E4F534A) + blob + rest
out = struct.pack("<III", 0x46546C67, 2, 12 + len(out)) + out
path.write_bytes(out)
for before, after in changed:
    print(f"cristal {[round(v,3) for v in before]} -> {after}")
