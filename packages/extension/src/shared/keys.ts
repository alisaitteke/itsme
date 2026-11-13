import type { Modifier } from '@itsme/protocol';

export interface KeyInfo {
  key: string;
  code: string;
  keyCode: number;
  /** What the key types, if anything. */
  text?: string;
}

const named: Record<string, KeyInfo> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};

const aliases: Record<string, string> = {
  return: 'enter',
  esc: 'escape',
  del: 'delete',
  left: 'arrowleft',
  up: 'arrowup',
  right: 'arrowright',
  down: 'arrowdown',
  ' ': 'space',
};

/** Undefined for a name that is neither a known key nor a single character. */
export function keyInfo(name: string): KeyInfo | undefined {
  const lower = name.toLowerCase();
  const known = named[aliases[lower] ?? lower];
  if (known) return known;

  const functionKey = /^f([1-9]|1[0-2])$/.exec(lower);
  if (functionKey) {
    const key = `F${functionKey[1]}`;
    return { key, code: key, keyCode: 111 + Number(functionKey[1]) };
  }

  if ([...name].length !== 1) return undefined;
  const upper = name.toUpperCase();
  if (/^[A-Z]$/.test(upper)) {
    return { key: name, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: name };
  }
  if (/^[0-9]$/.test(name)) {
    return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: name };
  }
  return { key: name, code: '', keyCode: 0, text: name };
}

/** A key pressed with one of these is a shortcut, not typing. */
export function isShortcut(modifiers: readonly Modifier[]): boolean {
  return modifiers.some((modifier) => modifier !== 'shift');
}
