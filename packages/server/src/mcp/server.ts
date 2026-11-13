import { McpServer } from '@modelcontextprotocol/server';
import type { Bridge } from '../bridge/bridge.ts';
import { registerTools, type ToolOptions } from './tools.ts';

const instructions = [
  "These tools drive the user's own browser through the itsme extension.",
  'They only reach tabs in the browser\'s "itsme" tab group: tabs_open and page_navigate put',
  'new tabs there, and the user can share an existing tab from the extension popup.',
  'Call page_snapshot or page_find to get element refs before acting on the page.',
  'Use batch to run steps that need no reading in between in one call.',
  'On NOT_CONNECTED, ask the user to open the browser and enable the extension.',
  'On TAB_NOT_SHARED, ask the user to share that tab.',
  'On SITE_NOT_ALLOWED, ask the user to allow the site: a prompt is waiting on the page.',
].join(' ');

export function createMcpServer(
  bridge: Bridge,
  version: string,
  options: ToolOptions = { uploadDirs: [] },
): McpServer {
  const server = new McpServer({ name: 'itsme', version }, { instructions });
  registerTools(server, bridge, options);
  return server;
}
