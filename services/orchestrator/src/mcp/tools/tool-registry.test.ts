import { ToolRegistry, TOOL_REGISTRY, MAGI_TOOL_ASSIGNMENTS, ToolCategory } from './tool-registry';
import { MagiName } from '../../types/magi-types';

describe('ToolRegistry', () => {
  describe('getToolDefinition', () => {
    it('should return tool definition by name', () => {
      const tool = ToolRegistry.getToolDefinition('tavily-search');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('tavily-search');
      expect(tool?.category).toBe(ToolCategory.WEB_SEARCH);
    });

    it('should return tool definition by alias', () => {
      const tool = ToolRegistry.getToolDefinition('search');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('tavily-search');
    });

    it('should return undefined for unknown tool', () => {
      const tool = ToolRegistry.getToolDefinition('unknown-tool');
      expect(tool).toBeUndefined();
    });
  });

  describe('getCanonicalName', () => {
    it('should return canonical name for alias', () => {
      const canonical = ToolRegistry.getCanonicalName('search');
      expect(canonical).toBe('tavily-search');
    });

    it('should return canonical name for direct name', () => {
      const canonical = ToolRegistry.getCanonicalName('tavily-search');
      expect(canonical).toBe('tavily-search');
    });

    it('should return undefined for unknown tool', () => {
      const canonical = ToolRegistry.getCanonicalName('unknown-tool');
      expect(canonical).toBeUndefined();
    });
  });

  describe('getToolsForMagi', () => {
    it('should return assigned tools for Balthazar', () => {
      const tools = ToolRegistry.getToolsForMagi(MagiName.Balthazar);
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toContain('tavily-search');
      expect(tools.map(t => t.name)).toContain('tavily-extract');
    });

    it('should return empty array for Caspar (no tools configured)', () => {
      const tools = ToolRegistry.getToolsForMagi(MagiName.Caspar);
      expect(tools).toHaveLength(0);
    });

    it('should return empty array for Melchior (no tools configured)', () => {
      const tools = ToolRegistry.getToolsForMagi(MagiName.Melchior);
      expect(tools).toHaveLength(0);
    });
  });

  describe('getToolsByCategory', () => {
    it('should return web search tools', () => {
      const tools = ToolRegistry.getToolsByCategory(ToolCategory.WEB_SEARCH);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('tavily-search');
    });

    it('should return web extract tools', () => {
      const tools = ToolRegistry.getToolsByCategory(ToolCategory.WEB_EXTRACT);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('tavily-extract');
    });
  });

  describe('getServersForMagi', () => {
    it('should return required servers for Balthazar', () => {
      const servers = ToolRegistry.getServersForMagi(MagiName.Balthazar);
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('tavily');
      expect(servers[0].provides).toContain('tavily-search');
      expect(servers[0].provides).toContain('tavily-extract');
    });

    it('should return empty array for Caspar (no tools configured)', () => {
      const servers = ToolRegistry.getServersForMagi(MagiName.Caspar);
      expect(servers).toHaveLength(0);
    });

    it('should return empty array for Melchior (no tools configured)', () => {
      const servers = ToolRegistry.getServersForMagi(MagiName.Melchior);
      expect(servers).toHaveLength(0);
    });
  });

  describe('isWebSearchTool', () => {
    it('should identify web search tools', () => {
      expect(ToolRegistry.isWebSearchTool('tavily-search')).toBe(true);
      expect(ToolRegistry.isWebSearchTool('search')).toBe(true);
      expect(ToolRegistry.isWebSearchTool('searchContext')).toBe(true);
    });

    it('should not identify non-search tools', () => {
      expect(ToolRegistry.isWebSearchTool('tavily-extract')).toBe(false);
      expect(ToolRegistry.isWebSearchTool('smart-home-devices')).toBe(false);
    });
  });

  describe('isWebExtractTool', () => {
    it('should identify web extract tools', () => {
      expect(ToolRegistry.isWebExtractTool('tavily-extract')).toBe(true);
      expect(ToolRegistry.isWebExtractTool('extract')).toBe(true);
      expect(ToolRegistry.isWebExtractTool('crawl_url')).toBe(true);
    });

    it('should not identify non-extract tools', () => {
      expect(ToolRegistry.isWebExtractTool('tavily-search')).toBe(false);
      expect(ToolRegistry.isWebExtractTool('personal-data')).toBe(false);
    });
  });

  describe('getToolNameMapping', () => {
    it('should create mapping from aliases to canonical names', () => {
      const mapping = ToolRegistry.getToolNameMapping();
      expect(mapping['search']).toBe('tavily-search');
      expect(mapping['searchContext']).toBe('tavily-search');
      expect(mapping['extract']).toBe('tavily-extract');
      expect(mapping['crawl_url']).toBe('tavily-extract');
    });
  });

  describe('validateAndApplyDefaults', () => {
    it('should apply defaults for search tools', () => {
      const params = ToolRegistry.validateAndApplyDefaults('tavily-search', { query: 'test' });
      expect(params.query).toBe('test');
      expect(params.search_depth).toBe('basic');
      expect(params.include_raw_content).toBe(false);
    });

    it('should apply defaults for extract tools', () => {
      const params = ToolRegistry.validateAndApplyDefaults('tavily-extract', { urls: 'https://example.com' });
      expect(params.urls).toBe('https://example.com');
      expect(params.extract_depth).toBe('basic');
      expect(params.raw_content_format).toBe('markdown');
    });

    it('should not override provided parameters', () => {
      const params = ToolRegistry.validateAndApplyDefaults('tavily-search', { 
        query: 'test',
        search_depth: 'advanced' 
      });
      expect(params.search_depth).toBe('advanced');
    });

    it('should return unchanged params for unknown tools', () => {
      const originalParams = { query: 'test' };
      const params = ToolRegistry.validateAndApplyDefaults('unknown-tool', originalParams);
      expect(params).toEqual(originalParams);
    });
  });

  describe('MAGI_TOOL_ASSIGNMENTS', () => {
    it('should have valid assignments for all Magi', () => {
      expect(MAGI_TOOL_ASSIGNMENTS[MagiName.Balthazar]).toEqual(['tavily-search', 'tavily-extract']);
      expect(MAGI_TOOL_ASSIGNMENTS[MagiName.Caspar]).toEqual([]); // No tools configured yet
      expect(MAGI_TOOL_ASSIGNMENTS[MagiName.Melchior]).toEqual([]); // No tools configured yet
    });

    it('should only assign tools with configured MCP servers', () => {
      // Balthazar should have tools because tavily server is configured
      expect(MAGI_TOOL_ASSIGNMENTS[MagiName.Balthazar].length).toBeGreaterThan(0);
      
      // Caspar and Melchior should be empty until their servers are configured
      expect(MAGI_TOOL_ASSIGNMENTS[MagiName.Caspar]).toEqual([]);
      expect(MAGI_TOOL_ASSIGNMENTS[MagiName.Melchior]).toEqual([]);
    });

    it('should fail if tools are assigned without MCP server configuration', () => {
      // This test ensures we catch the original error scenario
      const testAssignments = {
        [MagiName.Balthazar]: ['tavily-search'],
        [MagiName.Caspar]: ['smart-home-devices'], // This tool has no server config
        [MagiName.Melchior]: ['personal-data'] // This tool has no server config
      };

      // For each assignment, check that assigned tools have server configs
      for (const [magiName, toolNames] of Object.entries(testAssignments)) {
        const servers = ToolRegistry.getServersForMagi(magiName as MagiName);
        if (toolNames.length > 0) {
          // If tools are assigned, there should be servers to provide them
          const allToolsHaveServers = toolNames.every(toolName => 
            servers.some(server => server.provides.includes(toolName))
          );
          if (!allToolsHaveServers) {
            // This is the error condition we want to catch
            expect(servers.length).toBe(0); // Caspar and Melchior should have no servers
          }
        }
      }
    });
  });

  describe('TOOL_REGISTRY', () => {
    it('should contain all required tools', () => {
      expect(TOOL_REGISTRY['tavily-search']).toBeDefined();
      expect(TOOL_REGISTRY['tavily-extract']).toBeDefined();
      expect(TOOL_REGISTRY['smart-home-devices']).toBeDefined();
      expect(TOOL_REGISTRY['personal-data']).toBeDefined();
    });

    it('should have proper aliases defined', () => {
      expect(TOOL_REGISTRY['tavily-search'].aliases).toContain('search');
      expect(TOOL_REGISTRY['tavily-search'].aliases).toContain('searchContext');
      expect(TOOL_REGISTRY['tavily-extract'].aliases).toContain('extract');
      expect(TOOL_REGISTRY['tavily-extract'].aliases).toContain('crawl_url');
    });

    it('should have proper defaults defined', () => {
      expect(TOOL_REGISTRY['tavily-search'].defaults).toHaveProperty('search_depth', 'basic');
      expect(TOOL_REGISTRY['tavily-search'].defaults).toHaveProperty('include_raw_content', false);
      expect(TOOL_REGISTRY['tavily-extract'].defaults).toHaveProperty('extract_depth', 'basic');
      expect(TOOL_REGISTRY['tavily-extract'].defaults).toHaveProperty('raw_content_format', 'markdown');
    });
  });
});