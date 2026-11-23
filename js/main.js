import { HandTracker, listCameras, JOINT_NAMES } from "./tracker.js";
import { drawOverlay } from "./overlay.js";
import { HandView3D } from "./view3d.js";
import { FingerFire } from "./fire.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
const overlay = $("overlay");
const startBtn = $("start");
const camSelect = $("camera");
const statusEl = $("status");
const dataEl = $("data");
const fpsEl = $("fps");

const tracker = new HandTracker({ cameraId: "cam0", video });
const view3d = new HandView3D($("view3d"));
const fireCanvas = $("fire");
const fire = new FingerFire(fireCanvas);
$("fireOn").addEventListener("change", (e) => (fire.enabled = e.target.checked));
$("fireAll").addEventListener("change", (e) => (fire.allFingers = e.target.checked));

// Public API for later steps (lines, sound) and for poking at in the console:
//   handy.latest                     -> most recent frame
//   handy.on(frame => { ... })       -> subscribe to every frame
//   handy.JOINT_NAMES                -> index -> name
window.handy = {
  get latest() { return tracker.latest; },
  on(fn) {
    const h = (e) => fn(e.detail);
    tracker.addEventListener("frame", h);
    return () => tracker.removeEventListener("frame", h);
  },
  tracker,
  JOINT_NAMES,
};

tracker.addEventListener("frame", (e) => {
  const frame = e.detail;
  if (overlay.width !== frame.width || overlay.height !== frame.height) {
    overlay.width = frame.width;
    overlay.height = frame.height;
    fireCanvas.width = frame.width;
    fireCanvas.height = frame.height;
    $("stage").style.aspectRatio = `${frame.width} / ${frame.height}`;
  }
  drawOverlay(overlay, frame);
  view3d.update(frame);
  fire.update(frame);
});

// Text readout at ~10 Hz so it stays readable.
setInterval(() => {
  fpsEl.textContent = tracker.running ? `${tracker.fps.toFixed(0)} fps` : "";
  const f = tracker.latest;
  if (!f) return;
  if (!f.hands.length) { dataEl.textContent = "No hands in view"; return; }
  dataEl.textContent = f.hands.map((h) => {
    const t = h.joints.indexTip;
    return `${h.side} hand  (${(h.score * 100).toFixed(0)}%)\n` +
      `  index tip  x ${t.x.toFixed(3)}  y ${t.y.toFixed(3)}  z ${t.z.toFixed(3)}\n` +
      `  pinch      ${h.pinch?.toFixed(1)} cm`;
  }).join("\n\n");
}, 100);

async function refreshCameras() {
  const cams = await listCameras();
  const current = camSelect.value;
  camSelect.innerHTML = "";
  cams.forEach((c, i) => {
    const o = document.createElement("option");
    o.value = c.deviceId;
    o.textContent = c.label || `Camera ${i + 1}`;
    camSelect.appendChild(o);
  });
  if (current) camSelect.value = current;
  camSelect.hidden = cams.length < 2;
}

async function start(deviceId) {
  startBtn.disabled = true;
  statusEl.textContent = "Loading hand model…";
  try {
    await tracker.start(deviceId);
    statusEl.textContent = "";
    $("intro").hidden = true;
    await refreshCameras();
    const activeId = tracker.stream?.getVideoTracks()[0]?.getSettings().deviceId;
    if (activeId) camSelect.value = activeId;
  } catch (err) {
    console.error(err);
    statusEl.textContent = err.name === "NotAllowedError"
      ? "Camera permission was blocked. Allow it in the address bar and try again."
      : `Couldn't start: ${err.message || err}`;
    startBtn.disabled = false;
  }
}

startBtn.addEventListener("click", () => start());
camSelect.addEventListener("change", () => start(camSelect.value));
