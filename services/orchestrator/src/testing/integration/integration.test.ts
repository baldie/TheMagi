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
      }
      if (child.stderr) {
        child.stderr.removeAllListeners('data');
      }
      child.removeAllListeners('error');
      child.removeAllListeners('exit');
      try { child.unref(); } catch {
        // Ignore unref errors
      }
    }

    let timer: NodeJS.Timeout | null = setTimeout(checkTimeout, 500);

    child.stdout?.on('data', handleChunk);
    child.stderr?.on('data', handleErrChunk);
    child.on('error', (e) => { cleanup(); reject(e); });
    child.on('exit', async (code) => {
      // If the start script exits before readiness, perform a last health check
      if (timer) clearTimeout(timer);
      try {
        const health = await fetchOrchestratorHealth(ORCH_PORT);
        if (health?.status) {
          cleanup();
          resolve();
          return;
        }
      } catch {
        // Ignore health check errors
      }
      if (!readyPatterns.some(r => r.test(stdoutBuffer)) && !readyPatterns.some(r => r.test(stderrBuffer))) {
        cleanup();
        reject(new Error(`start-magi.sh exited early with code ${code ?? 'unknown'} before readiness`));
      }
    });
  });
}

// We no longer start or manage Ollama or the orchestrator here; start-magi.sh handles everything

// Desired health state before opening WebSocket connections
const ORCHESTRATOR_FULL_AVAILABILITY = {
  status: 'available',
  magi: { caspar: 'available', balthazar: 'available', melchior: 'available' }
} as const;

const HEALTH_POLL_INTERVAL_MS = 1000; // 1s
const HEALTH_MAX_WAIT_MS = 120000; // 2 minutes

type HealthResponse = {
  status?: string;
  magi?: {
    caspar?: {status: string};
    balthazar?: {status: string};
    melchior?: {status: string};
  };
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let healthPollAttempt = 0;
async function fetchOrchestratorHealth(port: number): Promise<HealthResponse | null> {
  const attempt = ++healthPollAttempt;
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += String(chunk); });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json as HealthResponse);
        } catch (error) {
          console.log(`[integration] [health] attempt=${attempt} parse error: ${String((error as Error)?.message || error)}`);
          resolve(null);
        }
      });
    });
    req.on('timeout', () => {
      console.log(`[integration] [health] attempt=${attempt} timeout after 2000ms`);
      try { req.destroy(); } catch {
        // Ignore destroy errors
      }
      resolve(null);
    });
    req.on('error', (err) => {
      console.log(`[integration] [health] attempt=${attempt} network error: ${String((err as Error)?.message || err)}`);
      resolve(null);
    });
  });
}

async function waitForFullAvailability(port: number, timeoutMs: number = HEALTH_MAX_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let health: HealthResponse | null = null;
  while (Date.now() < deadline) {
    health = await fetchOrchestratorHealth(port);
    if (
      health &&
      health.status === ORCHESTRATOR_FULL_AVAILABILITY.status &&
      health.magi?.caspar?.status === ORCHESTRATOR_FULL_AVAILABILITY.magi.caspar &&
      health.magi?.balthazar?.status === ORCHESTRATOR_FULL_AVAILABILITY.magi.balthazar &&
      health.magi?.melchior?.status === ORCHESTRATOR_FULL_AVAILABILITY.magi.melchior
    ) {
      console.log(`[integration] Orchestrator fully available on port ${port}`);
      return true;
    }
    await delay(HEALTH_POLL_INTERVAL_MS);
  }
  console.log(`[integration] Orchestrator not fully available on port ${port}: ${JSON.stringify(health)}`);
  return false;
}

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
    // Create a stable run id so all processes share the same log file name
    const RUN_ID = String(Date.now());
    const TEST_ENV = { ...process.env, MAGI_TEST_MODE: 'true', MAGI_TEST_RUN_ID: RUN_ID } as Record<string, string>;
    child = spawn('bash', ['-lc', 'yes | ./start-magi.sh --no-nodemon'], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...TEST_ENV, PORT: String(ORCH_PORT) },
    });
    // Also write an index line so the test runner can quickly identify the active log
    try {
      // fs already imported at top
      const logIndex = path.join(LOGS_DIR, `integration-${RUN_ID}.log`);
      fs.appendFileSync(logIndex, '');
    } catch {
      // Ignore log file creation errors
    }
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
      // Poll health until orchestrator and all Magi are fully available, or 3 minutes pass
      console.log('[integration] Waiting for full orchestrator availability before WS connect...');
      const fullyAvailable = await waitForFullAvailability(ORCH_PORT);
      if (!fullyAvailable) {
        console.warn('[integration] Full availability not reached within 3 minutes; proceeding to open WS anyway');
      }
      const ws = new WebSocket(`ws://127.0.0.1:${ORCH_PORT}`);
      const result = await new Promise<{response: string, meta: any}>((resolve, reject) => {
        const testTimeout = (spec.test.timeout ?? 60000) * 2; // Double the timeout for safety
        console.log(`[integration] Using inactivity timeout: ${testTimeout}ms for test: ${name}`);
        const startTime = Date.now();
        let inactivityTimer: NodeJS.Timeout = setTimeout(() => reject(new Error('WS test timeout')), testTimeout);
        const resetInactivityTimer = () => {
          clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(() => reject(new Error('WS test timeout')), testTimeout);
        };
        
        ws.on('open', () => {
          console.log('[integration] WS open, sending contact-magi');
          resetInactivityTimer();
          const message = {
            type: 'contact-magi',
            data: {
              message: spec.input.userMessage,
              testName: name,
              magi: spec.test.magi
            }
          };
          console.log(`[integration] Sending message: ${JSON.stringify(message)}`);
          ws.send(JSON.stringify(message));
          
          // Add heartbeat to show we're actively waiting
          const heartbeatInterval = setInterval(() => {
            console.log(`[integration] Still waiting for Magi deliberation... (${Math.floor((Date.now() - startTime) / 1000)}s elapsed)`);
          }, 10000); // Every 10 seconds
          
          // Clear heartbeat when test completes
          const originalResolve = resolve;
          const originalReject = reject;
          resolve = (...args) => {
            clearInterval(heartbeatInterval);
            clearTimeout(inactivityTimer);
            originalResolve(...args);
          };
          reject = (...args) => {
            clearInterval(heartbeatInterval);
            clearTimeout(inactivityTimer);
            originalReject(...args);
          };
        });
        
        ws.on('message', (raw: Buffer) => {
          try {
            const msg = JSON.parse(String(raw));
            if (msg.type === 'log') {
              // Stream logs like the UI does - this shows server activity in real-time
              console.log(`[magi-log] ${msg.data}`);
              // As long as logs are streaming, consider the system live and reset inactivity timer
              resetInactivityTimer();
            } else {
              console.log(`[integration] WS message type: ${msg.type}`);
              // Any other message also indicates activity
              resetInactivityTimer();
              if (msg.type !== 'ack') {
                console.log(`[integration] WS message data: ${JSON.stringify(msg)}`);
              }
            }
            if (msg.type === 'deliberation-complete') {
              console.log('[integration] Received deliberation-complete, resolving...');
              clearTimeout(inactivityTimer);
              resolve({ response: msg.data.response, meta: msg.data.testMeta });
              ws.close();
            } else if (msg.type === 'deliberation-error') {
              console.log('[integration] Received deliberation-error, rejecting...');
              clearTimeout(inactivityTimer);
              reject(new Error(msg.data?.error || 'unknown error'));
              ws.close();
            }
          } catch (err) {
            // Ignore non-JSON or irrelevant messages; not a test failure, but record once
            console.debug(`Non-JSON WS message ignored: ${String((err as Error)?.message || err)}`);
          }
        });
        
        ws.on('error', (e: any) => {
          clearTimeout(inactivityTimer);
          reject(e);
        });
      });

      assertExpectations(spec, result.response, result.meta);
    }, Math.max((spec.test.timeout ?? 60000) * 3 + HEALTH_MAX_WAIT_MS, HEALTH_MAX_WAIT_MS + 120000)); // Include up to 3 min health wait
  }
});
