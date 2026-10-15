#!/usr/bin/env node
/**
 * play.mjs — double-click launcher for NEON BLOCKS.
 *
 * The game uses ES modules plus an <script type="importmap">, so it cannot be
 * opened straight from the filesystem (file:// blocks module fetches). It needs
 * the local static server in serve.mjs. This launcher starts that server as a
 * detached background process, waits until it actually serves the game, then
 * opens it in the default browser. A console window is never left behind.
 *
 * Behaviour:
 *   - Already running?  Just opens the browser (safe to double-click twice).
 *   - Port held by an unrelated program?  Refuses with a clear message rather
 *     than silently opening something that is not the game.
 *   - Server fails to come up?  Kills it again and exits non-zero.
 *
 * Flags:
 *   --no-open   start/verify the server but do not launch a browser (testing)
 *   --stop      shut down a server this launcher started (see stop.mjs)
 */

import { spawn } from 'node:child_process';
import { openSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(PROJECT_ROOT, 'scripts', 'serve.mjs');
const PID_FILE = path.join(PROJECT_ROOT, '.tetris-server.pid');
const LOG_FILE = path.join(PROJECT_ROOT, '.tetris-server.log');

const HOST = '127.0.0.1';
const PORT = 5199;              // must match serve.mjs
const URL = `http://${HOST}:${PORT}/`;
const READY_TIMEOUT_MS = 20_000;

// ------------------------------------------------------------------ helpers

/** GET a path from the local server. Resolves with the body, or null on any failure. */
function probe(pathname = '/') {
  return new Promise((resolve) => {
    const req = http.get(
      { host: HOST, port: PORT, path: pathname, timeout: 1200 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True when something is already listening and it is serving our game. */
async function gameIsUp() {
  const res = await probe('/');
  return !!res && res.status === 200 && res.body.includes('NEON');
}

/** True when something at all is listening on the port. */
async function portBusy() {
  return (await probe('/')) !== null;
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    // `start` is a cmd builtin; the empty "" is the window title it would eat.
    spawn('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

/**
 * Start serve.mjs detached so it outlives this launcher, logging to LOG_FILE so
 * a later crash is diagnosable rather than invisible.
 */
function startServer() {
  const log = openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [SERVER], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
  });
  child.unref();
  // Record the pid so Stop.bat can shut down exactly this process later.
  writeFileSync(PID_FILE, String(child.pid));
  return child.pid;
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(-pid); } catch { try { process.kill(pid); } catch { /* already gone */ } }
  }
}

// --------------------------------------------------------------------- main

async function main() {
  const noOpen = process.argv.includes('--no-open');

  if (await gameIsUp()) {
    console.log(`[play] already running at ${URL}`);
    if (!noOpen) openBrowser(URL);
    return 0;
  }

  if (await portBusy()) {
    console.error(`[play] something else is using port ${PORT}.`);
    console.error(`[play] close it (or run stop.bat) and double-click again.`);
    return 1;
  }

  const pid = startServer();
  console.log(`[play] starting server (pid ${pid})...`);

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await gameIsUp()) {
      console.log(`[play] ready -> ${URL}`);
      console.log(`[play] (log: ${LOG_FILE})`);
      if (!noOpen) openBrowser(URL);
      return 0;
    }
    await sleep(250);
  }

  killTree(pid);
  console.error(`[play] server did not start within ${READY_TIMEOUT_MS / 1000}s; stopped it again.`);
  console.error(`[play] see ${LOG_FILE} for details.`);
  return 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`[play] ${err && err.message ? err.message : err}`);
  process.exit(1);
});