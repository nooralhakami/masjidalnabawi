#!/usr/bin/env bash
# Renders the v2 promo film (16:9) in 1080p and 4K, with and without burned-in captions, then normalizes
# loudness to -14 LUFS / -1 dBTP (video stream copied untouched) and copies the SRT files.
set -euo pipefail
cd "$(dirname "$0")"
HF="npx -y hyperframes@0.8.134"
mkdir -p out/final-v2
render() { local o=$1; shift; (cd promo && $HF render --fps 30 --quality high --output "../out/raw-$o.mp4" "$@" 2>&1 | grep -E "MB|rendered|rror"); }
render promo-1080p-captions
render promo-1080p-clean --variables '{"captions":false}'
render promo-4k-captions --resolution 4k
render promo-4k-clean --resolution 4k --variables '{"captions":false}'
for o in promo-1080p-captions promo-1080p-clean promo-4k-captions promo-4k-clean; do
  f=out/raw-$o.mp4
  stats=$(ffmpeg -hide_banner -i "$f" -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
  read -r I TP LRA TH OFF <<<"$(echo "$stats" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['input_i'],d['input_tp'],d['input_lra'],d['input_thresh'],d['target_offset'])")"
  ffmpeg -v error -y -i "$f" -c:v copy -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=$I:measured_TP=$TP:measured_LRA=$LRA:measured_thresh=$TH:offset=$OFF:linear=true,aresample=48000" -c:a aac -b:a 256k -movflags +faststart "out/final-v2/$o.mp4"
  echo "normalized $o (input $I LUFS)"
done
python3 make-srt.py >/dev/null && cp out/promo-*.srt out/final-v2/
ls -la out/final-v2
