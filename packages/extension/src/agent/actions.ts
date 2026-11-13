import { AgentError, type AgentResults } from './messages.ts';
import { resolveRef } from './refs.ts';

function fire(element: Element, type: string, init: KeyboardEventInit = {}): boolean {
  return element.dispatchEvent(
    new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, ...init }),
  );
}

export function click(ref: string): void {
  const element = resolveRef(ref);
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });

  const rect = element.getBoundingClientRect();
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    button: 0,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  const pointer: PointerEventInit = {
    ...init,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };

  // Many widgets act on press rather than on click, so send the whole sequence.
  element.dispatchEvent(new PointerEvent('pointerdown', pointer));
  element.dispatchEvent(new MouseEvent('mousedown', init));
  if (element instanceof HTMLElement) element.focus({ preventScroll: true });
  element.dispatchEvent(new PointerEvent('pointerup', pointer));
  element.dispatchEvent(new MouseEvent('mouseup', init));
  if (element instanceof HTMLElement) element.click();
  else element.dispatchEvent(new MouseEvent('click', init));
}

function setFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  // React tracks the value through its own setter and ignores a plain assignment.
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
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

function typeIntoEditable(element: HTMLElement, text: string, clear: boolean): void {
  const selection = getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  if (!clear) range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);

  // execCommand goes through the editing pipeline rich-text editors listen to.
  if (!document.execCommand('insertText', false, text)) {
    element.textContent = clear ? text : `${element.textContent ?? ''}${text}`;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  }
}

function editableElement(ref: string): HTMLElement {
  const element = resolveRef(ref);
  const editable =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable);
  if (!editable) throw new AgentError('INVALID_PARAMS', `Element ${ref} is not editable`);
  return element as HTMLElement;
}

export function type(ref: string, text: string, clear: boolean, submit: boolean): void {
  const element = editableElement(ref);
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  element.focus({ preventScroll: true });

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    setFieldValue(element, clear ? text : element.value + text);
  } else if (element instanceof HTMLSelectElement) {
    selectOption(element, text);
  } else {
    typeIntoEditable(element, text, clear);
  }

  if (!element.isContentEditable) {
    element.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
    );
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (submit) pressEnter(element);
}

function pressEnter(element: HTMLElement): void {
  const key = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
  const notHandled = fire(element, 'keydown', key);
  fire(element, 'keypress', key);
  fire(element, 'keyup', key);
  // A scripted Enter doesn't trigger the browser's implicit form submission.
  if (notHandled && element instanceof HTMLInputElement) element.form?.requestSubmit();
}

/** Scrolls the element into view and reports where a real pointer should press. */
export function locate(ref: string): AgentResults['locate'] {
  const element = resolveRef(ref);
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });

  // The first box, not the bounding box: a link wrapped over two lines has a
  // bounding box whose centre can fall outside the link.
  const rect = element.getClientRects()[0] ?? element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const top = document.elementFromPoint(x, y);
  const hittable = top !== null && (element.contains(top) || top.contains(element));
  return { x, y, hittable };
}

/** Focuses an editable element, with its content selected or the caret at the end. */
export function focus(ref: string, select: boolean): AgentResults['focus'] {
  const element = editableElement(ref);
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  element.focus({ preventScroll: true });
  if (element instanceof HTMLSelectElement) return { control: 'select' };

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (select) {
      element.select();
    } else {
      try {
        element.setSelectionRange(element.value.length, element.value.length);
      } catch {
        // Number, email and similar inputs have no selection API; the caret stays put.
      }
    }
  } else {
    const range = document.createRange();
    range.selectNodeContents(element);
    if (!select) range.collapse(false);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  return { control: 'text' };
}
