"""Draw the three reference maps of the car park roads: both levels, level A and level B (same numbers).
    python3 scripts/garage-maps.py
"""
import subprocess, sys

for args in ([], ['A'], ['B']):
    subprocess.run([sys.executable, 'scripts/garage-map.py', *args], check=True)
