import { MagiName, PERSONAS_CONFIG, Magi } from './magi';

// Mock the dependencies before importing
jest.mock('./conduit-client', () => ({
  ConduitClient: class MockConduitClient {
    public name: string;
    constructor(name: string) {
      this.name = name;
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should handle direct final answer without tools', async () => {
    const mockResponse = {
      thought: "This is a simple question that I can answer directly",
      action: {
        finalAnswer: "This is my direct answer to the user"
      }
    };
    
    mockContactForJSON.mockResolvedValue(mockResponse);
    
    const result = await magi.directMessage("What is 2+2?");
    
    expect(result).toBe("This is my direct answer to the user");
    expect(mockContactForJSON).toHaveBeenCalledTimes(1);
    expect(mockExecuteAgenticTool).not.toHaveBeenCalled();
  });

  it('should execute tool and then provide final answer', async () => {
    const toolResponse = {
      thought: "I need to search for information",
      action: {
        tool: {
          name: "web_search",
          args: { query: "test query" }
        }
      }
    };

    const finalResponse = {
      thought: "Based on the search results, I can now answer",
      action: {
        finalAnswer: "Here is my final answer based on the search"
      }
    };

    mockContactForJSON
      .mockResolvedValueOnce(toolResponse)
      .mockResolvedValueOnce(finalResponse);
    
    mockExecuteAgenticTool.mockResolvedValue("Search results: test data");

    const result = await magi.directMessage("Search for information about testing");

    expect(result).toBe("Here is my final answer based on the search");
    expect(mockContactForJSON).toHaveBeenCalledTimes(2);
    expect(mockExecuteAgenticTool).toHaveBeenCalledWith(
      { name: "web_search", args: { query: "test query" } },
      "I need to search for information",
      "Search for information about testing"
    );
  });

  it('should handle multiple tool executions before final answer', async () => {
    const responses = [
      {
        thought: "First I need to search",
        action: { tool: { name: "search", args: { query: "test" } } }
      },
      {
        thought: "Now I need to analyze the data",
        action: { tool: { name: "analyze", args: { data: "search_results" } } }
      },
      {
        thought: "I can now provide the final answer",
        action: { finalAnswer: "Final comprehensive answer" }
      }
    ];

    mockContactForJSON
      .mockResolvedValueOnce(responses[0])
      .mockResolvedValueOnce(responses[1])
      .mockResolvedValueOnce(responses[2]);

    mockExecuteAgenticTool
      .mockResolvedValueOnce("Search results")
      .mockResolvedValueOnce("Analysis complete");

    const result = await magi.directMessage("Complex request requiring multiple steps");

    expect(result).toBe("Final comprehensive answer");
    expect(mockContactForJSON).toHaveBeenCalledTimes(3);
    expect(mockExecuteAgenticTool).toHaveBeenCalledTimes(2);
  });

  it('should handle maximum steps reached without final answer', async () => {
    const toolResponse = {
      thought: "I need to keep working",
      action: {
        tool: { name: "test_tool", args: {} }
      }
    };

    mockContactForJSON.mockResolvedValue(toolResponse);
    mockExecuteAgenticTool.mockResolvedValue("Tool executed");

    const result = await magi.directMessage("Never ending task");

    expect(result).toBe("Sorry, I seem to have gotten stuck in a loop. Here is what I found:\nNothing is known yet.");
    expect(mockContactForJSON).toHaveBeenCalledTimes(7); // MAX_STEPS - 1
    expect(mockExecuteAgenticTool).toHaveBeenCalledTimes(7);
  });

  it('should handle invalid JSON response', async () => {
    const invalidResponse = {
      thought: "This response has no valid action",
      action: {}
    };

    mockContactForJSON.mockResolvedValue(invalidResponse);

    const result = await magi.directMessage("Simple question");

    expect(result).toBe("Sorry, I received an invalid response and had to stop.");
    expect(mockContactForJSON).toHaveBeenCalledTimes(1);
  });

  it('should handle tool execution errors gracefully', async () => {
    const toolResponse = {
      thought: "I'll try to use a tool",
      action: {
        tool: { name: "failing_tool", args: {} }
      }
    };

    mockContactForJSON.mockResolvedValue(toolResponse);
    mockExecuteAgenticTool.mockRejectedValue(new Error("Tool execution failed"));

    await expect(magi.directMessage("Test tool error")).rejects.toThrow("Tool execution failed");
  });

  it('should include previous results in subsequent prompts', async () => {
    const responses = [
      {
        thought: "I need to search first",
        action: { tool: { name: "search", args: { query: "test" } } }
      },
      {
        thought: "Now I can answer",
        action: { finalAnswer: "Answer based on search" }
      }
    ];

    mockContactForJSON
      .mockResolvedValueOnce(responses[0])
      .mockResolvedValueOnce(responses[1]);

    mockExecuteAgenticTool.mockResolvedValue("Search completed successfully");

    await magi.directMessage("Search and answer");

    // Check that the second call includes the synthesis (which is currently static)
    const secondCallArgs = mockContactForJSON.mock.calls[1][0];
    expect(secondCallArgs).toContain("**What I know so far:**");
    expect(secondCallArgs).toContain("Nothing is known yet.");
  });
});