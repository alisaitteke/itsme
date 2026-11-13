import {
  type CommandInput,
  type CommandName,
  type CommandResult,
  commands,
  toWireError,
} from '@itsme/protocol';
import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { Bridge } from '../bridge/bridge.ts';

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

interface ToolDef<N extends CommandName> {
  command: N;
  title: string;
  description: string;
  readOnly?: boolean;
  /** Defaults to the result as pretty-printed JSON. */
  format?: (result: CommandResult<N>) => Content[];
}

type Registrar = (server: McpServer, bridge: Bridge) => void;

function errorResult(error: unknown) {
  const { code, message } = toWireError(error);
  return { isError: true, content: [{ type: 'text' as const, text: `${code}: ${message}` }] };
}

const asJson = (value: unknown): Content[] => [
  { type: 'text', text: JSON.stringify(value, null, 2) },
];

/** The MCP tool is named after its command, with the dot replaced: tabs.list -> tabs_list. */
function tool<N extends CommandName>(def: ToolDef<N>): Registrar {
  return (server, bridge) => {
    server.registerTool(
      def.command.replace('.', '_'),
      {
        title: def.title,
        description: def.description,
        // The SDK has already validated args against this schema when the callback runs.
        inputSchema: commands[def.command].params as z.ZodType<Record<string, unknown>>,
        annotations: { readOnlyHint: def.readOnly ?? false, openWorldHint: true },
      },
      async (args) => {
        try {
          const result = await bridge.call(def.command, args as CommandInput<N>);
          return { content: def.format ? def.format(result) : asJson(result) };
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  };
}

function formatSnapshot(snapshot: CommandResult<'page.snapshot'>): Content[] {
  const elements = snapshot.elements.map((element) => {
    const value = element.value === undefined ? '' : ` value=${JSON.stringify(element.value)}`;
    return `[${element.ref}] ${element.role} ${JSON.stringify(element.name)}${value}`;
  });
  const text = [
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    '',
    'Interactive elements:',
    ...(elements.length > 0 ? elements : ['(none)']),
    '',
    snapshot.truncated ? 'Text (truncated):' : 'Text:',
    snapshot.text,
  ].join('\n');
  return [{ type: 'text', text }];
}

const browserStatus: Registrar = (server, bridge) => {
  server.registerTool(
    'browser_status',
    {
      title: 'Browser status',
      description: 'Report whether a browser is connected to the bridge, and which one.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return { content: asJson(await bridge.status()) };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
};

const registrars: Registrar[] = [
  browserStatus,
  tool({
    command: 'tabs.list',
    title: 'List tabs',
    description: 'List the open tabs in every window.',
    readOnly: true,
  }),
  tool({
    command: 'tabs.open',
    title: 'Open tab',
    description: 'Open a URL in a new tab and wait for it to load.',
  }),
  tool({ command: 'tabs.close', title: 'Close tab', description: 'Close a tab.' }),
  tool({
    command: 'tabs.activate',
    title: 'Activate tab',
    description: 'Bring a tab and its window to the front.',
  }),
  tool({
    command: 'page.navigate',
    title: 'Navigate',
    description: 'Load a URL in a tab and wait for it to finish loading.',
  }),
  tool({
    command: 'page.history',
    title: 'Back / forward',
    description: 'Go back or forward in the tab history.',
  }),
  tool({
    command: 'page.snapshot',
    title: 'Page snapshot',
    description:
      'Read the visible text of a page and list its interactive elements. ' +
      'Each element has a ref for page_click and page_type; refs are valid until the page navigates.',
    readOnly: true,
    format: formatSnapshot,
  }),
  tool({
    command: 'page.click',
    title: 'Click',
    description: 'Click an element by its ref from page_snapshot.',
  }),
  tool({
    command: 'page.type',
    title: 'Type',
    description: 'Type text into an input, textarea or editable element by its ref.',
  }),
  tool({
    command: 'page.screenshot',
    title: 'Screenshot',
    description: 'Capture the visible area of a tab. The tab is brought to the front first.',
    readOnly: true,
    format: (shot) => [{ type: 'image', data: shot.data, mimeType: shot.mimeType }],
  }),
];

export function registerTools(server: McpServer, bridge: Bridge): void {
  for (const register of registrars) register(server, bridge);
}
