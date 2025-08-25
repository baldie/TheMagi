import { MagiName } from '../../types/magi-types';
import { ToolRegistry } from './tool-registry';
import type { McpServerConfig } from '../index';

/**
 * Melchior's intuitive tools - focused on personal data about the user
 * 
 * Tools assigned: access-data, communicate
 * - Access user personal data and preferences
 * - User context and behavioral insights
 * - Core agentic tools for user interaction
 */

/**
 * Get Melchior's tool assignments from the registry
 */
export function getMelchiorToolAssignments(): string[] {
  return ['access-data', 'communicate', 'process-info'];
}

/**
 * Get MCP server configurations needed for Melchior's tools
 */
export function getMelchiorToolServers(): McpServerConfig[] {
  return ToolRegistry.getServersForMagi(MagiName.Melchior).map(server => ({
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args,
    env: server.env ? {
      ...process.env,
      ...server.env
    } as Record<string, string> : undefined,
    url: server.url,
    headers: server.headers
  }));
}