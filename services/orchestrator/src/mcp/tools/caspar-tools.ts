import { MagiName } from '../../types/magi-types';
import { ToolRegistry } from './tool-registry';
import type { McpServerConfig } from '../index';

/**
 * Caspar's practical tools - focused on smart home devices
 * 
 * Tools assigned: smart-home-devices, communicate, process-info
 */

/**
 * Get Caspar's tool assignments from the registry
 */
export function getCasparToolAssignments(): string[] {
  return ['smart-home-devices', 'communicate', 'process-info'];
}

/**
 * Get MCP server configurations needed for Caspar's tools
 */
export function getCasparToolServers(): McpServerConfig[] {
  return ToolRegistry.getServersForMagi(MagiName.Caspar).map(server => ({
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