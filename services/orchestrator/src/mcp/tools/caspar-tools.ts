import { MagiName } from '../../types/magi-types';
import { ToolRegistry } from './tool-registry';
import { McpServerConfig } from '../index';

/**
 * Caspar's practical tools - focused on smart home devices, system status, and integration data
 * 
 * Tools assigned: smart-home-devices, ask-user, answer-user
 * - Query and control smart home devices
 * - System status and environmental monitoring
 * - Core agentic tools for user interaction
 */

/**
 * Get Caspar's tool assignments from the registry
 */
export function getCasparToolAssignments(): string[] {
  return ['smart-home-devices', 'ask-user', 'answer-user'];
}

/**
 * Get MCP server configurations needed for Caspar's tools
 */
export function getCasparTools(): McpServerConfig[] {
  return ToolRegistry.getServersForMagi(MagiName.Caspar).map(server => ({
    name: server.name,
    command: server.command,
    args: server.args,
    env: {
      ...process.env,
      ...server.env
    } as Record<string, string>
  }));
}