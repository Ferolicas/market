#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_root="$project_root/Builds/WebGL"
release_stamp="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
release_path="/var/www/market-unity/releases/$release_stamp"

test -f "$build_root/index.html"
ssh vps "install -d -m 755 '$release_path'"
# Unity can emit Brotli payloads as mode 600. Force Caddy-readable modes while
# preserving their contents; otherwise try_files falls back to index.html.
rsync -a --chmod=D755,F644 -e ssh "$build_root/" "vps:$release_path/"
ssh vps "set -e
find '$release_path' -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > '$release_path/SHA256SUMS'
sha256sum -c '$release_path/SHA256SUMS' > /tmp/market-unity-deploy-verify.log
find '$release_path' -type d -exec chmod 555 {} +
find '$release_path' -type f -exec chmod 444 {} +
sudo -u caddy test -r '$release_path/Build/'\$(find '$release_path/Build' -name '*.framework.js.br' -printf '%f' -quit)
ln -sfn '$release_path' /var/www/market-unity/current
printf 'release=$release_path verified='
grep -c ': OK$' /tmp/market-unity-deploy-verify.log"
