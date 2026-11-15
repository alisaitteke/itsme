import {
  type Automation,
  BridgeError,
  type CommandInput,
  type CommandName,
  type CommandResult,
  commands,
  describeSchedule,
  describeStep,
  toWireError,
} from '@itsme/protocol';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Bridge } from '../bridge/bridge.ts';
import { readUploads } from './uploads.ts';

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
type Args = Record<string, unknown>;

// A type alias, not an interface: the SDK's result type has an index signature, which
// only an alias is assignable to.
type ToolResult = {
  content: Content[];
  isError?: boolean;
};

interface Tool {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  /** Absent for a tool that takes no arguments. */
  schema?: z.ZodType<Args>;
  /** Throws for a failure; `run` callers turn that into an error result. */
  run(bridge: Bridge, args: Args): Promise<ToolResult>;
}

export interface ToolOptions {
  /** Folders `page_upload` may read from; empty turns uploads off. */
  uploadDirs: readonly string[];
}

interface CommandToolDef<N extends CommandName> {
  command: N;
  title: string;
  description: string;
  readOnly?: boolean;
  /** Defaults to the result as JSON, or "OK" when the command returns nothing. */
  format?: (result: CommandResult<N>) => Content[];
}

const MAX_BATCH_STEPS = 20;

const text = (value: string): Content[] => [{ type: 'text', text: value }];

function errorText(error: unknown): string {
  const { code, message } = toWireError(error);
  return `${code}: ${message}`;
}

function asJson(value: object): Content[] {
  return text(Object.keys(value).length === 0 ? 'OK' : JSON.stringify(value, null, 2));
}

/** The MCP tool is named after its command, with the dot replaced: tabs.list -> tabs_list. */
function tool<N extends CommandName>(def: CommandToolDef<N>): Tool {
  return {
    name: def.command.replace('.', '_'),
    title: def.title,
    description: def.description,
    readOnly: def.readOnly ?? false,
    schema: commands[def.command].params as z.ZodType<Args>,
    async run(bridge, args) {
      const result = await bridge.call(def.command, args as CommandInput<N>);
      return { content: def.format ? def.format(result) : asJson(result) };
    },
  };
}

function page(header: { url: string; title: string }, body: string, note: string | false) {
  return text(
    [`URL: ${header.url}`, `Title: ${header.title}`, '', body, ...(note ? ['', note] : [])].join(
      '\n',
    ),
  );
}

function formatRequest(request: CommandResult<'page.network'>['requests'][number]): string {
  const outcome = request.error ? `FAILED ${request.error}` : (request.status ?? 'pending');
  const details = [
    request.type,
    ...(request.durationMs === undefined ? [] : [`${request.durationMs} ms`]),
    ...(request.bytes === undefined ? [] : [`${request.bytes} B`]),
  ];
  return `${outcome} ${request.method} ${request.url} (${details.join(', ')})`;
}

const STATUS_WORDS: Record<Automation['status'], string> = {
  pending: 'waiting for the user to approve it',
  on: 'on',
  paused: 'paused',
};

function describeAutomation(automation: Automation): string {
  const last = automation.history.at(-1);
  const because = automation.pausedBecause ? ` (${automation.pausedBecause})` : '';
  return [
    `[${automation.id}] ${JSON.stringify(automation.name)}: ${STATUS_WORDS[automation.status]}${because}`,
    `  ${describeSchedule(automation.schedule)}, on ${automation.url}`,
    ...automation.steps.map((step, index) => `  ${index + 1}. ${describeStep(step)}`),
    last
      ? `  ${automation.runs} run(s); the latest ${last.ok ? 'worked' : `failed: ${last.note ?? 'no reason given'}`} at ${new Date(last.at).toISOString()}`
      : '  Has not run yet',
  ].join('\n');
}

const APPROVAL_NOTE =
  'It will not run until the user approves it. Ask them to press the itsme toolbar button, ' +
  'open Automations and press Approve. You cannot approve it yourself.';

const browserStatus: Tool = {
  name: 'browser_status',
  title: 'Browser status',
  description: 'Report whether a browser is connected to the bridge, and which one.',
  readOnly: true,
  run: async (bridge) => ({ content: asJson(await bridge.status()) }),
};

const uploadSchema = z.object({
  tabId: commands['page.upload'].params.shape.tabId,
  ref: commands['page.upload'].params.shape.ref,
  paths: z.array(z.string()).min(1).max(10).describe('Absolute paths of the files to upload'),
});

function uploadTool(options: ToolOptions): Tool {
  return {
    name: 'page_upload',
    title: 'Upload files',
    description:
      'Put local files into a file input (role "fileinput" in page_snapshot), as if picked in ' +
      'the file dialog. Do not click the input instead: that opens a dialog nobody can answer. ' +
      'Only files in folders the user has allowed can be uploaded.',
    readOnly: false,
    schema: uploadSchema as z.ZodType<Args>,
    async run(bridge, args) {
      const { tabId, ref, paths } = args as z.infer<typeof uploadSchema>;
      const files = await readUploads(paths, options.uploadDirs);
      await bridge.call('page.upload', { tabId, ref, files });
      return { content: text(`Uploaded ${files.map((file) => file.name).join(', ')}`) };
    },
  };
}

const POINTER_TARGET = 'Target an element by ref, or a point by x and y from page_screenshot.';

function pageTools(options: ToolOptions): Tool[] {
  return [
    browserStatus,
    tool({
      command: 'tabs.list',
      title: 'List tabs',
      description:
        'List the tabs in itsme tab groups, with the group each is in. Other tabs are out of reach.',
      readOnly: true,
    }),
    tool({
      command: 'tabs.open',
      title: 'Open tab',
      description:
        'Open a URL in a new tab and wait for it to load. The tab goes into the "itsme" tab ' +
        'group, or into the group named by `group`, which is created if needed. Give tabs of ' +
        'one task the same group, with a color that suits the topic.',
    }),
    tool({
      command: 'tabs.group',
      title: 'Group tabs',
      description:
        'Move itsme tabs into a named tab group, creating it if needed, or give an existing ' +
        'group another color. Only tabs itsme already has can be moved.',
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
      command: 'page.annotate',
      title: 'Annotate page',
      description:
        'Draw on the page for the user to see: mark passages with a highlighter, an underline, ' +
        'a box, a circle or a bracket, and list them in a numbered legend at the side of the page. ' +
        'Use it to put a summary on the page itself, or to point at the place that answers a ' +
        'question (one mark, style circle). Quote text as page_text gives it; the page scrolls to ' +
        'the first mark. Marks stay until the page is left or the user clears them.',
      format: ({ marked, missing }) =>
        text(
          [
            marked === 0 && missing.length === 0 ? 'Marks removed' : `Marked ${marked}`,
            ...(missing.length > 0
              ? [
                  `Not found on the page: ${missing.join(', ')}. They are in the legend without ` +
                    'a place. Quote the text exactly as page_text shows it, or mark an element by ref.',
                ]
              : []),
          ].join('\n'),
        ),
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
      command: 'page.wait',
      title: 'Wait',
      description:
        'Wait until some text appears on the page (or disappears), or just for a moment. ' +
        'Use it after an action whose result takes time to show.',
      readOnly: true,
      format: ({ met }) => text(met ? 'OK' : 'Timed out: the page did not change as expected'),
    }),
    uploadTool(options),
    tool({
      command: 'page.console',
      title: 'Console',
      description:
        'Console messages and uncaught errors of the page. The first call on a tab starts the ' +
        'recording and still returns what the page logged before. Chromium only.',
      readOnly: true,
      format: ({ entries, total }) =>
        text(
          entries.length === 0
            ? 'No console messages'
            : [
                ...(total > entries.length ? [`Newest ${entries.length} of ${total}:`] : []),
                ...entries.map(
                  (entry) =>
                    `[${entry.level}] ${entry.text}${entry.source ? ` (${entry.source})` : ''}`,
                ),
              ].join('\n'),
        ),
    }),
    tool({
      command: 'page.network',
      title: 'Network',
      description:
        'Requests the page made: status, method, URL, type, time and size. Only requests after ' +
        'the first call on a tab are recorded, so call it once and then reload with ' +
        'page_navigate to capture a page load. Credentials in URLs are redacted. Chromium only.',
      readOnly: true,
      format: ({ requests, total, recordingMs }) =>
        text(
          [
            `Recording for ${Math.round(recordingMs / 1000)} s; earlier requests are not listed.`,
            ...(total > requests.length ? [`Newest ${requests.length} of ${total}:`] : []),
            ...(requests.length === 0 ? ['No requests recorded'] : requests.map(formatRequest)),
          ].join('\n'),
        ),
    }),
    tool({
      command: 'automation.create',
      title: 'Create automation',
      description:
        'Save steps for the browser to repeat by itself on a schedule, with no AI app running: ' +
        'every day at a time, or every few seconds. Work through the steps with the page tools ' +
        'first, then save what worked. A step names its element by the role and name ' +
        'page_snapshot prints, e.g. `[e5] button "Check in"` is {role: "button", name: "Check in"}; ' +
        'refs do not last. The user has to approve it in the extension before it runs. ' +
        'Automations run only on the sites of their own URLs and never type into password fields.',
      format: ({ automation }) => text(`${describeAutomation(automation)}\n\n${APPROVAL_NOTE}`),
    }),
    tool({
      command: 'automation.list',
      title: 'List automations',
      description: 'List the saved automations with their schedule, status and latest run.',
      readOnly: true,
      format: ({ automations }) =>
        text(
          automations.length === 0
            ? 'No automations'
            : automations.map(describeAutomation).join('\n\n'),
        ),
    }),
    tool({
      command: 'automation.pause',
      title: 'Pause automation',
      description:
        'Stop an automation from running. Only the user can turn it back on, in the extension.',
      format: ({ automation }) => text(describeAutomation(automation)),
    }),
    tool({
      command: 'automation.remove',
      title: 'Remove automation',
      description: 'Delete an automation and close its tab.',
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
}

const batchSchema = z.object({
  steps: z
    .array(
      z.object({
        tool: z.string().describe('Name of another tool, e.g. page_click'),
        args: z.record(z.string(), z.unknown()).default({}).describe("That tool's arguments"),
      }),
    )
    .min(1)
    .max(MAX_BATCH_STEPS),
});

/** Runs other tools back to back, saving a round trip per step. */
function batchTool(tools: readonly Tool[]): Tool {
  const byName = new Map(tools.map((entry) => [entry.name, entry]));
  return {
    name: 'batch',
    title: 'Batch',
    description:
      'Run several tools in one call, in order, stopping at the first failure. Use it when ' +
      'the steps do not depend on reading an earlier result, e.g. type, click, wait, snapshot.',
    readOnly: false,
    schema: batchSchema as z.ZodType<Args>,
    async run(bridge, args) {
      const { steps } = args as z.infer<typeof batchSchema>;
      const content: Content[] = [];
      for (const [index, step] of steps.entries()) {
        const label = `${index + 1}. ${step.tool}`;
        try {
          const target = byName.get(step.tool);
          if (!target) throw new BridgeError('INVALID_PARAMS', `No tool named "${step.tool}"`);
          // A direct call gets this from the MCP layer; here it has to be done by hand.
          const parsed = target.schema ? target.schema.parse(step.args) : {};
          const result = await target.run(bridge, parsed);
          content.push(...text(`--- ${label} ---`), ...result.content);
        } catch (error) {
          const left = steps.length - index - 1;
          const skipped = left > 0 ? ` ${left} later step(s) were not run.` : '';
          content.push(...text(`--- ${label} failed ---\n${errorText(error)}${skipped}`));
          return { content, isError: true };
        }
      }
      return { content };
    },
  };
}

export function registerTools(server: McpServer, bridge: Bridge, options: ToolOptions): void {
  const tools = pageTools(options);
  for (const entry of [...tools, batchTool(tools)]) {
    const config = {
      title: entry.title,
      description: entry.description,
      annotations: { readOnlyHint: entry.readOnly, openWorldHint: true },
    };
    const run = async (args: Args): Promise<ToolResult> => {
      try {
        return await entry.run(bridge, args);
      } catch (error) {
        return { isError: true, content: text(errorText(error)) };
      }
    };
    // A tool with no input schema is called with no arguments at all.
    if (entry.schema) {
      server.registerTool(entry.name, { ...config, inputSchema: entry.schema }, (args) =>
        run(args),
      );
    } else {
      server.registerTool(entry.name, config, () => run({}));
    }
  }
}
