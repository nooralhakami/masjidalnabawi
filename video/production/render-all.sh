#!/usr/bin/env bash
# Renders every deliverable, then normalizes loudness to -14 LUFS / -1 dBTP (video stream copied untouched).
set -euo pipefail
cd "$(dirname "$0")"
HF="npx -y hyperframes@0.8.134"
mkdir -p out/final
render() { # project output extra-args...
  local p=$1 o=$2; shift 2
  (cd "$p" && $HF render --fps 30 --quality high --output "../out/raw-$o.mp4" "$@" 2>&1 | grep -E "MB|rendered|rror")
}
render guide    guide-1080x1920-captions
render guide    guide-1080x1920-clean      --variables '{"captions":false}'
render official official-1080p-captions
render official official-1080p-clean       --variables '{"captions":false}'
render official official-4k-captions       --resolution 4k
render official official-4k-clean          --resolution 4k --variables '{"captions":false}'
for f in out/raw-*.mp4; do
  name=$(basename "$f" .mp4); name=${name#raw-}
  stats=$(ffmpeg -hide_banner -i "$f" -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
  mi=$(echo "$stats" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['input_i'],d['input_tp'],d['input_lra'],d['input_thresh'],d['target_offset'])")
  read -r I TP LRA TH OFF <<<"$mi"
  ffmpeg -v error -y -i "$f" -c:v copy -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=$I:measured_TP=$TP:measured_LRA=$LRA:measured_thresh=$TH:offset=$OFF:linear=true,aresample=48000" -c:a aac -b:a 256k -movflags +faststart "out/final/$name.mp4"
  echo "normalized $name (input $I LUFS)"
done
python3 make-srt.py >/dev/null && cp out/*.srt out/final/
ls -la out/final
