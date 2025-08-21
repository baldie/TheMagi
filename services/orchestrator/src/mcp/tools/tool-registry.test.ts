import { ToolRegistry, TOOL_REGISTRY, ToolCategory } from './tool-registry';
import { MagiName } from '../../types/magi-types';

describe('ToolRegistry', () => {
  describe('getToolDefinition', () => {
    it('should return tool definition by name', () => {
      const tool = ToolRegistry.getToolDefinition('search-web');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('search-web');
      expect(tool?.category).toBe(ToolCategory.WEB_SEARCH);
    });

    it('should return undefined for unknown tool', () => {
      const tool = ToolRegistry.getToolDefinition('unknown-tool');
      expect(tool).toBeUndefined();
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

    it('should return access-data server for Melchior', () => {
      const servers = ToolRegistry.getServersForMagi(MagiName.Melchior);
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('access-data');
    });
  });

  describe('isWebSearchTool', () => {
    it('should identify web search tools', () => {
      expect(ToolRegistry.isWebSearchTool('search-web')).toBe(true);
    });

    it('should not identify non-search tools', () => {
      expect(ToolRegistry.isWebSearchTool('read-page')).toBe(false);
      expect(ToolRegistry.isWebSearchTool('smart-home-devices')).toBe(false);
    });
  });

  describe('isWebExtractTool', () => {
    it('should identify web extract tools', () => {
      expect(ToolRegistry.isWebExtractTool('read-page')).toBe(true);
    });

    it('should not identify non-extract tools', () => {
      expect(ToolRegistry.isWebExtractTool('search-web')).toBe(false);
      expect(ToolRegistry.isWebExtractTool('access-data')).toBe(false);
    });
  });


  describe('validateAndApplyDefaults', () => {
    it('should apply defaults for search tools', () => {
      const params = ToolRegistry.validateAndApplyDefaults('search-web', { query: 'test' });
      expect(params.query).toBe('test');
      expect(params.search_depth).toBe('basic');
      expect(params.include_raw_content).toBe(false);
    });

    it('should apply defaults for extract tools', () => {
      const params = ToolRegistry.validateAndApplyDefaults('read-page', { urls: 'https://example.com' });
      expect(params.urls).toBe('https://example.com');
      expect(params.extract_depth).toBe('basic');
      expect(params.raw_content_format).toBe('markdown');
    });

    it('should not override provided parameters', () => {
      const params = ToolRegistry.validateAndApplyDefaults('search-web', { 
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



  describe('TOOL_REGISTRY', () => {
    it('should contain all required tools', () => {
      expect(TOOL_REGISTRY['search-web']).toBeDefined();
      expect(TOOL_REGISTRY['read-page']).toBeDefined();
      expect(TOOL_REGISTRY['smart-home-devices']).toBeDefined();
      expect(TOOL_REGISTRY['access-data']).toBeDefined();
    });

    it('should have proper defaults defined', () => {
      expect(TOOL_REGISTRY['search-web'].defaults).toHaveProperty('search_depth', 'basic');
      expect(TOOL_REGISTRY['search-web'].defaults).toHaveProperty('include_raw_content', false);
      expect(TOOL_REGISTRY['read-page'].defaults).toHaveProperty('extract_depth', 'basic');
      expect(TOOL_REGISTRY['read-page'].defaults).toHaveProperty('raw_content_format', 'markdown');
    });

    it('should have structured parameters for all tools', () => {
      for (const [, toolDef] of Object.entries(TOOL_REGISTRY)) {
        expect(toolDef.parameters).toBeDefined();
        expect(typeof toolDef.parameters).toBe('object');
        
        // Check that each parameter has required fields
        for (const [, paramDef] of Object.entries(toolDef.parameters)) {
          expect(paramDef.type).toBeDefined();
          expect(paramDef.description).toBeDefined();
          expect(typeof paramDef.type).toBe('string');
          expect(typeof paramDef.description).toBe('string');
        }
      }
    });
  });

  describe('validateParameters', () => {
    it('should validate required parameters', () => {
      const result = ToolRegistry.validateParameters('search-web', {});
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required parameter: query');
    });

    it('should validate parameter types', () => {
      const result = ToolRegistry.validateParameters('search-web', {
        query: 'test',
        max_results: 'not a number' // Should be number
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Parameter 'max_results' expected number, got string");
    });

    it('should validate enum values', () => {
      const result = ToolRegistry.validateParameters('read-page', {
        urls: 'https://example.com',
        topic: 'invalid-topic' // Should be 'general' or 'news'
      });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Parameter 'topic' must be one of: general, news");
    });

    it('should apply defaults for missing optional parameters', () => {
      const result = ToolRegistry.validateParameters('search-web', {
        query: 'test'
      });
      expect(result.isValid).toBe(true);
      expect(result.validated.max_results).toBe(5);
      expect(result.validated.include_answer).toBe(false);
      expect(result.validated.auto_parameters).toBe(false);
    });

    it('should pass validation for valid parameters', () => {
      const result = ToolRegistry.validateParameters('respond-to-user', {
        response: 'How are you?'
      });
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle unknown tools', () => {
      const result = ToolRegistry.validateParameters('unknown-tool', {});
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Unknown tool: unknown-tool');
    });
  });
});