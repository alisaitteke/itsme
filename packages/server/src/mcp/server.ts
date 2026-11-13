import { McpServer } from '@modelcontextprotocol/server';
import type { Bridge } from '../bridge/bridge.ts';
import { registerTools } from './tools.ts';

const instructions = [
  "These tools drive the user's own browser through the itsme extension.",
  'Call page_snapshot before page_click or page_type to get element refs.',
  'If a tool reports NOT_CONNECTED, ask the user to open the browser and enable the extension.',
].join(' ');

export function createMcpServer(bridge: Bridge, version: string): McpServer {
  const server = new McpServer({ name: 'itsme', version }, { instructions });
  registerTools(server, bridge);
  return server;
}
