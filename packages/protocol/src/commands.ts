import { z } from 'zod';
import { automationInputSchema, automationSchema } from './automation.ts';
import { httpUrl } from './url.ts';

const tabId = z.number().int().describe('Tab id from tabs_list');
const optionalTabId = tabId
  .optional()
  .describe('Tab id from tabs_list; defaults to the itsme tab used last');
const ref = z.string().describe('Element ref from page_snapshot or page_find');

/** Where a pointer action lands: an element, or a point in the viewport. */
const target = {
  ref: ref.optional(),
  x: z.number().optional().describe('Viewport x in the pixels of page_screenshot'),
  y: z.number().optional().describe('Viewport y in the pixels of page_screenshot'),
};
const targetSchema = z.object(target);
export type Target = z.infer<typeof targetSchema>;

export const modifierSchema = z.enum(['alt', 'ctrl', 'meta', 'shift']);
export type Modifier = z.infer<typeof modifierSchema>;
const modifiers = z.array(modifierSchema).default([]).describe('Keys held down meanwhile');

/** The colors a browser offers for a tab group. */
export const groupColorSchema = z.enum([
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
]);
export type GroupColor = z.infer<typeof groupColorSchema>;

export const DEFAULT_GROUP = 'itsme';

const groupName = z.string().trim().min(1).max(40);
const groupColor = groupColorSchema
  .optional()
  .describe(
    'Color of the group. Pick one that suits the topic; a new group gets a random one otherwise',
  );

export const tabSchema = z.object({
  id: z.number().int(),
  windowId: z.number().int(),
  url: z.string(),
  title: z.string(),
  active: z.boolean(),
  /** Absent where the browser has no tab groups. */
  group: z.object({ name: z.string(), color: z.string() }).optional(),
});
export type Tab = z.infer<typeof tabSchema>;

export const matchSchema = z.object({
  ref: z.string(),
  role: z.string(),
  name: z.string(),
});
export type Match = z.infer<typeof matchSchema>;

export const markStyleSchema = z.enum(['highlight', 'underline', 'box', 'circle', 'bracket']);
export type MarkStyle = z.infer<typeof markStyleSchema>;

export const markColorSchema = z.enum(['yellow', 'green', 'blue', 'pink', 'orange', 'purple']);
export type MarkColor = z.infer<typeof markColorSchema>;

/** Something on the page to draw on, and what the legend says about it. */
export const markSchema = z.object({
  quote: z
    .string()
    .min(2)
    .max(600)
    .optional()
    .describe('Text to mark, copied from page_text. The first place it appears is marked'),
  ref: ref.optional().describe('Element to mark instead of a quote'),
  label: z.string().trim().min(1).max(60).describe('Short name for the legend'),
  note: z.string().trim().max(300).optional().describe('A sentence for the legend'),
  style: markStyleSchema
    .default('highlight')
    .describe('bracket suits a whole paragraph, circle a single spot to look at'),
  color: markColorSchema.optional().describe('Taken in turn when left out'),
});
export type Mark = z.infer<typeof markSchema>;

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
      group: groupName
        .optional()
        .describe(
          `Tab group for the tab, created if it doesn't exist, e.g. "Flight prices". Defaults to "${DEFAULT_GROUP}"`,
        ),
      color: groupColor,
    }),
    result: tabResult,
  }),
  'tabs.group': command({
    params: z.object({
      tabIds: z.array(tabId).min(1).max(50),
      group: groupName.describe("Tab group to move the tabs to, created if it doesn't exist"),
      color: groupColor,
    }),
    result: z.object({ tabs: z.array(tabSchema) }),
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
      filter: z
        .enum(['all', 'interactive'])
        .default('all')
        .describe('"interactive" lists only links, buttons and fields'),
      ref: ref.optional().describe('Only this element and what is inside it'),
      maxDepth: z.number().int().min(1).max(50).default(50),
      maxChars: z.number().int().min(500).max(200_000).default(30_000),
    }),
    result: z.object({
      url: z.string(),
      title: z.string(),
      outline: z.string(),
      truncated: z.boolean(),
    }),
  }),
  'page.find': command({
    params: z.object({
      tabId: optionalTabId,
      query: z.string().min(1).describe('Text to look for in element names, values and page text'),
    }),
    result: z.object({ matches: z.array(matchSchema), more: z.boolean() }),
  }),
  'page.text': command({
    params: z.object({
      tabId: optionalTabId,
      maxChars: z.number().int().min(0).max(200_000).default(20_000),
    }),
    result: z.object({
      url: z.string(),
      title: z.string(),
      text: z.string(),
      truncated: z.boolean(),
    }),
  }),
  'page.annotate': command({
    params: z.object({
      tabId: optionalTabId,
      title: z.string().trim().min(1).max(60).optional().describe('Heading of the legend'),
      marks: z.array(markSchema).max(30).describe('Give none to remove the marks on the page'),
      keep: z.boolean().default(false).describe('Add to the marks already there'),
    }),
    result: z.object({
      marked: z.number().int(),
      /** Labels of the marks whose quote isn't on the page. */
      missing: z.array(z.string()),
    }),
  }),
  'page.click': command({
    params: z.object({
      tabId: optionalTabId,
      ...target,
      button: z.enum(['left', 'right', 'middle']).default('left'),
      count: z.number().int().min(1).max(3).default(1).describe('2 for a double click'),
      modifiers,
    }),
    result: empty,
  }),
  'page.hover': command({
    params: z.object({ tabId: optionalTabId, ...target }),
    result: empty,
  }),
  'page.drag': command({
    params: z.object({ tabId: optionalTabId, from: targetSchema, to: targetSchema }),
    result: empty,
  }),
  'page.scroll': command({
    params: z.object({
      tabId: optionalTabId,
      ref: ref.optional().describe('Scroll the scrollable area around this element'),
      direction: z.enum(['up', 'down', 'left', 'right']),
      amount: z.number().int().min(1).max(100_000).default(600).describe('Pixels'),
    }),
    result: z.object({ moved: z.boolean().describe('False at the end of the scrollable area') }),
  }),
  'page.type': command({
    params: z.object({
      tabId: optionalTabId,
      ref: ref.optional().describe('Field to type into; defaults to whatever has focus'),
      text: z.string(),
      clear: z.boolean().default(true).describe('Replace the current value instead of appending'),
      submit: z.boolean().default(false).describe('Press Enter afterwards'),
    }),
    result: empty,
  }),
  'page.press': command({
    params: z.object({
      tabId: optionalTabId,
      key: z
        .string()
        .min(1)
        .describe(
          'Key name such as Enter, Escape, Tab, ArrowDown, Backspace, F5, or one character',
        ),
      modifiers,
      count: z.number().int().min(1).max(50).default(1),
    }),
    result: empty,
  }),
  'page.wait': command({
    params: z.object({
      tabId: optionalTabId,
      text: z.string().min(1).optional().describe('Wait until this text is on the page'),
      gone: z.boolean().default(false).describe('Wait until the text has left the page instead'),
      timeoutMs: z
        .number()
        .int()
        .min(100)
        .max(20_000)
        .default(5_000)
        .describe('Longest wait; with no text, simply wait this long'),
    }),
    result: z.object({ met: z.boolean().describe('False when the time ran out first') }),
  }),
  'page.upload': command({
    params: z.object({
      tabId: optionalTabId,
      ref: ref.describe('The file input, from page_snapshot'),
      files: z.array(z.object({ name: z.string(), mimeType: z.string(), data: z.string() })).min(1),
    }),
    result: empty,
  }),
  'page.console': command({
    params: z.object({
      tabId: optionalTabId,
      pattern: z.string().optional().describe('Regular expression the message must match'),
      onlyErrors: z.boolean().default(false),
      limit: z.number().int().min(1).max(500).default(100).describe('Newest messages to return'),
      clear: z.boolean().default(false).describe('Forget the messages after returning them'),
    }),
    result: z.object({
      entries: z.array(
        z.object({
          level: z.enum(['debug', 'info', 'log', 'warning', 'error']),
          text: z.string(),
          source: z.string().optional(),
        }),
      ),
      total: z.number().int(),
    }),
  }),
  'page.network': command({
    params: z.object({
      tabId: optionalTabId,
      urlPattern: z.string().optional().describe('Text the request URL must contain'),
      limit: z.number().int().min(1).max(500).default(100).describe('Newest requests to return'),
      clear: z.boolean().default(false).describe('Forget the requests after returning them'),
    }),
    result: z.object({
      requests: z.array(
        z.object({
          method: z.string(),
          url: z.string(),
          type: z.string(),
          status: z.number().int().optional(),
          error: z.string().optional(),
          durationMs: z.number().optional(),
          bytes: z.number().optional(),
        }),
      ),
      total: z.number().int(),
      recordingMs: z.number().int().describe('How long requests have been recorded'),
    }),
  }),
  'automation.create': command({
    params: automationInputSchema,
    result: z.object({ automation: automationSchema }),
  }),
  'automation.list': command({
    params: empty,
    result: z.object({ automations: z.array(automationSchema) }),
  }),
  'automation.pause': command({
    params: z.object({ id: z.string().describe('Automation id from automation_list') }),
    result: z.object({ automation: automationSchema }),
  }),
  'automation.remove': command({
    params: z.object({ id: z.string().describe('Automation id from automation_list') }),
    result: empty,
  }),
  'page.screenshot': command({
    params: z.object({ tabId: optionalTabId }),
    result: z.object({
      mimeType: z.string(),
      data: z.string().describe('Base64 image data'),
      width: z.number().int(),
      height: z.number().int(),
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
