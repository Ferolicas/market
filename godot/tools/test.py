"""Bounded Godot test execution with error and case-completion validation."""
import os
import json
from pathlib import Path
import re
import signal
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]

def run(args, seconds):
    process = subprocess.Popen(args, cwd=ROOT, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, text=True, start_new_session=True)
    try:
        output, _ = process.communicate(timeout=seconds)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            output, _ = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            output, _ = process.communicate()
        print(output)
        print('FAIL: timeout', file=sys.stderr)
        return False
    print(output, end='')
    # Only remove a verified, exactly matched expected exception block.
    pattern = r'^EXPECTED ERROR START ([^\n]+)\n(.*?)^EXPECTED ERROR END VERIFIED\n'
    def expected_error(match):
        try:
            expected = json.loads(match[1])
        except ValueError:
            return match[0]
        errors = re.findall(r'^(?:SCRIPT ERROR|ERROR): (.+)$', match[2], re.M)
        return '' if errors == [expected] else match[0]
    output = re.sub(pattern, expected_error, output, flags=re.M | re.S)
    if process.returncode or re.search(r'(?:SCRIPT ERROR:|^ERROR:|LOAD FAIL|INVALID TEST CASE)', output, re.M):
        return False
    starts = re.findall(r'^CASE START (.+)$', output, re.M)
    ends = re.findall(r'^CASE END (.+)$', output, re.M)
    summaries = re.findall(r'^(\d+) suites, (\d+) passed, (\d+) failed$', output, re.M)
    return bool(starts and starts == ends and summaries and int(summaries[-1][0]) > 0
                and int(summaries[-1][1]) > 0 and int(summaries[-1][2]) == 0)

if __name__ == '__main__':
    godot = os.environ.get('GODOT', 'godot')
    sys.exit(0 if run([godot, '--headless', '--path', 'godot', '-s', 'tests/run_tests.gd', '--',
                      sys.argv[1] if len(sys.argv) > 1 else ''], 180) else 1)
