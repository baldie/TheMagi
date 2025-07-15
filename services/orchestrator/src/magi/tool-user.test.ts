import { ToolUser } from './tool-user';
import { MagiName } from './magi';
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
    getAvailableTools: jest.fn(),
    executeTool: jest.fn()
  }
}));

const mockMcpClientManager = mcpClientManager as jest.Mocked<typeof mcpClientManager>;

describe('ToolUser', () => {
  let toolUser: ToolUser;

  beforeEach(() => {
    jest.clearAllMocks();
    toolUser = new ToolUser(MagiName.Balthazar);
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

      mockMcpClientManager.getAvailableTools.mockResolvedValue(mockTools);

      const tools = await toolUser.getAvailableTools();

      expect(mockMcpClientManager.getAvailableTools).toHaveBeenCalledWith(MagiName.Balthazar);
      expect(tools).toEqual(mockTools);
    });

    it('should handle errors gracefully', async () => {
      mockMcpClientManager.getAvailableTools.mockRejectedValue(new Error('Failed to get tools'));

      const tools = await toolUser.getAvailableTools();

      expect(tools).toEqual([]);
    });

    it('should work for different Magi', async () => {
      const casparToolUser = new ToolUser(MagiName.Caspar);
      mockMcpClientManager.getAvailableTools.mockResolvedValue([]);

      await casparToolUser.getAvailableTools();

      expect(mockMcpClientManager.getAvailableTools).toHaveBeenCalledWith(MagiName.Caspar);
    });
  });

  describe('executeWithTool', () => {
    beforeEach(() => {
      mockMcpClientManager.initialize.mockResolvedValue(undefined);
    });

    it('should execute tool successfully', async () => {
      const mockResult = {
        content: [
          {
            type: 'text' as const,
            text: 'Search results for test query'
          }
        ],
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
      expect(result).toContain('Tool used: web_search');
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
        content: [],
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
        content: [
          {
            type: 'text' as const,
            text: 'Tool error occurred'
          }
        ],
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

    it('should process multiple content items', async () => {
      const mockResult = {
        content: [
          {
            type: 'text' as const,
            text: 'First result'
          },
          {
            type: 'text' as const,
            text: 'Second result'
          }
        ],
        isError: false
      };

      mockMcpClientManager.executeTool.mockResolvedValue(mockResult);

      const result = await toolUser.executeWithTool(
        'multi_result_tool',
        {},
        'Test multiple results'
      );

      expect(result).toContain('First result');
      expect(result).toContain('Second result');
    });

    it('should filter out non-text content', async () => {
      const mockResult = {
        content: [
          {
            type: 'text' as const,
            text: 'Text content'
          },
          {
            type: 'image' as const,
            data: 'base64data'
          },
          {
            type: 'resource' as const,
            uri: 'file://test.txt'
          }
        ],
        isError: false
      };

      mockMcpClientManager.executeTool.mockResolvedValue(mockResult);

      const result = await toolUser.executeWithTool(
        'mixed_content_tool',
        {},
        'Test mixed content'
      );

      expect(result).toContain('Text content');
      expect(result).not.toContain('base64data');
      expect(result).not.toContain('file://test.txt');
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

    it('should handle results without content', async () => {
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

    it('should handle text content with undefined text', async () => {
      const mockResult = {
        content: [
          {
            type: 'text' as const,
            text: undefined
          }
        ],
        isError: false
      };

      mockMcpClientManager.executeTool.mockResolvedValue(mockResult);

      const result = await toolUser.executeWithTool(
        'undefined_text_tool',
        {},
        'Test undefined text'
      );

      expect(result).toContain('Tool executed successfully but returned no text content');
    });
  });
});