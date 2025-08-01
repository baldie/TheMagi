import { MagiName } from '../../types/magi-types';
import { ToolRegistry } from './tool-registry';
import { McpServerConfig } from '../index';

/**
 * Balthazar's analytical tools - focused on data gathering, analysis, and fact-checking
 * 
 * Tools assigned: tavily-search, tavily-extract, ask-user, answer-user
 * - Web search for current information and fact-checking
 * - Content extraction from URLs for detailed analysis
 * - Core agentic tools for user interaction
 */

/**
 * Get Balthazar's tool assignments
 */
export function getBalthazarToolAssignments(): string[] {
  return ['tavily-search', 'tavily-extract', 'ask-user', 'answer-user'];
}

/**
 * Get MCP server configurations needed for Balthazar's tools
 */
export function getBalthazarToolServers(): McpServerConfig[] {
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