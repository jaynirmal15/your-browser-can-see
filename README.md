# Your Browser Can See

Three computer-vision models running on a live webcam, entirely in the browser.
No server, no API key, no inference bill. The camera frame is captured,
processed and discarded on the same machine it was created on — it is never
encoded for transmission, never sent, never stored.

This is the demo from **"Your Browser Can See"**, Boston Code Camp 41,
21 November 2026.

The deck is the demo: it is one HTML page that is both the slides and the
three live models, and the last third of the talk is navigated by hand gesture
rather than by keyboard.

---

## Run it

```bash
./setup.sh     # once — fetches the MediaPipe runtime and three models (~37 MB)
./run.sh       # serves on http://localhost:8000
```

`setup.sh` needs a normal internet connection. After it has run, the demo is
fully offline.

`run.sh` binds to `127.0.0.1` only. **It has to be `http://localhost`** —
`getUserMedia` requires a secure context, and `file://` does not qualify.

### Keys

| | |
|---|---|
| `←` `→` or space | move between slides |
| `G` | toggle gesture navigation |
| `F` | fullscreen |

With gesture navigation on: **open palm** advances, **fist** goes back.

---

## What's in it

**Face landmarks** — 478 points per frame, each with a relative depth estimate,
from MediaPipe Face Landmarker.

**Pose and a rep counter** — 33 body keypoints from Pose Landmarker Lite, plus
a bicep-curl counter built on top of three of them.

**Hand gestures** — 21 landmarks per hand from Gesture Recognizer, with its
built-in classifier (open palm, fist, victory, pointing up, thumbs up, thumbs
down), driving slide navigation.

A `PerformanceObserver` in the corner counts every network request the page
makes after load. It stays at zero.

---

## The three decisions worth copying

Everything below is in `app.js` and is the actual substance of the talk.

### 1. The model gives you coordinates, not meaning

The rep counter is not a model. Pose Landmarker reports 33 coordinates and
confidences per frame and nothing else — it has no concept of a repetition.

The counter takes three of those points — **11 shoulder, 13 elbow, 15 wrist** —
computes the angle at the elbow with a dot product, and runs a two-state
machine: `down` above **150°**, `up` below **55°**. It increments on the
**transition** from up back to down, not on the state. Counting the state
instead would give you one rep per frame.

The two widely separated thresholds are hysteresis: a few degrees of jitter
near 55 can never produce a count, because nothing short of a full extension
past 150 re-arms it.

Points below `visibility` **0.5** are discarded rather than trusted — an
occluded joint still returns a coordinate, and a guessed wrist swings like a
very fast curl.

### 2. Don't run inference on every frame

The render loop gates on `video.currentTime`. `requestAnimationFrame` runs
faster than the camera produces frames, so without that check you pay full
inference cost to process a frame you already processed.

Gesture recognition for navigation runs on every **third** frame
(`NAV_EVERY = 3`) and drives the deck perfectly well. Drawing happens every
frame; inference does not have to.

### 3. A probabilistic classifier needs a voting window

The gesture classifier returns scores, not certainties, and they flicker. An
earlier version required an unbroken hold, which marginal gestures could never
satisfy — a single dropped frame reset it.

It now keeps the last **9** samples above a score of **0.55**, fires when **4**
of them agree, and then waits **1200 ms** before moving again. Flicker-tolerant,
and still feels immediate.

---

## Requirements

A browser with `getUserMedia` and WebAssembly — any current Chrome, Edge,
Firefox or Safari. Python 3 for `run.sh`, and npm plus curl for `setup.sh`.

The MediaPipe tasks are created with the **GPU** delegate and fall back to
**CPU** if that fails. The CPU path runs through XNNPACK with SIMD, and on a
2018 MacBook at 1280×720 it is fast enough that the fallback is not a
degraded experience. Check your browser console to see which one you got.

---

## Licence

Code in this repository: MIT, see `LICENSE`.

The MediaPipe runtime and the three `.task` model files are Google's, under
Apache-2.0. They are not checked in — `setup.sh` fetches them from
`storage.googleapis.com/mediapipe-models` and npm.

Built with `@mediapipe/tasks-vision` **0.10.14**.
