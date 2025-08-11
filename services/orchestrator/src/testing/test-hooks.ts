import { TestRecorder } from './test-recorder';
import type { MagiName } from '../types/magi-types';

/**
 * Centralized testing hooks to avoid scattering test conditionals across code.
 * In production, these are effectively no-ops. Tests can enable via env or mock this module.
 */
export const testHooks = {
  isEnabled(): boolean {
    return process.env.MAGI_TEST_MODE === 'true';
  },

  initialize(): Promise<void> {
    if (!this.isEnabled()) return Promise.resolve();
    return TestRecorder.initialize();
  },

  beginRun(opts: { testName?: string; magi?: string }): void {
    if (!this.isEnabled()) return;
    TestRecorder.beginRun(opts);
  },

  endRunAndSummarize(finalResponse: string): unknown {
    if (!this.isEnabled()) return undefined as unknown as object;
    return TestRecorder.endRunAndSummarize(finalResponse);
  },

  recordPlan(goals: string[], magi: MagiName): void {
    if (!this.isEnabled()) return;
    try { TestRecorder.recordPlan(goals, magi); } catch { /* ignore */ }
  },

  recordToolCall(name: string, parameters: Record<string, any>): void {
    if (!this.isEnabled()) return;
    try { TestRecorder.recordToolCall(name, parameters); } catch { /* ignore */ }
  },

  tryStubTool(toolName: string, toolArgs: Record<string, any>): { used: boolean; response: string } {
    if (!this.isEnabled()) return { used: false, response: '' };
    return TestRecorder.tryStubTool(toolName, toolArgs);
  },

  recordTtsInvocation(text: string, persona: MagiName): void {
    if (!this.isEnabled()) return;
    try { TestRecorder.recordTtsInvocation(text, persona); } catch { /* ignore */ }
  }
};

export type TestHooks = typeof testHooks;
