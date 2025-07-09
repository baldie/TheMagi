import { MagiName } from '../magi/magi';
import { logger } from '../logger';

export interface McpToolContentItem {
  type: 'text' | 'resource';
  text?: string;
  resource?: {
    uri: string;
    name: string;
    description?: string;
  };
}

export interface McpToolResult {
  content: McpToolContentItem[];
}

/**
 * MCP Server response for tool listing
 */
export interface McpToolListResponse {
  tools?: McpToolInfo[];
}

/**
 * Information about a single MCP tool
 */
export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

/**
 * MCP Server response for tool execution
 */
export interface McpToolExecutionResponse {
  content: McpToolContentItem[];
  isError?: boolean;
  _meta?: Record<string, any>;
}

/**
 * Tool execution context passed to tools
 */
export interface ToolExecutionContext {
  magiName: string;
  stepNumber: number;
  previousStepOutput?: string;
  originalInquiry: string;
}

/**
 * Result of tool execution with metadata
 */
export interface ToolExecutionResult {
  success: boolean;
  output: string;
  metadata?: {
    toolName: string;
    executionTime: number;
    error?: string;
  };
}

/**
 * MCP Tool Registry - Simplified mock implementation for testing
 */
export class McpToolRegistry {
  private initialized = false;

  /**
   * Initialize MCP tool registry - mock implementation
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing MCP tool registry (mock)...');
    this.initialized = true;
    logger.info('MCP tool registry initialization complete (mock)');
  }

  /**
   * Execute a tool for a specific Magi - mock implementation
   */
  async executeTool(
    _magiName: MagiName,
    _toolName: string,
    _arguments: Record<string, any>
  ): Promise<McpToolExecutionResponse> {
    if (!this.initialized) {
      throw new Error('MCP tool registry not initialized');
    }

    logger.debug(`Executing tool ${_toolName} for ${_magiName} (mock)`, { arguments: _arguments });

    // Mock tool execution
    return {
      content: [
        {
          type: 'text',
          text: `Mock result from ${_toolName} tool for ${_magiName} with arguments: ${JSON.stringify(_arguments)}`
        }
      ],
      isError: false
    };
  }

  /**
   * Get tool schema for a specific tool - mock implementation
   */
  async getToolSchema(): Promise<Record<string, any> | null> {
    return {
      type: 'object',
      properties: {
        query: { type: 'string' }
      },
      required: ['query']
    };
  }
}

// Export singleton instance
export const mcpToolRegistry = new McpToolRegistry();