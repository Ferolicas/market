#!/usr/bin/env bash
# The supervisor rejects runtime errors even when Godot exits zero.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec python3 godot/tools/test.py "$@"
