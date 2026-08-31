"""Report textured face samples across a generated hairstyle bust."""

from __future__ import annotations

import colorsys
import statistics
import sys
from pathlib import Path

import bpy


def option(name: str, default: str = "") -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next((arg.removeprefix(prefix) for arg in args if arg.startswith(prefix)), default)


def linear_to_srgb(channel: float) -> float:
    return 12.92 * channel if channel <= 0.0031308 else 1.055 * channel ** (1.0 / 2.4) - 0.055


def main() -> None:
    source = Path(option("source"))
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
    obj = next(item for item in bpy.context.scene.objects if item.type == "MESH")
    mesh = obj.data
    uv_layer = mesh.uv_layers.active
    texture = next(
        node.image
        for material in mesh.materials
        for node in material.node_tree.nodes
        if node.type == "TEX_IMAGE" and node.image
    )
    width, height = texture.size
    pixels = list(texture.pixels[:])
    bounds = [
        min(vertex.co[index] for vertex in mesh.vertices)
        for index in range(3)
    ] + [
        max(vertex.co[index] for vertex in mesh.vertices)
        for index in range(3)
    ]
    print("BOUNDS", tuple(round(value, 4) for value in bounds))
    samples = []
    face_colors = []
    face_colors_flipped = []
    for polygon in mesh.polygons:
        center = polygon.center
        if abs(center.x) > 0.055:
            continue
        loop = polygon.loop_indices[0]
        uv = uv_layer.data[loop].uv
        x = min(width - 1, max(0, round((uv.x % 1.0) * (width - 1))))
        y = min(height - 1, max(0, round((uv.y % 1.0) * (height - 1))))
        offset = (y * width + x) * 4
        rgb = tuple(linear_to_srgb(pixels[offset + index]) for index in range(3))
        flipped_offset = ((height - 1 - y) * width + x) * 4
        flipped_rgb = tuple(linear_to_srgb(pixels[flipped_offset + index]) for index in range(3))
        hsv = colorsys.rgb_to_hsv(*rgb)
        samples.append((center.y, center.z, *rgb, *hsv))
        x_min, y_min, z_min, x_max, y_max, z_max = bounds
        if (
            abs(center.x) < (x_max - x_min) * 0.20
            and center.y < y_min + (y_max - y_min) * 0.28
            and z_min + (z_max - z_min) * 0.36 < center.z < z_min + (z_max - z_min) * 0.67
        ):
            face_colors.append((*rgb, *hsv))
            flipped_hsv = colorsys.rgb_to_hsv(*flipped_rgb)
            face_colors_flipped.append((*flipped_rgb, *flipped_hsv))
    center_front = sorted(
        (
            (polygon.center.y + abs(polygon.center.x) * 2.0, polygon)
            for polygon in mesh.polygons
            if z_min + (z_max - z_min) * 0.44 < polygon.center.z < z_min + (z_max - z_min) * 0.64
        ),
        key=lambda item: item[0],
    )[:12]
    for _, polygon in center_front:
        center = polygon.center
        loop = polygon.loop_indices[0]
        uv = uv_layer.data[loop].uv
        x = min(width - 1, max(0, round((uv.x % 1.0) * (width - 1))))
        y = min(height - 1, max(0, round((uv.y % 1.0) * (height - 1))))
        for label, pixel_y in (("direct", y), ("flipped", height - 1 - y)):
            offset = (pixel_y * width + x) * 4
            rgb = tuple(linear_to_srgb(pixels[offset + index]) for index in range(3))
            print("CENTER", label, tuple(round(value, 4) for value in (*center, uv.x, uv.y, *rgb)))
    if face_colors:
        print(
            "FACE",
            len(face_colors),
            tuple(round(statistics.median(sample[index] for sample in face_colors), 4) for index in range(6)),
        )
        print(
            "FACE_FLIPPED",
            len(face_colors_flipped),
            tuple(round(statistics.median(sample[index] for sample in face_colors_flipped), 4) for index in range(6)),
        )
    for sample in sorted(samples, key=lambda value: (round(value[1], 2), value[0]))[::max(1, len(samples) // 80)]:
        print("SAMPLE", " ".join(f"{value:.4f}" for value in sample))


if __name__ == "__main__":
    main()
