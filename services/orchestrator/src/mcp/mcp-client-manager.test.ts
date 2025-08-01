import { McpClientManager } from './index';
import { MagiName } from '../types/magi-types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Mock the SDK imports
jest.mock('@modelcontextprotocol/sdk/client/index.js');
jest.mock('@modelcontextprotocol/sdk/client/stdio.js');
jest.mock('@modelcontextprotocol/sdk/types.js');

// Mock logger to avoid path issues
jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock config to avoid file system issues during testing
jest.mock('../config', () => ({
  MAGI_CONDUIT_API_BASE_URL: 'http://localhost:11434',
  Model: {
    Qwen: 'qwen2.5:7b',
    Gemma: 'gemma2:9b',
    Llama: 'llama3.2:3b'
  }
}));

// Mock path module
jest.mock('path', () => ({
  resolve: jest.fn().mockReturnValue('/mocked/path/tavily'),
  join: jest.fn().mockReturnValue('/mocked/path')
}));

describe('McpClientManager', () => {
  let mcpClientManager: McpClientManager;
  let mockClient: jest.Mocked<Client>;
  let mockTransport: jest.Mocked<StdioClientTransport>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock instances with minimal required methods
    mockClient = {
      connect: jest.fn(),
      listTools: jest.fn(),
      callTool: jest.fn(),
      close: jest.fn()
    } as unknown as jest.Mocked<Client>;

    mockTransport = {
      close: jest.fn(),
    } as unknown as jest.Mocked<StdioClientTransport>;

    // Mock constructors
    (Client as jest.MockedClass<typeof Client>).mockImplementation(() => mockClient);
    (StdioClientTransport as jest.MockedClass<typeof StdioClientTransport>).mockImplementation(() => mockTransport);

    // Create a new instance for each test
    mcpClientManager = new McpClientManager();
  });

  describe('initialization', () => {
    it('should initialize successfully without errors', async () => {
      mockClient.connect.mockResolvedValue(undefined);

      await expect(mcpClientManager.initialize()).resolves.not.toThrow();
      expect(mockClient.connect).toHaveBeenCalledTimes(2); // Updated to reflect two servers (Balthazar + Melchior)
    });

    it('should not initialize twice', async () => {
      mockClient.connect.mockResolvedValue(undefined);

      await mcpClientManager.initialize();
      await mcpClientManager.initialize(); // Second call

      expect(mockClient.connect).toHaveBeenCalledTimes(2); // Updated to reflect two servers (Balthazar + Melchior)
    });

    it('should handle connection failures gracefully', async () => {
      mockClient.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(mcpClientManager.initialize()).resolves.not.toThrow();
      expect(mockClient.connect).toHaveBeenCalledTimes(2); // Updated to reflect two servers (Balthazar + Melchior)
    });

    it('should configure Client with correct parameters', async () => {
      mockClient.connect.mockResolvedValue(undefined);

      await mcpClientManager.initialize();

      expect(Client).toHaveBeenCalledWith(
        {
          name: 'the-magi-balthazar-tavily',
          version: '1.0.0'
        },
        {
          capabilities: {
            tools: {}
          }
        }
      );
    });
  });

  describe('getAvailableTools', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      // Initialize() calls listTools once per server during validation (1 call)
      // Then getAvailableTools() calls listTools again for each server (1 more call)
      // So we need to mock 2 calls total for Balthazar's server
      mockClient.listTools.mockResolvedValue({
        tools: [
          {
            name: 'tavily-search',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' }
              }
            }
          },
          {
            name: 'tavily-extract',
            inputSchema: {
              type: 'object',
              properties: {
                urls: { type: 'array' }
              }
            }
          }
        ]
      });
      await mcpClientManager.initialize();
    });

    it('should return tools from MCP servers for Balthazar', async () => {
      const tools = await mcpClientManager.getMCPToolInfoForMagi(MagiName.Balthazar);

      expect(tools).toHaveLength(4); // Two MCP tools + two default agentic tools
      
      // Check that both MCP server tools are present
      const mcpTools = tools.filter(tool => ['tavily-search', 'tavily-extract'].includes(tool.name));
      expect(mcpTools).toHaveLength(2);
      
      // Check that default agentic tools are present
      const agenticTools = tools.filter(tool => ['ask-user', 'answer-user'].includes(tool.name));
      expect(agenticTools).toHaveLength(2);
      
      // Verify the structure of the tavily-search tool
      const searchTool = tools.find(tool => tool.name === 'tavily-search');
      expect(searchTool).toEqual({
        name: 'tavily-search',
        description: undefined,
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' }
          }
        },
        instructions: ' query (required): The search query string\n  auto_parameters: false\n  topic: Search category "general" or "news" (string, default: "general")\n  max_results: Maximum results to return 0-10 (number, default: 5)\n  include_answer: Include LLM-generated answer (boolean, default: false)'
      });
    });

    it('should return only default agentic tools for Magi without MCP client', async () => {
      const tools = await mcpClientManager.getMCPToolInfoForMagi(MagiName.Caspar);
      
      // Caspar should get 3 tools: smart-home-devices, ask-user, answer-user
      // But since smart-home-devices requires an MCP server that's not configured in tests,
      // only the 2 default agentic tools should be returned
      expect(tools).toHaveLength(2);
      
      const toolNames = tools.map(tool => tool.name);
      expect(toolNames).toEqual(expect.arrayContaining(['ask-user', 'answer-user']));
    });

    it('should handle listTools errors gracefully', async () => {
      mockClient.listTools.mockReset();
      mockClient.listTools.mockRejectedValue(new Error('List tools failed'));

      const tools = await mcpClientManager.getMCPToolInfoForMagi(MagiName.Balthazar);
      
      // Should still return the default agentic tools even if MCP server fails
      expect(tools).toHaveLength(2);
      const toolNames = tools.map(tool => tool.name);
      expect(toolNames).toEqual(expect.arrayContaining(['ask-user', 'answer-user']));
    });
  });

  describe('executeTool', () => {
    beforeEach(async () => {
      jest.clearAllMocks();
      
      // Create fresh McpClientManager instance for these tests
      mcpClientManager = new McpClientManager();
      
      mockClient.connect.mockResolvedValue(undefined);
      // Mock listTools for initialization (2 calls) and then for tool execution lookups
      // Note: The actual MCP tools are named 'tavily-search' and 'tavily-extract'
      mockClient.listTools.mockResolvedValue({
        tools: [
          {
            name: 'tavily-search',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' }
              }
            }
          },
          {
            name: 'tavily-extract',
            inputSchema: {
              type: 'object',
              properties: {
                urls: { type: 'array' }
              }
            }
          },
          {
            name: 'multi_content_tool',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'text_tool',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          }
        ]
      });
      
      mockClient.callTool.mockImplementation(({ name }) => {
        if (name === 'tavily-search') {
          return Promise.resolve({
            content: [
              { type: 'text', text: 'Search results for test query' }
            ],
            isError: false
          });
        } else if (name === 'tavily-extract') {
          return Promise.resolve({
            content: [
              { type: 'text', text: 'Extracted data from web page' }
            ],
            isError: false
          });
        } else if (name === 'multi_content_tool') {
          return Promise.resolve({
            content: [
              { type: 'text', text: 'Text content' },
              { type: 'image', data: 'base64data', mimeType: 'image/png' },
              { type: 'resource', uri: 'file://test.txt', name: 'test.txt', description: 'Test file' }
            ],
            isError: false
          });
        } else if (name === 'text_tool') {
          return Promise.resolve({
            content: [
              { type: 'text', text: 'Text content from tool' }
            ],
            isError: false
          });
        } else {
          return Promise.reject(new Error(`Tool '${name}' not found`));
        }
      });
      await mcpClientManager.initialize();
    });

    it('should execute tool successfully', async () => {
      const result = await mcpClientManager.executeTool(
        MagiName.Balthazar,
        'tavily-search',
        { query: 'test query' }
      );

      expect(result.data).toBeDefined();
      expect(result.data.results).toBeDefined();
      expect(result.data.results[0].content).toBe('Search results for test query');
      expect(result.isError).toBe(false);
    });

    it('should handle tool execution errors', async () => {
      mockClient.callTool.mockRejectedValue(new Error('Tool execution failed'));

      const result = await mcpClientManager.executeTool(
        MagiName.Balthazar,
        'tavily-search',
        { query: 'test query' }
      );

      expect(result.isError).toBe(true);
      expect((result.data as any).text).toContain('not found in any connected MCP server');
    });

    it('should return error for Magi without MCP client', async () => {
      const result = await mcpClientManager.executeTool(
        MagiName.Caspar,
        'some_tool',
        { arg: 'value' }
      );

      expect(result.isError).toBe(true);
      expect(result.data.text).toContain('not found in any connected MCP server for Caspar');
    });

    it('should throw error if not initialized', async () => {
      const uninitializedManager = new McpClientManager();

      await expect(
        uninitializedManager.executeTool(MagiName.Balthazar, 'search', {})
      ).rejects.toThrow('MCP client manager not initialized');
    });

    it('should handle text content', async () => {
      const mockResult = {
        content: [
          { type: 'text', text: 'Text content from tool' }
        ],
        isError: false
      };

      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await mcpClientManager.executeTool(
        MagiName.Balthazar,
        'text_tool',
        {}
      );

      expect(result.data).toBeDefined();
      expect(result.data.text).toBe('Text content from tool');
      expect(result.isError).toBe(false);
    });
  });

  describe('cleanup', () => {
    beforeEach(async () => {
      jest.clearAllMocks();
      
      // Create fresh McpClientManager instance for these tests
      mcpClientManager = new McpClientManager();
      
      mockClient.connect.mockResolvedValue(undefined);
      mockClient.listTools.mockResolvedValue({ tools: [] });
      await mcpClientManager.initialize();
    });

    it('should close all transports during cleanup', async () => {
      mockTransport.close.mockResolvedValue(undefined);

      await mcpClientManager.cleanup();
      expect(mockTransport.close).toHaveBeenCalledTimes(2); // Two servers (Balthazar + Melchior)
    });

    it('should handle transport close errors gracefully', async () => {
      mockTransport.close.mockRejectedValue(new Error('Close failed'));

      await expect(mcpClientManager.cleanup()).resolves.not.toThrow();
      expect(mockTransport.close).toHaveBeenCalledTimes(2); // Two servers will be attempted (Balthazar + Melchior)
    });

    it('should reset initialization state after cleanup', async () => {
      await mcpClientManager.cleanup();

      // Should be able to initialize again
      await expect(mcpClientManager.initialize()).resolves.not.toThrow();
    });
  });

  describe('legacy compatibility', () => {
    it('should maintain backward compatibility with mcpToolRegistry', async () => {
      const { mcpToolRegistry } = await import('./index');

      expect(typeof mcpToolRegistry.initialize).toBe('function');
      expect(typeof mcpToolRegistry.executeTool).toBe('function');
    });
  });
});