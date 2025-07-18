import { logger } from '../logger';
import { mcpClientManager, McpToolInfo } from '../mcp';
import { MagiName } from './magi';
import { WebSearchResponse, WebExtractResponse, SmartHomeResponse, PersonalDataResponse, TextResponse, GetToolResponse, AnyToolResponse } from '../mcp/tool-response-types';

export const TAVILY_SEARCH_INSTRUCTIONS_PROMPT: string = `
query (required): The query string to run a search on. (Type: string)
auto_parameters: When enabled, Search automatically configures search parameters based on your query's content and intent. You can still set other parameters manually, and your explicit values will override the automatic ones. (Type: boolean, Default: false)
topic: The category of the search, which determines the agent used. Supported values are "general" and "news". (Type: string, Default: "general")
days: The number of days back from the current date to include in the results. Available only when using the "news" topic. (Type: number, Default: 7)
time_range: The time range back from the current date. Accepted values include "day", "week", "month", "year" or shorthand values "d", "w", "m", "y". (Type: string, Default: None)
max_results: The maximum number of search results to return. It must be between 0 and 20. (Type: number, Default: 5)
chunks_per_source: Defines the maximum number of relevant content snippets (chunks) returned per source. Chunks are short content snippets (maximum 500 characters each) pulled directly from the source. (Type: number, Default: 3)
include_answer: Include an answer to the query generated by an LLM based on search results. A "basic" (or true) answer is quick but less detailed; an "advanced" answer is more detailed. (Type: boolean or string, Default: false)
`

export const TAVILY_EXTRACT_INSTRUCTIONS_PROMPT: string = `
urls (required): The URL (or a list of URLs, up to 20) from which you want to extract content. (Type: string or list[str])
include_images: A boolean indicating whether to include a list of images extracted from the URLs in the response. (Type: boolean, Default: false)
timeout: A timeout in seconds to be used for the requests to the API. (Type: number, Default: 60)
`

export function getCleanExtractPrompt(inquiry: string, toolResponse: string): string {
  return `
    PERSONA:
    You are familiar with typical web page content and are adept at separating the useful text from the superfluous noise.

    CONTEXT:
    Consider the following inquiry: "${inquiry}"

    INSTRUCTIONS:
    I will now share with you a body of text extracted from a webpage. Your job is to extract the the text that is associated with the inquiry. Do not summarize the text, just include it as-is. Filter out any unrelated text like image URLs, privacy policy information, disclaimers, etc. Only respond with the resulting relevant text verbatim.

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
      return await mcpClientManager.getAvailableTools(this.magiName);
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
    let output = `Personal Data Query\n`;
    output += `Context: ${response.context}\n`;
    output += `Categories: ${response.categories.join(', ')}\n`;
    
    if (response.last_updated) {
      output += `Last Updated: ${response.last_updated}\n`;
    }
    
    output += '\nData:\n';
    output += JSON.stringify(response.data, null, 2);
    
    return output;
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