import { McpServerConfig } from '../index';

/**
 * Balthazar's analytical tools - focused on data gathering, analysis, and fact-checking
 * 
 * Note: Web search functionality is now handled by Tavily MCP server integration.
 * Tools are automatically available through the MCP client manager.
 */

type ToolImplementation = (args: Record<string, any>) => Promise<any>;

/**
 * Register Balthazar's tools and return the implementation map
 */
export function getBalthazarTools(): McpServerConfig[] {

  return [
            {
              name: 'tavily',
              command: 'npx',
              args: ['-y', '@mcptools/mcp-tavily@latest'],
              env: { 
                ...process.env,
                TAVILY_API_KEY: process.env.TAVILY_API_KEY || ''
              } as Record<string, string>
            }
          ]
}