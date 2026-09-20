"""Reject a generated or built iOS app that could launch/rotate to landscape."""
import plistlib
import sys
from pathlib import Path

path = Path(sys.argv[1])
with path.open("rb") as stream:
    info = plistlib.load(stream)
keys = {"UISupportedInterfaceOrientations"} | {key for key in info if key.startswith("UISupportedInterfaceOrientations~")}
for key in sorted(keys):
    if info.get(key) != ["UIInterfaceOrientationPortrait"]:
        raise SystemExit(f"{path}: {key} must be portrait only, got {info.get(key)!r}")
print(f"Portrait-only iOS orientations verified: {path}")
