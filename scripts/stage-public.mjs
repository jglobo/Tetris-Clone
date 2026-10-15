#!/usr/bin/env node
/**
 * stage-public.mjs — build the generated, minimal `public/` tree that the
 * local dev server serves. Security properties:
 *
 *   - Fixed allowlist only (no globs, no recursive project copies). The tree
 *     contains exactly: game HTML, one stylesheet, current game source
 *     modules, and the vendored three.js files actually imported.
 *   - Symlinked sources are rejected; every source must realpath to a regular
 *     file inside the project root.
 *   - Ownership is tracked in `public/.stage-manifest.json`. A staging
 *     destination that already exists and is NOT marked owned/generated is a
 *     hard failure. Unrelated pre-existing files in `public/` are preserved
 *     and never deleted; unexpected files or directories refuse staging.
 *   - `public/serve.json` disables directory listings explicitly.
 */

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const MANIFEST_REL = '.stage-manifest.json';
const CONFIG_REL = 'serve.json';

/** Explicit audited allowlist. Anything not listed here is never staged. */
export const ALLOWLIST = [
  'index.html',
  'styles/main.css',
  'src/audio.js',
  'src/hud.js',
  'src/input.js',
  'src/main.js',
  'src/tetris.js',
  'src/scene/blocks.js',
  'src/scene/palette.js',
  'src/scene/particles.js',
  'src/scene/renderer.js',
  'vendor/three/three.module.js',
  'vendor/three/jsm/environments/RoomEnvironment.js',
  'vendor/three/jsm/geometries/RoundedBoxGeometry.js',
  'vendor/three/jsm/postprocessing/EffectComposer.js',
  'vendor/three/jsm/postprocessing/MaskPass.js',
  'vendor/three/jsm/postprocessing/OutputPass.js',
  'vendor/three/jsm/postprocessing/Pass.js',
  'vendor/three/jsm/postprocessing/RenderPass.js',
  'vendor/three/jsm/postprocessing/ShaderPass.js',
  'vendor/three/jsm/postprocessing/UnrealBloomPass.js',
  'vendor/three/jsm/shaders/CopyShader.js',
  'vendor/three/jsm/shaders/LuminosityHighPassShader.js',
  'vendor/three/jsm/shaders/OutputShader.js',
];

/** Explicit serve configuration: directory listings disabled, symlinks refused. */
const SERVE_CONFIG = {
  directoryListing: false,
  symlinks: false,
};

function fail(message) {
  console.error(`[stage-public] ERROR: ${message}`);
  process.exit(1);
}

function insideDir(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function statIfPresent(target) {
  try { return lstatSync(target); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Inspect components individually, including the project/root ancestors.
function checkedDirectory(target) {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const st = lstatSync(current);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`linked or non-directory component: ${current}`);
  }
  return realpathSync(absolute);
}

function checkedFile(root, rel) {
  const rootReal = checkedDirectory(root);
  const target = path.join(root, rel);
  const parentReal = checkedDirectory(path.dirname(target));
  if (parentReal !== rootReal && !insideDir(rootReal, parentReal)) throw new Error(`parent escapes root: ${rel}`);
  const st = lstatSync(target);
  if (st.isSymbolicLink() || !st.isFile() || !insideDir(rootReal, realpathSync(target))) throw new Error(`unsafe file: ${rel}`);
  return target;
}

// Used for each HTTP request too; ownership/config metadata are never routes.
export function readPublicAsset(rel) {
  if (!ALLOWLIST.includes(rel)) throw new Error('not an allowed asset');
  return readFileSync(checkedFile(PUBLIC_DIR, rel));
}

const dests = new Set([...ALLOWLIST, CONFIG_REL]);
const directories = new Set();
for (const rel of dests) {
  let parent = path.posix.dirname(rel);
  while (parent !== '.') { directories.add(parent); parent = path.posix.dirname(parent); }
}

function preflight() {
  checkedDirectory(PROJECT_ROOT);
  for (const rel of ALLOWLIST) checkedFile(PROJECT_ROOT, rel);
  if (!statIfPresent(PUBLIC_DIR)) return;
  checkedDirectory(PUBLIC_DIR);
  const manifestPath = checkedFile(PUBLIC_DIR, MANIFEST_REL);
  const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!previous || typeof previous !== 'object' || Array.isArray(previous) || previous.generated !== true ||
      !previous.files || typeof previous.files !== 'object' || Array.isArray(previous.files)) throw new Error('invalid generated ownership manifest');
  for (const [rel, digest] of Object.entries(previous.files)) {
    // Exact membership rejects traversal, alternate separators, stale arbitrary paths and prototype names.
    if (!dests.has(rel) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`invalid owned path/digest: ${rel}`);
  }
  const owned = new Set(Object.keys(previous.files));
  function walk(dir, prefix = '') {
    for (const name of readdirSync(dir)) {
      const rel = prefix + name, target = path.join(dir, name), st = lstatSync(target);
      if (st.isSymbolicLink()) throw new Error(`linked destination: ${rel}`);
      if (st.isDirectory()) {
        if (!directories.has(rel)) throw new Error(`unexpected directory: ${rel}`);
        const real = checkedDirectory(target);
        if (!insideDir(realpathSync(PUBLIC_DIR), real)) throw new Error(`directory escapes public: ${rel}`);
        walk(target, rel + '/');
      } else {
        if (rel !== MANIFEST_REL && (!dests.has(rel) || !owned.has(rel))) throw new Error(`unexpected or unowned destination: ${rel}`);
        checkedFile(PUBLIC_DIR, rel);
      }
    }
  }
  walk(PUBLIC_DIR);
}

// All inventory, source, marker and collision checks precede the first write.
// No stale/unowned cleanup: an unknown path is a hard error, never deleted.
try { preflight(); } catch (error) { fail(error.message); }
mkdirSync(PUBLIC_DIR, { recursive: true });
const next = { generated: true, note: 'Generated by scripts/stage-public.mjs. Do not edit; owned files may be replaced.', files: {} };
for (const rel of ALLOWLIST) {
  const dest = path.join(PUBLIC_DIR, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(path.join(PROJECT_ROOT, rel), dest);
  next.files[rel] = sha256File(dest);
}
const configPath = path.join(PUBLIC_DIR, CONFIG_REL);
writeFileSync(configPath, JSON.stringify(SERVE_CONFIG, null, 2) + '\n');
next.files[CONFIG_REL] = sha256File(configPath);
writeFileSync(path.join(PUBLIC_DIR, MANIFEST_REL), JSON.stringify(next, null, 2) + '\n');
console.log(`[stage-public] staged ${Object.keys(next.files).length} files into ${PUBLIC_DIR}`);
