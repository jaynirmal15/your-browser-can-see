#!/usr/bin/env bash
# Serves the demo on http://localhost:8000
# getUserMedia needs a secure context: localhost counts, file:// does not.
set -euo pipefail
cd "$(dirname "$0")"

for m in models/face_landmarker.task models/pose_landmarker_lite.task models/gesture_recognizer.task; do
  [ -f "$m" ] || { echo "Missing $m — run ./get-models.sh first."; exit 1; }
done

PORT="${1:-8000}"
echo
echo "  Your Browser Can See  →  http://localhost:$PORT"
echo "  Ctrl-C to stop."
echo
command -v open >/dev/null && (sleep 1; open "http://localhost:$PORT") &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
