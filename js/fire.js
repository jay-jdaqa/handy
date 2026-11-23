// Particle flames that pour out of fingertips. Draws on its own canvas layer,
// animating every display frame so flames stay smooth between tracking frames.
import { FINGERTIPS } from "./tracker.js";

const MAX_PARTICLES = 2500;

// Pre-rendered soft glow sprite; tinted per particle via globalAlpha + color stops.
function makeSprite(size, stops) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([t, col]) => grad.addColorStop(t, col));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

// Sprites from hottest to coolest; particles move through them as they age.
const SPRITES = [
  makeSprite(64, [[0, "rgba(255,255,240,1)"], [0.3, "rgba(255,240,170,0.8)"], [1, "rgba(255,200,80,0)"]]),
  makeSprite(64, [[0, "rgba(255,230,120,1)"], [0.4, "rgba(255,170,40,0.7)"], [1, "rgba(255,120,0,0)"]]),
  makeSprite(64, [[0, "rgba(255,150,30,0.9)"], [0.5, "rgba(230,70,10,0.5)"], [1, "rgba(180,20,0,0)"]]),
  makeSprite(64, [[0, "rgba(200,50,10,0.6)"], [0.6, "rgba(120,20,5,0.25)"], [1, "rgba(60,0,0,0)"]]),
];

export class FingerFire {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.allFingers = false;
    this.enabled = true;
    this.particles = [];
    this.tips = new Map(); // key -> {x, y, vx, vy, t}
    this._last = performance.now();
    requestAnimationFrame(this._tick);
  }

  // Call with each tracking frame.
  update(frame) {
    const w = this.canvas.width, h = this.canvas.height;
    const seen = new Set();
    for (const hand of frame?.hands || []) {
      const tips = this.allFingers ? FINGERTIPS : [8];
      for (const i of tips) {
        const p = hand.points[i];
        const key = `${hand.side}-${i}`;
        seen.add(key);
        const x = p.x * w, y = p.y * h;
        const prev = this.tips.get(key);
        const now = frame.timestamp;
        let vx = 0, vy = 0;
        if (prev && now > prev.t) {
          const dt = (now - prev.t) / 1000;
          // Smooth velocity so jitter doesn't spray flames.
          vx = prev.vx * 0.5 + ((x - prev.x) / dt) * 0.5;
          vy = prev.vy * 0.5 + ((y - prev.y) / dt) * 0.5;
        }
        // Size flames to the hand on screen, so a close-up hand on a phone gets big flames.
        const palm = Math.hypot((hand.points[0].x - hand.points[9].x) * w, (hand.points[0].y - hand.points[9].y) * h);
        const scale = Math.max(0.4, palm / 140);
        this.tips.set(key, { x, y, vx, vy, t: now, px: prev?.x ?? x, py: prev?.y ?? y, scale });
      }
    }
    for (const [key, tip] of this.tips) if (!seen.has(key)) this.tips.delete(key);
  }

  _emit(tip, dt) {
    const scale = tip.scale;
    const speed = Math.hypot(tip.vx, tip.vy) / scale; // px/s relative to hand size
    const flare = Math.min(1, speed / 1500);           // 0 calm .. 1 fast flick
    const rate = (this.allFingers ? 90 : 160) * (1 + flare * 2);
    const n = Math.min(40, Math.round(rate * dt + Math.random()));
    for (let k = 0; k < n && this.particles.length < MAX_PARTICLES; k++) {
      // Spread spawn points along the path since the last frame so fast moves leave a trail.
      const f = Math.random();
      const x = tip.px + (tip.x - tip.px) * f;
      const y = tip.py + (tip.y - tip.py) * f;
      const life = 0.45 + Math.random() * 0.45 + flare * 0.3;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 6 * scale,
        y: y + (Math.random() - 0.5) * 6 * scale,
        vx: tip.vx * 0.15 + (Math.random() - 0.5) * 60 * scale,
        vy: tip.vy * 0.15 - (120 + Math.random() * 160) * scale,
        size: (18 + Math.random() * 18) * scale * (1 + flare * 0.8),
        life, age: 0,
        wobble: Math.random() * Math.PI * 2,
        scale,
      });
    }
  }

  _tick = (now) => {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    const { ctx, canvas } = this;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.enabled) for (const tip of this.tips.values()) this._emit(tip, dt);
    // After emitting, the segment is consumed: future spawns start at the current tip.
    for (const tip of this.tips.values()) { tip.px = tip.x; tip.py = tip.y; }

    ctx.globalCompositeOperation = "lighter";
    const ps = this.particles;
    let j = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      const t = p.age / p.life;
      const scale = p.scale;
      p.wobble += dt * 8;
      p.vx += Math.sin(p.wobble) * 40 * scale * dt; // flicker
      p.vy -= 220 * scale * dt;                       // buoyancy: flames rise
      p.vx *= 0.97; p.vy *= 0.97;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const size = p.size * (1 - t * 0.7);
      // Pass through the white-hot stage quickly, linger in orange/red.
      const sprite = SPRITES[Math.min(SPRITES.length - 1, Math.floor(Math.sqrt(t) * SPRITES.length))];
      // Additive blending stacks up fast, so each particle stays fairly faint.
      ctx.globalAlpha = 0.6 * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
      ctx.drawImage(sprite, p.x - size, p.y - size, size * 2, size * 2);
      ps[j++] = p;
    }
    ps.length = j;
    ctx.globalAlpha = 1;
    requestAnimationFrame(this._tick);
  };
}
