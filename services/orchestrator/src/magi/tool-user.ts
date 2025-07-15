import { logger } from '../logger';
import { mcpClientManager, McpToolInfo, McpToolExecutionResponse } from '../mcp';
import { MagiName } from './magi';

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
  async executeWithTool(
    toolName: string, 
    toolArguments: Record<string, any>,
    stepDescription: string
  ): Promise<string> {
    try {
      // Initialize MCP client manager if needed
      await mcpClientManager.initialize();
      
      // Execute the tool with Magi-determined arguments
      const toolResult = await mcpClientManager.executeTool(this.magiName, toolName, toolArguments);
      
      // Process tool output
      const processedOutput = this.processToolOutput(toolResult);
      
      return `Tool used: ${toolName}\nArguments: ${JSON.stringify(toolArguments)}\nResult: ${processedOutput}`;
    } catch (error) {
      logger.error(`${this.magiName} tool execution failed:`, error);
      // Fallback to reasoning-based approach
      return `Tool execution failed, proceeding with reasoning-based analysis for: ${stepDescription}`;
    }
  }

  /**
   * Process tool output into a readable format.
   * @param toolResult - The raw tool result from MCP.
   * @returns Formatted text output.
   */
  private processToolOutput(toolResult: McpToolExecutionResponse): string {
    if (!toolResult || !toolResult.content) {
      return 'No output from tool';
    }
    
    // Extract text content from MCP tool result
    const textContent = toolResult.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .filter((text): text is string => text !== undefined)
      .join('\n');
    
    return textContent || 'Tool executed successfully but returned no text content';
  }
}