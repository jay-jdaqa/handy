// Draws the green skeleton and red joints over the video, in screen space.
import { CONNECTIONS, FINGERTIPS } from "./tracker.js?v=6";

export function drawOverlay(canvas, frame, { showLabels = true, showSkeleton = true } = {}) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!frame || !showSkeleton) return;
  const scale = Math.min(w, h) / 720; // consistent line weights in landscape and portrait

  for (const hand of frame.hands) {
    const P = hand.points.map((p) => [p.x * w, p.y * h, p.z]);

    ctx.lineCap = "round";
    ctx.strokeStyle = "#2ee86b";
    ctx.lineWidth = 4 * scale;
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      ctx.moveTo(P[a][0], P[a][1]);
      ctx.lineTo(P[b][0], P[b][1]);
    }
    ctx.stroke();

    P.forEach(([x, y, z], i) => {
      // Closer joints (more negative z) draw slightly bigger.
      const r = Math.max(3, (6 - z * 40)) * scale;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (FINGERTIPS.includes(i)) {
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.fill();
        ctx.strokeStyle = "#ff3b3b";
        ctx.lineWidth = 2.5 * scale;
        ctx.stroke();
      } else {
        ctx.fillStyle = "#ff3b3b";
        ctx.fill();
      }
    });

    if (showLabels) {
      const [wx, wy] = P[0];
      ctx.font = `${Math.round(22 * scale)}px system-ui, sans-serif`;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      const label = `${hand.side}${hand.pinch != null ? ` · pinch ${hand.pinch.toFixed(1)} cm` : ""}`;
      const tw = ctx.measureText(label).width;
      ctx.fillRect(wx - tw / 2 - 8 * scale, wy + 14 * scale, tw + 16 * scale, 30 * scale);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, wx, wy + 29 * scale);
    }
  }
}
