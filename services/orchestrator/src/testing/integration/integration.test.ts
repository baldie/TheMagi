import WebSocket from 'ws';
import path from 'path';
import fs from 'fs';
import http from 'http';
import net from 'net';
import { spawn } from 'child_process';
import { SpecSchema, type Spec } from '../spec-schema';

// Orchestrator package root (services/orchestrator)
const ORCH_DIR = path.resolve(__dirname, '..', '..', '..');
let ORCH_PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

// Project root (repo root)
const PROJECT_ROOT = path.resolve(ORCH_DIR, '..', '..');

// Logs directory (services/orchestrator/logs)
const LOGS_DIR = path.resolve(ORCH_DIR, 'logs');

function printLogsLocation(): void {
  try {
    console.log(`[integration] Logs directory: ${LOGS_DIR}`);
    if (fs.existsSync(LOGS_DIR)) {
      const logFiles = fs
        .readdirSync(LOGS_DIR)
        .filter((f) => f.endsWith('.log'))
        .map((f) => ({ file: f, mtime: fs.statSync(path.join(LOGS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (logFiles.length > 0) {
        console.log(`[integration] Latest log file: ${path.join(LOGS_DIR, logFiles[0].file)}`);
      }
    }
  } catch {
    // Best-effort; do not fail tests due to logging
  }
}

// Always print logs location, regardless of success or failure
process.on('exit', printLogsLocation);
process.on('uncaughtException', () => { printLogsLocation(); });
process.on('unhandledRejection', () => { printLogsLocation(); });

afterAll(() => {
  // Also print within Jest lifecycle in case process hooks do not fire
  printLogsLocation();
});

// Wait for readiness by parsing the live output of start-magi.sh
async function checkHealthAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += String(chunk); });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(Boolean(json?.status));
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => { try { req.destroy(); } catch {} resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function isPortInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { resolve(false); });
  });
}

function waitForMagiReadyFromProcess(child: ReturnType<typeof spawn>, timeoutMs = 600000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const readyPatterns = [
      /The Magi are ready/i,
      /--- MAGI SYSTEM READY ---/i,
      /Orchestrator listening on port/i,
      /Previous Orchestrator instance already listening on port/i
    ];
    let stdoutBuffer = '';
    let stderrBuffer = '';

    function checkTimeout() {
      if (Date.now() > deadline) {
        cleanup();
        reject(new Error('Timed out waiting for Magi readiness message from process output'));
      } else {
        timer = setTimeout(checkTimeout, 500);
      }
    }

    function handleChunk(chunk: Buffer | string) {
      stdoutBuffer += String(chunk);
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        // Echo script output for visibility during long startup
        if (line.trim().length > 0) console.log(`[start-magi] ${line}`);
        if (readyPatterns.some(r => r.test(line))) {
          cleanup();
          resolve();
          return;
        }
      }
    }

    function handleErrChunk(chunk: Buffer | string) {
      // Some environments emit logs to stderr; scan those too
      stderrBuffer += String(chunk);
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim().length > 0) console.log(`[start-magi][stderr] ${line}`);
        if (readyPatterns.some(r => r.test(line))) {
          cleanup();
          resolve();
          return;
        }
      }
    }

    function cleanup() {
      if (timer) clearTimeout(timer);
      if (child.stdout) {
        child.stdout.removeAllListeners('data');
        try { child.stdout.destroy(); } catch {}
      }
      if (child.stderr) {
        child.stderr.removeAllListeners('data');
        try { child.stderr.destroy(); } catch {}
      }
      child.removeAllListeners('error');
      child.removeAllListeners('exit');
      try { child.unref(); } catch {}
    }

    let timer: NodeJS.Timeout | null = setTimeout(checkTimeout, 500);

    child.stdout?.on('data', handleChunk);
    child.stderr?.on('data', handleErrChunk);
    child.on('error', (e) => { cleanup(); reject(e); });
    child.on('exit', async (code) => {
      // If the start script exits before readiness, perform a last health check
      if (timer) clearTimeout(timer);
      try {
        const ready = await checkHealthAvailable(ORCH_PORT);
        if (ready) {
          cleanup();
          resolve();
          return;
        }
      } catch {}
      if (!readyPatterns.some(r => r.test(stdoutBuffer)) && !readyPatterns.some(r => r.test(stderrBuffer))) {
        cleanup();
        reject(new Error(`start-magi.sh exited early with code ${code ?? 'unknown'} before readiness`));
      }
    });
  });
}

// We no longer start or manage Ollama or the orchestrator here; start-magi.sh handles everything

function loadSpecs(): Spec[] {
  const specsDir = path.resolve(__dirname, 'specs');
  if (!fs.existsSync(specsDir)) return [];
  const results: Spec[] = [];
  const files = fs.readdirSync(specsDir).filter(f => f.endsWith('.json'));
  for (const fileName of files) {
    try {
      const raw = fs.readFileSync(path.join(specsDir, fileName), 'utf8');
      const json = JSON.parse(raw);
      const parsed = SpecSchema.safeParse(json);
      if (!parsed.success) {
        console.debug(`Skipping invalid spec file ${fileName}: ${parsed.error.message}`);
        continue;
      }
      const spec = parsed.data;
      if (spec.meta?.enabled !== false) {
        results.push(spec);
      }
    } catch (err) {
      console.debug(`Skipping unreadable spec file ${fileName}: ${String((err as Error)?.message || err)}`);
    }
  }
  return results;
}

function assertFinalResponse(exp: NonNullable<Spec['expectations']>['finalResponse'], response: string) {
  if (!exp) return;
  const { mustContain = [], mustNotContain = [], minLength, maxLength } = exp;
  for (const s of mustContain) expect(response).toEqual(expect.stringContaining(s));
  for (const s of mustNotContain) expect(response).not.toEqual(expect.stringContaining(s));
  if (minLength !== undefined) expect(response.length).toBeGreaterThanOrEqual(minLength);
  if (maxLength !== undefined) expect(response.length).toBeLessThanOrEqual(maxLength);
}

function assertToolUsage(exp: NonNullable<Spec['expectations']>['toolUsage'], testMeta: any) {
  if (!exp) return;
  const calls: Array<{name: string}> = testMeta?.toolCalls ?? [];
  const names = calls.map(c => c.name);
  const { mustCall = [], mustNotCall = [], expectedOrder = [], maxToolCalls } = exp;
  for (const name of mustCall) expect(names).toContain(name);
  for (const name of mustNotCall) expect(names).not.toContain(name);
  for (const rule of expectedOrder) {
    const iA = names.indexOf(rule.tool);
    const iB = names.indexOf(rule.before);
    if (iA >= 0 && iB >= 0) expect(iA).toBeLessThan(iB);
  }
  if (maxToolCalls !== undefined) expect(names.length).toBeLessThanOrEqual(maxToolCalls);
}

function assertBehavior(exp: NonNullable<Spec['expectations']>['behavior'], testMeta: any) {
  if (!exp) return;
  if (exp.shouldSpeak !== undefined) {
    expect(Boolean(testMeta?.spoke)).toBe(Boolean(exp.shouldSpeak));
  }
  if (exp.maxDuration !== undefined) {
    expect(testMeta?.durationMs).toBeLessThanOrEqual(exp.maxDuration);
  }
}

function assertPlanning(exp: NonNullable<Spec['expectations']>['planning'], testMeta: any) {
  if (!exp) return;
  if (exp.goalCount) {
    const min = exp.goalCount.min ?? 0;
    const max = exp.goalCount.max ?? Number.MAX_SAFE_INTEGER;
    const count = (testMeta?.plan ?? []).length;
    expect(count).toBeGreaterThanOrEqual(min);
    expect(count).toBeLessThanOrEqual(max);
  }
  if (exp.shouldPlanFor) {
    const joined = (testMeta?.plan ?? []).join(' ').toLowerCase();
    for (const k of exp.shouldPlanFor) {
      expect(joined).toContain(k.toLowerCase());
    }
  }
}

function assertExpectations(spec: Spec, response: string, testMeta: any) {
  const exp = spec.expectations;
  if (!exp) return;
  assertFinalResponse(exp.finalResponse, response);
  assertToolUsage(exp.toolUsage, testMeta);
  assertBehavior(exp.behavior, testMeta);
  assertPlanning(exp.planning, testMeta);
}

// no persistent child refs needed

beforeAll(async () => {
  // Start the full Magi system via the provided script and wait for readiness from its output
  let child: ReturnType<typeof spawn>;
  try {
    console.log('[integration] Launching start-magi.sh and waiting for readiness...');
    console.log('[integration] This can take several minutes on first run.');
    // Pipe 'yes' to auto-accept any interactive prompts (e.g., missing models warning)
    if (await isPortInUse(ORCH_PORT)) {
      ORCH_PORT = 18080;
    }
    child = spawn('bash', ['-lc', 'yes | ./start-magi.sh --no-nodemon'], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MAGI_TEST_MODE: 'true', PORT: String(ORCH_PORT) },
    });
  } catch (e) {
    throw new Error(`Failed to start Magi via start-magi.sh: ${String((e as Error)?.message || e)}`);
  }

  await waitForMagiReadyFromProcess(child, 600000);
  console.log('[integration] Magi reported ready. Beginning tests...');
}, 900000);

// Intentionally do not shut down services after tests; leave them running

const specs = loadSpecs();

describe('Integration (single Magi) specs', () => {
  if (specs.length === 0) {
    it('no enabled specs found', () => {
      expect(true).toBe(true);
    });
    return;
  }

  for (const spec of specs) {
    const name = spec.test.name;
    it(name, async () => {
      // Sanity: ensure health responds before opening WS
      const healthy = await checkHealthAvailable(ORCH_PORT);
      console.log(`[integration] Health check before WS connect on ${ORCH_PORT}: ${healthy}`);
      const ws = new WebSocket(`ws://127.0.0.1:${ORCH_PORT}`);
      const result = await new Promise<{response: string, meta: any}>((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('WS test timeout')), spec.test.timeout ?? 60000);
          ws.on('open', () => {
            console.log('[integration] WS open, sending start-magi');
            ws.send(JSON.stringify({
              type: 'start-magi',
              data: {
                testName: name,
                magi: spec.test.magi,
                userMessage: spec.input.userMessage
              }
            }));
          });
        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(String(raw));
            if (msg.type !== 'log') {
              console.log(`[integration] WS message: ${JSON.stringify(msg)}`);
            }
            if (msg.type === 'deliberation-complete') {
              clearTimeout(to);
              resolve({ response: msg.data.response, meta: msg.data.testMeta });
              ws.close();
            } else if (msg.type === 'deliberation-error') {
              clearTimeout(to);
              reject(new Error(msg.data?.error || 'unknown error'));
              ws.close();
            }
          } catch (err) {
            // Ignore non-JSON or irrelevant messages; not a test failure, but record once
            console.debug(`Non-JSON WS message ignored: ${String((err as Error)?.message || err)}`);
          }
        });
        ws.on('error', (e) => {
          clearTimeout(to);
          reject(e);
        });
      });

      assertExpectations(spec, result.response, result.meta);
    }, (spec.test.timeout ?? 60000) + 10000);
  }
});
