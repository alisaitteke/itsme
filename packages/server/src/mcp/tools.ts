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
  /** Defaults to the result as JSON, or "OK" when the command returns nothing. */
  format?: (result: CommandResult<N>) => Content[];
}

type Registrar = (server: McpServer, bridge: Bridge) => void;

const text = (value: string): Content[] => [{ type: 'text', text: value }];

function errorResult(error: unknown) {
  const { code, message } = toWireError(error);
  return { isError: true, content: text(`${code}: ${message}`) };
}

function asJson(value: object): Content[] {
  return text(Object.keys(value).length === 0 ? 'OK' : JSON.stringify(value, null, 2));
}

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

function page(header: { url: string; title: string }, body: string, note: string | false) {
  return text(
    [`URL: ${header.url}`, `Title: ${header.title}`, '', body, ...(note ? ['', note] : [])].join(
      '\n',
    ),
  );
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

const POINTER_TARGET = 'Target an element by ref, or a point by x and y from page_screenshot.';

const registrars: Registrar[] = [
  browserStatus,
  tool({
    command: 'tabs.list',
    title: 'List tabs',
    description: 'List the tabs in the itsme tab group. Other tabs are out of reach.',
    readOnly: true,
  }),
  tool({
    command: 'tabs.open',
    title: 'Open tab',
    description: 'Open a URL in a new tab of the itsme tab group and wait for it to load.',
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
    description:
      'Load a URL in a tab and wait for it to finish loading. Opens a tab if none is open yet.',
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
      'Outline of the page: headings, text, links, buttons and fields, indented by structure. ' +
      'Each element has a ref for the other page tools; refs are valid until the page navigates. ' +
      'Reads into same-origin iframes and open shadow DOM.',
    readOnly: true,
    format: (snapshot) =>
      page(
        snapshot,
        snapshot.outline || '(nothing to show)',
        snapshot.truncated && 'Truncated. Pass ref to read one part, or raise maxChars.',
      ),
  }),
  tool({
    command: 'page.find',
    title: 'Find on page',
    description:
      'Find elements whose role, name, value or text contains the query (case-insensitive). ' +
      'Cheaper than a snapshot when you know what you are looking for.',
    readOnly: true,
    format: ({ matches, more }) =>
      text(
        matches.length === 0
          ? 'No match'
          : [
              ...matches.map(
                (match) => `[${match.ref}] ${match.role} ${JSON.stringify(match.name)}`,
              ),
              ...(more ? ['More matches exist; narrow the query.'] : []),
            ].join('\n'),
      ),
  }),
  tool({
    command: 'page.text',
    title: 'Page text',
    description:
      'Readable text of the page, preferring the main article. Use it to read; it has no refs.',
    readOnly: true,
    format: (result) => page(result, result.text, result.truncated && 'Truncated.'),
  }),
  tool({
    command: 'page.click',
    title: 'Click',
    description: `Click, double-click or right-click. ${POINTER_TARGET}`,
  }),
  tool({
    command: 'page.hover',
    title: 'Hover',
    description: `Move the pointer over something, to open a menu or tooltip. ${POINTER_TARGET}`,
  }),
  tool({
    command: 'page.drag',
    title: 'Drag',
    description:
      'Press at one place, move and release at another. Both ends must be visible at once. ' +
      'Needs real input, so Chromium only.',
  }),
  tool({
    command: 'page.scroll',
    title: 'Scroll',
    description: 'Scroll the page, or the scrollable area around an element.',
  }),
  tool({
    command: 'page.type',
    title: 'Type',
    description:
      'Type text into a field by its ref, or into whatever has focus when ref is left out. ' +
      'For a select, the text is the option to pick.',
  }),
  tool({
    command: 'page.press',
    title: 'Press key',
    description: 'Press a key or shortcut in the focused element, e.g. Escape, or a with meta.',
  }),
  tool({
    command: 'page.screenshot',
    title: 'Screenshot',
    description: 'Capture the visible area of a tab. The tab is brought to the front first.',
    readOnly: true,
    format: (shot) => [
      { type: 'image', data: shot.data, mimeType: shot.mimeType },
      {
        type: 'text',
        text: `Viewport ${shot.width}x${shot.height}. Pointer tools take x and y in these pixels.`,
      },
    ],
  }),
];

export function registerTools(server: McpServer, bridge: Bridge): void {
  for (const register of registrars) register(server, bridge);
}
