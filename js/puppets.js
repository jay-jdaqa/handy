// Sock puppets on every tracked hand (up to 8). The fingers are the top jaw and
// the thumb is the bottom jaw: the mouth opens as the thumb moves away from the
// fingers. Googly eyes look the way the fingers point, and blink now and then.
// Draws on its own canvas layer and animates every display frame.
import { dist3 } from "./tracker.js?v=6";

// One felt colour per hand id: [felt, shade, highlight].
export const PUPPET_COLORS = [
  ["#3d8bff", "#1f4fae", "#9cc4ff"], // blue
  ["#ff8a1f", "#b8540a", "#ffc58a"], // orange
  ["#34c759", "#1d7a35", "#9ae6ad"], // green
  ["#a259ff", "#6427b0", "#d4b0ff"], // purple
  ["#ff4fa0", "#b0225f", "#ffaed2"], // pink
  ["#ffd21f", "#b08d00", "#fff09a"], // yellow
  ["#ff3b3b", "#a81616", "#ffa0a0"], // red
  ["#1fd1c4", "#0d8178", "#9ff2eb"], // teal
];

const LOST_MS = 200;   // stop drawing a hand this long after it leaves view
const SMOOTH = 0.55;   // per tracking frame: how far points move toward the new reading

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y);
const norm = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l }; };

// Convex hull (monotone chain) of 2D points.
function hull(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

// Closed smooth curve through the midpoints of a polygon (soft, felt-like corners).
function smoothPath(ctx, pts) {
  const n = pts.length;
  if (n < 3) return;
  const m0 = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m0.x, m0.y);
  for (let i = 0; i < n; i++) {
    const p = pts[i], m = mid(p, pts[(i + 1) % n]);
    ctx.quadraticCurveTo(p.x, p.y, m.x, m.y);
  }
  ctx.closePath();
}

export class HandPuppets {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.enabled = false;
    this.puppets = new Map(); // hand id -> state
    this._last = performance.now();
    requestAnimationFrame(this._tick);
  }

  // Call with each tracking frame.
  update(frame) {
    const w = this.canvas.width, h = this.canvas.height;
    const now = performance.now();
    for (const hand of frame?.hands || []) {
      const raw = hand.points.map((p) => ({ x: p.x * w, y: p.y * h }));
      let s = this.puppets.get(hand.id);
      if (!s) {
        s = {
          pts: raw, open: 0, openTarget: 0, gaze: { x: 0, y: 0 }, gazeTarget: { x: 0, y: 0 },
          nextBlink: now + 1000 + Math.random() * 3000, blinkStart: -1,
        };
        this.puppets.set(hand.id, s);
      } else {
        // A hand that reappears far away (or after a gap) snaps instead of sliding over.
        const jump = len(sub(raw[0], s.pts[0])) > len(sub(raw[0], raw[9])) * 3;
        s.pts = jump || now - s.seen > LOST_MS ? raw : s.pts.map((p, i) => ({
          x: lerp(p.x, raw[i].x, SMOOTH), y: lerp(p.y, raw[i].y, SMOOTH),
        }));
      }
      s.seen = now;

      const W = hand.world;
      if (W.length) {
        const palm = dist3(W[0], W[9]) || 0.08;
        // Mouth: gap between thumb tip and the index/middle fingertips, relative to palm length.
        const tips = { x: (W[8].x + W[12].x) / 2, y: (W[8].y + W[12].y) / 2, z: (W[8].z + W[12].z) / 2 };
        s.openTarget = clamp01((dist3(W[4], tips) / palm - 0.25) / 0.7);
        // Gaze: direction from the knuckles to the fingertips. World y is up and z is toward
        // the camera, so pointing at the camera leaves little sideways part: eyes look at you.
        const knuck = { x: (W[5].x + W[9].x) / 2, y: (W[5].y + W[9].y) / 2, z: (W[5].z + W[9].z) / 2 };
        const d = { x: tips.x - knuck.x, y: tips.y - knuck.y, z: tips.z - knuck.z };
        const l = Math.hypot(d.x, d.y, d.z) || 1;
        s.gazeTarget = { x: d.x / l, y: -d.y / l };
      }
    }
    for (const [id, s] of this.puppets) if (now - s.seen > 2000) this.puppets.delete(id);
  }

  _tick = (now) => {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.enabled) {
      const k = 1 - Math.exp(-dt * 18);
      for (const [id, s] of this.puppets) {
        if (now - s.seen > LOST_MS) continue;
        s.open = lerp(s.open, s.openTarget, k);
        s.gaze.x = lerp(s.gaze.x, s.gazeTarget.x, k * 0.8);
        s.gaze.y = lerp(s.gaze.y, s.gazeTarget.y, k * 0.8);
        if (s.blinkStart < 0 && now > s.nextBlink) s.blinkStart = now;
        let blink = 0;
        if (s.blinkStart >= 0) {
          const t = (now - s.blinkStart) / 160;
          blink = t < 1 ? Math.sin(t * Math.PI) : 0;
          if (t >= 1) { s.blinkStart = -1; s.nextBlink = now + 2000 + Math.random() * 4000; }
        }
        this._drawPuppet(s, PUPPET_COLORS[id % PUPPET_COLORS.length], blink);
      }
    }
    requestAnimationFrame(this._tick);
  };

  _drawPuppet(s, [felt, shade, light], blink) {
    const { ctx } = this;
    const P = s.pts;
    const palm = len(sub(P[0], P[9]));
    if (palm < 4) return;
    const tipsMid = mid(P[8], P[12]);
    const axis = norm(sub(tipsMid, P[9]));            // along the fingers
    const away = norm(sub(P[17], P[5]));              // across the hand, away from the thumb
    const pad = palm * 0.28;

    // Sleeve: a felt tube from the wrist down the arm.
    const back = norm(sub(P[0], P[9]));
    const elbow = add(P[0], back, palm * 3);
    ctx.lineCap = "round";
    ctx.strokeStyle = shade;
    ctx.lineWidth = palm * 1.25;
    ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); ctx.lineTo(elbow.x, elbow.y); ctx.stroke();
    ctx.strokeStyle = felt;
    ctx.lineWidth = palm * 1.1;
    ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); ctx.lineTo(elbow.x, elbow.y); ctx.stroke();
    // Striped cuff near the wrist.
    const cuff = add(P[0], back, palm * 0.9);
    ctx.strokeStyle = light;
    ctx.lineWidth = palm * 0.18;
    const perp = { x: -back.y, y: back.x };
    ctx.beginPath();
    ctx.moveTo(cuff.x + perp.x * palm * 0.55, cuff.y + perp.y * palm * 0.55);
    ctx.lineTo(cuff.x - perp.x * palm * 0.55, cuff.y - perp.y * palm * 0.55);
    ctx.stroke();

    // Head: the whole hand wrapped in felt, padded out from its outline.
    const H = hull(P);
    const c = H.reduce((a, p) => ({ x: a.x + p.x / H.length, y: a.y + p.y / H.length }), { x: 0, y: 0 });
    const body = H.map((p) => add(p, norm(sub(p, c)), pad));
    const grad = ctx.createRadialGradient(
      P[9].x + away.x * palm * 0.4, P[9].y + away.y * palm * 0.4, palm * 0.1,
      c.x, c.y, palm * 1.6);
    grad.addColorStop(0, light);
    grad.addColorStop(0.45, felt);
    grad.addColorStop(1, shade);
    ctx.fillStyle = grad;
    ctx.beginPath(); smoothPath(ctx, body); ctx.fill();
    ctx.strokeStyle = shade;
    ctx.lineWidth = palm * 0.06;
    ctx.stroke();

    // Mouth: thumb side is the lower lip, index side the upper lip. The gap between the
    // lips scales with how open the hand is, so a closed hand gives a closed mouth.
    const o = s.open;
    const pairs = [[4, 8], [3, 7], [2, 6], [1, 5]];
    const upper = [], lower = [];
    pairs.forEach(([a, b], i) => {
      const m = mid(P[a], P[b]);
      const half = sub(P[b], m);
      let u = add(m, half, o), l = add(m, half, -o);
      if (i === 0) { u = add(u, axis, pad * 0.7); l = add(l, axis, pad * 0.7); } // lips reach the felt edge
      upper.push(u); lower.push(l);
    });
    const hinge = add(mid(P[1], P[5]), axis, -palm * 0.05);
    const mouth = [...upper, hinge, ...[...lower].reverse()];

    if (o > 0.04) {
      ctx.save();
      ctx.beginPath(); smoothPath(ctx, mouth);
      const mg = ctx.createRadialGradient(hinge.x, hinge.y, 0, hinge.x, hinge.y, palm * 1.6);
      mg.addColorStop(0, "#1a0206");
      mg.addColorStop(1, "#7a0f22");
      ctx.fillStyle = mg;
      ctx.fill();
      ctx.clip();
      // Tongue rests on the lower (thumb) jaw.
      const tongue = add(mid(P[3], P[2]), sub(mid(P[7], P[6]), mid(P[3], P[2])), Math.max(0, 0.5 - o * 0.35));
      ctx.fillStyle = "#ff6b8a";
      ctx.beginPath();
      ctx.ellipse(tongue.x, tongue.y, palm * 0.55, palm * 0.28 * (0.6 + o * 0.6),
        Math.atan2(axis.y, axis.x), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(160,20,50,0.6)";
      ctx.lineWidth = palm * 0.03;
      ctx.beginPath();
      ctx.moveTo(tongue.x - axis.x * palm * 0.35, tongue.y - axis.y * palm * 0.35);
      ctx.lineTo(tongue.x + axis.x * palm * 0.1, tongue.y + axis.y * palm * 0.1);
      ctx.stroke();
      ctx.restore();
    }
    // Lips: a thick darker seam around the mouth (just a line when shut).
    ctx.strokeStyle = shade;
    ctx.lineWidth = palm * 0.1;
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (o > 0.04) smoothPath(ctx, mouth);
    else {
      const seam = upper.map((u, i) => mid(u, lower[i]));
      ctx.moveTo(seam[0].x, seam[0].y);
      for (const p of seam.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.lineTo(hinge.x, hinge.y);
    }
    ctx.stroke();

    // Pom-pom nose at the tip of the top jaw.
    const nose = add(add(P[8], axis, pad * 0.55), away, palm * 0.32);
    const ng = ctx.createRadialGradient(nose.x - palm * 0.06, nose.y - palm * 0.06, 0, nose.x, nose.y, palm * 0.2);
    ng.addColorStop(0, "#fff");
    ng.addColorStop(0.35, light);
    ng.addColorStop(1, shade);
    ctx.fillStyle = ng;
    ctx.beginPath(); ctx.arc(nose.x, nose.y, palm * 0.2, 0, Math.PI * 2); ctx.fill();

    // Googly eyes on top of the head (the side away from the thumb).
    const eyeR = palm * 0.27;
    const eyeBase = add(mid(P[10], P[14]), away, palm * 0.5);
    const eyes = [add(eyeBase, axis, -palm * 0.05), add(eyeBase, axis, -palm * 0.62)];
    for (const e of eyes) {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#222";
      ctx.lineWidth = palm * 0.035;
      ctx.beginPath(); ctx.arc(e.x, e.y, eyeR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const look = { x: s.gaze.x * eyeR * 0.5, y: s.gaze.y * eyeR * 0.5 };
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.arc(e.x + look.x, e.y + look.y, eyeR * 0.48, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath(); ctx.arc(e.x + look.x - eyeR * 0.16, e.y + look.y - eyeR * 0.18, eyeR * 0.13, 0, Math.PI * 2); ctx.fill();
      if (blink > 0) {
        // Felt eyelid sweeping down over the eye.
        ctx.save();
        ctx.beginPath(); ctx.arc(e.x, e.y, eyeR + palm * 0.02, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = felt;
        ctx.fillRect(e.x - eyeR * 1.2, e.y - eyeR * 1.2, eyeR * 2.4, eyeR * 2.4 * blink);
        ctx.restore();
      }
    }
  }
}
