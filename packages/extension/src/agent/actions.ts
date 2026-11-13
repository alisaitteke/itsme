import type { Modifier, Target } from '@itsme/protocol';
import { isShortcut, type KeyInfo } from '../shared/keys.ts';
import { composedParent, deepActiveElement, isHtml, isInput, isSelect, isTextArea } from './dom.ts';
import { centerOf, elementFor, inViewport, isHittable, isPoint } from './geometry.ts';
import {
  AgentError,
  type AgentResults,
  type Button,
  type Direction,
  type UploadFile,
} from './messages.ts';
import { resolveRef } from './refs.ts';

const BUTTON_CODES: Record<Button, number> = { left: 0, middle: 1, right: 2 };
const ENTER: KeyInfo = { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' };

function reveal(el: Element): void {
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
}

function modifierFlags(modifiers: readonly Modifier[]) {
  return {
    altKey: modifiers.includes('alt'),
    ctrlKey: modifiers.includes('ctrl'),
    metaKey: modifiers.includes('meta'),
    shiftKey: modifiers.includes('shift'),
  };
}

/** Scrolls a ref into view and reports where a real pointer should press. */
export function locate(target: Target, scroll: boolean): AgentResults['locate'] {
  if (target.ref === undefined) {
    if (!isPoint(target)) throw new AgentError('INVALID_PARAMS', 'Give a ref, or both x and y');
    return { x: target.x, y: target.y, hittable: true, inViewport: inViewport(target) };
  }
  const el = resolveRef(target.ref);
  if (scroll) reveal(el);
  const point = centerOf(el);
  return { ...point, hittable: isHittable(el, point), inViewport: inViewport(point) };
}

export function click(
  target: Target,
  button: Button,
  count: number,
  modifiers: readonly Modifier[],
): void {
  const el = elementFor(target);
  if (target.ref !== undefined) reveal(el);

  const point = isPoint(target) ? target : centerOf(el);
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: el.ownerDocument.defaultView,
    button: BUTTON_CODES[button],
    clientX: point.x,
    clientY: point.y,
    ...modifierFlags(modifiers),
  };
  const pointer: PointerEventInit = {
    ...init,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };

  for (let press = 1; press <= count; press++) {
    const detail = { detail: press };
    // Many widgets act on press rather than on click, so send the whole sequence.
    el.dispatchEvent(new PointerEvent('pointerdown', pointer));
    el.dispatchEvent(new MouseEvent('mousedown', { ...init, ...detail }));
    if (isHtml(el)) el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', pointer));
    el.dispatchEvent(new MouseEvent('mouseup', { ...init, ...detail }));

    if (button === 'right') el.dispatchEvent(new MouseEvent('contextmenu', init));
    else if (button === 'middle') el.dispatchEvent(new MouseEvent('auxclick', init));
    // el.click() also runs default actions such as following a link.
    else if (isHtml(el) && modifiers.length === 0) el.click();
    else el.dispatchEvent(new MouseEvent('click', { ...init, ...detail }));
  }
  if (button === 'left' && count === 2) {
    el.dispatchEvent(new MouseEvent('dblclick', { ...init, detail: 2 }));
  }
}

export function hover(target: Target): void {
  const el = elementFor(target);
  if (target.ref !== undefined) reveal(el);
  const point = isPoint(target) ? target : centerOf(el);
  const init: MouseEventInit = {
    bubbles: true,
    composed: true,
    view: el.ownerDocument.defaultView,
    clientX: point.x,
    clientY: point.y,
  };
  el.dispatchEvent(new PointerEvent('pointerover', init));
  el.dispatchEvent(new MouseEvent('mouseover', init));
  el.dispatchEvent(new MouseEvent('mouseenter', { ...init, bubbles: false }));
  el.dispatchEvent(new PointerEvent('pointermove', init));
  el.dispatchEvent(new MouseEvent('mousemove', init));
}

function isEditable(el: Element): el is HTMLElement {
  return isInput(el) || isTextArea(el) || isSelect(el) || (isHtml(el) && el.isContentEditable);
}

/** The element to type into: the ref, or whatever has focus. */
function editableFor(ref: string | undefined): HTMLElement {
  const el = ref === undefined ? deepActiveElement() : resolveRef(ref);
  if (!el || !isEditable(el)) {
    throw new AgentError(
      'INVALID_PARAMS',
      ref === undefined
        ? 'Nothing editable has focus; click a field first or pass its ref'
        : `Element ${ref} is not editable`,
    );
  }
  return el;
}

function setFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  // React tracks the value through the prototype's setter and ignores a plain assignment.
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
}

function selectOption(select: HTMLSelectElement, text: string): void {
  const wanted = text.trim();
  const option = [...select.options].find(
    (candidate) => candidate.value === wanted || candidate.label.trim() === wanted,
  );
  if (!option) throw new AgentError('INVALID_PARAMS', `The select has no option "${text}"`);
  select.value = option.value;
}

function selectContents(el: Element, collapseToEnd: boolean): void {
  const doc = el.ownerDocument;
  const range = doc.createRange();
  range.selectNodeContents(el);
  if (collapseToEnd) range.collapse(false);
  const selection = doc.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function typeIntoEditable(el: HTMLElement, text: string, clear: boolean): void {
  selectContents(el, !clear);
  // execCommand goes through the editing pipeline rich-text editors listen to.
  if (!el.ownerDocument.execCommand('insertText', false, text)) {
    el.textContent = clear ? text : `${el.textContent ?? ''}${text}`;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  }
}

export function type(ref: string | undefined, text: string, clear: boolean, submit: boolean): void {
  const el = editableFor(ref);
  reveal(el);
  el.focus({ preventScroll: true });

  if (isInput(el) || isTextArea(el)) setFieldValue(el, clear ? text : el.value + text);
  else if (isSelect(el)) selectOption(el, text);
  else typeIntoEditable(el, text, clear);

  if (!el.isContentEditable) {
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
    );
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (submit) press(ENTER, [], 1);
}

/** Focuses an editable element, with its content selected or the caret at the end. */
export function focus(ref: string, select: boolean): AgentResults['focus'] {
  const el = editableFor(ref);
  reveal(el);
  el.focus({ preventScroll: true });
  if (isSelect(el)) return { control: 'select' };

  if (isInput(el) || isTextArea(el)) {
    if (select) {
      el.select();
    } else {
      try {
        el.setSelectionRange(el.value.length, el.value.length);
      } catch {
        // Number, email and similar inputs have no selection API; the caret stays put.
      }
    }
  } else {
    selectContents(el, !select);
  }
  return { control: 'text' };
}

export function press(key: KeyInfo, modifiers: readonly Modifier[], count: number): void {
  const el = deepActiveElement() ?? document.body;
  const init: KeyboardEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    key: key.key,
    code: key.code,
    keyCode: key.keyCode,
    which: key.keyCode,
    ...modifierFlags(modifiers),
  };
  for (let i = 0; i < count; i++) {
    const notHandled = el.dispatchEvent(new KeyboardEvent('keydown', init));
    if (key.text && !isShortcut(modifiers)) el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    // A scripted Enter doesn't trigger the browser's implicit form submission.
    if (notHandled && key.key === 'Enter' && isInput(el)) el.form?.requestSubmit();
  }
}

function canScroll(el: Element, vertical: boolean): boolean {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  const overflow = vertical ? style?.overflowY : style?.overflowX;
  const room = vertical ? el.scrollHeight > el.clientHeight : el.scrollWidth > el.clientWidth;
  return room && (overflow === 'auto' || overflow === 'scroll');
}

export function scroll(
  ref: string | undefined,
  direction: Direction,
  amount: number,
): AgentResults['scroll'] {
  const vertical = direction === 'up' || direction === 'down';
  let area: Element | null = ref === undefined ? null : resolveRef(ref);
  while (area && !canScroll(area, vertical)) area = composedParent(area);
  area ??= document.scrollingElement ?? document.documentElement;

  const sign = direction === 'down' || direction === 'right' ? 1 : -1;
  const before = vertical ? area.scrollTop : area.scrollLeft;
  area.scrollBy({
    top: vertical ? sign * amount : 0,
    left: vertical ? 0 : sign * amount,
    behavior: 'instant',
  });
  return { moved: (vertical ? area.scrollTop : area.scrollLeft) !== before };
}

/** Puts files into a file input, as if the user had picked them in the file dialog. */
export function upload(ref: string, files: UploadFile[]): void {
  const input = resolveRef(ref);
  if (!isInput(input) || input.type !== 'file') {
    throw new AgentError('INVALID_PARAMS', `Element ${ref} is not a file input`);
  }
  if (files.length > 1 && !input.multiple) {
    throw new AgentError('INVALID_PARAMS', 'This file input takes a single file');
  }

  // Built in the input's own window, which differs from this one inside an iframe.
  const view = input.ownerDocument.defaultView ?? window;
  const transfer = new view.DataTransfer();
  for (const file of files) {
    const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0));
    transfer.items.add(new view.File([bytes], file.name, { type: file.mimeType }));
  }
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
