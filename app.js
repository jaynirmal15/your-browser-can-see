import {
  FilesetResolver, FaceLandmarker, PoseLandmarker, GestureRecognizer, DrawingUtils
} from "./vendor/vision_bundle.mjs";

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const setStatus = (t, live) => { $("#status").textContent = t; $("#dot").classList.toggle("live", !!live); };

/* =============== deck =============== */
const slides = $$(".slide");
let cur = 0;

function show(i) {
  cur = Math.max(0, Math.min(slides.length - 1, i));
  slides.forEach((s, n) => s.classList.toggle("on", n === cur));
  $("#pos").textContent = `${cur + 1} / ${slides.length}`;
  placeStage();
  if (slides[cur].dataset.demo === "pose") resetReps();
}
const next = () => show(cur + 1);
const prev = () => show(cur - 1);

addEventListener("keydown", e => {
  if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); next(); }
  else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prev(); }
  else if (e.key === "Home") show(0);
  else if (e.key === "End") show(slides.length - 1);
  else if (e.key.toLowerCase() === "f") document.documentElement.requestFullscreen?.();
  else if (e.key.toLowerCase() === "g") {
    gestureNav = !gestureNav;
    flash(gestureNav ? "Gesture control ON" : "Gesture control OFF");
    if (!gestureNav) $("#hint").textContent = "← → or space · G gesture control · F fullscreen";
  }
  else if (e.key.toLowerCase() === "r") resetReps();
});

/* One video + one canvas, moved into whichever demo slide is showing. */
const vid = document.createElement("video");
Object.assign(vid, { playsInline: true, autoplay: true, muted: true });
const cvs = document.createElement("canvas");
const ctx = cvs.getContext("2d");
const draw = new DrawingUtils(ctx);

function placeStage() {
  const host = slides[cur].querySelector("[data-stage]");
  if (host && cvs.parentElement !== host) { host.append(vid, cvs); }
}
const field = name => slides[cur].querySelector(`[data-${name}]`);
const put = (name, text) => { const el = field(name); if (el) el.textContent = text; };

/* =============== network honesty counter =============== */
let armed = false, netCount = 0;
new PerformanceObserver(list => {
  if (!armed) return;
  netCount += list.getEntries().length;
  $$("[data-netcount]").forEach(e => e.textContent = netCount);
  $$("[data-netbox]").forEach(e => e.classList.toggle("bad", netCount > 0));
}).observe({ type: "resource", buffered: false });

/* =============== models =============== */
let face, pose, gesture;

async function init() {
  setStatus("loading runtime");
  const fs = await FilesetResolver.forVisionTasks("./vendor/wasm");
  setStatus("loading models");

  const mk = async (Cls, path, extra) => {
    // GPU delegate where available; fall back to CPU rather than dying.
    try {
      return await Cls.createFromOptions(fs, {
        baseOptions: { modelAssetPath: path, delegate: "GPU" }, runningMode: "VIDEO", ...extra });
    } catch (e) {
      console.warn("GPU delegate failed, using CPU:", e.message);
      return await Cls.createFromOptions(fs, {
        baseOptions: { modelAssetPath: path, delegate: "CPU" }, runningMode: "VIDEO", ...extra });
    }
  };

  [face, pose, gesture] = await Promise.all([
    mk(FaceLandmarker, "./models/face_landmarker.task", { numFaces: 1 }),
    mk(PoseLandmarker, "./models/pose_landmarker_lite.task", { numPoses: 1 }),
    mk(GestureRecognizer, "./models/gesture_recognizer.task", { numHands: 2 }),
  ]);

  $("#backend").textContent = "MediaPipe · WASM/GPU";
  setStatus("starting camera");

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false });
  vid.srcObject = stream;
  await new Promise(r => vid.onloadedmetadata = r);
  await vid.play();
  cvs.width = vid.videoWidth; cvs.height = vid.videoHeight;

  setStatus(`camera live · ${vid.videoWidth}×${vid.videoHeight}`, true);
  show(0);
  requestAnimationFrame(loop);
  setTimeout(() => { armed = true; }, 1000);
}

/* =============== rep counter =============== */
let reps = 0, repState = "down";
function resetReps() { reps = 0; repState = "down"; put("reps", "0"); }

// angle ABC in degrees, from three normalised landmarks
function angleAt(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  return m ? Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180 / Math.PI : 0;
}

/* =============== gesture-driven navigation =============== */
let gestureNav = false, lastNav = 0;
const COOLDOWN_MS = 1200; // minimum gap between slide moves
const MIN_SCORE = 0.55;

// More than one way to say each direction: if one gesture reads poorly
// under the room's lighting, the other still works.
const NEXT = new Set(["Thumb_Up", "Open_Palm", "Victory"]);
const PREV = new Set(["Thumb_Down", "Closed_Fist"]);

function flash(msg) {
  const b = $("#gbadge");
  b.textContent = msg; b.classList.add("show");
  clearTimeout(flash._t); flash._t = setTimeout(() => b.classList.remove("show"), 1100);
}

/* Voting, not a continuous hold. A marginal gesture flickers to "None" for a
   frame or two; requiring an unbroken run meant it never accumulated. We keep
   the last VOTE_WINDOW samples and fire when enough of them agree. */
const VOTE_WINDOW = 9;
const VOTE_NEEDED = 4;
let votes = [];

function navSample(name, score) {
  if (!gestureNav) { votes.length = 0; return; }

  const usable = name && name !== "None" && score >= MIN_SCORE;
  const dir = usable ? (NEXT.has(name) ? "next" : PREV.has(name) ? "prev" : null) : null;
  votes.push(dir);
  if (votes.length > VOTE_WINDOW) votes.shift();

  const n = votes.filter(v => v === "next").length;
  const p = votes.filter(v => v === "prev").length;

  $("#hint").textContent = usable
    ? `seeing: ${name} ${(score * 100).toFixed(0)}%`
    : "seeing: no gesture";

  const now = performance.now();
  if (now - lastNav < COOLDOWN_MS) return;

  if (n >= VOTE_NEEDED && n > p)      { lastNav = now; votes.length = 0; flash("→  forward"); next(); }
  else if (p >= VOTE_NEEDED && p > n) { lastNav = now; votes.length = 0; flash("←  back");    prev(); }
}

/* =============== loop =============== */
let lastT = -1, frames = 0, clock = performance.now(), msAvg = 0;
let navTick = 0;
const NAV_EVERY = 3;   // recognise gestures on every 3rd frame

function loop() {
  const mode = slides[cur].dataset.demo;
  const needCamera = !!mode || gestureNav;

  if (needCamera && vid.readyState >= 2 && vid.currentTime !== lastT) {
    lastT = vid.currentTime;
    const ts = performance.now();

    if (mode) {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      ctx.drawImage(vid, 0, 0, cvs.width, cvs.height);
    }

    const t0 = performance.now();
    try {
      if (mode === "face") doFace(ts);
      else if (mode === "pose") doPose(ts);
      else if (mode === "gesture") doGesture(ts, true);   // this one navigates too

      // Navigation runs on EVERY slide, not just the gesture one — but at a
      // fraction of the frame rate. Nav needs ~10 Hz; the demo wants all of it.
      if (gestureNav && mode !== "gesture") {
        navTick++;
        if (navTick % NAV_EVERY === 0) doGesture(ts, false);
      }
    } catch (err) { console.error(err); }
    const dt = performance.now() - t0;

    if (mode) {
      msAvg = msAvg ? msAvg * 0.88 + dt * 0.12 : dt;
      put("ms", msAvg.toFixed(1));
      frames++;
      if (ts - clock >= 500) { put("fps", Math.round(frames * 1000 / (ts - clock))); frames = 0; clock = ts; }
    }
  }
  requestAnimationFrame(loop);
}

function doFace(ts) {
  const r = face.detectForVideo(vid, ts);
  if (!r.faceLandmarks?.length) { put("readout", "No face in frame."); return; }
  for (const lm of r.faceLandmarks) {
    draw.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: "#ffffff1c", lineWidth: 1 });
    for (const c of [
      FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
      FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, FaceLandmarker.FACE_LANDMARKS_LIPS,
      FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
    ]) draw.drawConnectors(lm, c, { color: "#3b8ae8dd", lineWidth: 2 });
  }
  put("readout", `${r.faceLandmarks[0].length} landmarks, each with an estimated depth.`);
}

function doPose(ts) {
  const r = pose.detectForVideo(vid, ts);
  if (!r.landmarks?.length) { put("readout", "Step back until your head and arms are in frame."); return; }
  const lm = r.landmarks[0];
  draw.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: "#3b8ae8", lineWidth: 4 });
  draw.drawLandmarks(lm, { color: "#f07a3f", radius: 4 });

  // left arm: 11 shoulder, 13 elbow, 15 wrist
  const [sh, el, wr] = [lm[11], lm[13], lm[15]];
  if (sh && el && wr && Math.min(sh.visibility ?? 1, el.visibility ?? 1, wr.visibility ?? 1) > 0.5) {
    const a = angleAt(sh, el, wr);
    put("angle", Math.round(a));
    const bar = field("repbar");
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, (165 - a) / 110 * 100))}%`;

    if (repState === "down" && a < 55)       { repState = "up"; }
    else if (repState === "up" && a > 150)   { repState = "down"; reps++; put("reps", reps); }

    put("readout", `Curl your left arm. State: ${repState}. Counting on the up→down transition.`);
  } else {
    put("readout", "Left arm not clearly visible.");
  }
}

const PRETTY = {
  Thumb_Up: "👍  Thumbs up", Thumb_Down: "👎  Thumbs down", Victory: "✌️  Victory",
  Open_Palm: "🖐  Open palm", Closed_Fist: "✊  Fist", Pointing_Up: "☝️  Pointing up",
  ILoveYou: "🤟  I love you",
};

function doGesture(ts, drawIt) {
  const r = gesture.recognizeForVideo(vid, ts);
  if (drawIt && r.landmarks?.length) {
    for (const lm of r.landmarks) {
      draw.drawConnectors(lm, GestureRecognizer.HAND_CONNECTIONS, { color: "#3b8ae8", lineWidth: 4 });
      draw.drawLandmarks(lm, { color: "#f07a3f", radius: 4 });
    }
  }
  const top = r.gestures?.[0]?.[0];
  const name = top?.categoryName, score = top?.score ?? 0;

  if (drawIt) {
    if (name && name !== "None") {
      put("gesturebig", PRETTY[name] ?? name);
      put("conf", Math.round(score * 100));
      put("readout", "Classified from 21 hand landmarks — no image leaves the page.");
    } else {
      put("gesturebig", "");
      put("conf", "—");
      put("readout", r.landmarks?.length ? "Hand tracked, no gesture matched." : "Hold a hand up to the camera.");
    }
  }
  navSample(name, score);
}

/* sponsor image is optional — don't let a missing file break the deck */
show(0);   // deck is usable before — and regardless of — the camera

const sp = $("#sponsor");
sp.onerror = () => { sp.style.display = "none"; $("#sponsorfallback").style.display = "block"; };
sp.src = "./sponsor.jpg";

init().catch(e => {
  console.error(e);
  // The deck keeps working. Only the live demos are lost.
  setStatus("no camera — slides only");
  $("#hint").textContent = "Demos unavailable: " + (e.message || e);
  $$("[data-stage]").forEach(h => {
    h.style.display = "grid";
    h.style.placeContent = "center";
    h.innerHTML = '<p style="color:#717a85;padding:2em;text-align:center;max-width:24em">' +
      'Live demo unavailable.<br><small>' + (e.message || e) + '</small></p>';
  });
});
