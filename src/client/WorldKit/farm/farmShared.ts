import * as THREE from "three";
import { makeRoundedBoxGeometry, makeText, updateText, type Position } from "../primitives";

/**
 * Shared helper for the direct `<RoundedBox>` uses inside `KitFarm`'s pieces
 * (as opposed to the `Box` wrapper, already ported as `makeBox()` in
 * `primitives.ts`, which always locks `smoothness=2`). The source calls
 * `<RoundedBox>` straight from `@react-three/drei` for a handful of farm
 * pieces with a non-default `smoothness` (3, for the crop bed and the
 * station sign board) or an explicit `castShadow`/`receiveShadow` pair not
 * expressible through `makeBox()`. This wraps the same faithfully-ported
 * `makeRoundedBoxGeometry()` so those numbers still come from the one
 * shared, verbatim geometry algorithm.
 */
export function roundedBoxMesh({ args, radius, smoothness = 2, material, position, rotation, castShadow = false, receiveShadow = false }: {
  args: Position;
  radius: number;
  smoothness?: number;
  material: THREE.Material;
  position?: Position;
  rotation?: Position;
  castShadow?: boolean;
  receiveShadow?: boolean;
}): THREE.Mesh {
  const geometry = makeRoundedBoxGeometry(args[0], args[1], args[2], radius, { smoothness });
  const mesh = new THREE.Mesh(geometry, material);
  if (position) mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

export interface StationSignRow {
  label: string;
  value: string;
  tone?: string;
}

/**
 * Faithful port of `StationSign` from `MarketKit.tsx`: a readable board on a
 * post, facing the camera. The source recomputes `boardHeight` from
 * `rows.length`, but a given call site's row count is fixed for the life of
 * the fixture (crop plots always pass one row, animal stations always pass
 * two), so the board/text layout is built once at `rowCount` and only the
 * per-row label/value/tone strings are mutated afterward.
 */
export function buildStationSign({ position, title, rowCount, height = 1.35 }: {
  position: Position;
  title: string;
  rowCount: number;
  height?: number;
}) {
  const boardHeight = 0.42 + rowCount * 0.36;
  const group = new THREE.Group();
  group.name = "dynamic:station-sign";
  group.position.set(...position);

  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.065, height, 8),
    new THREE.MeshStandardMaterial({ color: "#6d5136", roughness: 0.9 }),
  );
  post.position.set(0, height / 2 - 0.1, 0);
  post.castShadow = true;
  group.add(post);

  const board = new THREE.Group();
  board.position.set(0, height + boardHeight / 2 - 0.16, 0.04);
  board.rotation.set(-0.16, 0, 0);
  group.add(board);

  board.add(roundedBoxMesh({
    args: [1.42, boardHeight, 0.09],
    radius: 0.08,
    smoothness: 3,
    material: new THREE.MeshStandardMaterial({ color: "#1f3b33", roughness: 0.78 }),
    castShadow: true,
  }));
  board.add(roundedBoxMesh({
    args: [1.32, boardHeight - 0.1, 0.02],
    position: [0, 0, 0.05],
    radius: 0.06,
    smoothness: 3,
    material: new THREE.MeshStandardMaterial({ color: "#2c5749", roughness: 0.7 }),
  }));

  board.add(makeText({
    text: title,
    position: [0, boardHeight / 2 - 0.18, 0.07],
    fontSize: 0.155,
    color: "#ffe6a8",
    anchorX: "center",
    anchorY: "middle",
    fontWeight: 900,
  }));

  const rows = Array.from({ length: rowCount }, (_, index) => {
    const rowGroup = new THREE.Group();
    rowGroup.position.set(0, boardHeight / 2 - 0.52 - index * 0.36, 0.07);
    const labelText = makeText({
      text: "", position: [-0.58, 0, 0], fontSize: 0.125, color: "#bcd9cc", anchorX: "left", anchorY: "middle", fontWeight: 800,
    });
    const valueText = makeText({
      text: "", position: [0.58, 0, 0], fontSize: 0.23, color: "#ffffff", anchorX: "right", anchorY: "middle", fontWeight: 900,
    });
    rowGroup.add(labelText, valueText);
    board.add(rowGroup);
    return { labelText, valueText };
  });

  function update(values: readonly StationSignRow[]) {
    values.forEach((row, index) => {
      const target = rows[index];
      if (!target) return;
      updateText(target.labelText, { text: row.label });
      updateText(target.valueText, { text: row.value, color: row.tone ?? "#ffffff" });
    });
  }

  return { group, update };
}
