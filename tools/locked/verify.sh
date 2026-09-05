#!/usr/bin/env bash
# Fails if a locked asset has been altered. Run before building.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
art="$root/Unity/MiniMarketUnity/Assets/StreamingAssets/Art"
status=0
check() {   # name, live path
  local want have
  want="$(cat "$root/tools/locked/$1.sha256")"
  have="$(sha256sum "$2" | cut -d' ' -f1)"
  if [ "$want" != "$have" ]; then
    echo "BLOQUEADO: $1 ha cambiado."
    echo "  aprobado $want"
    echo "  actual   $have"
    echo "  restaurar: cp tools/locked/$1.locked.glb '$2'"
    status=1
  else
    echo "$1 intacta (${want:0:12})"
  fi
}
check StoreEntrance  "$art/StoreEquipment/StoreEntrance.glb"
check FloorTileWhite "$art/Furniture/FloorTileWhite.glb"
check FloorTileBeige "$art/Furniture/FloorTileBeige.glb"
exit $status
