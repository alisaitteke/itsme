import { clean, isHtml, isInput, isSelect, isTextArea, visibleText } from './dom.ts';

const MAX_NAME_LENGTH = 120;
const MAX_OPTIONS = 12;

const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image']);

const TAG_ROLES: Record<string, string> = {
  button: 'button',
  summary: 'button',
  textarea: 'textbox',
  select: 'combobox',
  option: 'option',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  img: 'image',
  nav: 'navigation',
  main: 'main',
  form: 'form',
  dialog: 'dialog',
  article: 'article',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  table: 'table',
  tr: 'row',
  td: 'cell',
  th: 'columnheader',
  iframe: 'frame',
};

const INTERACTIVE_ROLES = new Set([
  'link',
  'button',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'switch',
  'combobox',
  'option',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'slider',
  'spinbutton',
  'clickable',
]);

/** Roles whose text is their name; their children add nothing to an outline. */
const LEAF_ROLES = new Set([...INTERACTIVE_ROLES, 'heading', 'image']);

/** Null for a plain container, which an outline skips over. */
export function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit && explicit !== 'presentation' && explicit !== 'none') return explicit;

  if (el.localName === 'a') return el.hasAttribute('href') ? 'link' : null;
  if (isInput(el)) {
    if (el.type === 'hidden') return null;
    if (el.type === 'checkbox' || el.type === 'radio') return el.type;
    if (el.type === 'range') return 'slider';
    return BUTTON_INPUT_TYPES.has(el.type) ? 'button' : 'textbox';
  }
  const byTag = TAG_ROLES[el.localName];
  if (byTag === 'image') return el.getAttribute('alt') ? 'image' : null;
  if (byTag) return byTag;

  if (isHtml(el) && el.isContentEditable && !el.parentElement?.isContentEditable) return 'textbox';
  // Divs wired up as buttons: the page marks them focusable or gives them a handler.
  const tabindex = el.getAttribute('tabindex');
  if (el.hasAttribute('onclick') || (tabindex !== null && Number(tabindex) >= 0)) {
    return 'clickable';
  }
  return null;
}

export const isInteractive = (role: string | null): boolean =>
  role !== null && INTERACTIVE_ROLES.has(role);
export const isLeaf = (role: string | null): boolean => role !== null && LEAF_ROLES.has(role);

function labelledBy(el: Element): string {
  const ids = el.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
  return ids.map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' ');
}

const isField = (el: Element) => isInput(el) || isTextArea(el) || isSelect(el);

export function nameOf(el: Element, role: string): string {
  const candidates: Array<() => string | null | undefined> = [
    () => el.getAttribute('aria-label'),
    () => labelledBy(el),
    () => (el as HTMLInputElement).labels?.[0]?.textContent,
    () => el.getAttribute('placeholder'),
    () => el.getAttribute('alt'),
    () => (isInput(el) && BUTTON_INPUT_TYPES.has(el.type) ? el.value : null),
    // Containers get their name from attributes only; their text shows up as children.
    () => (isField(el) || !isLeaf(role) ? null : visibleText(el)),
    () => el.querySelector('img[alt]')?.getAttribute('alt'),
    () => el.getAttribute('title'),
    () => (isField(el) ? el.getAttribute('name') : null),
  ];
  for (const candidate of candidates) {
    const name = clean(candidate(), MAX_NAME_LENGTH);
    if (name) return name;
  }
  return '';
}

/** Extra facts about an element, as they appear after its name in an outline. */
export function stateOf(el: Element, role: string): string[] {
  const state: string[] = [];
  if (role === 'heading') {
    state.push(`level=${el.getAttribute('aria-level') ?? el.localName.slice(1)}`);
  }
  if (isInput(el)) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      state.push(el.checked ? 'checked' : 'unchecked');
      // Password contents never leave the page.
    } else if (el.type !== 'password' && !BUTTON_INPUT_TYPES.has(el.type)) {
      state.push(`value=${JSON.stringify(clean(el.value, MAX_NAME_LENGTH))}`);
    }
  } else if (isTextArea(el)) {
    state.push(`value=${JSON.stringify(clean(el.value, MAX_NAME_LENGTH))}`);
  } else if (isSelect(el)) {
    state.push(`value=${JSON.stringify(clean(el.selectedOptions[0]?.label, MAX_NAME_LENGTH))}`);
    const labels = [...el.options].slice(0, MAX_OPTIONS).map((option) => clean(option.label, 40));
    if (el.options.length > MAX_OPTIONS) labels.push('…');
    state.push(`options=${JSON.stringify(labels)}`);
  }

  const checked = el.getAttribute('aria-checked');
  if (checked) state.push(checked === 'true' ? 'checked' : 'unchecked');
  const expanded = el.getAttribute('aria-expanded');
  if (expanded) state.push(expanded === 'true' ? 'expanded' : 'collapsed');
  if (el.getAttribute('aria-selected') === 'true') state.push('selected');
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') {
    state.push('disabled');
  }
  return state;
}
