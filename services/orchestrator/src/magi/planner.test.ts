// Mock the magi module to prevent circular dependency
jest.mock('./magi', () => ({
  MagiName: {
    Balthazar: 'Balthazar',
    Melchior: 'Melchior',
    Caspar: 'Caspar'
  }
}));

import { Planner, PlanStep, StepType } from './planner';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { Model } from '../config';

// Define MagiName enum locally to avoid circular dependency
enum MagiName {
  Balthazar = 'Balthazar',
  Melchior = 'Melchior',
  Caspar = 'Caspar'
}

// Mock dependencies
const mockConduitClient = {
  contact: jest.fn(),
  contactForJSON: jest.fn(),
  getPersonality: jest.fn().mockReturnValue('test-personality')
} as unknown as ConduitClient;

const mockToolUser = {
  getAvailableTools: jest.fn().mockResolvedValue([]),
  executeWithTool: jest.fn()
} as unknown as ToolUser;

describe('Planner', () => {
  let planner: Planner;

  beforeEach(() => {
    jest.clearAllMocks();
    planner = new Planner(
      MagiName.Balthazar,
      mockConduitClient,
      mockToolUser,
      Model.Qwen,
      0.5
    );
  });


  describe('convertStepDataToPlanStep', () => {
    it('should convert step data to PlanStep format', () => {
      const stepData = {
        instruction: 'Test instruction',
        tool: {
          name: 'test-tool',
          args: { param1: 'value1', param2: 'value2' }
        }
      };
      
      const result = (planner as any).convertStepDataToPlanStep(stepData);
      
      expect(result).toEqual({
        instruction: 'Test instruction',
        type: StepType.PLAN_EXECUTION,
        toolName: 'test-tool',
        toolParameters: { param1: 'value1', param2: 'value2' }
      });
    });

    it('should handle step data without tool', () => {
      const stepData = {
        instruction: 'Test instruction without tool'
      };
      
      const result = (planner as any).convertStepDataToPlanStep(stepData);
      
      expect(result).toEqual({
        instruction: 'Test instruction without tool',
        type: StepType.PLAN_EXECUTION
      });
    });
  });

  describe('hydrateToolParameters', () => {
    it('should return hydrated step when LLM responds correctly', async () => {
      const step: PlanStep = {
        instruction: 'Test step',
        toolName: 'test-tool',
        toolParameters: { original: 'value' },
        type: StepType.PLAN_EXECUTION
      };
      
      const mockJsonResponse = {"ToolStep": {"instruction": "Updated step", "tool": {"name": "test-tool", "args": {"updated": "parameter", "url": "https://example.com"}}}};
      (mockConduitClient.contactForJSON as any).mockResolvedValue(mockJsonResponse);
      
      const result = await (planner as any).hydrateToolParameters(
        step,
        'Previous step found: https://example.com',
        'Original User Message'
      );
      
      expect(result).toEqual({
        instruction: 'Updated step',
        type: StepType.PLAN_EXECUTION,
        toolName: 'test-tool',
        toolParameters: { updated: 'parameter', url: 'https://example.com' }
      });
      expect(mockConduitClient.contactForJSON).toHaveBeenCalledWith(
        expect.stringContaining('Identify any parameters in the original tool step to be populated or refined'),
        '',
        Model.Qwen,
        { temperature: 0.1 }
      );
    });

    it('should return original step when hydration fails', async () => {
      const step: PlanStep = {
        instruction: 'Test step',
        toolName: 'test-tool',
        toolParameters: { original: 'value' },
        type: StepType.PLAN_EXECUTION
      };
      
      (mockConduitClient.contactForJSON as any).mockRejectedValue(new Error('LLM failed'));
      
      const result = await (planner as any).hydrateToolParameters(
        step,
        'Previous output',
        'Original User Message'
      );
      
      expect(result).toEqual(step);
    });

    it('should return original step when LLM returns invalid JSON', async () => {
      const step: PlanStep = {
        instruction: 'Test step',
        toolName: 'test-tool',
        toolParameters: { original: 'value' },
        type: StepType.PLAN_EXECUTION
      };
      
      (mockConduitClient.contactForJSON as any).mockRejectedValue(new Error('JSON parsing failed'));
      
      const result = await (planner as any).hydrateToolParameters(
        step,
        'Previous output',
        'Original User Message'
      );
      
      expect(result).toEqual(step);
    });

    it('should handle step with undefined toolParameters', async () => {
      const step: PlanStep = {
        instruction: 'Test step',
        toolName: 'test-tool',
        type: StepType.PLAN_EXECUTION
      };
      
      (mockConduitClient.contactForJSON as any).mockRejectedValue(new Error('LLM failed'));
      
      const result = await (planner as any).hydrateToolParameters(
        step,
        'Previous output',
        'Original User Message'
      );
      
      expect(result).toEqual(step);
    });

    it('should include relevant context in hydration prompt', async () => {
      const step: PlanStep = {
        instruction: 'Crawl the URL from search results',
        toolName: 'crawl_url',
        toolParameters: { url: 'placeholder-url' },
        type: StepType.PLAN_EXECUTION
      };
      
      const mockJsonResponse = {"ToolStep": {"instruction": "Crawl the URL from search results", "tool": {"name": "crawl_url", "args": {"url": "https://extracted-url.com"}}}};
      (mockConduitClient.contactForJSON as any).mockResolvedValue(mockJsonResponse);
      
      await (planner as any).hydrateToolParameters(
        step,
        'Search results: Found https://extracted-url.com with relevant content',
        'Find information about cooking'
      );
      
      const callArgs = (mockConduitClient.contactForJSON as any).mock.calls[0][0];
      expect(callArgs).toContain('Find information about cooking');
      expect(callArgs).toContain('Crawl the URL from search results');
      expect(callArgs).toContain('crawl_url');
      expect(callArgs).toContain('Search results: Found https://extracted-url.com');
      expect(callArgs).toContain('ORIGINAL TOOL STEP JSON');
    });
  });
});