"""Print connected mesh components with bounds for reconstruction QA."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector


source = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
mesh_object = max(
    (obj for obj in bpy.context.scene.objects if obj.type == "MESH"),
    key=lambda obj: len(obj.data.vertices),
)
mesh = mesh_object.data
vertex_faces: dict[int, list[int]] = {vertex.index: [] for vertex in mesh.vertices}
for polygon in mesh.polygons:
    for vertex_index in polygon.vertices:
        vertex_faces[vertex_index].append(polygon.index)

unseen = set(range(len(mesh.polygons)))
records = []
while unseen:
    seed = unseen.pop()
    component = {seed}
    frontier = [seed]
    vertices: set[int] = set()
    while frontier:
        polygon_index = frontier.pop()
        for vertex_index in mesh.polygons[polygon_index].vertices:
            vertices.add(vertex_index)
            for neighbor in vertex_faces[vertex_index]:
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    component.add(neighbor)
                    frontier.append(neighbor)
    points = [mesh.vertices[index].co for index in vertices]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    weights: dict[str, float] = {}
    for index in vertices:
        for membership in mesh.vertices[index].groups:
            name = mesh_object.vertex_groups[membership.group].name
            weights[name] = weights.get(name, 0.0) + membership.weight
    records.append(
        (
            len(component),
            len(vertices),
            minimum,
            maximum,
            sorted(weights.items(), key=lambda item: item[1], reverse=True)[:4],
        )
    )

for face_count, vertex_count, minimum, maximum, weights in sorted(records, reverse=True):
    extent = maximum - minimum
    print(
        f"COMPONENT faces={face_count} vertices={vertex_count} "
        f"min={tuple(round(value, 5) for value in minimum)} "
        f"max={tuple(round(value, 5) for value in maximum)} "
        f"extent={tuple(round(value, 5) for value in extent)} weights={weights}"
    )
