import { z } from 'zod';

const httpUrl = z.string().refine(
  (value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  },
  { error: 'Must be an http(s) URL' },
);

const tabId = z.number().int().describe('Tab id from tabs_list');
const optionalTabId = tabId
  .optional()
  .describe('Tab id from tabs_list; defaults to the active tab');
const ref = z.string().describe('Element ref from page_snapshot');

export const tabSchema = z.object({
  id: z.number().int(),
  windowId: z.number().int(),
  url: z.string(),
  title: z.string(),
  active: z.boolean(),
});
export type Tab = z.infer<typeof tabSchema>;

export const elementSchema = z.object({
  ref: z.string(),
  role: z.string(),
  name: z.string(),
  value: z.string().optional(),
});
export type SnapshotElement = z.infer<typeof elementSchema>;

function command<P extends z.ZodType, R extends z.ZodType>(def: { params: P; result: R }) {
  return def;
}

const tabResult = z.object({ tab: tabSchema });
const empty = z.object({});

export const commands = {
  'tabs.list': command({
    params: empty,
    result: z.object({ tabs: z.array(tabSchema) }),
  }),
  'tabs.open': command({
    params: z.object({
      url: httpUrl,
      active: z.boolean().default(true).describe('Focus the new tab'),
    }),
    result: tabResult,
  }),
  'tabs.close': command({
    params: z.object({ tabId }),
    result: empty,
  }),
  'tabs.activate': command({
    params: z.object({ tabId }),
    result: tabResult,
  }),
  'page.navigate': command({
    params: z.object({ tabId: optionalTabId, url: httpUrl }),
    result: tabResult,
  }),
  'page.history': command({
    params: z.object({ tabId: optionalTabId, direction: z.enum(['back', 'forward']) }),
    result: tabResult,
  }),
  'page.snapshot': command({
    params: z.object({
      tabId: optionalTabId,
      maxTextLength: z.number().int().min(0).max(200_000).default(20_000),
    }),
    result: z.object({
      url: z.string(),
      title: z.string(),
      text: z.string(),
      truncated: z.boolean(),
      elements: z.array(elementSchema),
    }),
  }),
  'page.click': command({
    params: z.object({ tabId: optionalTabId, ref }),
    result: empty,
  }),
  'page.type': command({
    params: z.object({
      tabId: optionalTabId,
      ref,
      text: z.string(),
      clear: z.boolean().default(true).describe('Replace the current value instead of appending'),
      submit: z.boolean().default(false).describe('Press Enter afterwards'),
    }),
    result: empty,
  }),
  'page.screenshot': command({
    params: z.object({ tabId: optionalTabId }),
    result: z.object({
      mimeType: z.string(),
      data: z.string().describe('Base64 image data'),
    }),
  }),
} as const;

export type CommandName = keyof typeof commands;
/** Params as a caller writes them, defaults still optional. */
export type CommandInput<N extends CommandName> = z.input<(typeof commands)[N]['params']>;
/** Params as a handler receives them, defaults applied. */
export type CommandParams<N extends CommandName> = z.output<(typeof commands)[N]['params']>;
export type CommandResult<N extends CommandName> = z.output<(typeof commands)[N]['result']>;

export const commandNames = Object.keys(commands) as CommandName[];

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(commands, name);
}
