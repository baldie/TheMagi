import { McpClientManager } from './index';
import { MagiName } from '../magi/magi';
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
      expect(mockClient.connect).toHaveBeenCalledTimes(2); // Updated to reflect two servers
    });

    it('should not initialize twice', async () => {
      mockClient.connect.mockResolvedValue(undefined);

      await mcpClientManager.initialize();
      await mcpClientManager.initialize(); // Second call

      expect(mockClient.connect).toHaveBeenCalledTimes(2); // Updated to reflect two servers
    });

    it('should handle connection failures gracefully', async () => {
      mockClient.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(mcpClientManager.initialize()).resolves.not.toThrow();
      expect(mockClient.connect).toHaveBeenCalledTimes(2); // Updated to reflect two servers
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
      expect(Client).toHaveBeenCalledWith(
        {
          name: 'the-magi-balthazar-web-crawl',
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
      // Initialize() calls listTools once per server for testing (2 calls)
      // Then getAvailableTools() calls listTools again for each server (2 more calls)
      // So we need to mock 4 calls total
      mockClient.listTools
        .mockResolvedValueOnce({
          tools: [
            {
              name: 'web_search',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string' }
                }
              }
            }
          ]
        })
        .mockResolvedValueOnce({
          tools: [
            {
              name: 'web_extract',
              inputSchema: {
                type: 'object',
                properties: {
                  url: { type: 'string' }
                }
              }
            }
          ]
        })
        .mockResolvedValueOnce({
          tools: [
            {
              name: 'web_search',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string' }
                }
              }
            }
          ]
        })
        .mockResolvedValueOnce({
          tools: [
            {
              name: 'web_extract',
              inputSchema: {
                type: 'object',
                properties: {
                  url: { type: 'string' }
                }
              }
            }
          ]
        });
      await mcpClientManager.initialize();
    });

    it('should return tools from MCP servers for Balthazar', async () => {
      const tools = await mcpClientManager.getAvailableTools(MagiName.Balthazar);

      expect(tools).toHaveLength(2); // One tool from each server
      expect(tools).toEqual([
        {
          name: 'web_search',
          description: undefined,
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' }
            }
          }
        },
        {
          name: 'web_extract',
          description: undefined,
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string' }
            }
          }
        }
      ]);
    });

    it('should return empty array for Magi without MCP client', async () => {
      const tools = await mcpClientManager.getAvailableTools(MagiName.Caspar);
      expect(tools).toEqual([]);
    });

    it('should handle listTools errors gracefully', async () => {
      mockClient.listTools.mockReset();
      mockClient.listTools.mockRejectedValue(new Error('List tools failed'));

      const tools = await mcpClientManager.getAvailableTools(MagiName.Balthazar);
      expect(tools).toEqual([]);
    });
  });

  describe('executeTool', () => {
    beforeEach(async () => {
      jest.clearAllMocks();
      
      // Create fresh McpClientManager instance for these tests
      mcpClientManager = new McpClientManager();
      
      mockClient.connect.mockResolvedValue(undefined);
      // Mock listTools for initialization (2 calls) and then for tool execution lookups
      // Note: The actual MCP tools are named 'search' and 'extract', which get mapped to 'web_search' and 'web_extract'
      mockClient.listTools.mockResolvedValue({
        tools: [
          {
            name: 'search',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' }
              }
            }
          },
          {
            name: 'extract',
            inputSchema: {
              type: 'object',
              properties: {
                url: { type: 'string' }
              }
            }
          },
          {
            name: 'multi_content_tool',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          }
        ]
      });
      
      mockClient.callTool.mockImplementation(({ name }) => {
        if (name === 'search') {
          return Promise.resolve({
            content: [
              { type: 'text', text: 'Search results for test query' }
            ],
            isError: false
          });
        } else if (name === 'extract') {
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
        } else {
          return Promise.reject(new Error(`Tool '${name}' not found`));
        }
      });
      await mcpClientManager.initialize();
    });

    it('should execute tool successfully', async () => {
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
      expect(result.content[0].text).toContain('not found in any connected MCP server');
    });

    it('should return error for Magi without MCP client', async () => {
      const result = await mcpClientManager.executeTool(
        MagiName.Caspar,
        'some_tool',
        { arg: 'value' }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found in any connected MCP server for Caspar');
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
      expect(mockTransport.close).toHaveBeenCalledTimes(2); // Two servers
    });

    it('should handle transport close errors gracefully', async () => {
      mockTransport.close.mockRejectedValue(new Error('Close failed'));

      await expect(mcpClientManager.cleanup()).resolves.not.toThrow();
      expect(mockTransport.close).toHaveBeenCalledTimes(2); // Two servers, both will be attempted
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