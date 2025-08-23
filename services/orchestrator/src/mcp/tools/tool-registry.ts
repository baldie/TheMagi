import { MagiName } from '../../types/magi-types';
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
  DEFAULT_AGENTIC_TOOL = "default_agentic_tool"
}

export const MCP_TOOL_MAPPING: Record<string, string> = {
  'search-web': 'tavily-search',
  'read-page': 'tavily-extract',
  'store-info': 'access-data',
  'store-data': 'access-data',
  'remember-data': 'access-data',
  'retrieve-data': 'access-data'
};

/**
 * Parameter definition for structured tool parameters
 */
export interface ParameterDefinition {
  /** Parameter type */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  /** Human-readable description */
  description: string;
  /** Whether this parameter is required */
  required?: boolean;
  /** Allowed values for enum types */
  enum?: string[];
  /** Default value if not provided */
  default?: any;
  /** Item type for arrays */
  items?: ParameterDefinition;
  /** Properties for object types */
  properties?: Record<string, ParameterDefinition>;
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
  /** Structured parameter definitions */
  parameters: Record<string, ParameterDefinition>;
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

export const EXCLUDED_TOOL_PARAMS = new Set(['format', 'extract_depth', 'country', 'search_depth', 'include_images', 'include_image_descriptions', 'include_raw_content', 'include_favicon', 'exclude_domains', 'include_domains', 'topic']);

/**
 * Central registry of all available tools
 * Under instructions, each line should have 
 */
export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  'search-web': {
    name: 'search-web',
    description: 'When your goal is SEARCH, use this tool with a relevant search query to search the web.',
    category: ToolCategory.WEB_SEARCH,
    defaults: {
      search_depth: 'basic',
      include_raw_content: false
    },
    responseType: 'WebSearchResponse',
    parameters: {
      query: {
        type: 'string',
        description: 'The search query string',
        required: true
      },
      auto_parameters: {
        type: 'boolean',
        description: 'Auto-generate search parameters',
        default: false
      },
      max_results: {
        type: 'number',
        description: 'Maximum results to return (0-10)',
        default: 5
      },
      include_answer: {
        type: 'boolean',
        description: 'Include an AI-generated answer. Set to true for straightforward inquiries.',
        default: false
      }
    },
  },

  'read-page': {
    name: 'read-page',
    description: 'Gets the content from web pages. Use this tool if you have URLs from <SEARCH_RESULTS>.',
    category: ToolCategory.WEB_EXTRACT,
    defaults: {
      extract_depth: 'basic',
      raw_content_format: 'markdown'
    },
    responseType: 'WebExtractResponse',
    parameters: {
      urls: {
        type: 'string',
        description: 'URL or array of URLs to extract content from (3 URLS MAXIMUM)',
        required: true
      },
      topic: {
        type: 'string',
        description: 'Content topic type',
        enum: ['general', 'news'],
        default: 'general'
      },
      include_images: {
        type: 'boolean',
        description: 'Include extracted images',
        default: false
      },
      timeout: {
        type: 'number',
        description: 'Request timeout in seconds',
        default: 60
      }
    },
  },

  'smart-home-devices': {
    name: 'smart-home-devices', 
    description: 'Query and control smart home devices',
    category: ToolCategory.SMART_HOME,
    defaults: {},
    responseType: 'SmartHomeResponse',
    parameters: {
      device_types: {
        type: 'array',
        description: 'Array of device types to query'
      },
      query_purpose: {
        type: 'string',
        description: 'Purpose of the query for context'
      }
    },
  },

  'access-data': {
    name: 'access-data',
    description: 'Store and retrieve user personal data and preferences using vector search.',
    category: ToolCategory.PERSONAL_DATA,
    defaults: { action: 'retrieve' },
    responseType: 'PersonalDataResponse',
    parameters: {
      action: {
        type: 'string',
        description: 'Operation to perform',
        enum: ['store', 'retrieve', 'search'],
        required: true
      },
      content: {
        type: 'string',
        description: 'Content to store or search for (required for store/search actions)'
      },
      category: {
        type: 'string',
        description: 'Category of the data (required when storing)'
      },
      categories: {
        type: 'array',
        description: 'Array of data categories to retrieve (required for retrieval)'
      },
      user_context: {
        type: 'string',
        description: 'Context for the data request'
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return',
        default: 10
      }
    },
  },

  // Default agentic tools
  'communicate': {
    name: 'communicate',
    description: 'This tool allows you to communicate with the user or other Magi participants',
    category: ToolCategory.DEFAULT_AGENTIC_TOOL,
    defaults: { recipient: 'User' },
    responseType: 'TextResponse',
    parameters: {
      message: {
        type: 'string',
        description: 'The message to send. This can be a question, answer, or any other communication. Use conversational tone.',
        required: true
      },
      recipient: {
        type: 'string',
        description: 'Caspar has access to the user\'s smart home devices, Melchior has access to personal data, Balthazar can access the internet on your behalf.',
        enum: ['User', 'System', 'Magi', 'Caspar', 'Melchior', 'Balthazar'],
        default: 'User'
      }
    },
  },
  'process-info': {
    name: 'process-info',
    description: 'This tool allows you to summarize, analyze, or parse information',
    category: ToolCategory.DEFAULT_AGENTIC_TOOL,
    defaults: {},
    responseType: 'TextResponse',
    parameters: {
      raw_info: {
        type: 'string',
        description: 'The information to summarize, analyze, or parse',
        required: true
      },
      processing_instructions: {
        type: 'string',
        description: 'Instructions for how to process the information',
        required: false
      },
    }
  },
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
        TAVILY_API_KEY: process.env.TAVILY_API_KEY ?? ''
      },
      provides: ['tavily-search', 'tavily-extract']
    },
    'access-data': {
      name: 'access-data',
      command: 'ts-node',
      args: [path.join(__dirname, '..', 'servers', 'personal-data-server.ts')],
      env: {},
      provides: ['access-data']
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
   * Map friendly tool names back to MCP tool names for server lookup
   */
  private static mapToMcpToolName(friendlyName: string): string {
    return MCP_TOOL_MAPPING[friendlyName] || friendlyName;
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
      // Map friendly name to MCP name for server lookup
      const mcpToolName = this.mapToMcpToolName(toolName);
      for (const [serverName, serverConfig] of Object.entries(toolServers)) {
        if (serverConfig.provides.includes(mcpToolName)) {
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
   * Validate tool parameters with defaults and type checking
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

  /**
   * Validate parameters against structured parameter definitions
   */
  static validateParameters(name: string, parameters: Record<string, any>): { 
    isValid: boolean; 
    errors: string[]; 
    validated: Record<string, any> 
  } {
    const definition = this.getToolDefinition(name);
    if (!definition) {
      return { isValid: false, errors: [`Unknown tool: ${name}`], validated: parameters };
    }

    const errors: string[] = [];
    const validated = { ...parameters };

    // First pass: Apply defaults for missing parameters
    for (const [paramName, paramDef] of Object.entries(definition.parameters)) {
      if (validated[paramName] === undefined && paramDef.default !== undefined) {
        validated[paramName] = paramDef.default;
      }
    }
    
    // Second pass: Check required parameters and validate types
    for (const [paramName, paramDef] of Object.entries(definition.parameters)) {
      if (paramDef.required && (validated[paramName] === undefined || validated[paramName] === null)) {
        errors.push(`Missing required parameter: ${paramName}`);
      }

      // Type validation
      if (validated[paramName] === undefined)
        continue;
      
      const value = validated[paramName];
      const expectedType = paramDef.type;

      if (!this.isValidType(value, expectedType)) {
        errors.push(`Parameter '${paramName}' expected ${expectedType}, got ${typeof value}`);
      }

      // Enum validation
      if (paramDef.enum && !paramDef.enum.includes(value)) {
        errors.push(`Parameter '${paramName}' must be one of: ${paramDef.enum.join(', ')}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      validated
    };
  }

  /**
   * Check if a value matches the expected type
   */
  private static isValidType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        return true; // Unknown types pass validation
    }
  }
}