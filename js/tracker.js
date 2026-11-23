// Hand tracking core. One HandTracker per camera.
//
// Each tracker owns a <video> element, runs MediaPipe Hand Landmarker on it,
// and emits a "frame" event with clean, render-agnostic data:
//
//   {
//     cameraId, timestamp, width, height,
//     hands: [{
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

let landmarkerPromise = null;

async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: 2,
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
    hands.sort((a, b) => (a.side < b.side ? -1 : 1));
    return {
      cameraId: this.cameraId,
      timestamp,
      width: this.video.videoWidth,
      height: this.video.videoHeight,
      hands,
    };
  }
}

export function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
