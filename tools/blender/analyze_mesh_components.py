"""Report connected mesh islands and their bounds for pipeline diagnostics."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector


def option(name: str) -> str:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    prefix = f"--{name}="
    return next(arg.removeprefix(prefix) for arg in args if arg.startswith(prefix))


def main() -> None:
    source = Path(option("source"))
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
    for obj in (item for item in bpy.context.scene.objects if item.type == "MESH"):
        mesh = obj.data
        vertex_faces: dict[int, list[int]] = {vertex.index: [] for vertex in mesh.vertices}
        for polygon in mesh.polygons:
            for vertex_index in polygon.vertices:
                vertex_faces[vertex_index].append(polygon.index)
        unseen = set(range(len(mesh.polygons)))
        components: list[tuple[int, int, Vector, Vector, Vector]] = []
        while unseen:
            seed = unseen.pop()
            faces = {seed}
            frontier = [seed]
            vertices: set[int] = set()
            while frontier:
                polygon_index = frontier.pop()
                for vertex_index in mesh.polygons[polygon_index].vertices:
                    vertices.add(vertex_index)
                    for neighbor in vertex_faces[vertex_index]:
                        if neighbor in unseen:
                            unseen.remove(neighbor)
                            faces.add(neighbor)
                            frontier.append(neighbor)
            points = [mesh.vertices[index].co for index in vertices]
            minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
            maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
            center = (minimum + maximum) * 0.5
            components.append((len(faces), len(vertices), minimum, maximum, center))
        components.sort(reverse=True, key=lambda item: item[0])
        print(f"MESH {obj.name} polygons={len(mesh.polygons)} vertices={len(mesh.vertices)} components={len(components)}")
        for index, component in enumerate(components[:100]):
            faces, vertices, minimum, maximum, center = component
            print(
                f"COMPONENT {index:03d} faces={faces} vertices={vertices} "
                f"min={tuple(round(value, 5) for value in minimum)} "
                f"max={tuple(round(value, 5) for value in maximum)} "
                f"center={tuple(round(value, 5) for value in center)}"
            )


if __name__ == "__main__":
    main()
