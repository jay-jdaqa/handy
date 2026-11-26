// Glinda Mode: pink blossoms bud at the fingertips, bloom, then drift down,
// trailing little sparkles. Reuses FingerFire's fingertip tracking and loop.
import { FingerFire } from "./fire.js?v=6";

const MAX_FLOWERS = 260;
const MAX_SPARKLES = 600;

// [outer petal, inner petal, edge] colour sets: rose, blush, magenta, bubblegum, orchid.
const PALETTES = [
  ["#ff4f9a", "#ffc2dc", "#d81b72"],
  ["#ff9ec7", "#fff0f6", "#f06ba3"],
  ["#e0218a", "#ff9cd0", "#a3105f"],
  ["#ff77b8", "#ffe1ef", "#e0408a"],
  ["#f25fd0", "#ffd3f4", "#b52f9c"],
];

function makeFlower(size, [outer, inner, edge], petals) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const r = size / 2;
  g.translate(r, r);

  // Soft glow behind the bloom.
  const glow = g.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
  glow.addColorStop(0, "rgba(255,180,220,0.35)");
  glow.addColorStop(1, "rgba(255,180,220,0)");
  g.fillStyle = glow;
  g.fillRect(-r, -r, size, size);

  const petal = (len, wid, fill) => {
    for (let i = 0; i < petals; i++) {
      g.save();
      g.rotate((i / petals) * Math.PI * 2);
      const grad = g.createLinearGradient(0, 0, 0, -len);
      grad.addColorStop(0, inner);
      grad.addColorStop(0.55, fill);
      grad.addColorStop(1, edge);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(wid, -len * 0.3, wid * 0.9, -len * 0.85, 0, -len);
      g.bezierCurveTo(-wid * 0.9, -len * 0.85, -wid, -len * 0.3, 0, 0);
      g.fill();
      g.strokeStyle = "rgba(255,255,255,0.35)";
      g.lineWidth = size / 128;
      g.beginPath();
      g.moveTo(0, -len * 0.15);
      g.lineTo(0, -len * 0.7);
      g.stroke();
      g.restore();
    }
  };
  petal(r * 0.78, r * 0.42, outer);
  g.rotate(Math.PI / petals);
  petal(r * 0.5, r * 0.28, inner);

  // White heart with golden stamens.
  const heart = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.18);
  heart.addColorStop(0, "#fffdf5");
  heart.addColorStop(1, "rgba(255,240,250,0)");
  g.fillStyle = heart;
  g.beginPath();
  g.arc(0, 0, r * 0.18, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffd76a";
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, d = r * 0.1;
    g.beginPath();
    g.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.025, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function makeSparkle(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,200,235,0.8)");
  grad.addColorStop(1, "rgba(255,120,200,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // Four-point twinkle.
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath();
  g.moveTo(r, 0); g.lineTo(r + r * 0.08, r); g.lineTo(r, size); g.lineTo(r - r * 0.08, r); g.closePath();
  g.moveTo(0, r); g.lineTo(r, r - r * 0.08); g.lineTo(size, r); g.lineTo(r, r + r * 0.08); g.closePath();
  g.fill();
  return c;
}

const FLOWERS = PALETTES.flatMap((p) => [makeFlower(128, p, 5), makeFlower(128, p, 6)]);
const SPARKLE = makeSparkle(32);

// Ease-out with a little overshoot, so blooms "pop" open.
const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

export class FingerFlowers extends FingerFire {
  constructor(canvas) {
    super(canvas);
    this.enabled = false;
    this.sparkles = [];
  }

  _emit(tip, dt) {
    const scale = tip.scale;
    const speed = Math.hypot(tip.vx, tip.vy) / scale;
    const flare = Math.min(1, speed / 1200);
    const rate = (this.allFingers ? 3 : 6) * (1 + flare * 4);
    // Accumulate fractional spawns: at 60 fps a few flowers per second is well under one per frame.
    tip.acc += rate * dt;
    const n = Math.min(4, Math.floor(tip.acc));
    tip.acc -= n;
    for (let k = 0; k < n && this.particles.length < MAX_FLOWERS; k++) {
      const f = Math.random();
      const life = 2.6 + Math.random() * 1.6;
      const ang = Math.random() * Math.PI * 2;
      this.particles.push({
        x: tip.px + (tip.x - tip.px) * f,
        y: tip.py + (tip.y - tip.py) * f,
        vx: tip.vx * 0.2 + Math.cos(ang) * 40 * scale,
        vy: tip.vy * 0.2 + Math.sin(ang) * 30 * scale - 50 * scale,
        size: (30 + Math.random() * 26) * scale,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 2,
        sprite: FLOWERS[(Math.random() * FLOWERS.length) | 0],
        sway: Math.random() * Math.PI * 2,
        life, age: 0, scale,
      });
    }
    // Sparkles stream steadily from each tip.
    tip.sacc += (25 + flare * 60) * dt;
    const sn = Math.floor(tip.sacc);
    tip.sacc -= sn;
    for (let k = 0; k < sn && this.sparkles.length < MAX_SPARKLES; k++) {
      this.sparkles.push({
        x: tip.x + (Math.random() - 0.5) * 16 * scale,
        y: tip.y + (Math.random() - 0.5) * 16 * scale,
        vx: (Math.random() - 0.5) * 50 * scale,
        vy: (Math.random() - 0.5) * 50 * scale - 20 * scale,
        size: (4 + Math.random() * 7) * scale,
        life: 0.5 + Math.random() * 0.7, age: 0, scale,
        tw: Math.random() * 10,
      });
    }
  }

  _draw(dt) {
    const { ctx } = this;
    ctx.globalCompositeOperation = "source-over";
    const ps = this.particles;
    let j = 0;
    for (const p of ps) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const t = p.age / p.life;
      const s = p.scale;
      p.sway += dt * 2.2;
      p.vx = p.vx * 0.96 + Math.sin(p.sway) * 25 * s * dt; // flutter side to side
      p.vy = p.vy * 0.96 + 45 * s * dt;                     // drift gently down
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      const bloom = t < 0.22 ? Math.max(0.15, easeOutBack(t / 0.22)) : 1;
      const size = p.size * bloom;
      ctx.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      // Tilt as it falls, like a petal catching the air.
      ctx.scale(1, 0.75 + 0.25 * Math.cos(p.sway));
      ctx.drawImage(p.sprite, -size, -size, size * 2, size * 2);
      ctx.restore();
      ps[j++] = p;
    }
    ps.length = j;

    ctx.globalCompositeOperation = "lighter";
    const sp = this.sparkles;
    j = 0;
    for (const p of sp) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const t = p.age / p.life;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.tw += dt * 18;
      ctx.globalAlpha = (1 - t) * (0.6 + 0.4 * Math.sin(p.tw));
      const size = p.size * (1 - t * 0.5);
      ctx.drawImage(SPARKLE, p.x - size, p.y - size, size * 2, size * 2);
      sp[j++] = p;
    }
    sp.length = j;
  }
}
