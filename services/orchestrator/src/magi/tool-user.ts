import { logger } from '../logger';
import type { MagiTool } from '../mcp';
import { mcpClientManager } from '../mcp';
import type { MagiName } from '../types/magi-types';
import type { WebSearchResponse, WebExtractResponse, SmartHomeResponse, PersonalDataResponse, TextResponse, GetToolResponse, AnyToolResponse } from '../mcp/tool-response-types';
import { MagiErrorHandler } from './error-handler';
import { testHooks } from '../testing/test-hooks';

// Minimal contract needed by ToolUser (implemented by both Magi and Magi2)
interface ToolUserMagiLike {
  name: MagiName;
  contactSimple(userPrompt: string, systemPrompt?: string): Promise<string>;
}

// Local type to avoid importing from magi2 and creating tight coupling
export type AgenticTool = { name: string; parameters: Record<string, unknown> };

/**
 * JSON Schema type definitions
 */
interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  default?: unknown;
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * A single prompt that takes the raw text from a webpage, and extracts the content that is relevant to the user's original query
 */
export function getRelevantContentFromRawText(userMessage: string, rawToolResponse: string): string {
  return `
  INSTRUCTIONS
  - Identify and Isolate: Read the entire text to identify the main body of the content (e.g., the article, the blog post, the initial forum post).
  - Extract Verbatim: Pull out the main content's text exactly as it is, preserving all original sentences, paragraphs, and their order. Do not summarize or add any text.

  EXCLUSION CRITERIA
  You MUST remove all of the following non-essential elements:
  - Promotional Content: Advertisements, sponsored links, affiliate marketing, and calls-to-action (e.g., "Sign up," "Download our guide").
  - Website Navigation: Headers, footers, sidebars, menus, and breadcrumbs.
  - Related Links: Lists or grids of "Related Articles," "Recent Posts," "Popular Stories," or "You might also like."
  - Metadata and Threading: Author bios, user signatures, post dates, comment sections, and any replies or comments that follow the main post.
  - Off-topic Text: Any content that is not directly part of the main content's central topic.
  - Images in base64 encoded strings and markdown tokens

  OUTPUT
  Respond ONLY with the cleaned text

  USER'S TOPIC/QUESTION:
  "${userMessage}"

  Now, perform this task on the following raw text.

  RAW TEXT:
  ${rawToolResponse}
  `
}

/**
 * ToolUser handles tool identification and execution for the Magi system.
 */
export class ToolUser {
  constructor(private readonly magi: ToolUserMagiLike) {}

  /**
   * Map friendly tool names to actual MCP tool names
   */
  private mapToMcpToolName(toolName: string): string {
    const mapping: Record<string, string> = {
      'search-web': 'tavily-search',
      'read-page': 'tavily-extract'
    };
    
    return mapping[toolName] || toolName;
  }

  /**
   * Gets all the tools that are available for the current Magi persona.   
   * @returns The tool's MCP information
   */
  async getAvailableTools(): Promise<MagiTool[]> {
    try {
      // Dynamically get tools from MCP servers
      return await mcpClientManager.getMCPToolInfoForMagi(this.magi.name);
    } catch (error) {
      logger.error(`Failed to get available tools for ${this.magi.name}:`, error);
      return [];
    }
  }

  /**
   * Execute a tool using MCP with Magi-determined arguments.
   * @param toolName - The name of the tool to execute.
   * @param toolArguments - The arguments for the tool.
   * @param stepDescription - The description of the step (for fallback).
   * @returns The formatted tool result.
   */
  async executeWithTool<T extends string = string>(
    toolName: T, 
    toolArguments: Record<string, any>,
  ): Promise<string> {
    try {
      // Test-mode tool stubbing first to avoid heavy initialization
      const stubbed = testHooks.tryStubTool(toolName as string, toolArguments);
      if (stubbed.used) {
        try { testHooks.recordToolCall(toolName as string, toolArguments); } catch (err) {
          logger.debug(`Failed to record stubbed tool call for ${this.magi.name}: ${String((err as Error)?.message || err)}`);
        }
        return stubbed.response;
      }

      await mcpClientManager.initialize();
      
      if (toolName === 'search-web') {
        toolArguments.urls = [toolArguments.url ?? ''];
        toolArguments.exclude_domains = ["youtube.com", "instagram.com", "facebook.com"];
      }
      
      // Map friendly tool names to MCP tool names
      const mcpToolName = this.mapToMcpToolName(toolName);
      
      // Execute the tool with Magi-determined arguments
      const toolResult = await mcpClientManager.executeTool(this.magi.name, mcpToolName, toolArguments);
      
      // Extract the text from the typed response object
      const toolResponse = this.extractToolOutput(toolResult);
      
      if (toolName !== 'read-page'){
        logger.debug(`🛠️🛠️🛠️\n${toolResponse}\n`);
      }
      
      try { testHooks.recordToolCall(toolName as string, toolArguments); } catch (err) {
        logger.debug(`Failed to record tool call for ${this.magi.name}: ${String((err as Error)?.message || err)}`);
      }

      return toolResponse;
    } catch (error) {
      return MagiErrorHandler.handleToolError(error, {
        magiName: this.magi.name,
        operation: 'tool execution'
      });
    }
  }

  /**
   * Response type detection strategies
   */
  private readonly responseDetectors = new Map<string, (data: any) => boolean>([
    ['WebSearch', (data) => 'results' in data && Array.isArray(data.results) && 'query' in data && 'response_time' in data],
    ['WebExtract', (data) => 'results' in data && Array.isArray(data.results) && 'failed_results' in data && 'response_time' in data],
    ['SmartHome', (data) => 'devices' in data && Array.isArray(data.devices) && 'timestamp' in data],
    ['PersonalData', (data) => 'data' in data && 'categories' in data && 'context' in data && Array.isArray(data.categories)],
    ['Text', (data) => 'text' in data && typeof data.text === 'string']
  ]);

  /**
   * Response formatters for each type
   */
  private readonly responseFormatters = new Map<string, (data: any) => string>([
    ['WebSearch', (data) => this.formatWebSearchResponse(data as WebSearchResponse)],
    ['WebExtract', (data) => this.formatWebExtractResponse(data as WebExtractResponse)],
    ['SmartHome', (data) => this.formatSmartHomeResponse(data as SmartHomeResponse)],
    ['PersonalData', (data) => this.formatPersonalDataResponse(data as PersonalDataResponse)],
    ['Text', (data) => (data as TextResponse).text]
  ]);

  /**
   * Extract tool output into a readable format from typed response.
   * @param toolResult - The typed tool result.
   * @returns Formatted text output.
   */
  private extractToolOutput(toolResult: GetToolResponse<string> | { data: AnyToolResponse | TextResponse; isError?: boolean; _meta?: any }): string {
    if (!toolResult?.data) {
      return 'No output from tool';
    }
    
    if (toolResult.isError) {
      return `Tool error: ${this.formatErrorData(toolResult.data)}`;
    }
    
    const { data } = toolResult;
    
    // Find matching response type and format
    for (const [type, detector] of this.responseDetectors) {
      if (detector(data)) {
        const formatter = this.responseFormatters.get(type);
        if (formatter) {
          return formatter(data);
        }
      }
    }
    
    // Fallback: stringify the data
    return JSON.stringify(data, null, 2);
  }
  
  /**
   * Format web search response for display (Tavily search API format)
   */
  private formatWebSearchResponse(response: WebSearchResponse): string {
    let output = '';
    
    if (response.answer) {
      output += `Answer: ${response.answer}\n\n`;
    }
    const MAX_CONTENT_LENGTH = 5000;
    output += response.results[0].content;

    if (output.length > MAX_CONTENT_LENGTH) {
      output = output.substring(0, MAX_CONTENT_LENGTH) + '...';
    }
    
    return output;
  }
  
  /**
   * Format web extract response for display (Tavily extract API format)
   */
  private formatWebExtractResponse(response: WebExtractResponse): string {
    logger.debug(`Web Content Extraction Results (${response.response_time}s)`);
    
    // Display failed extractions
    let output = ``
    if (response.failed_results.length > 0) {
      output += `Failed to extract ${response.failed_results.length} URL(s):\n`;
      response.failed_results.forEach((failed, index) => {
        output += `${index + 1}. ${failed.url}\n`;
        output += `   Error: ${failed.error}\n`;
      });
    } else{
      output = response.results[0].raw_content
    }
    
    return output;
  }
  
  /**
   * Format smart home response for display
   */
  private formatSmartHomeResponse(response: SmartHomeResponse): string {
    let output = `Smart Home Status (${response.timestamp}):\n`;
    
    response.devices.forEach((device, index) => {
      output += `${index + 1}. ${device.name} (${device.type})\n`;
      output += `   ID: ${device.id}\n`;
      output += `   Status: ${device.status}\n`;
      if (device.data) {
        output += `   Data: ${JSON.stringify(device.data, null, 2)}\n`;
      }
    });
    
    return output;
  }
  
  /**
   * Format personal data response for dispslay
   */
  private formatPersonalDataResponse(response: PersonalDataResponse): string {
    return JSON.stringify(response.data, null, 2);
  }
  
  /**
   * Format error data for display
   */
  private formatErrorData(data: AnyToolResponse | TextResponse): string {
    const isTextResponse = 'text' in data && typeof (data as any).text === 'string';
    if (isTextResponse) {
      return data.text;
    }
    if (typeof data === 'string') {
      return data;
    }
    return JSON.stringify(data);
  }

  /**
   * Extract parameter details from JSON Schema for MCP format
   */
  public extractParameterDetails(inputSchema: JsonSchema | undefined): Record<string, string> {
    if (!inputSchema?.properties) {
      return { query: 'string (required)' };
    }

    const properties = inputSchema.properties;
    const required = inputSchema.required ?? [];
    
    const parameters: Record<string, string> = {};
    
    Object.entries(properties).forEach(([name, schema]: [string, JsonSchemaProperty]) => {
      const type = schema.type ?? 'any';
      const isRequired = required.includes(name);
      const defaultValue = schema.default !== undefined ? `, default: ${JSON.stringify(schema.default)}` : '';
      const status = isRequired ? 'required' : 'optional';
      
      // Include enum constraints if present
      const enumOptions = schema.enum ? schema.enum.map(v => `"${v}"`).join('|') : '';
      const enumConstraint = enumOptions ? ` [options: ${enumOptions}]` : '';
      
      // Special handling for common parameter patterns
      let description = '';
      if (name === 'options' && type === 'object') {
        // Check for nested topic enum in options object
        const topicProperty = schema.properties?.topic;
        const topicEnumOptions = topicProperty?.enum ? topicProperty.enum.map(v => `"${v}"`).join('|') : '';
        const topicEnum = topicEnumOptions ? `topic must be one of: ${topicEnumOptions}. ` : '';
        description = ` - Configure search depth, topic, max results, etc. ${topicEnum}`;
      } else if (name === 'urls' && type === 'array') {
        description = ' - List of URLs to process (up to 20)';
      } else if (name === 'query') {
        description = ' - Search query or question';
      } else if (name === 'url') {
        description = ' - URL to crawl';
      } else if (name === 'include_content') {
        description = ' - Whether to include full content';
      }
      
      parameters[name] = `${type} (${status}${defaultValue})${enumConstraint}${description}`;
    });

    return parameters;
  }

  async executeAgenticTool(tool: AgenticTool, userMessage: string): Promise<string> {
    let toolResponse = await this.executeWithTool(
      tool.name, 
      tool.parameters, 
    );

    // Use the centralized processOutput logic from agent-actions
    toolResponse = await this.processToolOutput(tool.name, toolResponse, userMessage);
    return toolResponse;
  }

  /**
   * Process tool output using the same logic as the state machine
   */
  private async processToolOutput(toolName: string, toolOutput: string, userMessage?: string): Promise<string> {
    let processedOutput = toolOutput;
    
    // Process output based on tool type
    switch (toolName) {
      case 'read-page':
        // Web pages can have a lot of noise that throw off the magi, so lets clean it
        if (userMessage) {
          const relevantContentPrompt = getRelevantContentFromRawText(userMessage, toolOutput);
          processedOutput = await this.magi.contactSimple(relevantContentPrompt, "You are an expert text-processing AI. Your sole task is to analyze the provided raw text and extract only the primary content.");
        }
        break;
      
      case 'personal-data': {
        // Summarize the data we received back in human readable form
        logger.debug(`Raw personal-data retrieved: ${toolOutput}`);
        const summarize = `You have just completed the following task:\n${toolOutput}\n\nNow, concisely summarize the action and result(s) in plain language. When referring to ${this.magi.name}, speak in the first person and only provide the summary.`;
        logger.debug(`Summary prompt:\n${summarize}`);
        processedOutput = await this.magi.contactSimple(summarize);
        break;
      }
      
      default:
        // No special processing for other tools - keep original output
        break;
    }
    
    // Basic length check and truncation
    if (processedOutput.length > 5000) {
      processedOutput = processedOutput.substring(0, 5000) + '... [truncated]';
    }
    
    return processedOutput;
  }
}