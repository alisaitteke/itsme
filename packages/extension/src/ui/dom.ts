export function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Copies text; false where the page isn't allowed to use the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Makes a button copy something and say so for a moment. */
export function copyButton(button: HTMLButtonElement, text: () => string, onRefused?: () => void) {
  const label = button.textContent ?? 'Copy';
  button.addEventListener('click', async () => {
    const copied = await copyText(text());
    if (!copied) onRefused?.();
    button.textContent = copied ? 'Copied' : 'Select and copy';
    setTimeout(() => {
      button.textContent = label;
    }, 1_600);
  });
}
