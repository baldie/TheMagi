import { logger } from '../logger';
import { mcpToolRegistry, McpToolInfo, McpToolExecutionResponse, McpToolContentItem } from '../mcp';
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
  getAvailableTools(): McpToolInfo [] {
    // Tool identification based on step content and Magi specialization
    // Using more specific keyword matching to avoid conflicts
    switch (this.magiName) {
      case MagiName.Balthazar:
        return [{
          name: "web-search",
          description: "Search the web for information",
          inputSchema: {
            parameterName: "query",
            "ARGS": ["Argument1", "Argument2", "..."]
          }
      }];
        
      case MagiName.Melchior:
        return [{
          name: "personal-data",
          description: "Access the user's personal information",
          inputSchema: {
            parameterName: "data",
            "ARGS": ["Argument1", "Argument2", "..."]
          }
      }];
        
      case MagiName.Caspar:
       return [{
          name: "smart-home-devices",
          description: "Manage smart home devices",
          inputSchema: {
            parameterName: "device",
            "ARGS": ["Argument1", "Argument2", "..."]
          }
      }];
        
      default:
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
      // Initialize MCP registry if needed
      await mcpToolRegistry.initialize();
      
      // Execute the tool with Magi-determined arguments
      const toolResult = await mcpToolRegistry.executeTool(this.magiName, toolName, toolArguments);
      
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
      .filter((item: McpToolContentItem) => item.type === 'text')
      .map((item: McpToolContentItem) => item.text)
      .filter((text): text is string => text !== undefined)
      .join('\n');
    
    return textContent || 'Tool executed successfully but returned no text content';
  }
}