import { logger } from '../logger';
import { mcpClientManager, McpToolInfo } from '../mcp';
import { MagiName } from './magi';
import { WebSearchResponse, WebExtractResponse, SmartHomeResponse, PersonalDataResponse, TextResponse, GetToolResponse, AnyToolResponse } from '../mcp/tool-response-types';

export function getCleanExtractPrompt(userMessage: string, toolResponse: string): string {
  return `
    PERSONA:
    You are familiar with typical web page content and are adept at separating the useful text from the superfluous noise.

    CONTEXT:
    Consider the following User's Message: "${userMessage}"

    INSTRUCTIONS:
    I will now share with you a body of text extracted from a webpage. Your job is to extract the text that is associated with the User's Message. Do not summarize the text, just include it as-is. Filter out any unrelated text like image URLs, privacy policy information, disclaimers, etc. Only respond with the resulting relevant text verbatim.

    TEXT:
    ${toolResponse}
  `
}

/**
 * ToolUser handles tool identification and execution for the Magi system.
 */
export class ToolUser {
  constructor(private magiName: MagiName) {}

  /**
   * Gets all the tools that are available for the current Magi persona.   
   * @returns The tool's MCP information
   */
  async getAvailableTools(): Promise<McpToolInfo[]> {
    try {
      // Dynamically get tools from MCP servers
      return await mcpClientManager.getMCPToolInfoForMagi(this.magiName);
    } catch (error) {
      logger.error(`Failed to get available tools for ${this.magiName}:`, error);
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
    stepDescription: string
  ): Promise<string> {
    try {
      // Initialize MCP client manager if needed
      await mcpClientManager.initialize();
      
      // Execute the tool with Magi-determined arguments
      const toolResult = await mcpClientManager.executeTool(this.magiName, toolName, toolArguments);
      
      // Extract the text from the typed response object
      const processedOutput = this.extractToolOutput(toolResult);
      
      return `Tool used: ${toolName}\nArguments: ${JSON.stringify(toolArguments)}\nResult: ${processedOutput}`;
    } catch (error) {
      logger.error(`${this.magiName} tool execution failed:`, error);
      // Fallback to reasoning-based approach
      return `Tool execution failed, proceeding with reasoning-based analysis for: ${stepDescription}`;
    }
  }

  /**
   * Extract tool output into a readable format from typed response.
   * @param toolResult - The typed tool result.
   * @returns Formatted text output.
   */
  private extractToolOutput(toolResult: GetToolResponse<string> | { data: AnyToolResponse | TextResponse; isError?: boolean; _meta?: any }): string {
    if (!toolResult || !toolResult.data) {
      return 'No output from tool';
    }
    
    if (toolResult.isError) {
      return `Tool error: ${this.formatErrorData(toolResult.data)}`;
    }
    
    const { data } = toolResult;
    
    const isWebSearchResponse = 'results' in data && Array.isArray((data).results) && 'query' in data && 'response_time' in data;
    if (isWebSearchResponse) {
      return this.formatWebSearchResponse(data as WebSearchResponse);
    }
    
    const isWebExtractResponse = 'results' in data && Array.isArray((data).results) && 'failed_results' in data && 'response_time' in data;
    if (isWebExtractResponse) {
      return this.formatWebExtractResponse(data as WebExtractResponse);
    }
    
    const isSmartHomeResponse = 'devices' in data && Array.isArray((data).devices) && 'timestamp' in data;
    if (isSmartHomeResponse) {
      return this.formatSmartHomeResponse(data as SmartHomeResponse);
    }
    
    const isPersonalDataResponse = 'data' in data && 'categories' in data && 'context' in data && Array.isArray((data).categories);
    if (isPersonalDataResponse) {
      return this.formatPersonalDataResponse(data as PersonalDataResponse);
    }
    
    const isTextResponse = 'text' in data && typeof (data).text === 'string';
    if (isTextResponse) {
      return (data as TextResponse).text;
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
    
    output += `Found ${response.results.length} result(s):\n\n`;
    response.results.forEach((result, index) => {
      output += `${index + 1}. ${result.title}\n`;
      output += `   URL: ${result.url}\n`;
      output += `   Score: ${result.score}\n`;
      output += `   Content: ${result.content}\n`;
      output += `   Raw Content: ${result.raw_content}\n`;
      output += '\n';
    });
    
    // Show auto parameters if present
    if (response.auto_parameters) {
      output += `Auto Parameters: ${JSON.stringify(response.auto_parameters)}\n`;
    }
    
    return output;
  }
  
  /**
   * Format web extract response for display (Tavily extract API format)
   */
  private formatWebExtractResponse(response: WebExtractResponse): string {
    let output = `Web Content Extraction Results (${response.response_time}s):\n\n`;
    
    // Display successful extractions
    if (response.results.length > 0) {
      output += `Successfully extracted ${response.results.length} URL(s):\n\n`;
      
      response.results.forEach((result, index) => {
        output += `${index + 1}. ${result.url}\n`;
        output += `   Content: ${result.raw_content}\n`;
        output += '\n';
      });
    } else {
      output += 'No URLs were successfully extracted.\n\n';
    }
    
    // Display failed extractions
    if (response.failed_results.length > 0) {
      output += `Failed to extract ${response.failed_results.length} URL(s):\n\n`;
      response.failed_results.forEach((failed, index) => {
        output += `${index + 1}. ${failed.url}\n`;
        output += `   Error: ${failed.error}\n\n`;
      });
    }
    
    return output;
  }
  
  /**
   * Format smart home response for display
   */
  private formatSmartHomeResponse(response: SmartHomeResponse): string {
    let output = `Smart Home Status (${response.timestamp}):\n\n`;
    
    response.devices.forEach((device, index) => {
      output += `${index + 1}. ${device.name} (${device.type})\n`;
      output += `   ID: ${device.id}\n`;
      output += `   Status: ${device.status}\n`;
      if (device.data) {
        output += `   Data: ${JSON.stringify(device.data, null, 2)}\n`;
      }
      output += '\n';
    });
    
    return output;
  }
  
  /**
   * Format personal data response for display
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
      return (data as TextResponse).text;
    }
    if (typeof data === 'string') {
      return data;
    }
    return JSON.stringify(data);
  }
}