# Locked assets

The entrance is finished and signed off. Nothing in this repo may change it.

`StoreEntrance.locked.glb` is the approved file and `StoreEntrance.sha256` its
digest. `tools/locked/verify.sh` fails if the installed asset drifts from it;
run it before every build. To restore the approved file, copy the locked copy
back over `Unity/MiniMarketUnity/Assets/StreamingAssets/Art/StoreEquipment/`
and refresh the entry in `runtime-asset-catalog.json`.
