import { MagiName } from '../../types/magi-types';
import { ToolRegistry, MAGI_TOOL_ASSIGNMENTS } from './tool-registry';
import { McpServerConfig } from '../index';

/**
 * Balthazar's analytical tools - focused on data gathering, analysis, and fact-checking
 * 
 * Tools assigned: tavily-search, tavily-extract
 * - Web search for current information and fact-checking
 * - Content extraction from URLs for detailed analysis
 */

/**
 * Get Balthazar's tool assignments from the registry
 */
export function getBalthazarToolAssignments(): string[] {
  return MAGI_TOOL_ASSIGNMENTS[MagiName.Balthazar];
}

/**
 * Get MCP server configurations needed for Balthazar's tools
 */
export function getBalthazarTools(): McpServerConfig[] {
  return ToolRegistry.getServersForMagi(MagiName.Balthazar).map(server => ({
    name: server.name,
    command: server.command,
    args: server.args,
    env: {
      ...process.env,
      ...server.env
    } as Record<string, string>
  }));
}