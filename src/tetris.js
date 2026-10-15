/**
 * tetris.js — pure game logic. No DOM, no three.js. Testable in node.
 *
 * Implements guideline Tetris: SRS rotation with wall/floor kicks, 7-bag
 * randomizer, hold piece, ghost piece, lock delay with move reset,
 * T-spin detection (3-corner rule), back-to-back and combo scoring,
 * soft/hard drop, perfect clear, and block-out / lock-out game over.
 */

export const COLS = 10;
export const ROWS = 20;          // visible rows
const BUFFER = 4;                // hidden rows above the field (spawn area)
const GRID_ROWS = ROWS + BUFFER; // total storage rows

export const PIECE_NAMES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

/**
 * Cell tables for all four rotation states of every tetromino.
 * Coordinates are (col, row) within the piece's bounding box.
 * I and O use a 4x4 box, the rest a 3x3 box.
 */
const SHAPES = {
  I: {
    box: 4,
    states: [
      [[0, 1], [1, 1], [2, 1], [3, 1]],
      [[2, 0], [2, 1], [2, 2], [2, 3]],
      [[0, 2], [1, 2], [2, 2], [3, 2]],
      [[1, 0], [1, 1], [1, 2], [1, 3]],
    ],
  },
  J: {
    box: 3,
    states: [
      [[0, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [2, 2]],
      [[1, 0], [1, 1], [1, 2], [0, 2]],
    ],
  },
  L: {
    box: 3,
    states: [
      [[2, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 1], [0, 2]],
      [[0, 0], [1, 0], [1, 1], [1, 2]],
    ],
  },
  O: {
    box: 4,
    // The O piece is rotation-invariant: identical cells in all four states.
    states: [0, 1, 2, 3].map(() => [[1, 1], [2, 1], [1, 2], [2, 2]]),
  },
  S: {
    box: 3,
    states: [
      [[1, 0], [2, 0], [0, 1], [1, 1]],
      [[1, 0], [1, 1], [2, 1], [2, 2]],
      [[1, 1], [2, 1], [0, 2], [1, 2]],
      [[0, 0], [0, 1], [1, 1], [1, 2]],
    ],
  },
  T: {
    box: 3,
    states: [
      [[1, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [1, 2]],
      [[1, 0], [0, 1], [1, 1], [1, 2]],
    ],
  },
  Z: {
    box: 3,
    states: [
      [[0, 0], [1, 0], [1, 1], [2, 1]],
      [[2, 0], [2, 1], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [1, 2], [2, 2]],
      [[1, 0], [0, 1], [1, 1], [0, 2]],
    ],
  },
};

/**
 * SRS kick tables. Keys are `${from}${to}` rotation states.
 * Offsets are (dx, dy) with dy positive = UP, per the SRS specification.
 */
const KICKS_JLSTZ = {
  '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};

const KICKS_I = {
  '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

/** Gravity: seconds per row of natural fall, indexed by level (0-based). */
const GRAVITY = [
  0.8, 0.7167, 0.6333, 0.55, 0.4667, 0.3833, 0.3, 0.2167, 0.1333, 0.1,
  0.0833, 0.0833, 0.0833, 0.0667, 0.0667, 0.0667, 0.05, 0.05, 0.05, 0.0333,
];

const LOCK_DELAY = 0.5;       // seconds a piece rests before locking
const MAX_LOCK_RESETS = 15;   // guideline cap on move resets
const CLEAR_DELAY = 0.32;     // seconds the cleared rows stay highlighted
const LINES_PER_LEVEL = 10;

const SCORE = {
  single: 100, double: 300, triple: 500, tetris: 800,
  tspin: 400, tspinSingle: 800, tspinDouble: 1200, tspinTriple: 1600,
  tspinMini: 100, tspinMiniSingle: 200, tspinMiniDouble: 400,
  perfectClear: [0, 800, 1200, 1800, 2000],
};

const CLEAR_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'];

export class Tetris {
  constructor(opts = {}) {
    this.rng = opts.rng || Math.random;
    this.events = {};
    this.reset();
  }

  // ---------------------------------------------------------------- events

  on(name, fn) {
    (this.events[name] || (this.events[name] = [])).push(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) {
    const list = this.events[name];
    if (list) this.events[name] = list.filter((f) => f !== fn);
  }

  emit(name, payload) {
    const list = this.events[name];
    if (list) for (const fn of list) fn(payload);
  }

  // ----------------------------------------------------------------- setup

  reset() {
    // grid[row][col]; row 0 is the top visible row, negative rows are buffer.
    this.grid = Array.from({ length: GRID_ROWS }, () => new Array(COLS).fill(null));
    this.bag = [];
    this.queue = [];
    for (let i = 0; i < 5; i++) this.queue.push(this.pullFromBag());

    this.active = null;
    this.hold = null;
    this.canHold = true;

    this.state = 'ready'; // ready | falling | clearing | over | paused
    this.score = 0;
    this.lines = 0;
    this.level = 0;
    this.combo = -1;
    this.b2b = false;
    this.pieceCount = 0;

    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.clearTimer = 0;
    this.clearRows = [];
    this.lastActionWasRotation = false;
    this.lastKickIndex = 0;

    this.emit('reset', this);
  }

  /** Draw a piece name from the 7-bag, reshuffling when empty. */
  pullFromBag() {
    if (this.bag.length === 0) {
      this.bag = [...PIECE_NAMES];
      // Fisher-Yates
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop();
  }

  start() {
    if (this.state !== 'ready') return;
    this.state = 'falling';
    this.spawn();
  }

  togglePause() {
    if (this.state === 'over' || this.state === 'ready') return;
    if (this.state === 'paused') {
      // Restore whatever state the pause interrupted. Resuming hard-coded
      // 'falling', which abandoned an in-flight line clear: the stale piece
      // (already written into the grid) would lock a second time and inflate
      // this.lines.
      this.state = this.stateBeforePause || 'falling';
      this.stateBeforePause = null;
      this.emit('resume', this);
    } else {
      this.stateBeforePause = this.state;
      this.state = 'paused';
      this.emit('pause', this);
    }
  }

  // ------------------------------------------------------- piece placement

  makePiece(name) {
    // Spawn positions put the piece's lowest row just above the visible field.
    const p = {
      name,
      rot: 0,
      x: 3,
      y: name === 'O' ? -3 : -2,
    };
    return p;
  }

  cells(piece = this.active) {
    if (!piece) return [];
    return SHAPES[piece.name].states[piece.rot].map(([cx, cy]) => [
      piece.x + cx,
      piece.y + cy,
    ]);
  }

  spawn(name = null) {
    const pieceName = name || this.queue.shift();
    this.queue.push(this.pullFromBag());
    this.active = this.makePiece(pieceName);
    this.pieceCount++;
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lastActionWasRotation = false;

    // Block out: the spawn position is already occupied.
    if (this.collides(this.active.x, this.active.y, this.active.rot)) {
      this.active = null;
      this.gameOver('block-out');
      return;
    }
    this.emit('spawn', { piece: this.active });
  }

  /** Is (x, y, rot) colliding with the field, walls, or floor? */
  collides(x, y, rot, piece = this.active) {
    const cells = SHAPES[piece.name].states[rot];
    for (const [cx, cy] of cells) {
      const col = x + cx;
      const row = y + cy;
      if (col < 0 || col >= COLS) return true;
      if (row >= ROWS) return true;
      // The hidden buffer (rows -BUFFER..-1) holds real blocks now that
      // above-field locks are stored, so those must collide. Only rows above
      // the buffer are genuinely open space.
      if (row < -BUFFER) continue;
      if (this.grid[row + BUFFER][col]) return true;
    }
    return false;
  }

  /** Row index that would collide at this piece's lowest occupied row (floor). */
  bottomOf(piece) {
    return Math.max(...this.cells(piece).map(([, r]) => r));
  }

  ghostY() {
    if (!this.active) return 0;
    let y = this.active.y;
    while (!this.collides(this.active.x, y + 1, this.active.rot)) y++;
    return y;
  }

  dropDistance() {
    return this.ghostY() - this.active.y;
  }

  // --------------------------------------------------------------- actions

  move(dx) {
    if (this.state !== 'falling' || !this.active) return false;
    if (this.collides(this.active.x + dx, this.active.y, this.active.rot)) return false;
    this.active.x += dx;
    this.lastActionWasRotation = false;
    this.resetLockAfterAction();
    this.emit('move', { piece: this.active, dx });
    return true;
  }

  /**
   * Rotate using SRS. `dir` is +1 for clockwise, -1 for counter-clockwise.
   * Tries the standard kick offsets in order and uses the first that fits.
   */
  rotate(dir) {
    if (this.state !== 'falling' || !this.active) return false;
    const from = this.active.rot;
    const to = (from + (dir > 0 ? 1 : 3)) % 4;
    if (this.active.name === 'O') {
      // O never moves on rotation, but still counts as a rotation for T-spin
      // bookkeeping parity and resets nothing.
      this.lastActionWasRotation = true;
      this.emit('rotate', { piece: this.active, success: true });
      return true;
    }

    const table = this.active.name === 'I' ? KICKS_I : KICKS_JLSTZ;
    const kicks = table[`${from}${to}`];
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      // SRS y is positive-up; grid rows increase downward.
      const nx = this.active.x + kx;
      const ny = this.active.y - ky;
      if (!this.collides(nx, ny, to)) {
        this.active.x = nx;
        this.active.y = ny;
        this.active.rot = to;
        this.lastActionWasRotation = true;
        this.lastKickIndex = i;
        this.resetLockAfterAction();
        this.emit('rotate', { piece: this.active, success: true, kick: i });
        return true;
      }
    }
    this.emit('rotate', { piece: this.active, success: false });
    return false;
  }

  /** Move/rotate touching a grounded piece refreshes its lock timer (capped). */
  resetLockAfterAction() {
    if (!this.active) return;
    if (this.lockTimer > 0 && this.lockResets < MAX_LOCK_RESETS) {
      this.lockResets++;
      this.lockTimer = 0;
      this.emit('lockreset', { piece: this.active });
    }
  }

  softDrop(on) {
    this.softDropping = !!on;
  }

  hardDrop() {
    if (this.state !== 'falling' || !this.active) return 0;
    const from = this.active.y;
    const dist = this.dropDistance();
    if (dist > 0) {
      this.active.y += dist;
      this.score += dist * 2;
    }
    // NOTE: deliberately does NOT clear lastActionWasRotation. A T-spin is
    // defined by the last ROTATION before the lock, so rotating into a spin
    // notch and then hard-dropping must still score as a T-spin. (Only a
    // sideways move invalidates it, which move() already handles.)
    this.emit('harddrop', { piece: this.active, dist, fromY: from });
    this.lockPiece();
    return dist;
  }

  holdPiece() {
    if (this.state !== 'falling' || !this.active || !this.canHold) return;
    const current = this.active.name;
    const swapped = this.hold;
    this.hold = current;
    this.canHold = false;
    this.emit('hold', { held: this.hold, swapped });

    if (swapped) {
      this.active = this.makePiece(swapped);
      if (this.collides(this.active.x, this.active.y, this.active.rot)) {
        this.active = null;
        this.gameOver('block-out');
        return;
      }
      this.gravityAcc = 0;
      this.lockTimer = 0;
      this.lockResets = 0;
      this.lastActionWasRotation = false;
      this.emit('spawn', { piece: this.active });
    } else {
      // Nothing held yet: pull the next piece instead.
      this.spawn();
      this.canHold = false;
    }
  }

  // ------------------------------------------------------------ T-spin test

  /**
   * T-spin by the 3-corner rule. The T's centre is always its (1,1) cell.
   * Returns false unless the T piece's last action was a rotation.
   */
  detectTSpin() {
    if (!this.active || this.active.name !== 'T') return false;
    if (!this.lastActionWasRotation) return false;

    const [cx, cy] = [this.active.x + 1, this.active.y + 1];
    // Corners around the centre, in order: top-left, top-right, bottom-left, bottom-right
    const corners = [
      [cx - 1, cy - 1], [cx + 1, cy - 1],
      [cx - 1, cy + 1], [cx + 1, cy + 1],
    ].map(([c, r]) => (c < 0 || c >= COLS ? true : r >= ROWS ? true : r < 0 ? false : !!this.grid[r + BUFFER][c]));

    const filled = corners.filter(Boolean).length;
    if (filled < 3) return false;

    // Front corners are the two the T's nub points toward. Corner order is
    // [TL(0), TR(1), BL(2), BR(3)], so the nub direction determines the pair:
    //   rot 0 nub up    -> top    -> TL,TR
    //   rot 1 nub right -> right  -> TR,BR
    //   rot 2 nub down  -> bottom -> BL,BR
    //   rot 3 nub left  -> left   -> TL,BL
    const FRONT = { 0: [0, 1], 1: [1, 3], 2: [2, 3], 3: [0, 2] };
    const frontCount = FRONT[this.active.rot].filter((i) => corners[i]).length;
    // Only one front corner occupied => the spin didn't fully complete.
    this.tspinMini = frontCount <= 1;
    return true;
  }

  // -------------------------------------------------------------- locking

  lockPiece() {
    const piece = this.active;
    if (!piece) return;

    const tspin = this.detectTSpin();
    const mini = tspin && this.tspinMini;

    const cells = this.cells(piece);
    let aboveField = true;
    for (const [, row] of cells) {
      if (row >= 0) { aboveField = false; break; }
    }

    for (const [c, r] of cells) {
      if (r >= ROWS) continue;          // below the floor: lock-out below
      // Cells above row 0 land in the hidden buffer (index r + BUFFER >= 0).
      // They must be written, not discarded: dropping them would make the
      // stack unable to ever rise into the spawn area, leaving block-out
      // permanently unreachable.
      if (r < -BUFFER) continue;        // above the buffer: out of storage
      this.grid[r + BUFFER][c] = piece.name;
    }

    const fullRows = [];
    for (let r = 0; r < ROWS; r++) {
      if (this.grid[r + BUFFER].every((v) => v)) fullRows.push(r);
    }

    this.emit('lock', {
      piece, tspin, mini, cells, fullRows, lockRow: Math.max(...cells.map(([, r]) => r)),
    });

    if (aboveField) {
      // Lock out: the whole piece came to rest above the visible field.
      this.active = null;
      this.gameOver('lock-out');
      return;
    }

    if (fullRows.length > 0) {
      this.state = 'clearing';
      this.clearRows = fullRows;
      this.clearTimer = CLEAR_DELAY;
      this.applyScoring(fullRows.length, tspin, mini);
      this.lines += fullRows.length;
      const newLevel = Math.floor(this.lines / LINES_PER_LEVEL);
      if (newLevel > this.level) {
        this.level = newLevel;
        this.emit('levelup', { level: this.level });
      }
    } else {
      this.combo = -1;
      if (tspin) {
        this.b2b = false; // no-line t-spin breaks the chain
      }
      this.spawnNext();
    }
  }

  spawnNext() {
    this.canHold = true;
    this.spawn();
  }

  /** Compute and award points for a clear, including B2B, combo and PC. */
  applyScoring(lineCount, tspin, mini) {
    const lvlMult = this.level + 1;
    const before = this.score;

    let base = 0;
    let label = '';
    let difficult = false;

    if (tspin) {
      if (mini) {
        base = [SCORE.tspinMini, SCORE.tspinMiniSingle, SCORE.tspinMiniDouble, 400][Math.min(lineCount, 4)] ?? SCORE.tspinMini;
        label = 'T-SPIN MINI';
        difficult = lineCount > 0;
      } else {
        base = [SCORE.tspin, SCORE.tspinSingle, SCORE.tspinDouble, SCORE.tspinTriple][Math.min(lineCount, 3)] ?? SCORE.tspin;
        label = 'T-SPIN';
        difficult = lineCount > 0;
      }
      if (lineCount > 0) label += ` ${CLEAR_NAMES[Math.min(lineCount, 4)] ?? `${lineCount} LINES`}`;
    } else {
      // Guard the table lookups: an unbounded line count would read past the
      // end of the array and yield `undefined`, which turns the score NaN.
      const table = [SCORE.single, SCORE.double, SCORE.triple, SCORE.tetris];
      base = table[Math.min(lineCount, 4) - 1] ?? SCORE.single;
      label = CLEAR_NAMES[Math.min(lineCount, 4)] ?? `${lineCount} LINES`;
      difficult = lineCount === 4;
    }

    this.combo++;
    let comboBonus = 0;
    if (this.combo > 0) comboBonus = 50 * this.combo;

    let b2bApplied = false;
    let points = base;
    if (difficult && this.b2b) {
      points = Math.floor(points * 1.5);
      b2bApplied = true;
    }
    if (difficult) this.b2b = true; else this.b2b = false;

    const gained = Math.floor(points * lvlMult) + Math.floor(comboBonus * lvlMult);
    this.score += gained;

    this.pendingLabel = {
      text: label,
      b2b: b2bApplied,
      combo: this.combo,
      points: gained,
      tspin, mini,
      lineCount,
    };
    this.pendingBase = base;
  }

  gameOver(reason) {
    this.state = 'over';
    this.emit('gameover', {
      reason,
      score: this.score,
      lines: this.lines,
      level: this.level,
      time: this.elapsed || 0,
    });
  }

  // ------------------------------------------------------------------ tick

  /** @param {number} dt seconds since last frame */
  update(dt) {
    if (this.state === 'over' || this.state === 'ready') return;
    this.elapsed = (this.elapsed || 0) + dt;

    if (this.state === 'paused') return;

    if (this.state === 'clearing') {
      this.clearTimer -= dt;
      if (this.clearTimer <= 0) {
        this.commitClear();
      }
      return;
    }

    if (this.state !== 'falling' || !this.active) return;

    const interval = this.softDropping
      ? Math.min(GRAVITY[Math.min(this.level, GRAVITY.length - 1)], 0.02)
      : GRAVITY[Math.min(this.level, GRAVITY.length - 1)];

    this.gravityAcc += dt;
    let steps = 0;
    while (this.gravityAcc >= interval && steps < ROWS + 2) {
      this.gravityAcc -= interval;
      steps++;
      if (this.softDropping && this.gravityAcc < interval * 0.5) {
        // soft drop awards 1 point per row actually descended
      }
      if (!this.collides(this.active.x, this.active.y + 1, this.active.rot)) {
        this.active.y++;
        if (this.softDropping) this.score += 1;
        this.lockTimer = 0;
        this.emit('dropstep', { piece: this.active });
      } else {
        this.gravityAcc = 0;
        break;
      }
    }

    // Lock delay: the timer only runs while the piece is resting on something.
    const grounded = this.collides(this.active.x, this.active.y + 1, this.active.rot);
    if (grounded) {
      this.lockTimer += dt;
      if (this.lockTimer >= LOCK_DELAY) this.lockPiece();
    } else {
      this.lockTimer = 0;
    }
  }

  /** Remove the cleared rows, award a perfect-clear bonus, spawn the next piece. */
  commitClear() {
    const rows = this.clearRows;
    const lineCount = rows.length;

    for (const r of rows) {
      this.grid.splice(r + BUFFER, 1);
      this.grid.unshift(new Array(COLS).fill(null));
    }
    this.clearRows = [];

    const perfect = this.grid.every((row) => row.every((v) => !v));
    let pcBonus = 0;
    if (perfect) {
      pcBonus = (SCORE.perfectClear[Math.min(lineCount, 4)] ?? SCORE.perfectClear[1]) * (this.level + 1);
      this.score += pcBonus;
    }

    this.emit('clear', {
      rows, lineCount, perfect, pcBonus,
      label: this.pendingLabel, b2b: this.b2b, combo: this.combo,
    });

    this.state = 'falling';
    this.spawnNext();
  }

  // ----------------------------------------------------------- introspection

  snapshot() {
    return {
      score: this.score,
      lines: this.lines,
      level: this.level,
      combo: this.combo,
      b2b: this.b2b,
      state: this.state,
      hold: this.hold,
      queue: [...this.queue],
      active: this.active ? { name: this.active.name, rot: this.active.rot, x: this.active.x, y: this.active.y } : null,
      ghostY: this.active ? this.ghostY() : 0,
    };
  }
}

export { SHAPES, GRAVITY, CLEAR_DELAY, LOCK_DELAY, BUFFER };