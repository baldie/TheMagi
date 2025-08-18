import { ToolUser } from './tool-user';
import { MagiName, PERSONAS_CONFIG } from './magi2';
import type { MagiTool } from '../mcp';
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
  let mockMagi: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMagi = { name: MagiName.Balthazar, config: PERSONAS_CONFIG[MagiName.Balthazar] };
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
          },
          toString: () => 'Name: web_search\nDescription: Search the web for information',
          formatTypeInfo: (value: any) => value.type || 'unknown'
        } as unknown as MagiTool
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
      const casparMagi = { name: MagiName.Caspar, config: PERSONAS_CONFIG[MagiName.Caspar] };
      const casparToolUser = new ToolUser(casparMagi as any);
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
        { query: 'test query' }
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
        { query: 'test' }
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
        {}
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
        {}
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
        { query: 'test query' }
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
        {}
      );

      expect(result).toContain('Simple text content');
    });
  });

  describe('processToolOutput', () => {
    it('should handle null or undefined results', async () => {
      mockMcpClientManager.executeTool.mockResolvedValue(null as any);

      const result = await toolUser.executeWithTool(
        'null_tool',
        {}
      );

      expect(result).toContain('No output from tool');
    });

    it('should handle results without data', async () => {
      mockMcpClientManager.executeTool.mockResolvedValue({
        isError: false
      } as any);

      const result = await toolUser.executeWithTool(
        'no_content_tool',
        {}
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
        {}
      );

      expect(result).toBe('');
    });
  });

  describe('checkForDuplicatePersonalData', () => {
    beforeEach(() => {
      mockMcpClientManager.initialize.mockResolvedValue(undefined);
    });

    it('should detect duplicate data and return early', async () => {
      // Mock search result with high similarity match
      const searchResponseData = {
        data: {
          query: 'Similar content to store',
          items: [
            {
              id: 'existing-item-1',
              content: 'Very similar content',
              category: 'Health & Wellness',
              similarity_score: 0.97
            }
          ],
          total_found: 1
        },
        categories: ['Health & Wellness'],
        context: 'Similarity search for: Similar content to store',
        last_updated: new Date().toISOString()
      };

      const mockSearchResult = {
        data: {
          text: JSON.stringify(searchResponseData, null, 2)
        }
      };

      mockMcpClientManager.executeTool.mockResolvedValue(mockSearchResult);

      const result = await toolUser.executeWithTool(
        'access-data',
        {
          action: 'store',
          content: 'Similar content to store',
          category: 'Health & Wellness',
          user_context: 'Test context'
        }
      );

      // Should have called search but not the actual store
      expect(mockMcpClientManager.executeTool).toHaveBeenCalledTimes(1);
      expect(mockMcpClientManager.executeTool).toHaveBeenCalledWith(
        MagiName.Balthazar,
        'access-data',
        {
          action: 'search',
          content: 'Similar content to store',
          limit: 3
        }
      );

      // Should return duplicate prevention message
      const parsedResult = JSON.parse(result);
      expect(parsedResult.data.message).toContain('Similar data already exists');
      expect(parsedResult.existing_item.id).toBe('existing-item-1');
    });

    it('should proceed with storage when no high similarity match found', async () => {
      // Mock search result with low similarity
      const searchResponseData = {
        data: {
          query: 'Content to store',
          items: [
            {
              id: 'existing-item-1',
              content: 'Different content',
              category: 'Health & Wellness',
              similarity_score: 0.5
            }
          ],
          total_found: 1
        },
        categories: ['Health & Wellness'],
        context: 'Similarity search for: Content to store',
        last_updated: new Date().toISOString()
      };

      const storeResponseData = {
        data: { stored_item: { id: 'new-item-1' } },
        categories: ['Health & Wellness'],
        context: 'Test context'
      };

      const mockSearchResult = {
        data: {
          text: JSON.stringify(searchResponseData, null, 2)
        }
      };

      const mockStoreResult = {
        data: {
          text: JSON.stringify(storeResponseData, null, 2)
        }
      };

      mockMcpClientManager.executeTool
        .mockResolvedValueOnce(mockSearchResult) // For the search call
        .mockResolvedValueOnce(mockStoreResult); // For the store call

      const result = await toolUser.executeWithTool(
        'access-data',
        {
          action: 'store',
          content: 'Content to store',
          category: 'Health & Wellness',
          user_context: 'Test context'
        }
      );

      // Should have called both search and store
      expect(mockMcpClientManager.executeTool).toHaveBeenCalledTimes(2);
      expect(result).toContain('new-item-1');
    });

    it('should proceed with storage when different category', async () => {
      // Mock search result with high similarity but different category
      const searchResponseData = {
        data: {
          query: 'Content to store',
          items: [
            {
              id: 'existing-item-1',
              content: 'Very similar content',
              category: 'Personal Facts', // Different category
              similarity_score: 0.97
            }
          ],
          total_found: 1
        },
        categories: ['Personal Facts'],
        context: 'Similarity search for: Content to store',
        last_updated: new Date().toISOString()
      };

      const storeResponseData = {
        data: { stored_item: { id: 'new-item-1' } },
        categories: ['Health & Wellness'],
        context: 'Test context'
      };

      const mockSearchResult = {
        data: {
          text: JSON.stringify(searchResponseData, null, 2)
        }
      };

      const mockStoreResult = {
        data: {
          text: JSON.stringify(storeResponseData, null, 2)
        }
      };

      mockMcpClientManager.executeTool
        .mockResolvedValueOnce(mockSearchResult)
        .mockResolvedValueOnce(mockStoreResult);

      const result = await toolUser.executeWithTool(
        'access-data',
        {
          action: 'store',
          content: 'Content to store',
          category: 'Health & Wellness', // Different from search result
          user_context: 'Test context'
        }
      );

      // Should proceed with storage due to different category
      expect(mockMcpClientManager.executeTool).toHaveBeenCalledTimes(2);
      expect(result).toContain('new-item-1');
    });

    it('should handle search errors gracefully and proceed with storage', async () => {
      const storeResponseData = {
        data: { stored_item: { id: 'new-item-1' } },
        categories: ['Health & Wellness'],
        context: 'Test context'
      };

      const mockStoreResult = {
        data: {
          text: JSON.stringify(storeResponseData, null, 2)
        }
      };

      mockMcpClientManager.executeTool
        .mockRejectedValueOnce(new Error('Search failed')) // Search fails
        .mockResolvedValueOnce(mockStoreResult); // Store succeeds

      const result = await toolUser.executeWithTool(
        'access-data',
        {
          action: 'store',
          content: 'Content to store',
          category: 'Health & Wellness',
          user_context: 'Test context'
        }
      );

      // Should proceed with storage despite search failure
      expect(mockMcpClientManager.executeTool).toHaveBeenCalledTimes(2);
      expect(result).toContain('new-item-1');
    });

    it('should only check for duplicates on store action', async () => {
      const retrieveResponseData = {
        data: { items: [], total_found: 0 },
        categories: ['Health & Wellness'],
        context: 'Category based retrieval',
        last_updated: new Date().toISOString()
      };

      const mockRetrieveResult = {
        data: {
          text: JSON.stringify(retrieveResponseData, null, 2)
        }
      };

      mockMcpClientManager.executeTool.mockResolvedValue(mockRetrieveResult);

      await toolUser.executeWithTool(
        'access-data',
        {
          action: 'retrieve',
          categories: ['Health & Wellness']
        }
      );

      // Should only call once for retrieve, no duplicate check
      expect(mockMcpClientManager.executeTool).toHaveBeenCalledTimes(1);
      expect(mockMcpClientManager.executeTool).toHaveBeenCalledWith(
        MagiName.Balthazar,
        'access-data',
        {
          action: 'retrieve',
          categories: ['Health & Wellness']
        }
      );
    });
  });
});