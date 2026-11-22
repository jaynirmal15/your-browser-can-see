#!/usr/bin/env bash
# One-time setup. Needs a normal internet connection; after this the demo is fully offline.
set -euo pipefail
cd "$(dirname "$0")"

echo "1/2  MediaPipe runtime (npm)"
rm -rf .tmp && mkdir .tmp && cd .tmp
npm pack @mediapipe/tasks-vision@0.10.14 >/dev/null 2>&1
tar xzf mediapipe-tasks-vision-0.10.14.tgz
cd ..
mkdir -p vendor/wasm
cp .tmp/package/vision_bundle.mjs vendor/
cp .tmp/package/wasm/* vendor/wasm/
rm -rf .tmp
echo "     vendor/  $(du -sh vendor | cut -f1)"

echo "2/2  Models (Google)"
mkdir -p models
base="https://storage.googleapis.com/mediapipe-models"
get () { printf '     %-30s' "$(basename "$2")"; curl -fsSL "$1" -o "$2"; printf '%s\n' "$(du -h "$2" | cut -f1)"; }
get "$base/face_landmarker/face_landmarker/float16/1/face_landmarker.task"           models/face_landmarker.task
get "$base/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" models/pose_landmarker_lite.task
get "$base/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"  models/gesture_recognizer.task

echo
echo "Ready. Run:  ./run.sh"
