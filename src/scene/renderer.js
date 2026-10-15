/**
 * renderer.js — the WebGL presentation layer.
 *
 * Owns the three.js scene, camera, lighting, post-processing chain and the
 * frame loop. Reads game state from tetris.js and drives the block pool,
 * particles and screen effects from it. Knows nothing about the DOM or input.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { RoomEnvironment } from '../../vendor/three/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from '../../vendor/three/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/three/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../vendor/three/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../../vendor/three/jsm/postprocessing/OutputPass.js';
import { BlockPool, buildBoard, colToX, rowToY } from './blocks.js';
import { Particles } from './particles.js';
import { PIECE_COLORS, UI_COLORS } from './palette.js';
import { COLS, ROWS } from '../tetris.js';

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.clock = new THREE.Clock();

    // ---------------------------------------------------------- core setup
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(UI_COLORS.bg0);
    this.scene.fog = new THREE.FogExp2(UI_COLORS.bg0, 0.018);

    const W = COLS;
    const H = ROWS;
    this.board = buildBoard(this.scene);
    this.W = this.board.width;
    this.H = this.board.height;

    this.camera = new THREE.PerspectiveCamera(
      38, 1, 0.1, 200,
    );
    // Slight tilt and off-axis framing so the field reads as a 3D object.
    this.baseCamPos = new THREE.Vector3(0, H * 0.62, 26);
    this.camera.position.copy(this.baseCamPos);
    this.camera.lookAt(0, H * 0.5, 0);

    this.setupLights();
    this.setupPost();

    this.pool = new BlockPool(this.scene);
    this.particles = new Particles(this.scene);

    // ------------------------------------------------ per-frame bookkeeping
    this.shake = 0;          // camera shake intensity (decays)
    this.flash = 0;          // full-screen white flash (decays)
    this.dangerGlow = 0;     // red pulse when the stack is high
    this.activeMeshes = [];
    this.clearAnims = [];    // in-flight line-clear animations
    this.spawnPop = 0;       // 0..1 pop animation for a newly spawned piece
    this.tilt = 0;           // subtle camera parallax target
    // Set when on-screen touch controls are visible: reserves the bottom strip
    // so the board is never hidden behind the buttons.
    this.touchMode = false;
    this.controlsHeight = 0;

    this.bindGameEvents();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.running = true;
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  setupLights() {
    this.scene.add(new THREE.AmbientLight(0x4a5a9a, 0.6));

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(6, 18, 14);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x6688ff, 0.7);
    rim.position.set(-10, 6, -8);
    this.scene.add(rim);

    // A coloured point light near the stack height for local warmth.
    this.stackLight = new THREE.PointLight(0x66ccff, 12, 40, 2);
    this.stackLight.position.set(0, this.H * 0.4, 6);
    this.scene.add(this.stackLight);

    // Environment map gives the blocks their glossy reflections.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
  }

  setupPost() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.42,   // strength — high enough to glow, low enough to keep block colour
      0.5,    // radius
      0.78,   // threshold — only the brightest highlights bloom, not whole blocks
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /** Tell the renderer whether on-screen controls are shown, then reframe. */
  setTouchMode(on) {
    if (this.touchMode === !!on) return;
    this.touchMode = !!on;
    this.resize();
  }

  resize() {
    const el = this.canvas.parentElement || document.body;
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;

    // Frame the board. Pieces spawn partly above the top visible row, so leave
    // headroom above the frame rather than letting them render off-board.
    const viewAspect = w / h;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const HEADROOM = 3.2;                 // empty space above the play field
    const worldH = this.H + HEADROOM;

    // On touch layouts the on-screen controls occupy the bottom strip, so the
    // playable band is shorter than the window. Fit the board to that band and
    // sit it inside it, otherwise the lowest rows hide behind the buttons.
    const controlsHeight = this.touchMode ? Math.min(h * 0.16, 96) : 0;
    const usable = Math.max(140, h - controlsHeight);

    // Distance so the board's world height maps into `usable` pixels.
    const needVisibleWorldH = worldH * (h / usable);
    const distH = needVisibleWorldH / (2 * Math.tan(vFov / 2));
    const distW = (this.W + 2.5) / (2 * Math.tan(vFov / 2) * viewAspect);
    const dist = Math.max(distH, distW);

    // Solve the camera height that puts the board's floor (world y = 0) exactly
    // at the bottom of the usable band. Screen centre shows camY and one pixel
    // is worldPerPx world units, so:
    //   world y at pixel py = camY + (h/2 - py) * worldPerPx
    // requiring y(usable) = 0 gives camY = (usable - h/2) * worldPerPx.
    // Do NOT add an extra headroom offset here: the board's spawn area is
    // already covered by the distance calc above, and any extra term pushes
    // the lowest row down behind the controls.
    const visibleWorldH = 2 * dist * Math.tan(vFov / 2);
    const worldPerPx = visibleWorldH / h;
    const camY = (usable - h / 2) * worldPerPx;

    this.baseCamPos.set(0, camY, dist);
    this.camera.position.copy(this.baseCamPos);
    this.camera.updateProjectionMatrix();
    this.lookTargetY = camY;
    this.controlsHeight = controlsHeight;
  }
  // ------------------------------------------------------- game event wiring

  bindGameEvents() {
    const g = this.game;
    g.on('move', () => {});
    g.on('rotate', () => {});
    g.on('harddrop', ({ dist, piece }) => {
      if (dist <= 0) return;
      const gy = this.game.ghostY();
      this.addShake(0.18 + Math.min(dist * 0.01, 0.25));
      for (const [c] of this.game.cells({ ...piece, y: gy })) {
        this.particles.impact(c, gy, PIECE_COLORS[piece.name].glow, 0.8);
      }
    });
    g.on('lock', ({ piece, tspin }) => {
      if (tspin) { this.addShake(0.35); this.flash = Math.max(this.flash, 0.28); }
    });
    g.on('spawn', () => { this.spawnPop = 1; });
    g.on('clear', ({ rows, lineCount, perfect, label }) => {
      this.onLineClear(rows, lineCount, perfect, label);
    });
    g.on('gameover', () => {
      this.addShake(1.2);
      this.flash = 0.5;
    });
    g.on('levelup', () => {
      this.addShake(0.25);
      this.particles.celebrate(0xffd93d, this.W, this.H * 0.8);
    });
  }

  onLineClear(rows, lineCount, perfect, label) {
    const H = this.H;
    const accent = label?.tspin ? 0xc084fc : (lineCount === 4 ? 0xffd93d : 0xffffff);

    this.addShake(0.25 + lineCount * 0.18);
    this.flash = Math.min(0.5, 0.14 + lineCount * 0.09);

    for (const r of rows) {
      this.particles.rowBurst(r, accent, 0.8 + lineCount * 0.3);
      // White shockwave plane that expands across the cleared row.
      this.spawnShockwave(r, accent);
    }
    if (lineCount >= 4 || perfect) {
      this.particles.celebrate(perfect ? 0xffffff : 0xffd93d, this.W, H * (rows[0] ?? 10) * 0 + H * 0.5);
    }
  }

  spawnShockwave(row, colorHex) {
    const geo = new THREE.PlaneGeometry(this.W + 2, 0.5);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, rowToY(row) + 0.5, 0.4);
    m.scale.x = 0.2;
    this.scene.add(m);
    this.clearAnims.push({
      mesh: m, t: 0, dur: 0.5, kind: 'wave',
      geo, mat,
    });
  }

  addShake(amount) { this.shake = Math.min(1.4, this.shake + amount); }

  // ------------------------------------------------------------ frame logic

  /** Rebuild the visible block set from game state. Runs every frame. */
  syncBlocks(dt) {
    const pool = this.pool;
    // Everything acquired last frame goes back to the free list first, so the
    // pool cycles a fixed set of meshes instead of draining and vanishing.
    pool.releaseAll();
    this.activeMeshes.length = 0;

    // Settled blocks from the grid.
    const BUFFER = 4;
    const grid = this.game.grid;
    for (let r = 0; r < ROWS; r++) {
      const row = grid[r + BUFFER];
      if (!row) continue;
      for (let c = 0; c < COLS; c++) {
        const name = row[c];
        if (!name) continue;
        const mesh = pool._take('block', name);
        if (mesh) {
          pool.place(mesh, c, r);
          this.activeMeshes.push(mesh);
        }
      }
    }

    // Active piece with a spawn "pop".
    const active = this.game.active;
    if (active && this.game.state !== 'clearing') {
      const pop = 1 - this.spawnPop * 0.85; // shrink in from 1.15 -> settles to 1
      for (const [c, r] of this.game.cells()) {
        const mesh = pool._take('block', active.name);
        if (mesh) {
          pool.place(mesh, c, r, 0.05, { grow: pop });
          this.activeMeshes.push(mesh);
        }
      }
      // Ghost piece at the landing position.
      if (this.game.state === 'falling') {
        const gy = this.game.ghostY();
        for (const [c, r] of this.game.cells({ ...active, y: gy })) {
          const mesh = pool._take('ghost', active.name);
          if (mesh) {
            pool.place(mesh, c, r, -0.1, { grow: pop });
            this.activeMeshes.push(mesh);
          }
        }
      }
    }

    this.spawnPop = Math.max(0, this.spawnPop - dt * 5);
  }

  updateEffects(dt) {
    // Clear-row shockwaves.
    for (let i = this.clearAnims.length - 1; i >= 0; i--) {
      const a = this.clearAnims[i];
      a.t += dt;
      const k = a.t / a.dur;
      if (k >= 1) {
        this.scene.remove(a.mesh);
        a.geo.dispose();
        a.mat.dispose();
        this.clearAnims.splice(i, 1);
        continue;
      }
      // Expand horizontally while fading.
      a.mesh.scale.x = 0.2 + k * 1.0;
      a.mesh.scale.y = 1 + k * 1.6;
      a.mat.opacity = (1 - k) * 0.9;
    }
    this.particles.update(dt);
  }

  updateCamera(dt) {
    // Ease the parallax tilt toward the pointer position.
    const t = this.tilt;
    const base = this.baseCamPos;
    const shakeAmt = this.shake;

    let sx = 0, sy = 0;
    if (shakeAmt > 0.001) {
      sx = (Math.random() - 0.5) * shakeAmt * 1.2;
      sy = (Math.random() - 0.5) * shakeAmt * 1.2;
      this.shake = Math.max(0, this.shake - dt * 3.5);
    }

    const targetX = t * 2.2 + sx;
    const targetY = base.y + t * 1.1 + sy;
    this.camera.position.x += (targetX - this.camera.position.x) * Math.min(1, dt * 8);
    this.camera.position.y += (targetY - this.camera.position.y) * Math.min(1, dt * 8);
    this.camera.position.z = base.z;
    this.camera.lookAt(0, this.lookTargetY ?? this.H * 0.5, 0);

    // Danger glow: how full is the stack?
    const stack = this.stackHeight();
    const danger = Math.max(0, Math.min(1, (stack - 13) / 6));
    this.dangerGlow += (danger - this.dangerGlow) * Math.min(1, dt * 6);
    if (this.stackLight) {
      this.stackLight.position.y = Math.max(2, stack * 0.9);
      this.stackLight.intensity = 10 + this.dangerGlow * 20;
      this.stackLight.color.setHex(this.dangerGlow > 0.3 ? 0xff4466 : 0x66ccff);
    }
  }

  /**
   * Height of the stack measured from the floor: 0 when empty, ROWS when the
   * visible field is full. Returns a HEIGHT (not a row index) so danger maths
   * reads naturally: a tall stack is dangerous, an empty board is not.
   *
   * Buffer rows above the field count as a topped-out stack (capped at ROWS),
   * since that state is game over anyway.
   */
  stackHeight() {
    const BUFFER = 4;
    for (let r = ROWS - 1; r >= 0; r--) {
      const row = this.game.grid[r + BUFFER];
      if (row && row.some((v) => v)) return ROWS - r;
    }
    for (let r = 0; r < BUFFER; r++) {
      const row = this.game.grid[r];
      if (row && row.some((v) => v)) return ROWS;
    }
    return 0;
  }

  setPointer(nx, ny) {
    // nx, ny in [-1, 1]; damped in the loop for smoothness.
    this.tilt = nx * 0.6 + ny * 0.2;
  }

  render(dt) {
    this.syncBlocks(dt);
    this.updateEffects(dt);
    this.updateCamera(dt);
    this.composer.render();
  }

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 1 / 20); // clamp big frames
    this.render(dt);
  }
}