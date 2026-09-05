# Locked assets

Finished and signed off. Nothing in this repo may change them.

- `StoreEntrance` — the entrance block.
- `FloorTileWhite` — the shop and forecourt floor, laid 6 x 3 and 4 x 1.
- `FloorTileBeige` — built the same way, kept ready.

Each has its approved copy (`*.locked.glb`) and digest (`*.sha256`).
`tools/locked/verify.sh` fails if an installed asset drifts from its digest;
run it before every build. To restore one, copy the locked copy back over
`Unity/MiniMarketUnity/Assets/StreamingAssets/Art/...` and refresh its entry
in `runtime-asset-catalog.json`.

The floor tiles are produced by `tools/kit/extract_part.py` from
`KIT MARKET/PERSONAJES/MOSAICOS/MOBILIARIO.glb` (parts 11 and 15), with their
faces lifted off `MOBILIARIO.png` by `rectify_tiles.py`, straightened by
`refine_tile_face.py`, and made periodic by `panel_texture.py`.
