#!/usr/bin/env node
/**
 * stop.mjs — shut down the game server started by play.mjs.
 *
 * Double-click Stop.bat after playing. Safe to run when nothing is running:
 * it reports that and exits 0.
 *
 * Stops only a process whose command line is this project's serve.mjs, so it
 * can never kill an unrelated program that happens to hold the port.
 */

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PID_FILE = path.join(PROJECT_ROOT, '.tetris-server.pid');
const HOST = '127.0.0.1';
const PORT = 5199;

/** Read the launcher-recorded pid, if any. */
function readPid() {
  try {
    const n = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Does this pid actually look like our serve.mjs? Guards against a recycled pid. */
function isOurServer(pid) {
  if (process.platform !== 'win32') return true;
  try {
    const cmd = execFileSync(
      'wmic', ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return /serve\.mjs/i.test(cmd);
  } catch {
    // wmic is absent on newer Windows 11 builds. Fall back to wsl-free powershell.
    try {
      const cmd = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
        { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      return /serve\.mjs/i.test(cmd);
    } catch { return false; }
  }
}

function portBusy() {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path: '/', timeout: 1000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

const kill = (pid) => {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(-pid); } catch { try { process.kill(pid); } catch { /* gone */ } }
  }
};

async function main() {
  const pid = readPid();
  if (!pid) {
    console.log('[stop] no launcher pid recorded.');
    if (await portBusy()) {
      console.log('[stop] port 5199 still in use, but not by this launcher.');
    } else {
      console.log('[stop] nothing to stop.');
    }
    return 0;
  }
  if (!alive(pid)) {
    console.log(`[stop] pid ${pid} is gone; clearing the record.`);
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    return 0;
  }
  if (!isOurServer(pid)) {
    console.error(`[stop] pid ${pid} is not this project's serve.mjs; refusing to kill it.`);
    return 1;
  }

  kill(pid);
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  console.log(`[stop] stopped server (pid ${pid}).`);

  // Confirm it actually released the port.
  for (let i = 0; i < 20 && await portBusy(); i++) await new Promise((r) => setTimeout(r, 100));
  console.log((await portBusy()) ? '[stop] warning: port 5199 is still busy.' : '[stop] port 5199 is free.');
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error(`[stop] ${e && e.message ? e.message : e}`);
  process.exit(1);
});