/**
 * input.js — keyboard, touch and pointer input.
 *
 * Implements guideline DAS (delayed auto shift) / ARR (auto repeat rate) so
 * holding left/right feels right, plus 180° rotation kicks on up/down and the
 * standard key bindings.
 */

const DEFAULT_BINDS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  softDrop: ['ArrowDown', 'KeyS'],
  hardDrop: ['ArrowUp', 'KeyW', 'Space'],
  rotCW: ['ArrowUp', 'KeyX', 'KeyW'],
  rotCCW: ['KeyZ', 'ControlLeft', 'ControlRight'],
  rot180: ['KeyA', 'KeyQ'], // overridden below; see note
  hold: ['KeyC', 'ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
  restart: ['KeyR'],
  mute: ['KeyM'],
};

// Note: hard drop shares ArrowUp/KeyW with rotate-CW in many games, but here
// they are separated: ArrowUp + W rotate, Space hard-drops. `rot180` uses KeyX.
DEFAULT_BINDS.rotCW = ['ArrowUp', 'KeyW'];
DEFAULT_BINDS.hardDrop = ['Space'];

const DAS = 0.14;  // seconds held before auto-shift kicks in
const ARR = 0.035; // seconds between auto-shift repeats
const SDR = 0.04;  // soft drop repeat

export class Input {
  constructor(game, opts = {}) {
    this.game = game;
    this.onPause = opts.onPause || (() => {});
    this.onRestart = opts.onRestart || (() => {});
    this.onMute = opts.onMute || (() => {});
    this.onAnyInput = opts.onAnyInput || (() => {});
    this.binds = { ...DEFAULT_BINDS, ...(opts.binds || {}) };

    // Directional state for DAS/ARR.
    this.dir = 0;         // -1 left, +1 right, 0 none
    this.dasTimer = 0;
    this.arrTimer = 0;
    this.softHeld = false;
    this.softTimer = 0;

    this._onKeyDown = this.handleKeyDown.bind(this);
    this._onKeyUp = this.handleKeyUp.bind(this);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', () => this.releaseAll());
    this.bindTouch();
  }

  matches(action, code) {
    return this.binds[action]?.includes(code);
  }

  handleKeyDown(e) {
    // Let the browser handle reload/devtools combos.
    if (e.ctrlKey && ['KeyR', 'KeyW', 'KeyT'].includes(e.code)) return;

    let handled = true;
    if (this.matches('left', e.code)) this.setDir(-1);
    else if (this.matches('right', e.code)) this.setDir(1);
    else if (this.matches('softDrop', e.code)) this.setSoft(true);
    else if (this.matches('hardDrop', e.code)) { this.game.hardDrop(); }
    else if (this.matches('rotCW', e.code)) this.game.rotate(1);
    else if (this.matches('rotCCW', e.code)) this.game.rotate(-1);
    else if (e.code === 'KeyX') this.game.rotate(1);       // 180 kick
    else if (this.matches('hold', e.code)) this.game.holdPiece();
    else if (this.matches('pause', e.code)) this.onPause();
    else if (this.matches('restart', e.code)) this.onRestart();
    else if (this.matches('mute', e.code)) this.onMute();
    else handled = false;

    if (handled) {
      e.preventDefault();
      this.onAnyInput();
    }
  }

  handleKeyUp(e) {
    if (this.matches('left', e.code) && this.dir === -1) this.setDir(0);
    else if (this.matches('right', e.code) && this.dir === 1) this.setDir(0);
    else if (this.matches('softDrop', e.code)) this.setSoft(false);
  }

  setDir(d) {
    if (this.dir === d) return;
    // Direction change: move once immediately, then restart DAS.
    if (d !== 0) this.game.move(d);
    this.dir = d;
    this.dasTimer = 0;
    this.arrTimer = 0;
  }

  setSoft(on) {
    if (this.softHeld === on) return;
    this.softHeld = on;
    this.softTimer = 0;
    this.game.softDrop(on);
  }

  releaseAll() {
    this.dir = 0;
    this.softHeld = false;
    this.game.softDrop(false);
  }

  /** Called every frame to drive DAS/ARR and soft-drop repeat. */
  update(dt) {
    if (this.dir !== 0) {
      this.dasTimer += dt;
      if (this.dasTimer >= DAS) {
        this.arrTimer += dt;
        while (this.arrTimer >= ARR) {
          this.arrTimer -= ARR;
          this.game.move(this.dir);
        }
      }
    }
    if (this.softHeld) {
      this.softTimer += dt;
      while (this.softTimer >= SDR) {
        this.softTimer -= SDR;
        if (!this.game.collides(
          this.game.active?.x ?? 0,
          (this.game.active?.y ?? 0) + 1,
          this.game.active?.rot ?? 0,
        )) {
          this.game.active.y++;
          this.game.score += 1;
        } else break;
      }
    }
  }

  /** On-screen buttons: fire the same actions. */
  bindTouch() {
    const root = document.getElementById('touch-controls');
    if (!root) return;
    const press = (action) => (e) => {
      e.preventDefault();
      this.onAnyInput();
      const g = this.game;
      switch (action) {
        case 'left': g.move(-1); break;
        case 'right': g.move(1); break;
        case 'rotCW': g.rotate(1); break;
        case 'rotCCW': g.rotate(-1); break;
        case 'hardDrop': g.hardDrop(); break;
        case 'hold': g.holdPiece(); break;
        default: break;
      }
    };
    root.querySelectorAll('[data-action]').forEach((btn) => {
      const action = btn.dataset.action;
      btn.addEventListener('pointerdown', press(action));
    });
  }
}