import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { MagiName } from '../magi/magi2';
import { logger } from '../logger';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { GetToolResponse, WebSearchResponse, WebExtractResponse } from './tool-response-types';
import { getBalthazarToolAssignments, getBalthazarToolServers } from './tools/balthazar-tools';
import { getCasparToolAssignments,getCasparToolServers } from './tools/caspar-tools';
import { getMelchiorToolAssignments, getMelchiorToolServers } from './tools/melchior-tools';
import { EXCLUDED_TOOL_PARAMS, MCP_TOOL_MAPPING, TOOL_REGISTRY, ToolRegistry } from './tools/tool-registry';

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
  transport: 'stdio' | 'sse'; // Transport type
  // For stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  // For SSE transport
  url?: string;
  headers?: Record<string, string>;
}

export class MagiTool implements McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
  instructions?: string;

  constructor(info: McpToolInfo) {
    this.name = info.name;
    this.description = info.description;
    this.inputSchema = info.inputSchema;
    this.instructions = info.instructions;
  }

  toString(): string {
    const parts = [`Tool Name: ${this.name}`];
    
    if (this.description) {
      parts.push(`Description: ${this.description}`);
    }
    
    if (this.inputSchema?.properties) {
      const params = Object.entries(this.inputSchema.properties)
        .filter(([key]) => !EXCLUDED_TOOL_PARAMS.has(key))
        .map(([key, value]: [string, any]) => {
          const required = this.inputSchema?.required?.includes(key) ? ', required' : '';
          const typeInfo = this.formatTypeInfo(value);
          const description = value.description || 'No description provided';
          
          return `    ${key} (${typeInfo}${required}): ${description}`;
        })
        .join('\n');
      if (params.trim()) {
        parts.push(`Parameters:\n${params}`);
      }
    }
    
    if (this.instructions) {
      parts.push(`Instructions: ${this.instructions}`);
    }
    
    return parts.join('\n');
  }

  private formatTypeInfo(value: any): string {
    if (value.type === 'array' && value.items?.type) {
      return `array of ${value.items.type}s`;
    }
    
    if (value.enum && Array.isArray(value.enum)) {
      const enumList = value.enum.map((v: any) => `"${v}"`).join(', ');
      return `${value.type || 'string'}. Must be one of the following exact values: ${enumList}`;
    }
    
    return value.type || 'any';
  }
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
  private readonly clients = new Map<string, Client>(); // Key format: "MagiName:ServerName"
  private readonly transports = new Map<string, StdioClientTransport | SSEClientTransport>(); // Key format: "MagiName:ServerName"
  private serverConfigs?: Record<MagiName, McpServerConfig[]>;
  
  // MCP server configurations for each Magi - lazily initialized
  private getServerConfigs(): Record<MagiName, McpServerConfig[]> {
    this.serverConfigs ??= {
      [MagiName.Balthazar]: getBalthazarToolServers(),
      [MagiName.Caspar]: getCasparToolServers(),
      [MagiName.Melchior]: getMelchiorToolServers()
    };
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
      this.logConnectionAttempt(magiName, config);
      this.logServerCredentials(config);
      
      const transport = this.createTransport(config);
      const client = this.createClient(magiName, config);
      
      logger.debug(`Attempting to connect client to ${config.transport} transport for ${magiName}:${config.name}...`);
      await client.connect(transport);
      
      this.clients.set(serverKey, client);
      this.transports.set(serverKey, transport);
      
      logger.info(`Successfully connected to ${config.name} MCP server for ${magiName}`);
      
      await this.testConnection(magiName, config, client);
      
    } catch (error) {
      this.handleConnectionError(magiName, config, error);
    }
  }

  private logConnectionAttempt(magiName: MagiName, config: McpServerConfig): void {
    logger.info(`Connecting to ${config.name} MCP server for ${magiName} via ${config.transport}...`);
    logger.debug(`MCP server config:`, { 
      name: config.name,
      transport: config.transport,
      ...(config.transport === 'stdio' ? {
        command: config.command, 
        args: config.args, 
        cwd: config.cwd 
      } : {
        url: config.url,
        headers: config.headers
      })
    });
  }

  private logServerCredentials(config: McpServerConfig): void {
    if (config.name === 'tavily') {
      const apiKey = config.env?.TAVILY_API_KEY;
      const keyStatus = apiKey ? `Present (${apiKey.substring(0, 8)}...)` : 'Missing';
      logger.debug(`Tavily API key status: ${keyStatus}`);
    } else if (config.name === 'home-assistant') {
      const token = config.headers?.Authorization;
      const tokenStatus = token ? `Present (Bearer ${token.split(' ')[1]?.substring(0, 20)}...)` : 'Missing';
      logger.debug(`Home Assistant token status: ${tokenStatus}`);
    }
  }

  private createTransport(config: McpServerConfig): StdioClientTransport | SSEClientTransport {
    if (config.transport === 'sse') {
      if (!config.url) {
        throw new Error(`SSE transport requires a URL for server ${config.name}`);
      }
      return new SSEClientTransport(new URL(config.url), {
        requestInit: {
          headers: config.headers || {}
        }
      });
    } else {
      if (!config.command) {
        throw new Error(`Stdio transport requires a command for server ${config.name}`);
      }
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd
      });
    }
  }

  private createClient(magiName: MagiName, config: McpServerConfig): Client {
    return new Client(
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
  }

  private async testConnection(magiName: MagiName, config: McpServerConfig, client: Client): Promise<void> {
    try {
      const response = await client.listTools();
      logger.info(`${magiName}:${config.name} MCP server has ${response.tools.length} tools available`);
      
      response.tools.forEach((tool: Tool) => {
        logger.debug(`  Tool available: ${tool.name} - ${tool.description ?? 'No description'}`);
      });
      
      this.logServerSpecificTools(config, response.tools);
    } catch (toolError) {
      logger.warn(`${magiName}:${config.name} MCP server connected but failed to list tools:`, toolError);
    }
  }

  private logServerSpecificTools(config: McpServerConfig, tools: Tool[]): void {
    const toolNames = tools.map((tool: Tool) => tool.name);
    if (config.name === 'tavily') {
      logger.info(`Tavily MCP server tools: [${toolNames.join(', ')}]`);
    } else if (config.name === 'home-assistant') {
      logger.info(`Home Assistant MCP server tools: [${toolNames.join(', ')}]`);
    }
  }

  private handleConnectionError(magiName: MagiName, config: McpServerConfig, error: unknown): void {
    logger.error(`Failed to connect to ${config.name} MCP server for ${magiName}:`, error);
    
    if (config.name === 'home-assistant') {
      this.logHomeAssistantTokenStatus(config);
    }
    
    if (error instanceof Error) {
      logger.error(`Error details: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
  }

  private logHomeAssistantTokenStatus(config: McpServerConfig): void {
    const token = config.headers?.Authorization;
    if (!token || token === 'Bearer ' || token === 'Bearer undefined') {
      logger.error('❌ CASPAR_ACCESS_TOKEN is missing or empty - this is likely the cause');
    } else {
      logger.error(`✓ CASPAR_ACCESS_TOKEN is present (Bearer ${token.split(' ')[1]?.substring(0, 20)}...)`);
    }
  }

  /**
   * Get available tools for a specific Magi
   */
  async getMCPToolInfoForMagi(magiName: MagiName): Promise<MagiTool[]> {
    const allTools: MagiTool[] = [];
    
    // Find all clients for this Magi
    const serverConfigs = this.getServerConfigs();
    const configs = serverConfigs[magiName] || [];
    if (configs.length === 0) {
      logger.error(`⚠️ No MCP server configs found for ${magiName}, cannot get tools!`);
    }
    
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
        
        // Create mapping from MCP tool names to friendly names
        const mcpToFriendlyMap: Record<string, string> = {};
        for (const [friendlyName, mcpName] of Object.entries(MCP_TOOL_MAPPING)) {
          mcpToFriendlyMap[mcpName] = friendlyName;
        }
        // Add direct mappings for tools that don't need name conversion
        mcpToFriendlyMap['access-data'] = 'access-data';
        
        const tools = response.tools
        .filter((tool: Tool) => {
          // Special handling for Home Assistant server - all tools map to 'smart-home-devices'
          if (config.name === 'home-assistant' && myTools.includes('smart-home-devices')) {
            return true;
          }
          
          // Check if this MCP tool has a friendly name that's assigned to this Magi
          const friendlyName = mcpToFriendlyMap[tool.name] || tool.name;
          return myTools.includes(friendlyName);
        })
        .map((tool: Tool) => {
          // Special handling for Home Assistant server - all tools become 'smart-home-devices'
          if (config.name === 'home-assistant') {
            return new MagiTool({
              name: 'smart-home-devices',
              description: 'Query and control smart home devices through Home Assistant',
              inputSchema: tool.inputSchema,
            });
          }
          
          // Use the friendly name instead of the MCP name
          const friendlyName = mcpToFriendlyMap[tool.name] || tool.name;
          return new MagiTool({
            name: friendlyName,
            description: tool.description,
            inputSchema: tool.inputSchema,
          });
        });
        
        // For Home Assistant, deduplicate tools since they all map to 'smart-home-devices'
        if (config.name === 'home-assistant' && tools.length > 0) {
          // Use our defined schema from the tool registry instead of HA's schema
          const toolDef = TOOL_REGISTRY['smart-home-devices'];
          const smartHomeTool = new MagiTool({
            name: 'smart-home-devices',
            description: toolDef?.description || 'Query and control smart home devices through Home Assistant',
            inputSchema: toolDef ? this.createInputSchemaForDefaultTool(toolDef) : undefined,
          });
          allTools.push(smartHomeTool);
        } else {
          allTools.push(...tools);
        }
      } catch (error) {
        logger.error(`Failed to list tools for ${magiName}:${config.name}:`, error);
      }
    }
    
    // Add DEFAULT_AGENTIC_TOOL tools that don't require MCP servers
    const myTools = getToolAssigmentsForAllMagi()[magiName];
    const defaultAgenticTools = myTools
      .map(toolName => TOOL_REGISTRY[toolName])
      .filter(toolDef => toolDef?.category === 'default_agentic_tool')
      .map(toolDef => new MagiTool({
        name: toolDef.name,
        description: toolDef.description,
        inputSchema: this.createInputSchemaForDefaultTool(toolDef),
      }));
    
    allTools.push(...defaultAgenticTools);
    
    return allTools;
  }

  /**
   * Create a basic input schema for default agentic tools using structured parameters
   */
  private createInputSchemaForDefaultTool(toolDef: any): Record<string, any> {
    // Basic schema structure for default tools
    const schema = {
      type: 'object',
      properties: {} as Record<string, any>,
      required: [] as string[]
    };

    // Use structured parameters instead of parsing instructions
    if (toolDef.parameters) {
      for (const [paramName, paramDef] of Object.entries(toolDef.parameters)) {
        const param = paramDef as any;
        schema.properties[paramName] = {
          type: param.type || 'string',
          description: param.description
        };
        
        // Add enum if present
        if (param.enum) {
          schema.properties[paramName].enum = param.enum;
        }
        
        // Add to required array if marked as required
        if (param.required) {
          schema.required.push(paramName);
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

    const serverConfigs = this.getServerConfigs();
    const configs = serverConfigs[magiName] || [];
    logger.debug(`Checking ${configs.length} MCP servers for ${magiName}`);
    
    // Try to execute the tool on available MCP servers
    const mcpResult = await this.tryExecuteOnMcpServers(magiName, toolName, toolArguments, configs);
    if (mcpResult) {
      return mcpResult;
    }

    // Check if this is a default agentic tool
    const toolDef = TOOL_REGISTRY[toolName];
    if (toolDef?.category === 'default_agentic_tool') {
      logger.debug(`Executing default agentic tool ${toolName} for ${magiName}`);
      return this.executeDefaultAgenticTool(toolName, toolArguments) as GetToolResponse<T>;
    }

    // Tool not found in any server
    const mcpToolName = MCP_TOOL_MAPPING[toolName] || toolName;
    logger.warn(`Tool ${toolName} (mapped to ${mcpToolName}) not found in any MCP server for ${magiName}`);
    return this.createErrorResponse(`Tool '${toolName}' not found in any connected MCP server for ${magiName}`) as GetToolResponse<T>;
  }

  private async tryExecuteOnMcpServers<T extends string>(
    magiName: MagiName,
    toolName: T,
    toolArguments: Record<string, any>,
    configs: McpServerConfig[]
  ): Promise<GetToolResponse<T> | null> {
    for (const config of configs) {
      const serverKey = `${magiName}:${config.name}`;
      const client = this.clients.get(serverKey);
      
      if (!client) {
        continue;
      }

      try {
        const response = await client.listTools();
        const availableTools = response.tools.map((tool: Tool) => tool.name);
        logger.debug(`${config.name} server has tools: [${availableTools.join(', ')}], looking for: ${toolName}`);
        
        // Try home assistant tool execution
        const homeAssistantResult = await this.tryHomeAssistantExecution(
          magiName, toolName, toolArguments, config, client, availableTools
        );
        if (homeAssistantResult) {
          return homeAssistantResult as GetToolResponse<T>;
        }
        
        // Try regular MCP tool execution
        const regularResult = await this.tryRegularMcpExecution(
          magiName, toolName, toolArguments, config, client, response.tools
        );
        if (regularResult) {
          return regularResult as GetToolResponse<T>;
        }
      } catch (error) {
        this.logToolExecutionError(toolName, config.name, magiName, error);
        continue;
      }
    }
    
    return null;
  }

  private async tryHomeAssistantExecution(
    magiName: MagiName,
    toolName: string,
    toolArguments: Record<string, any>,
    config: McpServerConfig,
    client: Client,
    availableTools: string[]
  ): Promise<GetToolResponse<string> | null> {
    if ((toolName === 'smart-home-devices' || toolName === 'home-assistant') && config.name === 'home-assistant') {
      logger.debug(`🏠 Processing smart-home-devices call with arguments:`, toolArguments);
      
      const homeAssistantTool = this.selectHomeAssistantTool(toolArguments, availableTools);
      if (homeAssistantTool) {
        const transformedArgs = this.transformArgumentsForHomeAssistant(toolArguments);
        
        logger.debug(`🔄 Routing to Home Assistant tool: ${homeAssistantTool}`);
        logger.debug(`📤 Calling ${homeAssistantTool} with args:`, transformedArgs);
        
        const result = await client.callTool({ 
          name: homeAssistantTool, 
          arguments: transformedArgs
        });
        
        logger.debug(`✅ Smart-home-devices (${homeAssistantTool}) completed for ${magiName}`);
        return this.transformMcpResultToTypedResponse(toolName, result);
      } else {
        logger.error(`❌ No suitable Home Assistant tool found for smart-home-devices call`);
        logger.error(`Available tools: [${availableTools.join(', ')}]`);
        return this.createErrorResponse(`No suitable Home Assistant tool found for action: ${toolArguments.action}`);
      }
    }
    
    return null;
  }

  private async tryRegularMcpExecution(
    magiName: MagiName,
    toolName: string,
    toolArguments: Record<string, any>,
    config: McpServerConfig,
    client: Client,
    tools: Tool[]
  ): Promise<GetToolResponse<string> | null> {
    const friendlyToMcpMap: Record<string, string> = { ...MCP_TOOL_MAPPING };
    friendlyToMcpMap['access-data'] = 'access-data';
    
    const mcpToolName = friendlyToMcpMap[toolName] || toolName;
    const hasTool = tools.some((tool: Tool) => tool.name === mcpToolName);
    
    if (hasTool) {
      logger.debug(`Executing tool ${toolName} (mapped to ${mcpToolName}) for ${magiName} via ${config.name} server`);
      
      const result = await client.callTool({ name: mcpToolName, arguments: toolArguments });
      
      logger.debug(`Tool ${toolName} completed for ${magiName} via ${config.name} server`);
      
      return this.transformMcpResultToTypedResponse(toolName, result);
    }
    
    return null;
  }

  private logToolExecutionError(toolName: string, serverName: string, magiName: MagiName, error: unknown): void {
    logger.error(`Failed to check tools or execute ${toolName} on ${serverName} server for ${magiName}:`);
    logger.error(`Error details: ${error}`);
    if (error instanceof Error) {
      logger.error(`Error message: ${error.message}`);
    }
  }

  /**
   * Select the appropriate Home Assistant tool based on the action and arguments
   */
  private selectHomeAssistantTool(toolArguments: Record<string, any>, availableTools: string[]): string | null {
    const { action, command } = toolArguments;
    
    logger.debug(`Selecting Home Assistant tool for action: ${action}, command: ${command}`);
    logger.debug(`Available Home Assistant tools: [${availableTools.join(', ')}]`);
    
    // Priority 1: Map specific commands to tools
    if (command) {
      switch (command) {
        case 'turn_on':
          return availableTools.find(tool => tool === 'HassTurnOn') || null;
        case 'turn_off':
          return availableTools.find(tool => tool === 'HassTurnOff') || null;
        case 'toggle':
          // Look for specific toggle tool, fallback to turn_on
          return availableTools.find(tool => tool.includes('Toggle')) || 
                 availableTools.find(tool => tool === 'HassTurnOn') || null;
        case 'set_speed':
        case 'set_brightness':
          // These might use general control tools
          return availableTools.find(tool => tool === 'HassTurnOn') || null;
      }
    }
    
    // Priority 2: Map actions to tools
    if (action) {
      switch (action) {
        case 'control':
          // Default control action - use turn_on if no specific command
          return availableTools.find(tool => tool === 'HassTurnOn') || null;
        case 'get_state':
        case 'query':
        case 'list_devices':
          return availableTools.find(tool => tool === 'GetLiveContext') || null;
      }
    }
    
    // Priority 3: Fallback based on available tools
    // If we have GetLiveContext, it's probably a query operation
    if (availableTools.includes('GetLiveContext')) {
      logger.debug('Defaulting to GetLiveContext for unknown action');
      return 'GetLiveContext';
    }
    
    // Last resort: use first available tool
    logger.debug(`No specific tool found, using first available: ${availableTools[0]}`);
    return availableTools[0] || null;
  }
  
  /**
   * Transform smart-home-devices arguments to Home Assistant tool arguments
   */
  private transformArgumentsForHomeAssistant(toolArguments: Record<string, any>): Record<string, any> {
    const transformed: Record<string, any> = {};
    const { action, entity_id, device_type, command, attributes } = toolArguments;
    
    // For all tools, entity_id maps to name
    if (entity_id) {
      transformed.name = entity_id;
    }
    
    // For state/query operations (GetLiveContext)
    if (action === 'get_state' || action === 'query' || action === 'list_devices') {
      if (device_type) {
        transformed.domain = [device_type];
      }
      // If no entity_id provided for list_devices, remove name to get all devices of type
      if (action === 'list_devices' && !entity_id) {
        delete transformed.name;
      }
    }
    
    // For control operations (HassTurnOn, HassTurnOff, etc.)
    if (action === 'control' || command) {
      // Pass through additional attributes for control commands
      if (attributes && typeof attributes === 'object') {
        Object.assign(transformed, attributes);
      }
      
      // Some Home Assistant tools might need additional domain info
      if (device_type) {
        transformed.domain = device_type;
      }
    }
    
    logger.debug(`Transformed smart-home-devices args: ${JSON.stringify({ 
      original: toolArguments, 
      transformed 
    })}`);
    
    return transformed;
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
    if (ToolRegistry.isWebSearchTool(toolName)) {
      return {
        data: this.parseWebSearchResponse(textContent),
        isError: Boolean(result.isError),
        _meta: result._meta
      } as any;
    } else if (ToolRegistry.isWebExtractTool(toolName)) {
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
  initialize: async () => mcpClientManager.initialize(),
  executeTool: async (magiName: MagiName, toolName: string, toolArguments: Record<string, any>) => 
    mcpClientManager.executeTool(magiName, toolName, toolArguments)
};