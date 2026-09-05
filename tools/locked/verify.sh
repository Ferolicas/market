#!/usr/bin/env bash
# Fails if a locked asset has been altered. Run before building.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
live="$root/Unity/MiniMarketUnity/Assets/StreamingAssets/Art/StoreEquipment/StoreEntrance.glb"
want="$(cat "$root/tools/locked/StoreEntrance.sha256")"
have="$(sha256sum "$live" | cut -d' ' -f1)"
if [ "$want" != "$have" ]; then
  echo "BLOQUEADO: StoreEntrance.glb ha cambiado."
  echo "  aprobado $want"
  echo "  actual   $have"
  echo "  restaurar: cp tools/locked/StoreEntrance.locked.glb '$live'"
  exit 1
fi
echo "entrada intacta ($want)"
