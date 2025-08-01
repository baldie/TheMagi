import { MagiName } from '../../types/magi-types';
import { WebSearchResponse, WebExtractResponse, SmartHomeResponse, PersonalDataResponse } from '../tool-response-types';
import { getBalthazarToolAssignments } from './balthazar-tools';
import { getCasparToolAssignments } from './caspar-tools';
import { getMelchiorToolAssignments } from './melchior-tools';
import path from 'path';

/**
 * Tool categories for organizational purposes
 */
export enum ToolCategory {
  WEB_SEARCH = 'web_search',
  WEB_EXTRACT = 'web_extract', 
  SMART_HOME = 'smart_home',
  PERSONAL_DATA = 'personal_data',
  ANALYSIS = 'analysis',
  DEFAULT_AGENTIC_TOOL = "default_agentic_tool"
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

export const EXCLUDED_TOOL_PARAMS = new Set(['format', 'extract_depth', 'country', 'search_depth', 'include_images', 'include_raw_content', 'include_favicon']);

/**
 * Central registry of all available tools
 */
export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  'tavily-search': {
    name: 'tavily-search',
    description: 'Search the web for current information',
    category: ToolCategory.WEB_SEARCH,
    defaults: {
      search_depth: 'basic',
      include_raw_content: false
    },
    responseType: 'WebSearchResponse',
    instructions: ` query (required): The search query string
  auto_parameters: false
  topic: Search category "general" or "news" (string, default: "general")
  max_results: Maximum results to return 0-10 (number, default: 5)
  include_answer: Include LLM-generated answer (boolean, default: false)`
  },

  'tavily-extract': {
    name: 'tavily-extract',
    description: 'Gets the content from web pages. Use this tool if you have URLs from a previous search.',
    category: ToolCategory.WEB_EXTRACT,
    defaults: {
      extract_depth: 'basic',
      raw_content_format: 'markdown'
    },
    responseType: 'WebExtractResponse',
    instructions: ` urls (required): URL or array of URLs to extract content from (3 URLS MAXIMUM)
  topic: 'general' or 'news' (string, default: 'general')
  include_images: Include extracted images (boolean, default: false)
  timeout: Request timeout in seconds (number, default: 60)`
  },

  'smart-home-devices': {
    name: 'smart-home-devices', 
    description: 'Query and control smart home devices',
    category: ToolCategory.SMART_HOME,
    defaults: {},
    responseType: 'SmartHomeResponse',
    instructions: ` device_types: Array of device types to query
  query_purpose: Purpose of the query for context`
  },

  'personal-data': {
    name: 'personal-data',
    description: 'Store and retrieve user personal data and preferences using vector search',
    category: ToolCategory.PERSONAL_DATA,
    defaults: { action: 'retrieve' },
    responseType: 'PersonalDataResponse',
    instructions: ` action: Operation to perform - "store", "retrieve", or "search" (**THESE ARE THE ONLY 3 VALID ACTIONS**)
  content: Content to store or search for (required for store/search actions)
  category: Category of the data (**REQUIRED WHEN STORING**)
  categories: Array of data categories to retrieve (**REQUIRED FOR RETRIEVAL**)
  user_context: Context for the data request
  limit: Maximum results to return (number, default: 10)`
  },

  // Default agentic tools
  'ask-user': {
    name: 'ask-user',
    description: 'Ask the user a clarifying question if more information is needed.',
    category: ToolCategory.DEFAULT_AGENTIC_TOOL,
    defaults: {},
    responseType: 'TextResponse',
    instructions: ` question (required): The question to ask the user.`
  },
  'answer-user': {
    name: 'answer-user',
    description: 'Answer the user with the results you have synthesized, or directly if it is a simple inquiry.',
    category: ToolCategory.DEFAULT_AGENTIC_TOOL,
    defaults: {},
    responseType: 'TextResponse',
    instructions: ` answer (required): The final answer to provide to the user. This should be in conversational tone.`
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
    },
    'personal-data': {
      name: 'personal-data',
      command: 'ts-node',
      args: [path.join(__dirname, '..', 'servers', 'personal-data-server.ts')],
      env: {},
      provides: ['personal-data']
    }
  };
}

/**
 * Registry utilities
 */
export class ToolRegistry {
  /**
   * Get tool definition by name
   */
  static getToolDefinition(name: string): ToolDefinition | undefined {
    // Check direct name match first
    if (TOOL_REGISTRY[name]) {
      return TOOL_REGISTRY[name];
    }
    
    return undefined;
  }

  /**
   * Get server configs needed for a Magi
   */
  static getServersForMagi(magi: MagiName): ToolServerConfig[] {
    const toolNames = [];
    switch(magi) {
       case MagiName.Balthazar:
          toolNames.push(...getBalthazarToolAssignments());
          break;
      case MagiName.Caspar:
          toolNames.push(...getCasparToolAssignments());
          break;
       case MagiName.Melchior:
        toolNames.push(...getMelchiorToolAssignments());
        break;
        default:
          break;
    }
    const serverNames = new Set<string>();
    const toolServers = getToolServers();
    
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
  static isWebSearchTool(name: string): boolean {
    const definition = this.getToolDefinition(name);
    return definition?.category === ToolCategory.WEB_SEARCH;
  }

  /**
   * Check if a tool is a web extract tool  
   */
  static isWebExtractTool(name: string): boolean {
    const definition = this.getToolDefinition(name);
    return definition?.category === ToolCategory.WEB_EXTRACT;
  }

  /**
   * Validate tool parameters with defaults
   */
  static validateAndApplyDefaults(name: string, parameters: Record<string, any>): Record<string, any> {
    const definition = this.getToolDefinition(name);
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