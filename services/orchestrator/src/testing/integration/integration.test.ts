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
    socket.setTimeout(3000); // More generous timeout
    socket.once('connect', () => { 
      socket.destroy(); 
      resolve(true); 
    });
    socket.once('timeout', () => { 
      socket.destroy(); 
      resolve(false); 
    });
    socket.once('error', () => { 
      resolve(false); 
    });
  });
}



async function waitForMagiReadyFromProcess(child: ReturnType<typeof spawn>, timeoutMs = 600000): Promise<void> {
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

const HEALTH_POLL_INTERVAL_MS = 2000; // 2s - less aggressive polling
const HEALTH_MAX_WAIT_MS = 300000; // 5 minutes - more time for cold starts
const HEALTH_REQUEST_TIMEOUT_MS = 5000; // 5s per request
const MAX_STARTUP_RETRIES = 3;

type HealthResponse = {
  status?: string;
  magi?: {
    caspar?: {status: string};
    balthazar?: {status: string};
    melchior?: {status: string};
  };
};

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let healthPollAttempt = 0;
async function fetchOrchestratorHealth(port: number, timeoutMs: number = HEALTH_REQUEST_TIMEOUT_MS): Promise<HealthResponse | null> {
  const attempt = ++healthPollAttempt;
  return new Promise((resolve) => {
    const req = http.get({ 
      host: '127.0.0.1', 
      port, 
      path: '/health', 
      timeout: timeoutMs,
      headers: { 'Connection': 'close' } // Prevent keep-alive issues
    }, (res) => {
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
      console.log(`[integration] [health] attempt=${attempt} timeout after ${timeoutMs}ms`);
      try { req.destroy(); } catch { /* ignore */ }
      resolve(null);
    });
    req.on('error', (err) => {
      if (attempt <= 5 || attempt % 10 === 0) { // Reduce log spam
        console.log(`[integration] [health] attempt=${attempt} network error: ${String((err as Error)?.message || err)}`);
      }
      resolve(null);
    });
  });
}

function isFullyAvailable(health: HealthResponse): boolean {
  return health.status === ORCHESTRATOR_FULL_AVAILABILITY.status &&
    health.magi?.caspar?.status === ORCHESTRATOR_FULL_AVAILABILITY.magi.caspar &&
    health.magi?.balthazar?.status === ORCHESTRATOR_FULL_AVAILABILITY.magi.balthazar &&
    health.magi?.melchior?.status === ORCHESTRATOR_FULL_AVAILABILITY.magi.melchior;
}

function shouldLogProgress(attempt: number, elapsed: number): boolean {
  return attempt === 1 || elapsed % 30000 < HEALTH_POLL_INTERVAL_MS;
}

function shouldLogPartialHealth(attempt: number, elapsed: number): boolean {
  return attempt <= 5 || elapsed % 20000 < HEALTH_POLL_INTERVAL_MS;
}

function calculateBackoff(consecutiveFailures: number): number {
  return consecutiveFailures > 0 
    ? Math.min(HEALTH_POLL_INTERVAL_MS * Math.pow(1.5, Math.min(consecutiveFailures - 1, 4)), 10000)
    : HEALTH_POLL_INTERVAL_MS;
}

async function performHealthCheck(port: number, attempt: number, consecutiveFailures: number, elapsed: number): Promise<{health: HealthResponse | null, newConsecutiveFailures: number}> {
  try {
    const health = await fetchOrchestratorHealth(port);
    
    if (health) {
      if (shouldLogPartialHealth(attempt, elapsed)) {
        console.log(`[integration] Partial health: status=${health.status}, magi=${JSON.stringify(health.magi || {})}`);
      }
      return { health, newConsecutiveFailures: 0 };
    } else {
      return { health: null, newConsecutiveFailures: consecutiveFailures + 1 };
    }
  } catch (error) {
    const newFailures = consecutiveFailures + 1;
    if (newFailures <= 3) {
      console.log(`[integration] Health check error (${newFailures} consecutive): ${String(error)}`);
    }
    return { health: null, newConsecutiveFailures: newFailures };
  }
}

async function waitForFullAvailability(port: number, timeoutMs: number = HEALTH_MAX_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const startTime = Date.now();
  let health: HealthResponse | null = null;
  let consecutiveFailures = 0;
  let attempt = 0;
  
  while (Date.now() < deadline) {
    attempt++;
    const elapsed = Date.now() - startTime;
    
    if (shouldLogProgress(attempt, elapsed)) {
      console.log(`[integration] Health check attempt ${attempt}, elapsed: ${Math.round(elapsed/1000)}s`);
    }
    
    const result = await performHealthCheck(port, attempt, consecutiveFailures, elapsed);
    health = result.health;
    consecutiveFailures = result.newConsecutiveFailures;
    
    if (health && isFullyAvailable(health)) {
      console.log(`[integration] Orchestrator fully available on port ${port} after ${Math.round(elapsed/1000)}s`);
      return true;
    }
    
    const backoffMs = calculateBackoff(consecutiveFailures);
    await delay(backoffMs);
  }
  
  const finalElapsed = Date.now() - startTime;
  console.log(`[integration] Orchestrator not fully available on port ${port} after ${Math.round(finalElapsed/1000)}s`);
  console.log(`[integration] Final health status: ${JSON.stringify(health, null, 2)}`);
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

function assertFinalResponse(exp: NonNullable<Spec['expectations']>['finalResponse'], response: string, spec: Spec) {
  if (!exp) return;
  const { mustContain = [], mustContainAtLeastOneOf = [], mustNotContain = [], minLength, maxLength } = exp;
  
  for (const s of mustContain) {
    expect(response).toEqual(expect.stringContaining(s));
    // Add custom message if assertion fails
    if (!response.includes(s)) {
      throw new Error(`[${spec.test.name}] Final response must contain "${s}"\nActual response: "${response}"\nExpected to contain: ${JSON.stringify(mustContain)}`);
    }
  }
  
  if (mustContainAtLeastOneOf.length > 0) {
    const foundAny = mustContainAtLeastOneOf.some(s => response.includes(s));
    if (!foundAny) {
      throw new Error(`[${spec.test.name}] Final response must contain at least one of the specified strings\nActual response: "${response}"\nExpected to contain at least one of: ${JSON.stringify(mustContainAtLeastOneOf)}`);
    }
    expect(foundAny).toBe(true);
  }
  
  for (const s of mustNotContain) {
    expect(response).not.toEqual(expect.stringContaining(s));
    if (response.includes(s)) {
      throw new Error(`[${spec.test.name}] Final response must NOT contain "${s}"\nActual response: "${response}"\nExpected NOT to contain: ${JSON.stringify(mustNotContain)}`);
    }
  }
  
  if (minLength !== undefined) {
    if (response.length < minLength) {
      throw new Error(`[${spec.test.name}] Final response too short\nActual length: ${response.length}, Required minimum: ${minLength}\nActual response: "${response}"`);
    }
    expect(response.length).toBeGreaterThanOrEqual(minLength);
  }
  
  if (maxLength !== undefined) {
    if (response.length > maxLength) {
      throw new Error(`[${spec.test.name}] Final response too long\nActual length: ${response.length}, Required maximum: ${maxLength}\nActual response: "${response}"`);
    }
    expect(response.length).toBeLessThanOrEqual(maxLength);
  }
}

function validateMustCallTools(names: string[], mustCall: string[], spec: Spec, testMeta: any) {
  for (const name of mustCall) {
    if (!names.includes(name)) {
      throw new Error(`[${spec.test.name}] Tool usage requirement failed\nRequired tool "${name}" was not called\nActual tools called: ${JSON.stringify(names)}\nExpected to call: ${JSON.stringify(mustCall)}\nTest metadata: ${JSON.stringify(testMeta, null, 2)}`);
    }
    expect(names).toContain(name);
  }
}

function validateMustNotCallTools(names: string[], mustNotCall: string[], spec: Spec, testMeta: any) {
  for (const name of mustNotCall) {
    if (names.includes(name)) {
      throw new Error(`[${spec.test.name}] Tool usage restriction failed\nRestricted tool "${name}" was called\nActual tools called: ${JSON.stringify(names)}\nExpected NOT to call: ${JSON.stringify(mustNotCall)}\nTest metadata: ${JSON.stringify(testMeta, null, 2)}`);
    }
    expect(names).not.toContain(name);
  }
}

function validateToolOrder(names: string[], expectedOrder: Array<{tool: string, before: string}>, spec: Spec, testMeta: any) {
  for (const rule of expectedOrder) {
    const iA = names.indexOf(rule.tool);
    const iB = names.indexOf(rule.before);
    if (iA >= 0 && iB >= 0) {
      if (iA >= iB) {
        throw new Error(`[${spec.test.name}] Tool order requirement failed\nTool "${rule.tool}" should be called before "${rule.before}"\nActual order: ${JSON.stringify(names)}\nTest metadata: ${JSON.stringify(testMeta, null, 2)}`);
      }
      expect(iA).toBeLessThan(iB);
    }
  }
}

function validateMaxToolCalls(names: string[], maxToolCalls: number, spec: Spec, testMeta: any) {
  if (names.length > maxToolCalls) {
    throw new Error(`[${spec.test.name}] Too many tool calls\nActual: ${names.length}, Maximum allowed: ${maxToolCalls}\nTools called: ${JSON.stringify(names)}\nTest metadata: ${JSON.stringify(testMeta, null, 2)}`);
  }
  expect(names.length).toBeLessThanOrEqual(maxToolCalls);
}

function assertToolUsage(exp: NonNullable<Spec['expectations']>['toolUsage'], testMeta: any, spec: Spec) {
  if (!exp) return;
  const calls: Array<{name: string}> = testMeta?.toolCalls ?? [];
  const names = calls.map(c => c.name);
  const { mustCall = [], mustNotCall = [], expectedOrder = [], maxToolCalls } = exp;
  
  validateMustCallTools(names, mustCall, spec, testMeta);
  validateMustNotCallTools(names, mustNotCall, spec, testMeta);
  validateToolOrder(names, expectedOrder, spec, testMeta);
  
  if (maxToolCalls !== undefined) {
    validateMaxToolCalls(names, maxToolCalls, spec, testMeta);
  }
}

function assertBehavior(exp: NonNullable<Spec['expectations']>['behavior'], testMeta: any, spec: Spec) {
  if (!exp) return;
  
  if (exp.shouldSpeak !== undefined) {
    const actualSpoke = Boolean(testMeta?.spoke);
    const expectedSpeak = Boolean(exp.shouldSpeak);
    if (actualSpoke !== expectedSpeak) {
      throw new Error(`[${spec.test.name}] Speech behavior expectation failed\nExpected shouldSpeak: ${expectedSpeak}\nActual spoke: ${actualSpoke}\nTest metadata: ${JSON.stringify(testMeta, null, 2)}\nSpec expectations: ${JSON.stringify(exp, null, 2)}`);
    }
    expect(actualSpoke).toBe(expectedSpeak);
  }
  
  if (exp.maxDuration !== undefined) {
    const actualDuration = testMeta?.durationMs;
    if (actualDuration > exp.maxDuration) {
      throw new Error(`[${spec.test.name}] Duration expectation failed\nActual duration: ${actualDuration}ms\nMaximum allowed: ${exp.maxDuration}ms\nTest metadata: ${JSON.stringify(testMeta, null, 2)}`);
    }
    expect(actualDuration).toBeLessThanOrEqual(exp.maxDuration);
  }
}

function assertPlanning(exp: NonNullable<Spec['expectations']>['planning'], testMeta: any, spec: Spec) {
  if (!exp) return;
  
  if (exp.goalCount) {
    const min = exp.goalCount.min ?? 0;
    const max = exp.goalCount.max ?? Number.MAX_SAFE_INTEGER;
    const count = (testMeta?.plan ?? []).length;
    
    if (count < min || count > max) {
      throw new Error(`[${spec.test.name}] Planning goal count failed\nActual goals: ${count}\nExpected range: ${min}-${max}\nActual plan: ${JSON.stringify(testMeta?.plan ?? [])}\nTest metadata: ${JSON.stringify(testMeta, null, 2)}`);
    }
    
    expect(count).toBeGreaterThanOrEqual(min);
    expect(count).toBeLessThanOrEqual(max);
  }
  
  if (exp.shouldPlanFor) {
    const joined = (testMeta?.plan ?? []).join(' ').toLowerCase();
    for (const k of exp.shouldPlanFor) {
      if (!joined.includes(k.toLowerCase())) {
        throw new Error(`[${spec.test.name}] Planning content requirement failed\nExpected plan to include: "${k}"\nActual plan content: "${joined}"\nActual plan array: ${JSON.stringify(testMeta?.plan ?? [])}\nAll required items: ${JSON.stringify(exp.shouldPlanFor)}\nTest metadata: ${JSON.stringify(testMeta, null, 2)}`);
      }
      expect(joined).toContain(k.toLowerCase());
    }
  }
}

function assertExpectations(spec: Spec, response: string, testMeta: any) {
  const exp = spec.expectations;
  if (!exp) return;
  
  console.log(`[integration] [${spec.test.name}] Running assertions with test metadata:`, JSON.stringify(testMeta, null, 2));
  
  assertFinalResponse(exp.finalResponse, response, spec);
  assertToolUsage(exp.toolUsage, testMeta, spec);
  assertBehavior(exp.behavior, testMeta, spec);
  assertPlanning(exp.planning, testMeta, spec);
}

// no persistent child refs needed

async function tryUseExistingService(port: number): Promise<boolean> {
  if (await isPortInUse(port)) {
    console.log(`[integration] Service detected on port ${port}, performing health check...`);
    const isReady = await waitForFullAvailability(port, 120000);
    if (isReady) {
      console.log(`[integration] Using existing healthy service on port ${port}`);
      return true;
    }
    console.log(`[integration] Service on port ${port} exists but is not healthy`);
    console.log(`[integration] Will attempt to start new instance (may conflict)`);
  } else {
    console.log(`[integration] No service detected on port ${port}, starting fresh instance`);
  }
  return false;
}

async function attemptStartup(port: number, attempt: number): Promise<boolean> {
  console.log(`[integration] Startup attempt ${attempt}/${MAX_STARTUP_RETRIES} on port ${port}`);
  
  const RUN_ID = `${Date.now()}-${attempt}`;
  const TEST_ENV = { 
    ...process.env, 
    MAGI_TEST_MODE: 'true', 
    MAGI_TEST_RUN_ID: RUN_ID,
    PORT: String(port)
  } as Record<string, string>;
  
  const child = spawn('/bin/bash', ['-lc', 'yes | ./start-magi.sh --no-nodemon'], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: TEST_ENV,
  });
  
  // Create log file index
  try {
    const logIndex = path.join(LOGS_DIR, `integration-${RUN_ID}.log`);
    fs.appendFileSync(logIndex, `# Integration test attempt ${attempt} on port ${port}\n`);
  } catch {
    // Ignore log file creation errors
  }
  
  // Wait for readiness with longer timeout on first attempt
  const startupTimeout = attempt === 1 ? 600000 : 300000;
  await waitForMagiReadyFromProcess(child, startupTimeout);
  
  // Verify health after startup
  console.log(`[integration] Verifying system health on port ${port}...`);
  const isHealthy = await waitForFullAvailability(port, 120000);
  
  if (isHealthy) {
    console.log(`[integration] Magi system ready on port ${port} after attempt ${attempt}`);
    return true;
  }
  
  throw new Error(`System started but failed health check on port ${port}`);
}

beforeAll(async () => {
  console.log('[integration] Starting Magi system initialization...');
  
  const configuredPort = process.env.PORT ? Number(process.env.PORT) : 8080;
  ORCH_PORT = configuredPort;
  
  // Try to use existing service first
  if (await tryUseExistingService(ORCH_PORT)) {
    return;
  }
  
  // Start new instance with retries
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_STARTUP_RETRIES; attempt++) {
    try {
      const success = await attemptStartup(ORCH_PORT, attempt);
      if (success) return;
    } catch (error) {
      lastError = error as Error;
      console.log(`[integration] Startup attempt ${attempt} failed: ${lastError.message}`);
      
      if (attempt < MAX_STARTUP_RETRIES) {
        console.log(`[integration] Waiting 15s before retry ${attempt + 1}...`);
        await delay(15000);
      }
    }
  }
  
  throw new Error(`Failed to start Magi system on port ${ORCH_PORT} after ${MAX_STARTUP_RETRIES} attempts. Last error: ${lastError?.message}`);
}, 1200000);

// Intentionally do not shut down services after tests; leave them running

function createInactivityTimeoutError(name: string, elapsed: number, testTimeout: number): Error {
  return new Error(`[${name}] Test inactivity timeout after ${elapsed}ms (limit: ${testTimeout}ms). No activity from orchestrator.`);
}

function setupWebSocketHandlers(
  ws: WebSocket, 
  spec: Spec, 
  name: string, 
  port: number,
  startTime: number, 
  testTimeout: number,
  resolve: (value: {response: string, meta: any}) => void,
  reject: (reason: Error) => void
) {
  let inactivityTimer: NodeJS.Timeout;
  let heartbeatInterval: NodeJS.Timeout;
  let isResolved = false;
  let plannerCompletionTimer: NodeJS.Timeout | null = null;
  let plannerCompleted = false;
  
  const resetInactivityTimer = () => {
    // Don't reset the inactivity timer if planner has completed - we want the planner timeout to take precedence
    if (plannerCompleted) return;
    
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      const elapsed = Date.now() - startTime;
      reject(createInactivityTimeoutError(name, elapsed, testTimeout));
    }, testTimeout);
  };

  const connectionTimeout = setTimeout(() => {
    reject(new Error(`[${name}] WebSocket connection timeout after 10 seconds to ws://127.0.0.1:${port}`));
  }, 10000);

  const cleanupTimers = () => {
    clearInterval(heartbeatInterval);
    clearTimeout(inactivityTimer);
    clearTimeout(connectionTimeout);
    if (plannerCompletionTimer) clearTimeout(plannerCompletionTimer);
  };

  inactivityTimer = setTimeout(() => {
    const elapsed = Date.now() - startTime;
    reject(createInactivityTimeoutError(name, elapsed, testTimeout));
  }, testTimeout);

  ws.on('open', () => {
    console.log('[integration] WebSocket connected successfully');
    clearTimeout(connectionTimeout);
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
    
    heartbeatInterval = setInterval(() => {
      console.log(`[integration] Still waiting for Magi deliberation... (${Math.floor((Date.now() - startTime) / 1000)}s elapsed)`);
    }, 10000);
  });

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'log') {
        console.log(`[magi-log] ${msg.data}`);
        resetInactivityTimer();
        
        // Check if this is a planner-machine done state log
        if (msg.data && typeof msg.data === 'string' && msg.data.includes('planner-machine done state')) {
          console.log('[integration] Detected planner-machine completion - waiting 10 seconds for deliberation-complete...');
          
          // Only set the timer if we haven't already resolved
          if (!isResolved && !plannerCompletionTimer) {
            plannerCompleted = true; // Mark that planner has completed
            plannerCompletionTimer = setTimeout(() => {
              if (!isResolved) {
                console.log('[integration] Planner completed but no deliberation-complete received within 10 seconds - test failed!');
                isResolved = true;
                cleanupTimers();
                reject(new Error(`[${name}] Planner machine completed but failed to send deliberation-complete within 10 seconds. This indicates the Magi completed its work but did not use the communicate tool to respond.`));
                ws.close();
              }
            }, 10000); // 10 second grace period (increased from 5)
          }
        }
      } else {
        console.log(`[integration] WS message type: ${msg.type}`);
        resetInactivityTimer();
        if (msg.type !== 'ack') {
          console.log(`[integration] WS message data: ${JSON.stringify(msg)}`);
        }
      }
      if (msg.type === 'deliberation-complete') {
        console.log('[integration] Received deliberation-complete, resolving...');
        if (!isResolved) {
          isResolved = true;
          clearTimeout(inactivityTimer);
          
          setTimeout(() => {
            cleanupTimers();
            resolve({ response: msg.data.response, meta: msg.data.testMeta });
            ws.close();
          }, 3000);
        }
      } else if (msg.type === 'deliberation-error') {
        console.log('[integration] Received deliberation-error, rejecting...');
        if (!isResolved) {
          isResolved = true;
          cleanupTimers();
          reject(new Error(msg.data?.error || 'unknown error'));
          ws.close();
        }
      }
    } catch (err) {
      console.debug(`Non-JSON WS message ignored: ${String((err as Error)?.message || err)}`);
    }
  });

  ws.on('error', (e: any) => {
    if (!isResolved) {
      isResolved = true;
      cleanupTimers();
      reject(new Error(`[${name}] WebSocket error: ${String(e.message || e)}`));
    }
  });
}

async function runWebSocketTest(
  ws: WebSocket, 
  spec: Spec, 
  name: string, 
  port: number
): Promise<{response: string, meta: any}> {
  return new Promise<{response: string, meta: any}>((resolve, reject) => {
    const baseTimeout = spec.test.timeout ?? 60000;
    const testTimeout = Math.max(baseTimeout * 5, 120000);
    console.log(`[integration] Using inactivity timeout: ${testTimeout}ms for test: ${name}`);
    const startTime = Date.now();
    
    setupWebSocketHandlers(ws, spec, name, port, startTime, testTimeout, resolve, reject);
  });
}

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
      // Verify orchestrator is still healthy before test
      console.log(`[integration] [${name}] Verifying orchestrator readiness...`);
      const fullyAvailable = await waitForFullAvailability(ORCH_PORT, 60000); // 1 minute check
      if (!fullyAvailable) {
        // Get detailed diagnostics
        console.log(`[integration] [${name}] Running diagnostics...`);
        const portInUse = await isPortInUse(ORCH_PORT);
        const currentHealth = await fetchOrchestratorHealth(ORCH_PORT, 10000);
        
        console.error(`[integration] [${name}] System not ready:`);
        console.error(`  - Port ${ORCH_PORT} in use: ${portInUse}`);
        console.error(`  - Health response: ${JSON.stringify(currentHealth, null, 2)}`);
        console.error(`  - Logs directory: ${LOGS_DIR}`);
        
        throw new Error(`[${name}] System not ready. Port active: ${portInUse}, Health: ${currentHealth?.status || 'none'}`);
      }
      
      console.log(`[integration] [${name}] Orchestrator is ready. Starting test...`);
      const ws = new WebSocket(`ws://127.0.0.1:${ORCH_PORT}`);
      const result = await runWebSocketTest(ws, spec, name, ORCH_PORT);

      assertExpectations(spec, result.response, result.meta);
    }, Math.max((spec.test.timeout ?? 60000) * 4 + 180000, 600000)); // Generous per-test timeout: 4x base + 3min overhead, minimum 10min
  }
});
