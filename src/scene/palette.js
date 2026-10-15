/**
 * palette.js — colours, materials and per-piece visual identity.
 * Central place to retune the whole look of the game.
 */
import * as THREE from '../../vendor/three/three.module.js';

export const PIECE_COLORS = {
  I: { base: 0x22d3ee, glow: 0x67e8f9, name: 'CYAN' },
  J: { base: 0x4f7cff, glow: 0x93b0ff, name: 'BLUE' },
  L: { base: 0xff9f43, glow: 0xffc27d, name: 'ORANGE' },
  O: { base: 0xffd93d, glow: 0xfff09a, name: 'YELLOW' },
  S: { base: 0x4ade80, glow: 0xa7f3c6, name: 'GREEN' },
  T: { base: 0xc084fc, glow: 0xe2c8ff, name: 'PURPLE' },
  Z: { base: 0xff5d7a, glow: 0xffa3b3, name: 'RED' },
};

export const CLEAR_COLOR = {
  flash: 0xffffff,
  warm: 0xffd6a0,
};

export const UI_COLORS = {
  bg0: 0x05060f,
  bg1: 0x0a0e20,
  grid: 0x1b2340,
  gridBright: 0x2a3566,
  danger: 0xff2d55,
  gold: 0xffd93d,
};

/** Build a shiny, slightly translucent block material for a tetromino. */
export function makeBlockMaterial(baseHex, opts = {}) {
  const { emissive = 0.16, opacity = 1, metalness = 0.15, roughness = 0.28, transparent = false } = opts;
  const color = new THREE.Color(baseHex);
  // Tint the emissive toward the piece's own hue (not white) so bright blocks
  // still read as their tetromino colour under bloom instead of blowing out.
  const glow = new THREE.Color(baseHex).lerp(new THREE.Color(0xffffff), 0.18);

  return new THREE.MeshPhysicalMaterial({
    color,
    emissive: glow,
    emissiveIntensity: emissive,
    metalness,
    roughness,
    clearcoat: 0.9,
    clearcoatRoughness: 0.14,
    opacity,
    transparent,
    // A touch of transmission makes blocks read as glass without being slow.
    transmission: opts.transmission ?? 0.12,
    thickness: 0.6,
    ior: 1.35,
  });
}

/** Ghost (preview) material: translucent, wireframe-ish, low emissive. */
export function makeGhostMaterial(baseHex) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(baseHex),
    emissive: new THREE.Color(baseHex),
    emissiveIntensity: 0.5,
    metalness: 0,
    roughness: 0.1,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}