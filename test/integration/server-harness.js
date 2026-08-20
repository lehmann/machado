// Starts the Python server (uvicorn) with a deterministic fake MT engine so
// integration tests exercise the real HTTP stack without the NLLB model/GPU.
// If a server is already reachable it reuses it; if it can't start (deps
// missing), returns null so tests skip cleanly.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const SERVER_DIR = fileURLToPath(new URL('../../server/', import.meta.url));

async function reachable(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    const r = await fetch(`${url}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

export async function startServer(port = 8123) {
  const url = `http://127.0.0.1:${port}`;

  // Reuse an already-running server (e.g. started manually).
  if (await reachable(url)) return { url, external: true, stop() {} };

  let proc;
  try {
    proc = spawn(
      'python3',
      ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)],
      {
        cwd: SERVER_DIR,
        env: { ...process.env, MACHADO_FAKE_MT: '1', CT2_DEVICE: 'cpu' },
        stdio: 'ignore',
        detached: true, // own process group so we can kill any children too
      }
    );
  } catch {
    return null;
  }

  // Don't let the child keep Node's event loop alive if teardown is missed.
  proc.unref();

  const stop = () => {
    try { process.kill(-proc.pid, 'SIGKILL'); } // kill the whole group
    catch { try { proc.kill('SIGKILL'); } catch { /* noop */ } }
  };

  let spawnError = false;
  proc.on('error', () => { spawnError = true; });

  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (spawnError || proc.exitCode !== null) break;
    if (await reachable(url)) {
      return { url, external: false, stop };
    }
    await sleep(300);
  }

  stop();
  return null; // could not start → tests skip
}
