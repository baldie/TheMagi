import { McpClientManager } from './index';
import { MagiName } from '../magi/magi';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Mock the SDK imports
jest.mock('@modelcontextprotocol/sdk/client/index.js');
jest.mock('@modelcontextprotocol/sdk/client/stdio.js');

// Mock logger to avoid path issues
jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock path module
jest.mock('path', () => ({
  resolve: jest.fn().mockReturnValue('/mocked/path/web-search'),
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
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    });

    it('should not initialize twice', async () => {
      mockClient.connect.mockResolvedValue(undefined);

      await mcpClientManager.initialize();
      await mcpClientManager.initialize(); // Second call

      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    });

    it('should handle connection failures gracefully', async () => {
      mockClient.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(mcpClientManager.initialize()).resolves.not.toThrow();
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    });

    it('should configure StdioClientTransport with correct parameters', async () => {
      mockClient.connect.mockResolvedValue(undefined);

      await mcpClientManager.initialize();

      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: '/mocked/path/web-search',
        args: ['mcp_web_search.py'],
        env: expect.any(Object),
        cwd: '/mocked/path/web-search'
      });
    });

    it('should configure Client with correct parameters', async () => {
      mockClient.connect.mockResolvedValue(undefined);

      await mcpClientManager.initialize();

      expect(Client).toHaveBeenCalledWith(
        {
          name: 'the-magi-balthazar',
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
      await mcpClientManager.initialize();
    });

    it('should return tools from MCP server for Balthazar', async () => {
      const mockTools = [
        {
          name: 'web_search',
          description: 'Search the web for information',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' }
            }
          }
        }
      ];

      mockClient.listTools.mockResolvedValue({
        tools: mockTools as any[]
      } as any);

      const tools = await mcpClientManager.getAvailableTools(MagiName.Balthazar);

      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        name: 'web_search',
        description: 'Search the web for information',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' }
          }
        }
      });
    });

    it('should return empty array for Magi without MCP client', async () => {
      const tools = await mcpClientManager.getAvailableTools(MagiName.Caspar);
      expect(tools).toEqual([]);
    });

    it('should handle listTools errors gracefully', async () => {
      mockClient.listTools.mockRejectedValue(new Error('List tools failed'));

      const tools = await mcpClientManager.getAvailableTools(MagiName.Balthazar);
      expect(tools).toEqual([]);
    });
  });

  describe('executeTool', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await mcpClientManager.initialize();
    });

    it('should execute tool successfully', async () => {
      const mockResult = {
        content: [
          {
            type: 'text',
            text: 'Search results for test query'
          }
        ],
        isError: false
      };

      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await mcpClientManager.executeTool(
        MagiName.Balthazar,
        'web_search',
        { query: 'test query' }
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('Search results for test query');
      expect(result.isError).toBe(false);
    });

    it('should handle tool execution errors', async () => {
      mockClient.callTool.mockRejectedValue(new Error('Tool execution failed'));

      const result = await mcpClientManager.executeTool(
        MagiName.Balthazar,
        'web_search',
        { query: 'test query' }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Tool execution failed');
    });

    it('should return error for Magi without MCP client', async () => {
      const result = await mcpClientManager.executeTool(
        MagiName.Caspar,
        'some_tool',
        { arg: 'value' }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No MCP server connected for Caspar');
    });

    it('should throw error if not initialized', async () => {
      const uninitializedManager = new McpClientManager();

      await expect(
        uninitializedManager.executeTool(MagiName.Balthazar, 'web_search', {})
      ).rejects.toThrow('MCP client manager not initialized');
    });

    it('should handle different content types', async () => {
      const mockResult = {
        content: [
          { type: 'text', text: 'Text content' },
          { type: 'image', data: 'base64data', mimeType: 'image/png' },
          { type: 'resource', uri: 'file://test.txt', name: 'test.txt' }
        ],
        isError: false
      };

      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await mcpClientManager.executeTool(
        MagiName.Balthazar,
        'multi_content_tool',
        {}
      );

      expect(result.content).toHaveLength(3);
      expect(result.content[0].text).toBe('Text content');
      expect(result.content[1].data).toBe('base64data');
      expect(result.content[1].mimeType).toBe('image/png');
      expect(result.content[2].uri).toBe('file://test.txt');
      expect(result.content[2].name).toBe('test.txt');
    });
  });

  describe('cleanup', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await mcpClientManager.initialize();
    });

    it('should close all transports during cleanup', async () => {
      mockTransport.close.mockResolvedValue(undefined);

      await mcpClientManager.cleanup();

      expect(mockTransport.close).toHaveBeenCalledTimes(1);
    });

    it('should handle transport close errors gracefully', async () => {
      mockTransport.close.mockRejectedValue(new Error('Close failed'));

      await expect(mcpClientManager.cleanup()).resolves.not.toThrow();
      expect(mockTransport.close).toHaveBeenCalledTimes(1);
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