import { ToolUser } from './tool-user';
import { MagiName, Magi, PERSONAS_CONFIG } from './magi';
import { mcpClientManager } from '../mcp';

// Mock logger to avoid path issues
jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock the MCP client manager
jest.mock('../mcp', () => ({
  mcpClientManager: {
    initialize: jest.fn(),
    getMCPToolInfoForMagi: jest.fn(),
    executeTool: jest.fn()
  }
}));

const mockMcpClientManager = mcpClientManager as jest.Mocked<typeof mcpClientManager>;

describe('ToolUser', () => {
  let toolUser: ToolUser;
  let mockMagi: Magi;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMagi = new Magi(MagiName.Balthazar, PERSONAS_CONFIG[MagiName.Balthazar]);
    toolUser = new ToolUser(mockMagi);
  });

  describe('getAvailableTools', () => {
    it('should return tools from MCP client manager', async () => {
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

      mockMcpClientManager.getMCPToolInfoForMagi.mockResolvedValue(mockTools);

      const tools = await toolUser.getAvailableTools();

      expect(mockMcpClientManager.getMCPToolInfoForMagi).toHaveBeenCalledWith(MagiName.Balthazar);
      expect(tools).toEqual(mockTools);
    });

    it('should handle errors gracefully', async () => {
      mockMcpClientManager.getMCPToolInfoForMagi.mockRejectedValue(new Error('Failed to get tools'));

      const tools = await toolUser.getAvailableTools();

      expect(tools).toEqual([]);
    });

    it('should work for different Magi', async () => {
      const casparMagi = new Magi(MagiName.Caspar, PERSONAS_CONFIG[MagiName.Caspar]);
      const casparToolUser = new ToolUser(casparMagi);
      mockMcpClientManager.getMCPToolInfoForMagi.mockResolvedValue([]);

      await casparToolUser.getAvailableTools();

      expect(mockMcpClientManager.getMCPToolInfoForMagi).toHaveBeenCalledWith(MagiName.Caspar);
    });
  });

  describe('executeWithTool', () => {
    beforeEach(() => {
      mockMcpClientManager.initialize.mockResolvedValue(undefined);
    });

    it('should execute tool successfully', async () => {
      const mockResult = {
        data: {
          text: 'Search results for test query'
        },
        isError: false
      };

      mockMcpClientManager.executeTool.mockResolvedValue(mockResult);

      const result = await toolUser.executeWithTool(
        'web_search',
        { query: 'test query' },
        'Search for information'
      );

      expect(mockMcpClientManager.initialize).toHaveBeenCalled();
      expect(mockMcpClientManager.executeTool).toHaveBeenCalledWith(
        MagiName.Balthazar,
        'web_search',
        { query: 'test query' }
      );
      expect(result).toContain('Search results for test query');
    });

    it('should handle tool execution errors', async () => {
      mockMcpClientManager.executeTool.mockRejectedValue(new Error('Tool execution failed'));

      const result = await toolUser.executeWithTool(
        'web_search',
        { query: 'test' },
        'Search for something'
      );

      expect(result).toContain('Tool execution failed');
      expect(result).toContain('proceeding with reasoning-based analysis');
    });

    it('should handle empty tool results', async () => {
      const mockResult = {
        data: {
          text: 'Tool executed successfully but returned no text content'
        },
        isError: false
      };

      mockMcpClientManager.executeTool.mockResolvedValue(mockResult);

      const result = await toolUser.executeWithTool(
        'empty_tool',
        {},
        'Test empty result'
      );

      expect(result).toContain('Tool executed successfully but returned no text content');
    });

    it('should handle error responses from tools', async () => {
      const mockResult = {
        data: {
          text: 'Tool error occurred'
        },
        isError: true
      };

      mockMcpClientManager.executeTool.mockResolvedValue(mockResult);

      const result = await toolUser.executeWithTool(
        'error_tool',
        {},
        'Test error handling'
      );

      expect(result).toContain('Tool error occurred');
    });

    it('should process web search results', async () => {
      const mockResult = {
        data: {
          text: 'Search query: test query\n\nFound 2 results:\n\n1. First Result\n   URL: https://example.com/1\n   Content: First result content\n\n2. Second Result\n   URL: https://example.com/2\n   Content: Second result content'
        },
        isError: false
      } as any;

      mockMcpClientManager.executeTool.mockResolvedValue(mockResult);

      const result = await toolUser.executeWithTool(
        'search',
        { query: 'test query' },
        'Test search results'
      );

      expect(result).toContain('First Result');
      expect(result).toContain('Second Result');
      expect(result).toContain('test query');
    });

    it('should handle text response', async () => {
      const mockResult = {
        data: {
          text: 'Simple text content'
        },
        isError: false
      };

      mockMcpClientManager.executeTool.mockResolvedValue(mockResult);

      const result = await toolUser.executeWithTool(
        'text_tool',
        {},
        'Test text content'
      );

      expect(result).toContain('Simple text content');
    });
  });

  describe('processToolOutput', () => {
    it('should handle null or undefined results', async () => {
      mockMcpClientManager.executeTool.mockResolvedValue(null as any);

      const result = await toolUser.executeWithTool(
        'null_tool',
        {},
        'Test null result'
      );

      expect(result).toContain('No output from tool');
    });

    it('should handle results without data', async () => {
      mockMcpClientManager.executeTool.mockResolvedValue({
        isError: false
      } as any);

      const result = await toolUser.executeWithTool(
        'no_content_tool',
        {},
        'Test no content'
      );

      expect(result).toContain('No output from tool');
    });

    it('should handle text response with empty text', async () => {
      const mockResult = {
        data: {
          text: ''
        },
        isError: false
      };

      mockMcpClientManager.executeTool.mockResolvedValue(mockResult);

      const result = await toolUser.executeWithTool(
        'empty_text_tool',
        {},
        'Test empty text'
      );

      expect(result).toBe('');
    });
  });
});