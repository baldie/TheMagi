import { ToolRegistry, TOOL_REGISTRY, ToolCategory } from './tool-registry';
import { MagiName } from '../../types/magi-types';

describe('ToolRegistry', () => {
  describe('getToolDefinition', () => {
    it('should return tool definition by name', () => {
      const tool = ToolRegistry.getToolDefinition('tavily-search');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('tavily-search');
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

    it('should return empty array for Melchior (no tools configured)', () => {
      const servers = ToolRegistry.getServersForMagi(MagiName.Melchior);
      expect(servers).toHaveLength(0);
    });
  });

  describe('isWebSearchTool', () => {
    it('should identify web search tools', () => {
      expect(ToolRegistry.isWebSearchTool('tavily-search')).toBe(true);
    });

    it('should not identify non-search tools', () => {
      expect(ToolRegistry.isWebSearchTool('tavily-extract')).toBe(false);
      expect(ToolRegistry.isWebSearchTool('smart-home-devices')).toBe(false);
    });
  });

  describe('isWebExtractTool', () => {
    it('should identify web extract tools', () => {
      expect(ToolRegistry.isWebExtractTool('tavily-extract')).toBe(true);
    });

    it('should not identify non-extract tools', () => {
      expect(ToolRegistry.isWebExtractTool('tavily-search')).toBe(false);
      expect(ToolRegistry.isWebExtractTool('personal-data')).toBe(false);
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



  describe('TOOL_REGISTRY', () => {
    it('should contain all required tools', () => {
      expect(TOOL_REGISTRY['tavily-search']).toBeDefined();
      expect(TOOL_REGISTRY['tavily-extract']).toBeDefined();
      expect(TOOL_REGISTRY['smart-home-devices']).toBeDefined();
      expect(TOOL_REGISTRY['personal-data']).toBeDefined();
    });


    it('should have proper defaults defined', () => {
      expect(TOOL_REGISTRY['tavily-search'].defaults).toHaveProperty('search_depth', 'basic');
      expect(TOOL_REGISTRY['tavily-search'].defaults).toHaveProperty('include_raw_content', false);
      expect(TOOL_REGISTRY['tavily-extract'].defaults).toHaveProperty('extract_depth', 'basic');
      expect(TOOL_REGISTRY['tavily-extract'].defaults).toHaveProperty('raw_content_format', 'markdown');
    });
  });
});