/**
 * audio.js — procedural sound effects via WebAudio. No asset files.
 *
 * Every sound is synthesised from oscillators and noise buffers, so the game
 * ships as pure code and works offline. The context is created lazily on the
 * first user gesture to satisfy browser autoplay policies.
 */

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = 0.5;
  }

  /** Must be called from a user gesture handler the first time. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;

    // A gentle limiter keeps stacked effects from clipping.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;

    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    return this.ctx;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
  }

  get now() { return this.ctx.currentTime; }

  /** Short percussive blip used for move/rotate feedback. */
  tick(freq = 420, dur = 0.045, gain = 0.14, type = 'square') {
    if (!this.ctx || this.muted) return;
    const t = this.now;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  move() { this.tick(360, 0.035, 0.07, 'square'); }
  rotate() { this.tick(520, 0.05, 0.1, 'triangle'); }
  wallHit() { this.tick(150, 0.05, 0.06, 'sawtooth'); }

  hold() {
    this.tick(300, 0.07, 0.1, 'sine');
    setTimeout(() => this.tick(460, 0.07, 0.09, 'sine'), 55);
  }

  hardDrop() {
    if (!this.ctx || this.muted) return;
    const t = this.now;
    // Noise thump
    const dur = 0.16;
    const buf = this._noiseBuffer(dur);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1400, this.now);
    filt.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.34, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur);
    // Sub pitch drop underneath
    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.14);
    og.gain.setValueAtTime(0.3, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(og); og.connect(this.master);
    osc.start(t); osc.stop(t + 0.18);
  }

  /** Rising arpeggio; `level` 0-3 picks the chord, higher = brighter. */
  clear(level = 1) {
    if (!this.ctx || this.muted) return;
    const chords = [
      [523.25, 659.25, 783.99],              // C E G
      [523.25, 659.25, 783.99, 1046.5],      // + C
      [440, 554.37, 659.25, 880],           // A
      [523.25, 698.46, 880, 1046.5, 1318.5],
    ];
    const notes = chords[Math.min(level - 1, chords.length - 1)] || chords[0];
    const t0 = this.now;
    notes.forEach((f, i) => {
      const t = t0 + i * 0.055;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + 0.34);
    });
  }

  tSpin() {
    if (!this.ctx || this.muted) return;
    const t = this.now;
    // A shimmering downward glissando reads as "special".
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.35);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 2600;
    osc.connect(filt); filt.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.4);
  }

  levelUp() {
    if (!this.ctx || this.muted) return;
    const t0 = this.now;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const t = t0 + i * 0.08;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + 0.42);
    });
  }

  gameOver() {
    if (!this.ctx || this.muted) return;
    const t = this.now;
    [392, 329.63, 261.63, 196].forEach((f, i) => {
      const tt = t + i * 0.17;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.16, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.5);
      osc.connect(g); g.connect(this.master);
      osc.start(tt); osc.stop(tt + 0.52);
    });
  }

  _noiseBuffer(dur) {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      // Decaying white noise
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
    return buf;
  }
}