#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
surfaces="$repo_root/Unity/MiniMarketUnity/Assets/Resources/Surfaces"
palette_tmp="$(mktemp -d /tmp/market-world-palette.XXXXXX)"
trap 'rm -rf -- "$palette_tmp"' EXIT

# Keep the photographed microtexture, but constrain every surface to the
# approved semantic colours. The thresholds separate grout/paint from the
# underlying tile or asphalt without introducing extra runtime materials.
magick "$surfaces/FloorTileBeige.jpg" \
  -colorspace gray -level 55%,95% \
  +level-colors '#D8CFBA','#F3EDDF' \
  -strip -define png:compression-level=9 "$surfaces/FloorTilePremium.png"

magick "$surfaces/Grass.png" \
  -colorspace gray -level 5%,90% \
  +level-colors '#4E7A31','#79A94B' \
  -strip -define png:compression-level=9 "$surfaces/GrassPremium.png"

palette_road() {
  local source="$1"
  local output="$2"
  local stem="$3"
  local width height
  read -r width height < <(identify -format '%w %h\n' "$source")
  magick "$source" -colorspace gray -level 20%,48% \
    +level-colors '#383D3B','#505551' "$palette_tmp/${stem}-asphalt.png"
  magick "$source" -colorspace gray -level 56%,94% \
    "$palette_tmp/${stem}-lines.png"
  magick -size "${width}x${height}" xc:'#E8E5D9' "$palette_tmp/${stem}-ink.png"
  magick "$palette_tmp/${stem}-asphalt.png" "$palette_tmp/${stem}-ink.png" \
    "$palette_tmp/${stem}-lines.png" -composite -strip \
    -define png:compression-level=9 "$output"
}

palette_road "$surfaces/Road.png" "$surfaces/RoadPremium.png" road
palette_road "$surfaces/Crosswalk.png" "$surfaces/CrosswalkPremium.png" crosswalk

printf 'Generated premium world surfaces in %s\n' "$surfaces"
