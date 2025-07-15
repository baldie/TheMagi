import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MagiName } from '../magi/magi';
import { logger } from '../logger';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import path from 'path';

/**
 * MCP Server response for tool execution
 */
export interface McpToolExecutionResponse {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
    name?: string;
    description?: string;
  }>;
  isError?: boolean;
  _meta?: Record<string, any>;
}

/**
 * Information about a single MCP tool
 */
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

/**
 * Configuration for MCP servers for each Magi
 */
interface McpServerConfig {
  name: string; // Unique identifier for this server
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
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
        [MagiName.Balthazar]: [
          {
            name: 'tavily',
            command: 'npx',
            args: ['-y', '@mcptools/mcp-tavily@latest'],
            env: { 
              ...process.env,
              TAVILY_API_KEY: process.env.TAVILY_API_KEY || ''
            } as Record<string, string>
          },
          {
            name: 'web-crawl',
            command: path.resolve(__dirname, '../../../web-search/venv/bin/python'),
            args: ['mcp_web_search.py'],
            env: { 
              ...process.env,
              VIRTUAL_ENV: path.resolve(__dirname, '../../../web-search/venv'),
              PATH: `${path.resolve(__dirname, '../../../web-search/venv/bin')}:${process.env.PATH}`,
              PYTHONPATH: path.resolve(__dirname, '../../../web-search/venv/lib/python3.12/site-packages')
            } as Record<string, string>,
            cwd: path.resolve(__dirname, '../../../web-search')
          }
        ],
        [MagiName.Caspar]: [],
        [MagiName.Melchior]: []
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
    
    const serverConfigs = this.getServerConfigs();
    for (const [magiName, configs] of Object.entries(serverConfigs)) {
      for (const config of configs) {
        await this.connectToMcpServer(magiName as MagiName, config);
      }
    }
    
    this.initialized = true;
    logger.info('MCP client manager initialization complete');
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
  async getAvailableTools(magiName: MagiName): Promise<McpToolInfo[]> {
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
        const tools = response.tools.map((tool: Tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }));
        allTools.push(...tools);
      } catch (error) {
        logger.error(`Failed to list tools for ${magiName}:${config.name}:`, error);
      }
    }
    
    return allTools;
  }

  /**
   * Get tool name mapping for logical names to actual MCP tool names
   */
  private getToolNameMapping(): Record<string, string> {
    return {
      'web_search': 'search',
      'web_extract': 'extract'
    };
  }

  /**
   * Execute a tool for a specific Magi
   */
  async executeTool(
    magiName: MagiName,
    toolName: string,
    toolArguments: Record<string, any>
  ): Promise<McpToolExecutionResponse> {
    if (!this.initialized) {
      throw new Error('MCP client manager not initialized');
    }

    // Map logical tool names to actual MCP tool names
    const toolMapping = this.getToolNameMapping();
    const actualToolName = toolMapping[toolName] || toolName;
    
    logger.debug(`Executing tool: ${toolName} (mapped to: ${actualToolName}) for ${magiName}`);

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
        logger.debug(`${config.name} server has tools: [${availableTools.join(', ')}], looking for: ${actualToolName}`);
        
        const hasTool = response.tools.some((tool: Tool) => tool.name === actualToolName);
        
        if (hasTool) {
          logger.debug(`Executing tool ${toolName} (mapped to ${actualToolName}) for ${magiName} via ${config.name} server`);
          
          const result = await client.callTool({
            name: actualToolName,
            arguments: toolArguments
          });
          
          logger.debug(`Tool ${toolName} completed for ${magiName} via ${config.name} server`);
          
          return {
            content: Array.isArray(result.content) ? result.content.map(item => ({
              type: item.type as 'text' | 'image' | 'resource',
              text: item.type === 'text' ? (item as any).text : undefined,
              data: item.type === 'image' ? (item as any).data : undefined,
              mimeType: item.type === 'image' ? (item as any).mimeType : undefined,
              uri: item.type === 'resource' ? (item as any).uri : undefined,
              name: item.type === 'resource' ? (item as any).name : undefined,
              description: item.type === 'resource' ? (item as any).description : undefined
            })) : [],
            isError: Boolean(result.isError),
            _meta: result._meta
          };
        }
      } catch (error) {
        logger.error(`Failed to check tools or execute ${toolName} on ${config.name} server for ${magiName}:`, error);
        continue;
      }
    }

    logger.warn(`Tool ${toolName} (mapped to ${actualToolName}) not found in any MCP server for ${magiName}`);
    return this.createErrorResponse(`Tool '${toolName}' not found in any connected MCP server for ${magiName}`);
  }

  /**
   * Create a standardized error response
   */
  private createErrorResponse(message: string): McpToolExecutionResponse {
    return {
      content: [{ type: 'text', text: message }],
      isError: true
    };
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