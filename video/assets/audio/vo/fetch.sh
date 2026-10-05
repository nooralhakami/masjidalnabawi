#!/usr/bin/env bash
# Downloads the voice-over takes listed in takes.json into <set>/NN.mp3 (needs platform.r2.fish.audio reachable).
set -euo pipefail
cd "$(dirname "$0")"
python3 - <<'PY'
import json, pathlib, subprocess
t = json.load(open('takes.json'))
for key in ('official-ar', 'guide-ar'):
    d = pathlib.Path(key); d.mkdir(exist_ok=True)
    for i, url in enumerate(t[key], 1):
        out = d / f'{i:02}.mp3'
        if not out.exists():
            subprocess.run(['curl', '-fsSL', '--retry', '3', '-o', str(out), url], check=True)
        print(out)
PY
