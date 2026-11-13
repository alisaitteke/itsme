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

export const tabSchema = z.object({
  id: z.number().int(),
  windowId: z.number().int(),
  url: z.string(),
  title: z.string(),
  active: z.boolean(),
});
export type Tab = z.infer<typeof tabSchema>;

export const matchSchema = z.object({
  ref: z.string(),
  role: z.string(),
  name: z.string(),
});
export type Match = z.infer<typeof matchSchema>;

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
