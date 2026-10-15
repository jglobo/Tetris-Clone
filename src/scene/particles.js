/**
 * particles.js — GPU particle bursts for line clears and hard drops.
 *
 * One InstancedMesh holds every particle in the game. Dead particles are
 * parked far off-screen at scale 0 rather than removed, so there is no
 * allocation or GC churn during play.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { colToX, rowToY } from './blocks.js';

const MAX = 1400;

export class Particles {
  constructor(scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.95, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX * 3), 3,
    );
    scene.add(this.mesh);

    this.p = [];
    for (let i = 0; i < MAX; i++) {
      this.p.push({
        alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 0.1, spin: 0, rot: 0,
        r: 1, g: 1, b: 1, gravity: -14, drag: 0.98,
      });
    }
    this.cursor = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this.clear();
  }

  clear() {
    for (const p of this.p) p.alive = false;
    this.flush();
  }

  /** Grab the next free particle slot, recycling the oldest if saturated. */
  _next() {
    for (let i = 0; i < MAX; i++) {
      const idx = (this.cursor + i) % MAX;
      if (!this.p[idx].alive) {
        this.cursor = (idx + 1) % MAX;
        return this.p[idx];
      }
    }
    const p = this.p[this.cursor];
    this.cursor = (this.cursor + 1) % MAX;
    return p;
  }

  emit(opts) {
    const {
      x, y, z = 0, count = 10, color = 0xffffff, speed = 5, spread = Math.PI * 2,
      dir = Math.PI / 2, size = 0.16, life = 0.7, gravity = -14, drag = 0.97,
    } = opts;
    this._c.set(color);
    for (let i = 0; i < count; i++) {
      const p = this._next();
      const a = dir + (Math.random() - 0.5) * spread;
      const sp = speed * (0.45 + Math.random() * 0.85);
      p.alive = true;
      p.x = x; p.y = y; p.z = z;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.vz = (Math.random() - 0.5) * sp * 0.5;
      p.life = 0;
      p.maxLife = life * (0.6 + Math.random() * 0.8);
      p.size = size * (0.5 + Math.random());
      p.spin = (Math.random() - 0.5) * 14;
      p.rot = Math.random() * Math.PI;
      p.r = this._c.r; p.g = this._c.g; p.b = this._c.b;
      p.gravity = gravity;
      p.drag = drag;
    }
  }

  /** A row of sparks shooting upward from a cleared line. */
  rowBurst(row, colorHex, intensity = 1) {
    const n = 11;
    for (let c = 0; c < 10; c++) {
      const x = colToX(c);
      const y = rowToY(row) + 0.5;
      this.emit({
        x: x + (Math.random() - 0.5) * 0.5,
        y,
        count: Math.round(n * intensity),
        color: colorHex,
        speed: 4.5 + Math.random() * 5,
        spread: Math.PI * 1.1,
        dir: Math.PI / 2,
        size: 0.14 + Math.random() * 0.12,
        life: 0.55 + Math.random() * 0.4,
        gravity: -11,
      });
    }
  }

  /** A tight impact puff where a piece slams down. */
  impact(col, row, colorHex, strength = 1) {
    this.emit({
      x: colToX(col),
      y: rowToY(row) + 0.45,
      count: Math.round(12 * strength),
      color: colorHex,
      speed: 3.2 * strength,
      spread: Math.PI * 1.4,
      dir: Math.PI / 2,
      size: 0.1,
      life: 0.36,
      gravity: -16,
      drag: 0.9,
    });
  }

  /** Celebration spray for a tetris / perfect clear. */
  celebrate(colorHex, spreadX, centerY) {
    for (let i = 0; i < 22; i++) {
      const x = (Math.random() - 0.5) * spreadX;
      this.emit({
        x, y: centerY,
        count: 3,
        color: colorHex,
        speed: 6 + Math.random() * 7,
        spread: Math.PI * 1.6,
        dir: Math.PI / 2,
        size: 0.13,
        life: 1.0,
        gravity: -7,
        drag: 0.985,
      });
    }
  }

  update(dt) {
    for (const p of this.p) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.maxLife) { p.alive = false; continue; }
      p.vy += p.gravity * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.vz *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;
    }
    this.flush();
  }

  /** Write every particle's transform + colour into the instance buffers. */
  flush() {
    for (let i = 0; i < MAX; i++) {
      const p = this.p[i];
      if (p.alive) {
        const t = 1 - p.life / p.maxLife;
        const s = p.size * (0.35 + t * 0.9);
        this._v.set(p.x, p.y, p.z);
        this._e.set(p.rot, p.rot * 0.7, p.rot * 0.4);
        this._q.setFromEuler(this._e);
        this._s.set(s, s, s);
        // Fade out by darkening toward black (additive blending).
        const f = Math.min(1, t * 1.8);
        this._m.compose(this._v, this._q, this._s);
        this.mesh.setMatrixAt(i, this._m);
        this.mesh.instanceColor.setXYZ(i, p.r * f, p.g * f, p.b * f);
      } else {
        this._m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this._m);
        this.mesh.instanceColor.setXYZ(i, 0, 0, 0);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}