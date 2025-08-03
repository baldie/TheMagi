import { MagiName, PERSONAS_CONFIG, Magi } from './magi';
import { MagiTool } from '../mcp';

// Mock the dependencies before importing
jest.mock('./conduit-client', () => ({
  ConduitClient: class MockConduitClient {
    public name: string;
    constructor(name: string) {
      this.name = name;
    }
    async contact() {
      return 'mock contact response';
    }
    async contactForJSON() {
      return {
        thought: "mock thought",
        action: {
          tool: {
            name: "answer-user",
            parameters: { answer: "mock response" }
          }
        }
      };
    }
  }
}));

jest.mock('./tool-user', () => ({
  ToolUser: class MockToolUser {
    constructor() {}
    async getAvailableTools() {
      return [];
    }
    async executeAgenticTool() {
      return 'mock tool response';
    }
  }
}));

jest.mock('./short-term-memory', () => ({
  ShortTermMemory: class MockShortTermMemory {
    constructor() {}
    async summarize() {
      return '';
    }
    async determineTopic() {
      return null;
    }
    remember() {}
    forget() {}
  }
}));

jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('Magi Configuration', () => {
  it('should have all three Magi personas configured', () => {
    expect(PERSONAS_CONFIG[MagiName.Balthazar]).toBeDefined();
    expect(PERSONAS_CONFIG[MagiName.Melchior]).toBeDefined();
    expect(PERSONAS_CONFIG[MagiName.Caspar]).toBeDefined();
  });

  it('should have correct temperature settings', () => {
    expect(PERSONAS_CONFIG[MagiName.Balthazar].options.temperature).toBe(0.4);
    expect(PERSONAS_CONFIG[MagiName.Melchior].options.temperature).toBe(0.6);
    expect(PERSONAS_CONFIG[MagiName.Caspar].options.temperature).toBe(0.5);
  });

});

describe('Magi contactAsAgent', () => {
  let magi: Magi;
  let mockExecuteAgenticTool: jest.SpyInstance;
  let mockContactForJSON: jest.SpyInstance;

  beforeEach(async () => {
    magi = new Magi(MagiName.Balthazar, PERSONAS_CONFIG[MagiName.Balthazar]);
    await magi.initialize("You are Balthazar, a logical and analytical AI assistant.");
    
    // Mock the ToolUser.executeAgenticTool method
    mockExecuteAgenticTool = jest.spyOn(magi['toolUser'], 'executeAgenticTool');
    
    // Mock the ConduitClient.contactForJSON method through the conduit property
    mockContactForJSON = jest.spyOn(magi['conduit'], 'contactForJSON');
    
    // Mock the makeTTSReady method to return the input unchanged
    jest.spyOn(magi as any, 'makeTTSReady').mockImplementation(async (...args: unknown[]) => Promise.resolve(args[0] as string));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should handle simple contact without agentic loop', async () => {
    // Mock the conduit.contact method directly for contactSimple
    const mockContact = jest.spyOn(magi['conduit'], 'contact');
    mockContact.mockResolvedValue("Simple response");
    
    const result = await magi.contactSimple("What is 2+2?", "You are a math expert");
    
    expect(result).toBe("Simple response");
    expect(mockContact).toHaveBeenCalledWith("What is 2+2?", "You are a math expert", magi['config'].model, magi['config'].options);
    expect(mockContactForJSON).not.toHaveBeenCalled();
    expect(mockExecuteAgenticTool).not.toHaveBeenCalled();
  });

  it('should execute tool and then provide final answer', async () => {
    // First: initial synthesis
    const initialSynthesisResponse = {
      synthesis: "Just started looking into the user's message, see findings."
    };

    // Second: initial goal determination
    const initialGoalResponse = {
      goal: "Search for information about testing"
    };

    // Third: action decision (search tool)
    const toolResponse = {
      thought: "I need to search for information",
      action: {
        tool: {
          name: "search-web",
          parameters: { query: "test query" }
        }
      }
    };

    // Fourth: synthesis after tool execution
    const finalSynthesisResponse = {
      synthesis: "I have gathered information from the search and can now provide an answer"
    };

    // Fifth: final goal determination
    const finalGoalResponse = {
      goal: "Provide the final answer to the user"
    };

    // Sixth: final action decision (answer user)
    const finalResponse = {
      thought: "Based on the search results, I can now answer",
      action: {
        tool: {
          name: "answer-user",
          parameters: { answer: "Here is my final answer based on the search" }
        }
      }
    };

    mockContactForJSON
      .mockResolvedValueOnce(initialSynthesisResponse)  // generateSynthesis call
      .mockResolvedValueOnce(initialGoalResponse)       // determineNextGoal call
      .mockResolvedValueOnce(toolResponse)              // decideNextAction call (search)
      .mockResolvedValueOnce(finalSynthesisResponse)    // generateSynthesis call after tool
      .mockResolvedValueOnce(finalGoalResponse)         // determineNextGoal call after tool
      .mockResolvedValueOnce(finalResponse);            // decideNextAction call (final answer)
    
    mockExecuteAgenticTool.mockResolvedValue("Search results: test data");

    const result = await magi.contactAsAgent("Search for information about testing");

    expect(result).toBe("Here is my final answer based on the search");
    expect(mockContactForJSON).toHaveBeenCalledTimes(6);
    expect(mockExecuteAgenticTool).toHaveBeenCalledWith(
      { name: "search-web", parameters: { query: "test query" } },
      "I need to search for information",
      "Search for information about testing"
    );
  });

  it('should handle multiple tool executions before final answer', async () => {
    const responses = [
      {
        thought: "First I need to search",
        action: { tool: { name: "search-web", parameters: { query: "test" } } }
      },
      {
        thought: "Now I need to analyze the data",
        action: { tool: { name: "read-page", parameters: { urls: "search_results" } } }
      },
      {
        thought: "I can now provide the final answer",
        action: {
          tool: {
            name: "answer-user",
            parameters: { answer: "Final comprehensive answer" }
          }
        }
      }
    ];

    // Proper sequence: synthesis, goal, action calls per the current implementation
    const initialSynthesis = { synthesis: "Starting to look into the complex request" };
    const initialGoal = { goal: "Search for information first" };
    const synthesis2 = { synthesis: "I have search results, need to analyze" };
    const goal2 = { goal: "Analyze the data from search results" };
    const synthesis3 = { synthesis: "I have search results and analysis, ready to answer" };
    const goal3 = { goal: "Provide comprehensive final answer" };

    mockContactForJSON
      .mockResolvedValueOnce(initialSynthesis)    // generateSynthesis
      .mockResolvedValueOnce(initialGoal)         // determineNextGoal
      .mockResolvedValueOnce(responses[0])        // decideNextAction (search)
      .mockResolvedValueOnce(synthesis2)          // generateSynthesis after search
      .mockResolvedValueOnce(goal2)               // determineNextGoal after search
      .mockResolvedValueOnce(responses[1])        // decideNextAction (analyze)
      .mockResolvedValueOnce(synthesis3)          // generateSynthesis after analyze
      .mockResolvedValueOnce(goal3)               // determineNextGoal after analyze
      .mockResolvedValueOnce(responses[2]);       // decideNextAction (final answer)

    mockExecuteAgenticTool
      .mockResolvedValueOnce("Search results")
      .mockResolvedValueOnce("Analysis complete");

    const result = await magi.contactAsAgent("Complex request requiring multiple steps");

    expect(result).toBe("Final comprehensive answer");
    expect(mockContactForJSON).toHaveBeenCalledTimes(9);
    expect(mockExecuteAgenticTool).toHaveBeenCalledTimes(2);
  });

  it('should handle maximum steps reached without final answer', async () => {
    const toolResponse = {
      thought: "I need to keep working",
      action: {
        tool: { name: "test_tool", parameters: {} }
      }
    };

    const synthesisResponse = {
      synthesis: "I have executed some tools but not found a complete answer"
    };
    const goalResponse = {
      goal: "Keep working on the task"
    };

    // Mock all 33 calls: Each of the 11 steps has synthesis + goal + action
    // Each iteration: generateSynthesis, determineNextGoal, decideNextAction
    const mockCalls = [];
    for (let i = 0; i < 11; i++) {
      mockCalls.push(synthesisResponse); // generateSynthesis
      mockCalls.push(goalResponse);      // determineNextGoal  
      mockCalls.push(toolResponse);      // decideNextAction
    }
    
    mockContactForJSON.mockResolvedValueOnce(mockCalls[0]);
    for (let i = 1; i < mockCalls.length; i++) {
      mockContactForJSON.mockResolvedValueOnce(mockCalls[i]);
    }
    
    mockExecuteAgenticTool.mockResolvedValue("Tool executed");

    const result = await magi.contactAsAgent("Never ending task");

    expect(result).toBe("Sorry, I seem to have gotten stuck in a loop. Here is what I found:\nI have executed some tools but not found a complete answer");
    expect(mockContactForJSON).toHaveBeenCalledTimes(33); // 11 * (synthesis + goal + action) = 33 calls
    expect(mockExecuteAgenticTool).toHaveBeenCalledTimes(11); // MAX_STEPS - 1 = 11
  });

  it('should handle invalid JSON response', async () => {
    const synthesisResponse = {
      synthesis: "Starting to work on the question"
    };
    const goalResponse = {
      goal: "Use tools to find answer"
    };

    const invalidResponse = {
      thought: "This response has no valid action",
      action: {}
    };

    mockContactForJSON
      .mockResolvedValueOnce(synthesisResponse)  // generateSynthesis (succeeds)
      .mockResolvedValueOnce(goalResponse)       // determineNextGoal (succeeds)
      .mockResolvedValueOnce(invalidResponse);   // decideNextAction (fails)

    const result = await magi.contactAsAgent("Simple question");

    expect(result).toBe("Sorry, I received an invalid response and had to stop.");
    expect(mockContactForJSON).toHaveBeenCalledTimes(3);
  });

  it('should handle tool execution errors gracefully', async () => {
    const toolResponse = {
      thought: "I'll try to use a tool",
      action: {
        tool: { name: "failing_tool", parameters: {} }
      }
    };

    mockContactForJSON.mockResolvedValue(toolResponse);
    mockExecuteAgenticTool.mockRejectedValue(new Error("Tool execution failed"));

    await expect(magi.contactAsAgent("Test tool error")).rejects.toThrow("Tool execution failed");
  });

  it('should include previous results in subsequent prompts', async () => {
    const initialSynthesis = {
      synthesis: "Just started looking into the user's message, see findings."
    };

    const initialGoal = {
      goal: "Search for relevant information"
    };

    const searchAction = {
      thought: "I need to search first",
      action: { tool: { name: "search-web", parameters: { query: "test" } } }
    };

    const finalSynthesis = {
      synthesis: "I have completed a search and got results"
    };

    const finalGoal = {
      goal: "Provide the final answer based on search results"
    };

    const finalAction = {
      thought: "Now I can answer",
      action: {
        tool: {
          name: "answer-user",
          parameters: { answer: "Answer based on search" }
        }
      }
    };

    mockContactForJSON
      .mockResolvedValueOnce(initialSynthesis)  // generateSynthesis
      .mockResolvedValueOnce(initialGoal)       // determineNextGoal
      .mockResolvedValueOnce(searchAction)      // decideNextAction (search)
      .mockResolvedValueOnce(finalSynthesis)    // generateSynthesis after search
      .mockResolvedValueOnce(finalGoal)         // determineNextGoal after search
      .mockResolvedValueOnce(finalAction);      // decideNextAction (final answer)

    mockExecuteAgenticTool.mockResolvedValue("Search completed successfully");

    await magi.contactAsAgent("Search and answer");

    // Check that the second synthesis call (after tool execution) includes the previous state  
    const synthesisCallArgs = mockContactForJSON.mock.calls[3][0];
    expect(synthesisCallArgs).toContain("CONTEXT:");
    expect(synthesisCallArgs).toContain("Just started looking into the user's message, see findings.");
  });
});

describe('Magi getToolForGoal', () => {
  let magi: Magi;

  beforeEach(async () => {
    magi = new Magi(MagiName.Balthazar, PERSONAS_CONFIG[MagiName.Balthazar]);
    
    // Mock getAvailableTools to return both MCP tools and default tools (as they would come from tool assignments)
    const mockGetAvailableTools = jest.spyOn(magi['toolUser'], 'getAvailableTools');
    mockGetAvailableTools.mockResolvedValue([
      new MagiTool({ name: 'search-web', description: 'Search the web for information', inputSchema: { query: 'string' } }),
      new MagiTool({ name: 'read-page', description: 'Extract content from URLs', inputSchema: { urls: 'string[]' } }),
      new MagiTool({ name: 'ask-user', description: 'Ask the user a clarifying question if more information is needed.', inputSchema: { question: 'string' } }),
      new MagiTool({ name: 'answer-user', description: 'Answer the user with the results you have synthesized, or directly if it is a simple inquiry.', inputSchema: { answer: 'string' } })
    ]);
    
    await magi.initialize("You are Balthazar, a logical AI assistant.");
  });

  it('should return read-page tool for ANALYZE goal (since analyze-data is not available)', () => {
    const result = magi['getToolForGoal']('ANALYZE the data');
    
    expect(result.some(tool => tool.name === 'read-page')).toBe(true);
    expect(result.some(tool => tool.name === 'ask-user')).toBe(false);
    expect(result.some(tool => tool.name === 'answer-user')).toBe(false);
  });

  it('should return answer-user tool for ANSWER goal', () => {
    const result = magi['getToolForGoal']('ANSWER the user');
    
    expect(result.some(tool => tool.name === 'answer-user')).toBe(true);
    expect(result.some(tool => tool.name === 'search-web')).toBe(false);
    expect(result.some(tool => tool.name === 'ask-user')).toBe(false);
  });

  it('should return ask-user tool for ASK goal', () => {
    const result = magi['getToolForGoal']('ASK the user for clarification');
    
    expect(result.some(tool => tool.name === 'ask-user')).toBe(true);
    expect(result.some(tool => tool.name === 'search-web')).toBe(false);
    expect(result.some(tool => tool.name === 'answer-user')).toBe(false);
  });

  it('should return search-web tool for SEARCH goal', () => {
    const result = magi['getToolForGoal']('SEARCH for keyword');
    
    expect(result.some(tool => tool.name === 'search-web')).toBe(true);
    expect(result.some(tool => tool.name === 'ask-user')).toBe(false);
    expect(result.some(tool => tool.name === 'answer-user')).toBe(false);
  });

  it('should return read-page tool for READ goal', () => {
    const result = magi['getToolForGoal']('READ content from URLs');
    
    expect(result.some(tool => tool.name === 'read-page')).toBe(true);
    expect(result.some(tool => tool.name === 'ask-user')).toBe(false);
    expect(result.some(tool => tool.name === 'answer-user')).toBe(false);
  });

  it('should return all tools when goal is empty', () => {
    const result = magi['getToolForGoal']('');
    
    expect(result.some(tool => tool.name === 'search-web')).toBe(true);
    expect(result.some(tool => tool.name === 'read-page')).toBe(true);
    expect(result.some(tool => tool.name === 'ask-user')).toBe(true);
    expect(result.some(tool => tool.name === 'answer-user')).toBe(true);
  });

  it('should return all tools when goal is whitespace only', () => {
    const result = magi['getToolForGoal']('   ');
    
    expect(result.some(tool => tool.name === 'search-web')).toBe(true);
    expect(result.some(tool => tool.name === 'read-page')).toBe(true);
    expect(result.some(tool => tool.name === 'ask-user')).toBe(true);
    expect(result.some(tool => tool.name === 'answer-user')).toBe(true);
  });

  it('should return other tools for unknown goal types', () => {
    const result = magi['getToolForGoal']('UNKNOWN goal type');
    
    // Should exclude the known core tools and include others
    expect(result.some(tool => tool.name === 'search-web')).toBe(true);
    expect(result.some(tool => tool.name === 'read-page')).toBe(true);
    expect(result.some(tool => tool.name === 'ask-user')).toBe(false);
    expect(result.some(tool => tool.name === 'answer-user')).toBe(false);
  });
});