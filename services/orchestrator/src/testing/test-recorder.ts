import fs from 'fs';
import path from 'path';
import { SpecSchema, type Spec } from './spec-schema';
import { MagiName } from '../types/magi-types';

interface BeginRunOptions {
  testName?: string;
  magi?: string;
}

interface ToolCallRecord {
  name: string;
  parameters: Record<string, any>;
  timestamp: number;
}

let activeSpec: Spec | null = null;
let activeSpecName: string | null = null;
let startTimeMs = 0;
let toolCalls: ToolCallRecord[] = [];
let spoke: boolean = false;
let plannedGoals: string[] = [];
let currentMagi: MagiName | null = null;

function toMagiName(name: string | undefined): MagiName | null {
  if (!name) return null;
  const norm = name.toLowerCase();
  if (norm.startsWith('b')) return MagiName.Balthazar;
  if (norm.startsWith('m')) return MagiName.Melchior;
  if (norm.startsWith('c')) return MagiName.Caspar;
  return null;
}

function loadAllSpecs(): Spec[] {
  // Specs live at services/orchestrator/src/testing/integration/specs
  const baseDir = path.resolve(__dirname, 'integration', 'specs');
  if (!fs.existsSync(baseDir)) return [];
  const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.json'));
  const specs: Spec[] = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(baseDir, file), 'utf8');
      const parsed = JSON.parse(content);
      const spec = SpecSchema.parse(parsed);
      if (spec.meta?.enabled !== false) {
        specs.push(spec);
      }
    } catch (err) {
      const reason = (err as Error)?.message || String(err);
      console.debug(`Skipping invalid spec file ${file}: ${reason}`);
    }
  }
  return specs;
}

function loadSpecByName(name?: string): Spec | null {
  if (!name) return null;
  const specs = loadAllSpecs();
  const found = specs.find(s => s.test?.name === name);
  return found ?? null;
}

export const TestRecorder = {
  async initialize(): Promise<void> {
    // If a specific spec is set, load it; otherwise we run with the pool available.
    const explicit = process.env.MAGI_TEST_SPEC ? loadSpecByName(process.env.MAGI_TEST_SPEC) : null;
    activeSpec = explicit;
    activeSpecName = explicit?.test?.name ?? null;
  },

  beginRun(opts: BeginRunOptions): void {
    if (process.env.MAGI_TEST_MODE !== 'true') return;
    // If caller passes a testName, try to load/activate it; otherwise keep current or null
    if (opts.testName) {
      const candidate = loadSpecByName(opts.testName);
      if (candidate) {
        activeSpec = candidate;
        activeSpecName = candidate.test.name;
      }
    }
    currentMagi = toMagiName(opts.magi ?? activeSpec?.test?.magi);
    startTimeMs = Date.now();
    toolCalls = [];
    plannedGoals = [];
    spoke = false;
  },

  endRunAndSummarize(finalResponse: string) {
    const durationMs = Date.now() - startTimeMs;
    return {
      testName: activeSpecName,
      magi: currentMagi,
      durationMs,
      spoke,
      plan: plannedGoals,
      toolCalls,
      finalResponseLength: finalResponse?.length ?? 0,
    };
  },

  recordToolCall(name: string, parameters: Record<string, any>): void {
    toolCalls.push({ name, parameters, timestamp: Date.now() });
  },

  recordPlan(goals: string[], _magi: MagiName): void {
    plannedGoals = Array.isArray(goals) ? goals.slice() : [];
  },

  recordTtsInvocation(_text: string, _persona: MagiName): void {
    spoke = true;
  },

  tryStubTool(toolName: string, toolArgs: Record<string, any>): { used: boolean; response: string } {
    const spec = activeSpec;
    if (!spec?.toolStubs) return { used: false, response: '' };
    const definition = spec.toolStubs[toolName];
    if (!definition) return { used: false, response: '' };

    if (definition.ignoreParameters && definition.response) {
      return { used: true, response: definition.response };
    }

    const variants = definition.responses ?? [];
    for (const variant of variants) {
      const when = variant.when ?? {};
      if (matchesWhenConditions(toolArgs, when)) {
        return { used: true, response: variant.response };
      }
    }

    if (definition.response) {
      return { used: true, response: definition.response };
    }

    return { used: false, response: '' };
  }
};

// Helper functions to reduce complexity and improve readability
function matchesWhenConditions(toolArgs: Record<string, any>, when: Record<string, any>): boolean {
  for (const [paramName, expected] of Object.entries(when)) {
    const actual = (toolArgs as any)[paramName];
    if (!doesValueMatch(actual, expected)) {
      return false;
    }
  }
  return true;
}

function doesValueMatch(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return arraysContainAllValues(actual, expected);
  }
  if (typeof expected === 'object' && expected !== null) {
    return shallowObjectMatches(actual, expected as Record<string, unknown>);
  }
  return String(actual) === String(expected);
}

function arraysContainAllValues(actual: unknown, expectedArray: unknown[]): boolean {
  if (!Array.isArray(actual)) return false;
  const want = expectedArray.map(String);
  const have = (actual as unknown[]).map(String);
  for (const entry of want) {
    if (!have.includes(entry)) return false;
  }
  return true;
}

function shallowObjectMatches(actual: unknown, expectedObject: Record<string, unknown>): boolean {
  const actualObj = (actual ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(expectedObject)) {
    if (JSON.stringify(actualObj[key]) !== JSON.stringify(expectedObject[key])) {
      return false;
    }
  }
  return true;
}
