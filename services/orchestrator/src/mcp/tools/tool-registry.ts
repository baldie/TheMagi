import { MagiName } from '../../types/magi-types';
import { WebSearchResponse, WebExtractResponse, SmartHomeResponse, PersonalDataResponse } from '../tool-response-types';

/**
 * Tool categories for organizational purposes
 */
export enum ToolCategory {
  WEB_SEARCH = 'web_search',
  WEB_EXTRACT = 'web_extract', 
  SMART_HOME = 'smart_home',
  PERSONAL_DATA = 'personal_data',
  ANALYSIS = 'analysis'
}

/**
 * Tool definition with metadata and configuration
 */
export interface ToolDefinition {
  /** Canonical tool name (what the MCP server exposes) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Tool category for organization */
  category: ToolCategory;
  /** Legacy aliases that should map to this tool */
  aliases: string[];
  /** Default parameters to apply if not specified */
  defaults: Record<string, any>;
  /** Expected response type */
  responseType: 'WebSearchResponse' | 'WebExtractResponse' | 'SmartHomeResponse' | 'PersonalDataResponse' | 'TextResponse';
  /** Instructions for the LLM on how to use this tool */
  instructions?: string;
}

/**
 * MCP Server configuration for a tool provider
 */
export interface ToolServerConfig {
  /** Server identifier */
  name: string;
  /** Command to run the server */
  command: string;
  /** Command arguments */
  args: string[];
  /** Environment variables */
  env: Record<string, string>;
  /** Tools this server provides */
  provides: string[];
}

/**
 * Central registry of all available tools
 */
export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  'tavily-search': {
    name: 'tavily-search',
    description: 'Search the web using Tavily API for current information',
    category: ToolCategory.WEB_SEARCH,
    aliases: ['search', 'searchContext'],
    defaults: {
      search_depth: 'basic',
      include_raw_content: false
    },
    responseType: 'WebSearchResponse',
    instructions: `query (required): The search query string
auto_parameters: Auto-configure search parameters (boolean, default: false)
topic: Search category "general" or "news" (string, default: "general")
max_results: Maximum results to return 0-20 (number, default: 5)
include_answer: Include LLM-generated answer (boolean, default: false)`
  },

  'tavily-extract': {
    name: 'tavily-extract',
    description: 'Extract content from web pages using Tavily API',
    category: ToolCategory.WEB_EXTRACT,
    aliases: ['extract', 'crawl_url'],
    defaults: {
      extract_depth: 'basic',
      raw_content_format: 'markdown'
    },
    responseType: 'WebExtractResponse',
    instructions: `urls (required): URL or array of URLs to extract content from
include_images: Include extracted images (boolean, default: false)
timeout: Request timeout in seconds (number, default: 60)`
  },

  'smart-home-devices': {
    name: 'smart-home-devices', 
    description: 'Query and control smart home devices',
    category: ToolCategory.SMART_HOME,
    aliases: [],
    defaults: {},
    responseType: 'SmartHomeResponse',
    instructions: `device_types: Array of device types to query
query_purpose: Purpose of the query for context`
  },

  'personal-data': {
    name: 'personal-data',
    description: 'Access user personal data and preferences',
    category: ToolCategory.PERSONAL_DATA,
    aliases: [],
    defaults: {},
    responseType: 'PersonalDataResponse',
    instructions: `categories: Array of data categories to retrieve
user_context: Context for the data request`
  }
};

/**
 * Server configurations for tool providers
 * Note: Environment variables are resolved at runtime to ensure proper loading
 */
export function getToolServers(): Record<string, ToolServerConfig> {
  return {
    'tavily': {
      name: 'tavily',
      command: 'npx',
      args: ['-y', 'tavily-mcp@latest'],
      env: {
        TAVILY_API_KEY: process.env.TAVILY_API_KEY || ''
      },
      provides: ['tavily-search', 'tavily-extract']
    }
  };
}

/**
 * Magi tool assignments - which tools each Magi has access to
 * Note: Only tools with configured MCP servers should be assigned
 */
export const MAGI_TOOL_ASSIGNMENTS: Record<MagiName, string[]> = {
  [MagiName.Balthazar]: ['tavily-search', 'tavily-extract'],
  [MagiName.Caspar]: [], // smart-home-devices not yet configured with MCP server
  [MagiName.Melchior]: [] // personal-data not yet configured with MCP server
};

/**
 * Registry utilities
 */
export class ToolRegistry {
  /**
   * Get tool definition by name or alias
   */
  static getToolDefinition(nameOrAlias: string): ToolDefinition | undefined {
    // Check direct name match first
    if (TOOL_REGISTRY[nameOrAlias]) {
      return TOOL_REGISTRY[nameOrAlias];
    }
    
    // Check aliases
    for (const [toolName, definition] of Object.entries(TOOL_REGISTRY)) {
      if (definition.aliases.includes(nameOrAlias)) {
        return definition;
      }
    }
    
    return undefined;
  }

  /**
   * Get canonical tool name for any alias
   */
  static getCanonicalName(nameOrAlias: string): string | undefined {
    const definition = this.getToolDefinition(nameOrAlias);
    return definition?.name;
  }

  /**
   * Get all tools assigned to a Magi
   */
  static getToolsForMagi(magi: MagiName): ToolDefinition[] {
    const toolNames = MAGI_TOOL_ASSIGNMENTS[magi] || [];
    return toolNames.map(name => TOOL_REGISTRY[name]).filter(Boolean);
  }

  /**
   * Get tools by category
   */
  static getToolsByCategory(category: ToolCategory): ToolDefinition[] {
    return Object.values(TOOL_REGISTRY).filter(tool => tool.category === category);
  }

  /**
   * Get server configs needed for a Magi
   */
  static getServersForMagi(magi: MagiName): ToolServerConfig[] {
    const toolNames = MAGI_TOOL_ASSIGNMENTS[magi] || [];
    const serverNames = new Set<string>();
    const toolServers = getToolServers(); // Get dynamic server configs
    
    // Find which servers provide the tools this Magi needs
    for (const toolName of toolNames) {
      for (const [serverName, serverConfig] of Object.entries(toolServers)) {
        if (serverConfig.provides.includes(toolName)) {
          serverNames.add(serverName);
        }
      }
    }
    
    return Array.from(serverNames).map(name => toolServers[name]).filter(Boolean);
  }

  /**
   * Check if a tool is a web search tool
   */
  static isWebSearchTool(nameOrAlias: string): boolean {
    const definition = this.getToolDefinition(nameOrAlias);
    return definition?.category === ToolCategory.WEB_SEARCH;
  }

  /**
   * Check if a tool is a web extract tool  
   */
  static isWebExtractTool(nameOrAlias: string): boolean {
    const definition = this.getToolDefinition(nameOrAlias);
    return definition?.category === ToolCategory.WEB_EXTRACT;
  }

  /**
   * Get tool name mapping (legacy name -> canonical name)
   */
  static getToolNameMapping(): Record<string, string> {
    const mapping: Record<string, string> = {};
    
    for (const [toolName, definition] of Object.entries(TOOL_REGISTRY)) {
      for (const alias of definition.aliases) {
        mapping[alias] = toolName;
      }
    }
    
    return mapping;
  }

  /**
   * Validate tool parameters with defaults
   */
  static validateAndApplyDefaults(nameOrAlias: string, parameters: Record<string, any>): Record<string, any> {
    const definition = this.getToolDefinition(nameOrAlias);
    if (!definition) {
      return parameters;
    }

    const validated = { ...parameters };
    
    // Apply defaults for missing parameters
    for (const [key, defaultValue] of Object.entries(definition.defaults)) {
      if (validated[key] === undefined) {
        validated[key] = defaultValue;
      }
    }

    return validated;
  }
}