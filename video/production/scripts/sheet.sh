#!/usr/bin/env bash
# sheet.sh VIDEO OUT.png "t1 t2 ..." COLS — tile frames at the given times (labelled) for review.
set -euo pipefail
v=$1; o=$2; ts=$3; cols=${4:-4}; tmp=$(mktemp -d); i=0
for t in $ts; do i=$((i+1)); ffmpeg -v error -y -ss "$t" -i "$v" -frames:v 1 -vf "scale=640:-2,drawtext=text='${t}s':x=8:y=8:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.6" "$tmp/$(printf %03d $i).png"; done
ffmpeg -v error -y -framerate 1 -i "$tmp/%03d.png" -vf "tile=${cols}x$(( (i+cols-1)/cols )):padding=4:color=0x202020" -frames:v 1 "$o"; rm -rf "$tmp"; echo "$o"
