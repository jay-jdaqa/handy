// Small rotatable 3D view of both hands (drag to orbit, scroll to zoom).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CONNECTIONS, FINGERTIPS } from "./tracker.js?v=6";

const HAND_COLORS = { Left: 0x4fc3ff, Right: 0xffb347 };

export class HandView3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.position.set(0, 0.15, 2.0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(1, 2, 3);
    this.scene.add(dir);

    const grid = new THREE.GridHelper(2, 20, 0x335, 0x223);
    grid.position.y = -0.6;
    this.scene.add(grid);

    // Outline of the camera's view, so you can tell where "the screen" is.
    const frameGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.78, 1));
    this.frameLines = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({ color: 0x445566 }));
    this.scene.add(this.frameLines);

    this.hands = {};
    for (const side of ["Left", "Right"]) this.hands[side] = this._makeHand(HAND_COLORS[side]);

    this._resize();
    new ResizeObserver(() => this._resize()).observe(container);
    this._render();
  }

  _makeHand(color) {
    const group = new THREE.Group();
    const jointGeo = new THREE.SphereGeometry(1, 12, 12);
    const jointMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 0.6 });
    const joints = [];
    for (let i = 0; i < 21; i++) {
      const m = new THREE.Mesh(jointGeo, FINGERTIPS.includes(i) ? tipMat : jointMat);
      m.scale.setScalar(FINGERTIPS.includes(i) ? 0.018 : 0.012);
      group.add(m);
      joints.push(m);
    }
    const positions = new Float32Array(CONNECTIONS.length * 6);
    const boneGeo = new THREE.BufferGeometry();
    boneGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const bones = new THREE.LineSegments(boneGeo, new THREE.LineBasicMaterial({ color }));
    group.add(bones);
    group.visible = false;
    this.scene.add(group);
    return { group, joints, bones };
  }

  _resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(frame) {
    const aspect = frame && frame.height ? frame.width / frame.height : 16 / 9;
    this.frameLines.scale.set(aspect / 1.78, 1, 1);
    const seen = new Set();
    for (const hand of frame?.hands || []) {
      const h = this.hands[hand.side];
      if (!h || seen.has(hand.side)) continue;
      seen.add(hand.side);
      h.group.visible = true;
      // Screen x/y placed on the camera plane; relative z pulls joints toward the viewer.
      const v = hand.points.map((p) => new THREE.Vector3((p.x - 0.5) * aspect, 0.5 - p.y, -p.z * aspect));
      v.forEach((pos, i) => h.joints[i].position.copy(pos));
      const arr = h.bones.geometry.attributes.position.array;
      CONNECTIONS.forEach(([a, b], k) => {
        arr.set([v[a].x, v[a].y, v[a].z, v[b].x, v[b].y, v[b].z], k * 6);
      });
      h.bones.geometry.attributes.position.needsUpdate = true;
      h.bones.geometry.computeBoundingSphere();
    }
    for (const side of Object.keys(this.hands)) if (!seen.has(side)) this.hands[side].group.visible = false;
  }

  _render = () => {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._render);
  };
}
