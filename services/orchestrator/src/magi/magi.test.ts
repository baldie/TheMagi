import { MagiName, PERSONAS_CONFIG, Magi } from './magi';

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
      return {};
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
    jest.spyOn(magi as any, 'makeTTSReady').mockImplementation((...args: unknown[]) => Promise.resolve(args[0] as string));
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
    const toolResponse = {
      thought: "I need to search for information",
      action: {
        tool: {
          name: "web_search",
          parameters: { query: "test query" }
        }
      }
    };

    const synthesisResponse = {
      synthesis: "I found some search results about testing",
      goal: "Provide a comprehensive answer based on the search results"
    };

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
      .mockResolvedValueOnce(toolResponse)
      .mockResolvedValueOnce(synthesisResponse)
      .mockResolvedValueOnce(finalResponse);
    
    mockExecuteAgenticTool.mockResolvedValue("Search results: test data");

    const result = await magi.contactAsAgent("Search for information about testing");

    expect(result).toBe("Here is my final answer based on the search");
    expect(mockContactForJSON).toHaveBeenCalledTimes(3);
    expect(mockExecuteAgenticTool).toHaveBeenCalledWith(
      { name: "web_search", parameters: { query: "test query" } },
      "I need to search for information",
      "Search for information about testing"
    );
  });

  it('should handle multiple tool executions before final answer', async () => {
    const responses = [
      {
        thought: "First I need to search",
        action: { tool: { name: "search", parameters: { query: "test" } } }
      },
      {
        thought: "Now I need to analyze the data",
        action: { tool: { name: "analyze", parameters: { data: "search_results" } } }
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

    // Need to add synthesis responses between decision steps
    const synthesisResponse1 = {
      synthesis: "I have search results",
      goal: "Now analyze the data"
    };
    const synthesisResponse2 = {
      synthesis: "I have search results and analysis",
      goal: "Provide final comprehensive answer"
    };

    mockContactForJSON
      .mockResolvedValueOnce(responses[0])  // Step 1: Decision (search)
      .mockResolvedValueOnce(synthesisResponse1)  // Step 2: Synthesis
      .mockResolvedValueOnce(responses[1])  // Step 2: Decision (analyze)
      .mockResolvedValueOnce(synthesisResponse2)  // Step 3: Synthesis
      .mockResolvedValueOnce(responses[2]);  // Step 3: Decision (final answer)

    mockExecuteAgenticTool
      .mockResolvedValueOnce("Search results")
      .mockResolvedValueOnce("Analysis complete");

    const result = await magi.contactAsAgent("Complex request requiring multiple steps");

    expect(result).toBe("Final comprehensive answer");
    expect(mockContactForJSON).toHaveBeenCalledTimes(5);
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
      synthesis: "I have executed some tools but not found a complete answer",
      goal: "Keep working on the task"
    };

    // Mock all 21 calls explicitly: 11 decisions + 10 synthesis calls (since loop runs steps 1-11)
    // Step 1: Decision only, Steps 2-11: synthesis + decision
    mockContactForJSON
      .mockResolvedValueOnce(toolResponse)     // Step 1: Decision
      .mockResolvedValueOnce(synthesisResponse) // Step 2: Synthesis
      .mockResolvedValueOnce(toolResponse)     // Step 2: Decision
      .mockResolvedValueOnce(synthesisResponse) // Step 3: Synthesis
      .mockResolvedValueOnce(toolResponse)     // Step 3: Decision
      .mockResolvedValueOnce(synthesisResponse) // Step 4: Synthesis
      .mockResolvedValueOnce(toolResponse)     // Step 4: Decision
      .mockResolvedValueOnce(synthesisResponse) // Step 5: Synthesis
      .mockResolvedValueOnce(toolResponse)     // Step 5: Decision
      .mockResolvedValueOnce(synthesisResponse) // Step 6: Synthesis
      .mockResolvedValueOnce(toolResponse)     // Step 6: Decision
      .mockResolvedValueOnce(synthesisResponse) // Step 7: Synthesis
      .mockResolvedValueOnce(toolResponse)     // Step 7: Decision
      .mockResolvedValueOnce(synthesisResponse) // Step 8: Synthesis
      .mockResolvedValueOnce(toolResponse)     // Step 8: Decision
      .mockResolvedValueOnce(synthesisResponse) // Step 9: Synthesis
      .mockResolvedValueOnce(toolResponse)     // Step 9: Decision
      .mockResolvedValueOnce(synthesisResponse) // Step 10: Synthesis
      .mockResolvedValueOnce(toolResponse)     // Step 10: Decision
      .mockResolvedValueOnce(synthesisResponse) // Step 11: Synthesis
      .mockResolvedValueOnce(toolResponse);    // Step 11: Decision
    
    mockExecuteAgenticTool.mockResolvedValue("Tool executed");

    const result = await magi.contactAsAgent("Never ending task");

    expect(result).toBe("Sorry, I seem to have gotten stuck in a loop. Here is what I found:\nI have executed some tools but not found a complete answer");
    expect(mockContactForJSON).toHaveBeenCalledTimes(21); // 11 decisions + 10 synthesis calls
    expect(mockExecuteAgenticTool).toHaveBeenCalledTimes(11); // MAX_STEPS - 1 = 11
  });

  it('should handle invalid JSON response', async () => {
    const invalidResponse = {
      thought: "This response has no valid action",
      action: {}
    };

    mockContactForJSON.mockResolvedValue(invalidResponse);

    const result = await magi.contactAsAgent("Simple question");

    expect(result).toBe("Sorry, I received an invalid response and had to stop.");
    expect(mockContactForJSON).toHaveBeenCalledTimes(1);
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
    const responses = [
      {
        thought: "I need to search first",
        action: { tool: { name: "search", parameters: { query: "test" } } }
      },
      {
        synthesis: "I have completed a search and got results",
        goal: "Provide the final answer based on search results"
      },
      {
        thought: "Now I can answer",
        action: {
          tool: {
            name: "answer-user",
            parameters: { answer: "Answer based on search" }
          }
        }
      }
    ];

    mockContactForJSON
      .mockResolvedValueOnce(responses[0])  // Step 1: Decision
      .mockResolvedValueOnce(responses[1])  // Step 2: Synthesis  
      .mockResolvedValueOnce(responses[2]); // Step 2: Decision

    mockExecuteAgenticTool.mockResolvedValue("Search completed successfully");

    await magi.contactAsAgent("Search and answer");

    // Check that the synthesis call includes the previous state  
    const synthesisCallArgs = mockContactForJSON.mock.calls[1][0];
    expect(synthesisCallArgs).toContain("What you know so far:");
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
      { name: 'tavily-search', description: 'Search the web for information', inputSchema: { query: 'string' } },
      { name: 'tavily-extract', description: 'Extract content from URLs', inputSchema: { urls: 'string[]' } },
      { name: 'ask-user', description: 'Ask the user a clarifying question if more information is needed.', inputSchema: { question: 'string' } },
      { name: 'analyze-data', description: 'Process and analyze available information to draw conclusions and insights', inputSchema: { focus: 'string', criteria: 'string' } },
      { name: 'answer-user', description: 'Answer the user with the results you have synthesized, or directly if it is a simple inquiry.', inputSchema: { answer: 'string' } }
    ]);
    
    await magi.initialize("You are Balthazar, a logical AI assistant.");
  });

  it('should return analyze-data tool for ANALYZE goal', () => {
    const result = magi['getToolForGoal']('ANALYZE the data');
    
    expect(result).toContain('analyze-data');
    expect(result).toContain('Process and analyze available information');
    expect(result).not.toContain('tavily-search');
    expect(result).not.toContain('ask-user');
    expect(result).not.toContain('answer-user');
  });

  it('should return answer-user tool for ANSWER goal', () => {
    const result = magi['getToolForGoal']('ANSWER the user');
    
    expect(result).toContain('answer-user');
    expect(result).toContain('Answer the user with the results');
    expect(result).not.toContain('analyze-data');
    expect(result).not.toContain('tavily-search');
    expect(result).not.toContain('ask-user');
  });

  it('should return ask-user tool for ASK goal', () => {
    const result = magi['getToolForGoal']('ASK the user for clarification');
    
    expect(result).toContain('ask-user');
    expect(result).toContain('Ask the user a clarifying question');
    expect(result).not.toContain('analyze-data');
    expect(result).not.toContain('tavily-search');
    expect(result).not.toContain('answer-user');
  });

  it('should return tavily-search tool for SEARCH goal', () => {
    const result = magi['getToolForGoal']('SEARCH for keyword');
    
    expect(result).toContain('tavily-search');
    expect(result).toContain('Search the web for information');
    expect(result).not.toContain('analyze-data');
    expect(result).not.toContain('ask-user');
    expect(result).not.toContain('answer-user');
  });

  it('should return tavily-extract tool for EXTRACT goal', () => {
    const result = magi['getToolForGoal']('EXTRACT content from URLs');
    
    expect(result).toContain('tavily-extract');
    expect(result).toContain('Extract content from URLs');
    expect(result).not.toContain('analyze-data');
    expect(result).not.toContain('ask-user');
    expect(result).not.toContain('answer-user');
  });

  it('should return all tools when goal is empty', () => {
    const result = magi['getToolForGoal']('');
    
    expect(result).toContain('tavily-search');
    expect(result).toContain('tavily-extract');
    expect(result).toContain('analyze-data');
    expect(result).toContain('ask-user');
    expect(result).toContain('answer-user');
  });

  it('should return all tools when goal is whitespace only', () => {
    const result = magi['getToolForGoal']('   ');
    
    expect(result).toContain('tavily-search');
    expect(result).toContain('tavily-extract');
    expect(result).toContain('analyze-data');
    expect(result).toContain('ask-user');
    expect(result).toContain('answer-user');
  });

  it('should return other tools for unknown goal types', () => {
    const result = magi['getToolForGoal']('UNKNOWN goal type');
    
    // Should exclude the known core tools and include others
    expect(result).toContain('tavily-search');
    expect(result).toContain('tavily-extract');
    expect(result).not.toContain('analyze-data');
    expect(result).not.toContain('ask-user');
    expect(result).not.toContain('answer-user');
  });
});