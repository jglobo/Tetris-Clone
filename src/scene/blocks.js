/**
 * blocks.js — pooled block meshes + the board's visual scaffolding.
 *
 * Blocks are shared-geometry InstancedMesh-style objects drawn from a free
 * list: creating/destroying meshes per frame is the classic way to make a
 * block game stutter, so we allocate up front and recycle.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { RoundedBoxGeometry } from '../../vendor/three/jsm/geometries/RoundedBoxGeometry.js';
import { PIECE_COLORS, makeBlockMaterial, makeGhostMaterial } from './palette.js';
import { COLS, ROWS } from '../tetris.js';

const UNIT = 1;                 // one cell in world units
const GAP = 0.06;               // visual gap between blocks
const BLOCK = UNIT - GAP;
const POOL_SIZE = 240;          // 200 settled + active + ghost + effect headroom

export class BlockPool {
  constructor(scene) {
    this.geometry = new RoundedBoxGeometry(BLOCK, BLOCK, BLOCK, 3, 0.12);
    this.group = new THREE.Group();
    this.group.name = 'blocks';
    scene.add(this.group);

    this.materials = {};
    for (const [name, c] of Object.entries(PIECE_COLORS)) {
      this.materials[name] = makeBlockMaterial(c.base);
      this.materials[`${name}Ghost`] = makeGhostMaterial(c.glow);
    }
    this.materials.clearWhite = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 1, depthWrite: false,
    });

    this.free = [];
    this.usedNow = []; // meshes acquired during the current frame
    for (let i = 0; i < POOL_SIZE; i++) {
      const m = new THREE.Mesh(this.geometry, this.materials.I);
      m.visible = false;
      m.matrixAutoUpdate = true;
      m.userData = { kind: 'free' };
      this.group.add(m);
      this.free.push(m);
    }
    this.used = 0;
  }

  acquire(kind = 'block', pieceName = 'I') {
    const mesh = this.free.pop();
    if (!mesh) return null; // pool exhausted — caller degrades gracefully
    const mat = kind === 'ghost' ? this.materials[`${pieceName}Ghost`]
      : kind === 'flash' ? this.materials.clearWhite
      : this.materials[pieceName];
    mesh.material = mat;
    mesh.visible = true;
    mesh.scale.set(1, 1, 1);
    mesh.rotation.set(0, 0, 0);
    mesh.position.set(0, 0, 0);
    mesh.userData = { kind, pieceName };
    this.used++;
    return mesh;
  }

  release(mesh) {
    if (!mesh) return;
    mesh.visible = false;
    mesh.userData = { kind: 'free' };
    if (!this.free.includes(mesh)) this.free.push(mesh);
    this.used = Math.max(0, this.used - 1);
  }

  /**
   * Place a block at a grid cell. World coords put column 0 at the left edge
   * of the board and row 0 (top visible row) at the top.
   *
   * NOTE: never clones materials here — this runs for every visible block on
   * every frame, so a per-frame clone would leak GPU programs continuously.
   * Fading is done with scale + a pre-baked flash material instead.
   */
  place(mesh, col, row, z = 0, opts = {}) {
    const { scale = 1, yOffset = 0, grow = 1 } = opts;
    mesh.position.set(colToX(col), rowToY(row) + yOffset, z);
    // `grow` animates a block popping in (0 -> 1) without touching materials.
    const s = scale * grow;
    mesh.scale.set(s, s, s);
    return mesh;
  }

  /** Release everything acquired during the previous frame. */
  releaseAll() {
    for (const m of this.usedNow) this.release(m);
    this.usedNow.length = 0;
  }

  _take(kind, pieceName) {
    const mesh = this.acquire(kind, pieceName);
    if (mesh) this.usedNow.push(mesh);
    return mesh;
  }

  dispose() {
    this.geometry.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
  }
}

/** Grid column -> world X (board is centred on the origin). */
export function colToX(col) {
  return (col - (COLS - 1) / 2) * UNIT;
}

/** Grid row (0 = top visible row) -> world Y (board bottom is y = 0). */
export function rowToY(row) {
  return (ROWS - row) * UNIT;
}

/**
 * The board's static furniture: back panel, grid lines, side walls, floor and
 * a soft glowing frame. Built once, never touched again.
 */
export function buildBoard(scene) {
  const g = new THREE.Group();
  g.name = 'board';

  const W = COLS * UNIT;
  const H = ROWS * UNIT;

  // Back panel — a dark slab that catches the blocks' bloom.
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshStandardMaterial({
      color: 0x070a16,
      roughness: 0.9,
      metalness: 0.1,
    }),
  );
  panel.position.set(0, H / 2, -0.62);
  panel.receiveShadow = false;
  g.add(panel);

  // Grid lines drawn as thin emissive planes on the back panel.
  const lineMat = new THREE.MeshBasicMaterial({
    color: 0x2a3566, transparent: true, opacity: 0.5,
  });
  const lines = new THREE.Group();
  const Z = -0.6;
  for (let c = 0; c <= COLS; c++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.022, H), lineMat);
    m.position.set(colToX(c - 0.5), H / 2, Z);
    lines.add(m);
  }
  for (let r = 0; r <= ROWS; r++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.022), lineMat);
    m.position.set(0, rowToY(r) + 0.5, Z);
    lines.add(m);
  }
  g.add(lines);

  // Side walls and floor: thin glowing slabs that frame the play area.
  const frameMat = new THREE.MeshPhysicalMaterial({
    color: 0x151c3a,
    emissive: 0x2a3f8a,
    emissiveIntensity: 0.55,
    metalness: 0.6,
    roughness: 0.25,
    clearcoat: 0.7,
  });
  const wallGeo = new THREE.BoxGeometry(0.12, H + 0.24, 0.7);
  const l = new THREE.Mesh(wallGeo, frameMat);
  l.position.set(-W / 2 - 0.06, H / 2, -0.28);
  const r = new THREE.Mesh(wallGeo, frameMat);
  r.position.set(W / 2 + 0.06, H / 2, -0.28);
  const floorGeo = new THREE.BoxGeometry(W + 0.36, 0.12, 0.7);
  const f = new THREE.Mesh(floorGeo, frameMat);
  f.position.set(0, -0.06, -0.28);
  g.add(l, r, f);

  // A faint glow strip behind the play field for depth.
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.05, H * 1.04),
    new THREE.MeshBasicMaterial({
      color: 0x0e1740, transparent: true, opacity: 0.5, depthWrite: false,
    }),
  );
  glow.position.set(0, H / 2, -0.66);
  g.add(glow);

  scene.add(g);
  return { group: g, width: W, height: H };
}

/**
 * An invisible plane covering the play field, used for raycasting clicks.
 * Created once and passed to the caller directly (no global proxy needed).
 */
export function buildBoardProxy(W, H) {
  const proxy = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  proxy.position.set(0, H / 2, 0.3);
  proxy.name = 'boardProxy';
  return proxy;
}

/** Convert a hit point on the proxy plane into a board cell, or null. */
export function pointToCell(point, W, H) {
  const col = Math.floor(point.x + W / 2);
  const row = Math.floor(H - point.y);
  if (col >= 0 && col < COLS && row >= 0 && row < ROWS) return { col, row };
  return null;
}