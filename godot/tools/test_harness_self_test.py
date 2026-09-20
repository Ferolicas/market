"""Prove the runner rejects runtime/parser/empty failures and awaits async tests."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
probe = root / 'godot/tests/test_harness_temporary_probe.gd'
if probe.exists():
    raise SystemExit('Refusing to replace an existing probe')
cases = [
    ('runtime', 'extends TestCase\nfunc test_runtime():\n\tvar subject: Variant = {}\n\tsubject.nonexistent()\n', 1),
    ('parser', 'extends TestCase\nthis is invalid syntax\n', 1),
    ('empty', 'extends TestCase\n', 1),
    ('async', 'extends TestCase\nfunc test_async():\n\tawait (Engine.get_main_loop() as SceneTree).create_timer(0.01).timeout\n\tassert_true(true)\n', 0),
]
try:
    for name, source, expected in cases:
        probe.write_text(source)
        result = subprocess.run([sys.executable, 'godot/tools/test.py', probe.name], cwd=root, capture_output=True, text=True, timeout=30)
        if result.returncode != expected:
            print(result.stdout, result.stderr)
            raise SystemExit(f'{name}: expected exit {expected}, got {result.returncode}')
        print(f'PASS {name}: exit {result.returncode}')
    result = subprocess.run([sys.executable, 'godot/tools/test.py', 'no-such-suite-77812'], cwd=root, capture_output=True, text=True, timeout=30)
    if result.returncode != 1: raise SystemExit('Empty filter was not rejected')
    print('PASS empty filter: exit 1')
finally:
    probe.unlink(missing_ok=True)
    probe.with_suffix('.gd.uid').unlink(missing_ok=True)
