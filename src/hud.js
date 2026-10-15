/**
 * hud.js — the DOM overlay: score panel, next/hold previews, pop-up labels,
 * overlays (pause / game over) and the touch controls.
 *
 * All 2D text and panels live here in the DOM; the canvas stays purely 3D.
 * Keeps itself in sync by polling game state each frame (cheap, and avoids a
 * web of one-way update calls from the game core).
 */
import { PIECE_COLORS } from './scene/palette.js';
import { COLS, ROWS } from './tetris.js';

const el = (id) => document.getElementById(id);

export class Hud {
  constructor(game, opts = {}) {
    this.game = game;
    this.onStart = opts.onStart || (() => {});
    this.onRestart = opts.onRestart || (() => {});
    this.onTogglePause = opts.onTogglePause || (() => {});
    this.onToggleMute = opts.onToggleMute || (() => {});
    this.showTouch = opts.showTouch ?? false;

    this.dom = {
      score: el('score'),
      level: el('level'),
      lines: el('lines'),
      combo: el('combo'),
      b2b: el('b2b'),
      holdCanvas: el('hold-canvas'),
      nextCanvas: el('next-canvas'),
      centerLabel: el('center-label'),
      flash: el('flash'),
      dangerVignette: el('danger-vignette'),
      startOverlay: el('start-overlay'),
      pauseOverlay: el('pause-overlay'),
      overOverlay: el('over-overlay'),
      overScore: el('over-score'),
      overLines: el('over-lines'),
      overLevel: el('over-level'),
      overReason: el('over-reason'),
      pauseBtn: el('pause-btn'),
      muteBtn: el('mute-btn'),
      touch: el('touch-controls'),
      statsFps: el('stats-fps'),
    };

    this.labelTimer = 0;
    this._lastScore = -1;
    this._lastLines = -1;
    this._lastLevel = -1;
    this._lastQueue = '';
    this._lastHold = undefined;

    this.bindControls();
    this.drawPreviews();
    if (this.showTouch && this.dom.touch) this.dom.touch.classList.add('show');
  }

  bindControls() {
    const d = this.dom;
    el('start-btn')?.addEventListener('click', () => this.onStart());
    el('resume-btn')?.addEventListener('click', () => this.onTogglePause());
    el('restart-btn')?.addEventListener('click', () => this.onRestart());
    el('over-restart-btn')?.addEventListener('click', () => this.onRestart());
    d.pauseBtn?.addEventListener('click', () => this.onTogglePause());
    d.muteBtn?.addEventListener('click', () => {
      const muted = this.onToggleMute();
      if (d.muteBtn) {
        d.muteBtn.textContent = muted ? '🔇' : '🔊';
        d.muteBtn.classList.toggle('muted', muted);
      }
    });
    el('start-sound-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const muted = this.onToggleMute();
      e.currentTarget.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
    });
  }

  // ----------------------------------------------------------- piece drawing

  /** Draw a tetromino into a small canvas, using its colour. */
  drawPiece(ctx, name, size, ox = 0, oy = 0) {
    if (!name) return;
    // Mini cell tables (rotation 0), in a 4x4 conceptual box for I/O.
    const MINI = {
      I: [[0, 1], [1, 1], [2, 1], [3, 1]],
      J: [[0, 0], [0, 1], [1, 1], [2, 1]],
      L: [[2, 0], [0, 1], [1, 1], [2, 1]],
      O: [[1, 1], [2, 1], [1, 2], [2, 2]],
      S: [[1, 0], [2, 0], [0, 1], [1, 1]],
      T: [[1, 0], [0, 1], [1, 1], [2, 1]],
      Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
    };
    const cells = MINI[name];
    // Normalise to a tight bounding box so every piece looks centred.
    const minX = Math.min(...cells.map((c) => c[0]));
    const maxX = Math.max(...cells.map((c) => c[0]));
    const minY = Math.min(...cells.map((c) => c[1]));
    const maxY = Math.max(...cells.map((c) => c[1]));
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;

    const cell = size / Math.max(w, h);
    const offX = ox + (size - w * cell) / 2;
    const offY = oy + (size - h * cell) / 2;
    const c = PIECE_COLORS[name];

    for (const [cx, cy] of cells) {
      const x = offX + (cx - minX) * cell;
      const y = offY + (cy - minY) * cell;
      const pad = cell * 0.08;
      // block body with a vertical gradient
      const grad = ctx.createLinearGradient(x, y, x, y + cell);
      grad.addColorStop(0, `#${c.glow.toString(16).padStart(6, '0')}`);
      grad.addColorStop(1, `#${c.base.toString(16).padStart(6, '0')}`);
      ctx.fillStyle = grad;
      roundRect(ctx, x + pad, y + pad, cell - pad * 2, cell - pad * 2, cell * 0.18);
      ctx.fill();
      // top highlight
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      roundRect(ctx, x + pad + cell * 0.12, y + pad + cell * 0.1,
        cell - pad * 2 - cell * 0.24, cell * 0.14, cell * 0.07);
      ctx.fill();
    }
  }

  drawPreviews() {
    const dpr = window.devicePixelRatio || 1;
    const sizeCanvas = (canvas, cellPx, pieces, gap) => {
      if (!canvas) return;
      const rows = pieces.length;
      const w = 4 * cellPx;
      const h = rows * (4 * cellPx + gap) - gap;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      pieces.forEach((name, i) => {
        if (name) this.drawPiece(ctx, name, 4 * cellPx, 0, i * (4 * cellPx + gap));
      });
    };

    sizeCanvas(this.dom.holdCanvas, 8, [this.game.hold], 0);
    const queue = this.game.queue.slice(0, 4);
    sizeCanvas(this.dom.nextCanvas, 7, queue, 4);
    this._lastQueue = queue.join('');
    this._lastHold = this.game.hold;
  }

  // -------------------------------------------------------------- main sync

  update(dt) {
    const g = this.game;
    const d = this.dom;

    // Stats
    if (g.score !== this._lastScore && d.score) {
      d.score.textContent = g.score.toLocaleString();
      this._lastScore = g.score;
    }
    if (g.lines !== this._lastLines && d.lines) {
      d.lines.textContent = g.lines;
      this._lastLines = g.lines;
    }
    if (g.level !== this._lastLevel && d.level) {
      d.level.textContent = g.level;
      this._lastLevel = g.level;
      // Pulse the level chip.
      d.level.parentElement?.classList.remove('pulse');
      void d.level.offsetWidth;
      d.level.parentElement?.classList.add('pulse');
    }

    // Combo / B2B chips
    if (d.combo) {
      const show = g.combo > 0;
      d.combo.textContent = show ? `${g.combo}x COMBO` : '';
      d.combo.classList.toggle('visible', show);
    }
    if (d.b2b) d.b2b.classList.toggle('visible', g.b2b);

    // Previews redraw only when the queue/hold actually change.
    const queueKey = g.queue.slice(0, 4).join('');
    if (queueKey !== this._lastQueue || g.hold !== this._lastHold) {
      this.drawPreviews();
    }

    // Centre pop-up label (TETRIS! / T-SPIN DOUBLE / PERFECT CLEAR ...)
    if (this.labelTimer > 0) {
      this.labelTimer -= dt;
      if (this.labelTimer <= 0 && d.centerLabel) {
        d.centerLabel.classList.remove('visible');
      }
    }

    // Danger vignette when the stack is near the top.
    if (d.dangerVignette) {
      const stack = this.stackHeight();
      const danger = Math.max(0, Math.min(1, (stack - 12) / 6));
      d.dangerVignette.style.opacity = danger > 0 ? String(danger * 0.55) : '0';
    }

    // Overlays
    this.syncOverlays();
  }

  /**
 * Stack height measured from the floor: 0 = empty, ROWS = full or topped out.
 * Buffer rows above the field count as topped-out so the danger vignette
 * still appears right before a block-out.
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

  /** Show the big centre label for a scored clear. */
  showClearLabel(label, perfect) {
    const d = this.dom;
    if (!d.centerLabel) return;
    if (!label || !label.text) {
      d.centerLabel.classList.remove('visible');
      return;
    }
    let text = label.text;
    if (perfect) text = 'PERFECT CLEAR';
    else if (label.b2b) text += ' · B2B';
    d.centerLabel.textContent = text;
    d.centerLabel.classList.toggle('tspin', !!label.tspin);
    d.centerLabel.classList.toggle('perfect', !!perfect);
    d.centerLabel.classList.add('visible');
    this.labelTimer = 1.1;
  }

  flashScreen(strength = 0.4) {
    const d = this.dom;
    if (!d.flash) return;
    d.flash.style.opacity = String(Math.min(0.8, strength));
    requestAnimationFrame(() => { d.flash.style.opacity = '0'; });
  }

  syncOverlays() {
    const g = this.game;
    const d = this.dom;
    const show = (node, on) => node?.classList.toggle('visible', on);

    show(d.startOverlay, g.state === 'ready');
    show(d.pauseOverlay, g.state === 'paused');
    show(d.overOverlay, g.state === 'over');

    if (g.state === 'over') {
      if (d.overScore) d.overScore.textContent = g.score.toLocaleString();
      if (d.overLines) d.overLines.textContent = g.lines;
      if (d.overLevel) d.overLevel.textContent = g.level;
      if (d.overReason) {
        d.overReason.textContent =
          g.gameOverReason === 'lock-out' ? 'LOCK OUT' : 'BLOCK OUT';
      }
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}