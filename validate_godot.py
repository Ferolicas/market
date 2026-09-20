#!/usr/bin/env python3
"""Compatibility entry point: validate with Godot itself and the real suite."""
from pathlib import Path
import runpy

if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).resolve().parent / 'godot/tools/test.py'), run_name='__main__')
