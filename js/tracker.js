// Hand tracking core. One HandTracker per camera.
//
// Each tracker owns a <video> element, runs MediaPipe Hand Landmarker on it,
// and emits a "frame" event with clean, render-agnostic data:
//
//   {
//     cameraId, timestamp, width, height,
//     hands: [{
//       id,                          // stable 0..7 while the hand stays in view
//       side: "Left" | "Right",      // the person's actual hand
//       score,                       // handedness confidence 0..1
//       points: [{x, y, z}] x21,     // x,y in 0..1 screen space (mirrored, as you see yourself),
//                                    // z relative depth (smaller = closer to camera), same scale as x
//       world:  [{x, y, z}] x21,     // metres, origin at the hand's centre (true hand shape)
//       joints: { wrist, thumbTip, indexTip, ... },  // named shortcuts into points
//       pinch:  cm between thumb tip and index tip (from world coords)
//     }]
//   }
//
// Stereo later: create a second HandTracker on the other camera and feed both
// frames (same timestamp window) to a triangulator. Nothing here assumes one camera.

import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export const JOINT_NAMES = [
  "wrist",
  "thumbCmc", "thumbMcp", "thumbIp", "thumbTip",
  "indexMcp", "indexPip", "indexDip", "indexTip",
  "middleMcp", "middlePip", "middleDip", "middleTip",
  "ringMcp", "ringPip", "ringDip", "ringTip",
  "pinkyMcp", "pinkyPip", "pinkyDip", "pinkyTip",
];

export const FINGERTIPS = [4, 8, 12, 16, 20];

// Bone pairs for drawing the skeleton.
export const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

// Up to 8 hands, so a few people can play at once. Each hand gets a stable
// `id` (0..7) that follows it from frame to frame, so effects keep their colour.
export const MAX_HANDS = 8;

async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: MAX_HANDS,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, opts("GPU"));
  } catch (e) {
    console.warn("GPU delegate failed, falling back to CPU", e);
    return await HandLandmarker.createFromOptions(fileset, opts("CPU"));
  }
}

export async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
}

export class HandTracker extends EventTarget {
  constructor({ cameraId = "cam0", video } = {}) {
    super();
    this.cameraId = cameraId;
    this.video = video || document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
    this.stream = null;
    this.landmarker = null;
    this.running = false;
    this.latest = null;
    this.fps = 0;
    this._lastVideoTime = -1;
    this._lastTs = 0;
    this._tracks = []; // [{id, x, y, t}] last known palm centre of each hand id
  }

  async start(deviceId) {
    this.stop();
    // Each tracker gets its own landmarker instance (VIDEO mode keeps per-stream state).
    if (!this.landmarker) this.landmarker = await createLandmarker();
    const constraints = {
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
      },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  _loop = () => {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this._lastVideoTime) {
      this._lastVideoTime = v.currentTime;
      const now = performance.now();
      const result = this.landmarker.detectForVideo(v, now);
      const frame = this._toFrame(result, now);
      this.latest = frame;
      if (this._lastTs) {
        const inst = 1000 / (now - this._lastTs);
        this.fps = this.fps ? this.fps * 0.9 + inst * 0.1 : inst;
      }
      this._lastTs = now;
      this.dispatchEvent(new CustomEvent("frame", { detail: frame }));
    }
    requestAnimationFrame(this._loop);
  };

  _toFrame(result, timestamp) {
    const hands = (result.landmarks || []).map((lm, i) => {
      const cat = result.handedness?.[i]?.[0];
      // We feed the raw (unmirrored) camera image; the Tasks API label then matches
      // the person's actual hand (verified against known left/right test images).
      const side = cat?.categoryName === "Left" ? "Left" : "Right";
      const points = lm.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
      const world = (result.worldLandmarks?.[i] || []).map((p) => ({ x: -p.x, y: -p.y, z: -p.z }));
      const joints = {};
      JOINT_NAMES.forEach((name, j) => (joints[name] = points[j]));
      const pinch = world.length ? dist3(world[4], world[8]) * 100 : null;
      return { side, score: cat?.score ?? 0, points, world, joints, pinch };
    });
    this._assignIds(hands, timestamp);
    hands.sort((a, b) => a.id - b.id);
    return {
      cameraId: this.cameraId,
      timestamp,
      width: this.video.videoWidth,
      height: this.video.videoHeight,
      hands,
    };
  }
}

// Match each hand to the nearest hand from recent frames by palm centre, so ids
// (and puppet colours) stay put while hands move. Unmatched hands take the lowest
// free id. A hand that drops out briefly keeps its id for a second.
HandTracker.prototype._assignIds = function (hands, now) {
  const KEEP_MS = 1000, MAX_JUMP = 0.25;
  this._tracks = this._tracks.filter((t) => now - t.t < KEEP_MS);
  const centres = hands.map((h) => ({
    x: (h.points[0].x + h.points[9].x) / 2,
    y: (h.points[0].y + h.points[9].y) / 2,
  }));
  const pairs = [];
  hands.forEach((_, i) => this._tracks.forEach((t, k) => {
    const d = Math.hypot(centres[i].x - t.x, centres[i].y - t.y);
    if (d < MAX_JUMP) pairs.push([d, i, k]);
  }));
  pairs.sort((a, b) => a[0] - b[0]);
  const handTaken = new Set(), trackTaken = new Set();
  for (const [, i, k] of pairs) {
    if (handTaken.has(i) || trackTaken.has(k)) continue;
    handTaken.add(i); trackTaken.add(k);
    hands[i].id = this._tracks[k].id;
  }
  const used = new Set(this._tracks.map((t) => t.id));
  hands.forEach((h) => {
    if (h.id != null) return;
    let id = 0;
    while (used.has(id) && id < MAX_HANDS * 4) id++;
    used.add(id);
    h.id = id;
  });
  hands.forEach((h, i) => {
    const t = this._tracks.find((t) => t.id === h.id);
    if (t) Object.assign(t, centres[i], { t: now });
    else this._tracks.push({ id: h.id, ...centres[i], t: now });
  });
};

export function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
