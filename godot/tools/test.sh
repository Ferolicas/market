#!/usr/bin/env bash
# Runs the GDScript test-suite headlessly. Usage: tools/test.sh [filter]
# GODOT may point at a Godot 4.7 binary; defaults to `godot` on PATH.
set -u
cd "$(dirname "$0")/.."
GODOT="${GODOT:-godot}"
# Refresh the global class cache so class_name scripts resolve outside the editor.
"$GODOT" --headless --path . --import >/dev/null 2>&1
"$GODOT" --headless --path . -s tests/run_tests.gd -- "${1:-}" 2>&1 | grep -vE '^(Godot Engine|$)'
exit "${PIPESTATUS[0]}"
