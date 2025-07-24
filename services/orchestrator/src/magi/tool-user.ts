import { logger } from '../logger';
import { mcpClientManager, McpToolInfo } from '../mcp';
import { Magi, AgenticTool } from './magi';
import { WebSearchResponse, WebExtractResponse, SmartHomeResponse, PersonalDataResponse, TextResponse, GetToolResponse, AnyToolResponse } from '../mcp/tool-response-types';
import { MagiErrorHandler } from './error-handler';

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
 * First-pass prompt to isolate the main body of content from a raw, markdown-formatted webpage extract.
 * Its only job is to remove in-content promotional material, unrelated article links, and other boilerplate.
 */
export function getCoreContentPrompt(rawToolResponse: string): string {
  return `
  PERSONA:
  You are an expert content extraction AI. Your specialty is parsing pre-processed text from webpages to distinguish the primary content (like an article) from surrounding promotional text, boilerplate, and unrelated links, even when they are mixed together.

  INSTRUCTIONS:
  1.  Analyze the RAW TEXT provided below.
  2.  Your sole mission is to identify and extract the main, primary article or content.
  3.  DELETE any text that is promotional, an advertisement, or a call-to-action for a different service (e.g., text about a moving company in an article about cities).
  4.  DELETE lists of "Recent Posts," "Related Articles," or similar sections.
  5.  DELETE social media links and contact information that is not part of the core content.
  6.  DO NOT summarize, edit, or alter the main content. Preserve its original wording and paragraphs.
  7.  Respond ONLY with the cleaned main content.

  EXAMPLE:
  ---
  RAW TEXT:
  "**The Best Cities to Live in on the East Coast**

  Are you considering moving to the East Coast? With its rich history, diverse culture, and exciting lifestyle, it's no wonder why many people make this region their home. But with so many great cities to choose from, which one is right for you?

  Here are some of the best cities to live in on the East Coast:

  1. **New York City**: The Big Apple offers an unparalleled urban experience, with world-class museums, restaurants, and entertainment options.
  2. **Washington D.C.**: Our nation's capital is a hub of politics, culture, and history, with plenty of opportunities for career advancement and personal growth.
  3. **Boston**: Known for its prestigious universities and rich history, Boston is a great place to live for students and professionals alike.
  4. **Orlando**: With its theme parks, beautiful beaches, and vibrant nightlife, Orlando is a top destination for families and young adults.
  5. **Jacksonville**: This affordable city on the Atlantic coast offers a relaxed lifestyle, with plenty of outdoor activities and cultural attractions.

  **Why Choose Georgetown Moving?**

  At Georgetown Moving, we understand the importance of making your move as stress-free as possible. That's why we offer:

  * **Affordable prices**: We strive to provide the best value for our customers without sacrificing quality.
  * **Professional crews**: Our team is dedicated to delivering a smooth and efficient moving experience.
  * **State-of-the-art equipment**: We use only the latest technology to ensure your belongings are handled with care.

  **Get a Free Estimate Today!**

  Ready to start planning your move? Contact us online or call (703) 889-8899 to learn more about our services, including storage solutions. Don't wait – get a free estimate today and take the first step towards making your East Coast dream a reality!

  **Recent Posts**

  * **How to Prepare for a Stress-Free Local Move in Washington, D.C.**
  * **Long-Distance Moves Made Easy: How to Prepare and What to Expect**
  * **The Ultimate Guide To Stress-Free Moving: Tips And Tricks For A Smooth Transition**

  **Get Social!**

  Follow us on social media to stay up-to-date on the latest moving tips and trends:

  * [Facebook](https://www.facebook.com/georgetownmoving)
  * [Instagram](https://www.instagram.com/georgetownmoving)
  * [Twitter](https://twitter.com/georgetownmoving)"

  CLEANED CORE CONTENT:
  "**The Best Cities to Live in on the East Coast**

  Are you considering moving to the East Coast? With its rich history, diverse culture, and exciting lifestyle, it's no wonder why many people make this region their home. But with so many great cities to choose from, which one is right for you?

  Here are some of the best cities to live in on the East Coast:

  1. **New York City**: The Big Apple offers an unparalleled urban experience, with world-class museums, restaurants, and entertainment options.
  2. **Washington D.C.**: Our nation's capital is a hub of politics, culture, and history, with plenty of opportunities for career advancement and personal growth.
  3. **Boston**: Known for its prestigious universities and rich history, Boston is a great place to live for students and professionals alike.
  4. **Orlando**: With its theme parks, beautiful beaches, and vibrant nightlife, Orlando is a top destination for families and young adults.
  5. **Jacksonville**: This affordable city on the Atlantic coast offers a relaxed lifestyle, with plenty of outdoor activities and cultural attractions."
  ---

  Now, perform this task on the following text.

  RAW TEXT:
  ${rawToolResponse}
  `
}

/**
 * Second-pass prompt that takes the *cleaned* content and extracts
 * only the text relevant to the user's original query.
 */
export function getRelevantExtractFromCoreContentPrompt(userMessage: string, coreContent: string): string {
  return `
  PERSONA:
  You are a research assistant AI. You are adept at reading a body of text and extracting the specific passages that are directly relevant to a topic or question.

  CONTEXT:
  Consider the following topic/question: "${userMessage}"

  INSTRUCTIONS:
  I will now share with you a body of text. Your job is to extract only the sentences and paragraphs that are directly associated with the topic/question.
  -   Do not summarize the text; return it verbatim.
  -   Filter out any parts of the text that are off-topic.
  -   If multiple passages are relevant, include them all in the order they appeared.
  -   Only respond with the resulting relevant text.

  BODY OF TEXT:
  ${coreContent}
  `
}

/**
 * ToolUser handles tool identification and execution for the Magi system.
 */
export class ToolUser {
  constructor(private magi: Magi) {}

  /**
   * Gets all the tools that are available for the current Magi persona.   
   * @returns The tool's MCP information
   */
  async getAvailableTools(): Promise<McpToolInfo[]> {
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
    stepDescription: string
  ): Promise<string> {
    try {
      // Initialize MCP client manager if needed
      await mcpClientManager.initialize();
      
      // Execute the tool with Magi-determined arguments
      const toolResult = await mcpClientManager.executeTool(this.magi.name, toolName, toolArguments);
      
      // Extract the text from the typed response object
      return this.extractToolOutput(toolResult);
      
      //return `Tool used: ${toolName}\nArguments: ${JSON.stringify(toolArguments)}\nResult: ${processedOutput}`;
    } catch (error) {
      return MagiErrorHandler.handleToolError(error, {
        magiName: this.magi.name,
        operation: 'tool execution'
      }, stepDescription);
    }
  }

  /**
   * Response type detection strategies
   */
  private responseDetectors = new Map<string, (data: any) => boolean>([
    ['WebSearch', (data) => 'results' in data && Array.isArray(data.results) && 'query' in data && 'response_time' in data],
    ['WebExtract', (data) => 'results' in data && Array.isArray(data.results) && 'failed_results' in data && 'response_time' in data],
    ['SmartHome', (data) => 'devices' in data && Array.isArray(data.devices) && 'timestamp' in data],
    ['PersonalData', (data) => 'data' in data && 'categories' in data && 'context' in data && Array.isArray(data.categories)],
    ['Text', (data) => 'text' in data && typeof data.text === 'string']
  ]);

  /**
   * Response formatters for each type
   */
  private responseFormatters = new Map<string, (data: any) => string>([
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
    if (!toolResult || !toolResult.data) {
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

  /**
   * Extract parameter details from JSON Schema for MCP format
   */
  public extractParameterDetails(inputSchema: JsonSchema | undefined): Record<string, string> {
    if (!inputSchema?.properties) {
      return { query: 'string (required)' };
    }

    const properties = inputSchema.properties;
    const required = inputSchema.required || [];
    
    const parameters: Record<string, string> = {};
    
    Object.entries(properties).forEach(([name, schema]: [string, JsonSchemaProperty]) => {
      const type = schema.type || 'any';
      const isRequired = required.includes(name);
      const defaultValue = schema.default !== undefined ? `, default: ${JSON.stringify(schema.default)}` : '';
      const status = isRequired ? 'required' : 'optional';
      
      // Include enum constraints if present
      const enumConstraint = schema.enum ? ` [options: ${schema.enum.map(v => `"${v}"`).join('|')}]` : '';
      
      // Special handling for common parameter patterns
      let description = '';
      if (name === 'options' && type === 'object') {
        // Check for nested topic enum in options object
        const topicProperty = schema.properties?.topic;
        const topicEnum = topicProperty?.enum ? `topic must be one of: ${topicProperty.enum.map(v => `"${v}"`).join('|')}. ` : '';
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

  async executeAgenticTool(tool: AgenticTool, thought: string, userMessage: string): Promise<string> {
    let toolResponse = await this.executeWithTool(
      tool.name, 
      tool.parameters, 
      thought
    );

    // Web pages can have a lot of noise that throw off the magi, so lets clean it
    if (tool.name == 'tavily-extract'){
      logger.debug(`☑️☑️☑️Raw web-extract retreived:\n${toolResponse}`);
      const contentOnlyPrompt = getCoreContentPrompt(toolResponse);
      toolResponse = await this.magi.contactWithoutPersonality(contentOnlyPrompt);
      logger.debug(`☑️☑️☑️Content reduced to:\n${toolResponse}`);
      const relevantTextOnlyPrompt = getRelevantExtractFromCoreContentPrompt(userMessage, toolResponse);
      toolResponse = await this.magi.contactWithoutPersonality(relevantTextOnlyPrompt);
      logger.debug(`☑️☑️☑️Further refined for relevancy:\n${toolResponse}`);
    }

    // Summarize the data we recieved back in human readable form.
    if (tool.name == "personal-data") {
      logger.debug(`Raw personal-data retreived: ${toolResponse}`);
      const summarize = `You have just completed the following task:\n${thought}\nThis resulted in:\n${toolResponse}\n\nNow, concisely summarize the action and result(s) in plain language.`;
      logger.debug(`Summary prompt:\n${summarize}`);
      toolResponse = await this.magi.contactWithoutPersonality(summarize);
    }
    return toolResponse;
  }
}