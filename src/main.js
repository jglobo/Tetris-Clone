/**
 * main.js — wires the game core, renderer, HUD, audio and input together and
 * runs the master loop.
 */
import { Tetris } from './tetris.js';
import { Renderer } from './scene/renderer.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Audio } from './audio.js';

const canvas = document.getElementById('game-canvas');
const game = new Tetris();
const audio = new Audio();
let muted = false;

// ---------------------------------------------------------------- renderer
const renderer = new Renderer(canvas, game);

// ---------------------------------------------------------------- HUD
// Show touch controls when the device plausibly has a touchscreen. A single
// media query is not enough: '(pointer: coarse)' is false on hybrid laptops
// and under some emulation, while 'ontouchstart in window' catches those.
// Falls back to a narrow viewport so phones always get the controls.
const isTouch =
  window.matchMedia('(pointer: coarse)').matches ||
  ('ontouchstart' in window) ||
  window.matchMedia('(max-width: 900px)').matches;
const hud = new Hud(game, {
  showTouch: isTouch,
  onStart: () => startGame(),
  onRestart: () => restart(),
  onTogglePause: () => togglePause(),
  onToggleMute: () => toggleMute(),
});

renderer.setTouchMode(isTouch);

const input = new Input(game, {
  onPause: () => togglePause(),
  onRestart: () => { if (game.state === 'over') restart(); },
  onMute: () => toggleMute(),
  onAnyInput: () => audio.ensure(),
});

// ------------------------------------------- audio feedback from game events
game.on('move', ({ dx }) => audio.move());
game.on('rotate', ({ success }) => (success ? audio.rotate() : audio.wallHit()));
game.on('hold', () => audio.hold());
game.on('harddrop', () => audio.hardDrop());
game.on('levelup', () => { audio.levelUp(); hud.flashScreen(0.25); });
game.on('clear', ({ lineCount, perfect, label }) => {
  if (label?.tspin) audio.tSpin(); else audio.clear(lineCount);
  if (perfect) setTimeout(() => audio.levelUp(), 180);
  hud.showClearLabel(label, perfect);
  hud.flashScreen(perfect ? 0.7 : 0.2 + lineCount * 0.08);
  renderer.particles.celebrate(
    perfect ? 0xffffff : 0xffd93d, renderer.W, renderer.H * 0.6,
  );
});
game.on('gameover', ({ reason }) => {
  game.gameOverReason = reason;
  audio.gameOver();
});

// ------------------------------------------------------- pointer parallax
window.addEventListener('pointermove', (e) => {
  const nx = (e.clientX / window.innerWidth) * 2 - 1;
  const ny = (e.clientY / window.innerHeight) * 2 - 1;
  renderer.setPointer(nx, ny);
});

// ------------------------------------------------------------- transitions
function startGame() {
  audio.ensure();
  game.start();
}

function restart() {
  audio.ensure();
  game.reset();
  game.start();
  renderer.pool.releaseAll();
  renderer.particles.clear();
}

function togglePause() {
  if (game.state === 'ready' || game.state === 'over') return;
  audio.ensure();
  game.togglePause();
  input.releaseAll();
}

function toggleMute() {
  muted = !muted;
  audio.setMuted(muted);
  return muted;
}

// Escape / R are handled by Input; also allow clicking the canvas to unpause.
canvas.addEventListener('click', () => {
  audio.ensure();
  if (game.state === 'ready') startGame();
});

// ------------------------------------------------------------- master loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;

  if (game.state !== 'paused') {
    game.update(dt);
  }
  input.update(dt);
  hud.update(dt);
}
requestAnimationFrame(frame);

// Expose for debugging in the console.
window.__tetris = { game, renderer, hud, audio, input };