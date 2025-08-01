import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MagiName } from '../magi/magi';
import { logger } from '../logger';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { GetToolResponse, WebSearchResponse, WebExtractResponse } from './tool-response-types';
import { getBalthazarToolAssignments, getBalthazarToolServers } from './tools/balthazar-tools';
import { getCasparToolAssignments,getCasparTools } from './tools/caspar-tools';
import { getMelchiorToolAssignments, getMelchiorTools } from './tools/melchior-tools';
import { TOOL_REGISTRY, ToolRegistry } from './tools/tool-registry';

/**
 * Information about a single MCP tool
 */
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
  instructions?: string;
}

/**
 * Configuration for MCP servers for each Magi
 */
export interface McpServerConfig {
  name: string; // Unique identifier for this server
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

function getToolAssigmentsForAllMagi(): Record<MagiName, string[]> {
  return {
    [MagiName.Balthazar]: getBalthazarToolAssignments(),
    [MagiName.Caspar]: getCasparToolAssignments(),
    [MagiName.Melchior]: getMelchiorToolAssignments()
  };
}

/**
 * MCP Client Manager - Manages connections to MCP servers for each Magi
 */
export class McpClientManager {
  private initialized = false;
  private clients = new Map<string, Client>(); // Key format: "MagiName:ServerName"
  private transports = new Map<string, StdioClientTransport>(); // Key format: "MagiName:ServerName"
  private serverConfigs?: Record<MagiName, McpServerConfig[]>;
  
  // MCP server configurations for each Magi - lazily initialized
  private getServerConfigs(): Record<MagiName, McpServerConfig[]> {
    if (!this.serverConfigs) {
      this.serverConfigs = {
        [MagiName.Balthazar]: getBalthazarToolServers(),
        [MagiName.Caspar]: getCasparTools(),
        [MagiName.Melchior]: getMelchiorTools()
      };
    }
    return this.serverConfigs;
  }

  /**
   * Initialize MCP client manager and connect to all MCP servers
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing MCP client manager...');
    
    // Validate tool assignments against registry
    this.validateToolAssignments();
    
    const serverConfigs = this.getServerConfigs();
    for (const [magiName, configs] of Object.entries(serverConfigs)) {
      for (const config of configs) {
        await this.connectToMcpServer(magiName as MagiName, config);
      }
    }
    
    // Validate that assigned tools are actually available after connection
    await this.validateToolAvailability();
    
    this.initialized = true;
    logger.info('MCP client manager initialization complete');
  }

  /**
   * If a Magi is assigned a tool, make sure the tool exists
   */
  private validateToolAssignments(): void {
    logger.debug('Validating tool assignments against registry...');
    const toolAssignments = getToolAssigmentsForAllMagi();
    for (const [magiName, assignedTools] of Object.entries(toolAssignments)) {
      for (const toolName of assignedTools) {
        const toolDef = ToolRegistry.getToolDefinition(toolName);
        if (!toolDef) {
          logger.error(`${magiName} is assigned unknown tool: ${toolName}`);
          throw new Error(`Unknown tool assignment: ${magiName} -> ${toolName}`);
        }
        logger.debug(`✓ ${magiName}: ${toolName} (${toolDef.description})`);
      }
    }
    
    logger.info('Tool assignments validated');
  }

  /**
   * Validate that assigned tools are available after MCP connections
   */
  private async validateToolAvailability(): Promise<void> {
    logger.debug('Validating tool availability after MCP connections...');
    const toolAssignments = getToolAssigmentsForAllMagi();
    for (const [magiName, assignedTools] of Object.entries(toolAssignments)) {
      const availableTools = await this.getMCPToolInfoForMagi(magiName as MagiName);
      const availableToolNames = availableTools.map(t => t.name);
      
      for (const toolName of assignedTools) {
        if (!availableToolNames.includes(toolName)) {
          logger.warn(`${magiName} assigned tool '${toolName}' not available from MCP servers`);
        } else {
          logger.debug(`✓ ${magiName}: ${toolName} available`);
        }
      }
    }
    
    logger.info('Tool availability validation complete');
  }

  /**
   * Connect to an MCP server for a specific Magi
   */
  private async connectToMcpServer(magiName: MagiName, config: McpServerConfig): Promise<void> {
    const serverKey = `${magiName}:${config.name}`;
    
    try {
      logger.info(`Connecting to ${config.name} MCP server for ${magiName}...`);
      logger.debug(`MCP server config:`, { 
        name: config.name,
        command: config.command, 
        args: config.args, 
        cwd: config.cwd 
      });
      
      // Special logging for Tavily to debug API key issues
      if (config.name === 'tavily') {
        const apiKey = config.env?.TAVILY_API_KEY;
        logger.debug(`Tavily API key status: ${apiKey ? `Present (${apiKey.substring(0, 8)}...)` : 'Missing'}`);
      }
      
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd
      });
      
      const client = new Client(
        {
          name: `the-magi-${magiName.toLowerCase()}-${config.name}`,
          version: '1.0.0'
        },
        {
          capabilities: {
            tools: {}
          }
        }
      );
      
      logger.debug(`Attempting to connect client to transport for ${magiName}:${config.name}...`);
      await client.connect(transport);
      
      this.clients.set(serverKey, client);
      this.transports.set(serverKey, transport);
      
      logger.info(`Successfully connected to ${config.name} MCP server for ${magiName}`);
      
      // Test the connection by listing tools
      try {
        const response = await client.listTools();
        logger.info(`${magiName}:${config.name} MCP server has ${response.tools.length} tools available`);
        
        // Log each tool for debugging
        response.tools.forEach((tool: Tool) => {
          logger.debug(`  Tool available: ${tool.name} - ${tool.description || 'No description'}`);
        });
        
        // Special logging for Tavily to help debug the web_search mapping issue
        if (config.name === 'tavily') {
          const toolNames = response.tools.map((tool: Tool) => tool.name);
          logger.info(`Tavily MCP server tools: [${toolNames.join(', ')}]`);
        }
      } catch (toolError) {
        logger.warn(`${magiName}:${config.name} MCP server connected but failed to list tools:`, toolError);
      }
      
    } catch (error) {
      logger.error(`Failed to connect to ${config.name} MCP server for ${magiName}:`, error);
      // Log more details about the error
      if (error instanceof Error) {
        logger.error(`Error details: ${error.message}`);
        logger.error(`Error stack: ${error.stack}`);
      }
    }
  }

  /**
   * Get available tools for a specific Magi
   */
  async getMCPToolInfoForMagi(magiName: MagiName): Promise<McpToolInfo[]> {
    const allTools: McpToolInfo[] = [];
    
    // Find all clients for this Magi
    const serverConfigs = this.getServerConfigs();
    const configs = serverConfigs[magiName] || [];
    
    for (const config of configs) {
      const serverKey = `${magiName}:${config.name}`;
      const client = this.clients.get(serverKey);
      
      if (!client) {
        logger.warn(`No MCP client available for ${magiName}:${config.name}`);
        continue;
      }

      try {
        const response = await client.listTools();
        const myTools = getToolAssigmentsForAllMagi()[magiName];
        const tools = response.tools
        .filter((tool: Tool) => myTools.includes(tool.name))
        .map((tool: Tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          instructions: TOOL_REGISTRY[tool.name]?.instructions
        }));
        allTools.push(...tools);
      } catch (error) {
        logger.error(`Failed to list tools for ${magiName}:${config.name}:`, error);
      }
    }
    
    // Add DEFAULT_AGENTIC_TOOL tools that don't require MCP servers
    const myTools = getToolAssigmentsForAllMagi()[magiName];
    const defaultAgenticTools = myTools
      .map(toolName => TOOL_REGISTRY[toolName])
      .filter(toolDef => toolDef?.category === 'default_agentic_tool')
      .map(toolDef => ({
        name: toolDef.name,
        description: toolDef.description,
        inputSchema: this.createInputSchemaForDefaultTool(toolDef),
        instructions: toolDef.instructions
      }));
    
    allTools.push(...defaultAgenticTools);
    
    return allTools;
  }

  /**
   * Create a basic input schema for default agentic tools
   */
  private createInputSchemaForDefaultTool(toolDef: any): Record<string, any> {
    // Basic schema structure for default tools
    const schema = {
      type: 'object',
      properties: {} as Record<string, any>,
      required: [] as string[]
    };

    // Parse instructions to determine required parameters
    if (toolDef.instructions) {
      const lines = toolDef.instructions.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.includes('(required)')) {
          const paramMatch = trimmed.match(/^\s*(\w+)\s*\(required\)/);
          if (paramMatch) {
            const paramName = paramMatch[1];
            schema.properties[paramName] = { type: 'string' };
            schema.required.push(paramName);
          }
        } else if (trimmed.includes('(optional)')) {
          const paramMatch = trimmed.match(/^\s*(\w+)\s*\(optional\)/);
          if (paramMatch) {
            const paramName = paramMatch[1];
            schema.properties[paramName] = { type: 'string' };
          }
        }
      }
    }

    return schema;
  }

  /**
   * Execute a tool for a specific Magi
   */
  async executeTool<T extends string = string>(
    magiName: MagiName,
    toolName: T,
    toolArguments: Record<string, any>
  ): Promise<GetToolResponse<T>> {
    if (!this.initialized) {
      throw new Error('MCP client manager not initialized');
    }

    // Find which server provides this tool
    const serverConfigs = this.getServerConfigs();
    const configs = serverConfigs[magiName] || [];
    
    logger.debug(`Checking ${configs.length} MCP servers for ${magiName}`);
    
    for (const config of configs) {
      const serverKey = `${magiName}:${config.name}`;
      const client = this.clients.get(serverKey);
      
      if (!client) {
        continue;
      }

      try {
        // Check if this server provides the requested tool
        const response = await client.listTools();
        const availableTools = response.tools.map((tool: Tool) => tool.name);
        logger.debug(`${config.name} server has tools: [${availableTools.join(', ')}], looking for: ${toolName}`);
        
        const hasTool = response.tools.some((tool: Tool) => tool.name === toolName);
        
        if (hasTool) {
          logger.debug(`Executing tool ${toolName} (mapped to ${toolName}) for ${magiName} via ${config.name} server`);
          
          const result = await client.callTool({ name: toolName, arguments: toolArguments });
          
          logger.debug(`Tool ${toolName} completed for ${magiName} via ${config.name} server`);
          
          return this.transformMcpResultToTypedResponse(toolName, result) as GetToolResponse<T>;
        }
      } catch (error) {
        logger.error(`Failed to check tools or execute ${toolName} on ${config.name} server for ${magiName}:`);
        logger.error(`Error details: ${error}`);
        if (error instanceof Error) {
          logger.error(`Error message: ${error.message}`, error.message);
        }
        continue;
      }
    }

    // Check if this is a DEFAULT_AGENTIC_TOOL that doesn't require an MCP server
    const toolDef = TOOL_REGISTRY[toolName];
    if (toolDef?.category === 'default_agentic_tool') {
      logger.debug(`Executing default agentic tool ${toolName} for ${magiName}`);
      return this.executeDefaultAgenticTool(toolName, toolArguments) as GetToolResponse<T>;
    }

    logger.warn(`Tool ${toolName} (mapped to ${toolName}) not found in any MCP server for ${magiName}`);
    return this.createErrorResponse(`Tool '${toolName}' not found in any connected MCP server for ${magiName}`) as GetToolResponse<T>;
  }

  /**
   * Execute a default agentic tool that doesn't require an MCP server
   */
  private executeDefaultAgenticTool(toolName: string, toolArguments: Record<string, any>): GetToolResponse<string> {
    logger.debug(`Executing default agentic tool: ${toolName} with arguments:`, toolArguments);
    
    // Default agentic tools are essentially pass-through operations
    // They're designed to be processed by the Magi's agentic logic
    const toolDef = TOOL_REGISTRY[toolName];
    
    // Create a response that includes the tool execution details
    const response = {
      tool: toolName,
      description: toolDef?.description || 'Default agentic tool',
      arguments: toolArguments,
      executed: true,
      timestamp: new Date().toISOString()
    };
    
    return {
      data: { text: JSON.stringify(response, null, 2) },
      isError: false
    };
  }

  /**
   * Transform MCP result to typed response based on tool name
   */
  private transformMcpResultToTypedResponse(toolName: string, result: any): GetToolResponse<string> {
    // Extract text content from MCP response
    const textContent = Array.isArray(result.content) 
      ? result.content
          .filter((item: any) => item.type === 'text')
          .map((item: any) => item.text)
          .filter((text: any): text is string => text !== undefined)
          .join('\n')
      : '';

    // Parse the response based on tool type
    if (this.isWebSearchTool(toolName)) {
      return {
        data: this.parseWebSearchResponse(textContent),
        isError: Boolean(result.isError),
        _meta: result._meta
      } as any;
    } else if (this.isWebExtractTool(toolName)) {
      return {
        data: this.parseWebExtractResponse(textContent),
        isError: Boolean(result.isError),
        _meta: result._meta
      } as any;
    } else {
      // Fallback to generic text response
      return {
        data: { text: textContent || 'Tool executed successfully but returned no text content' },
        isError: Boolean(result.isError),
        _meta: result._meta
      } as any;
    }
  }

  /**
   * Check if tool is a web search tool
   */
  private isWebSearchTool(toolName: string): boolean {
    return ToolRegistry.isWebSearchTool(toolName);
  }

  /**
   * Check if tool is a web extract tool
   */
  private isWebExtractTool(toolName: string): boolean {
    return ToolRegistry.isWebExtractTool(toolName);
  }

  /**
   * Parse web search response from text content (Tavily search API format)
   */
  private parseWebSearchResponse(textContent: string): WebSearchResponse {
    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(textContent);
      if (parsed.results && Array.isArray(parsed.results)) {
        return {
          query: parsed.query || '',
          answer: parsed.answer,
          images: parsed.images || [],
          results: parsed.results.map((r: any) => ({
            title: r.title || '',
            url: r.url || '',
            content: r.content || r.snippet || '',
            score: r.score || 0,
            raw_content: r.raw_content,
            favicon: r.favicon
          })),
          auto_parameters: parsed.auto_parameters,
          response_time: parsed.response_time || 0
        };
      }
    } catch {
      // If parsing fails, treat as plain text response
    }
    
    return {
      query: '',
      answer: undefined,
      images: [],
      results: [{
        title: 'Search Result',
        url: '',
        content: textContent,
        score: 0
      }],
      response_time: 0
    };
  }

  /**
   * Parse web extract response from text content (Tavily extract API format)
   */
  private parseWebExtractResponse(textContent: string): WebExtractResponse {
    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(textContent);
      if (parsed.results && Array.isArray(parsed.results)) {
        return {
          results: parsed.results.map((r: any) => ({
            url: r.url || '',
            raw_content: r.raw_content || r.content || '',
            images: r.images || [],
            favicon: r.favicon
          })),
          failed_results: parsed.failed_results || [],
          response_time: parsed.response_time || 0
        };
      }
      // Handle legacy format or simple response
      if (parsed.content || parsed.url) {
        return {
          results: [{
            url: parsed.url || '',
            raw_content: parsed.content || textContent,
            images: parsed.images || [],
            favicon: parsed.favicon
          }],
          failed_results: [],
          response_time: 0
        };
      }
    } catch {
      // If parsing fails, treat as plain text response
    }
    
    // Fallback for plain text responses
    return {
      results: [{
        url: '',
        raw_content: textContent,
        images: [],
        favicon: undefined
      }],
      failed_results: [],
      response_time: 0
    };
  }

  /**
   * Create a standardized error response
   */
  private createErrorResponse<T extends string>(message: string): GetToolResponse<T> {
    return {
      data: { text: message } as any,
      isError: true
    } as GetToolResponse<T>;
  }

  /**
   * Cleanup all MCP connections
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up MCP connections...');
    
    for (const [serverKey, transport] of this.transports) {
      try {
        await transport.close();
        logger.debug(`Closed MCP transport for ${serverKey}`);
      } catch (error) {
        logger.warn(`Failed to close MCP transport for ${serverKey}:`, error);
      }
    }
    
    this.clients.clear();
    this.transports.clear();
    this.initialized = false;
  }
}

// Export singleton instance
export const mcpClientManager = new McpClientManager();

// Legacy exports for backward compatibility during transition
export const mcpToolRegistry = {
  initialize: () => mcpClientManager.initialize(),
  executeTool: (magiName: MagiName, toolName: string, toolArguments: Record<string, any>) => 
    mcpClientManager.executeTool(magiName, toolName, toolArguments)
};