import { type Automation, automationSchema } from '@itsme/protocol';
import { browser } from 'wxt/browser';

export const AUTOMATIONS_KEY = 'automations';

/** What the automations page asks the background to do; only the background writes. */
export interface AutomationAction {
  type: 'itsme/automation';
  action: 'approve' | 'pause' | 'resume' | 'remove' | 'run';
  id: string;
}

export type AutomationActionResult = { ok: true } | { ok: false; error: string };

export function isAutomationAction(message: unknown): message is AutomationAction {
  const candidate = message as Partial<AutomationAction> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    candidate.type === 'itsme/automation' &&
    typeof candidate.id === 'string' &&
    ['approve', 'pause', 'resume', 'remove', 'run'].includes(candidate.action ?? '')
  );
}

export async function loadAutomations(): Promise<Automation[]> {
  const stored = (await browser.storage.local.get(AUTOMATIONS_KEY))[AUTOMATIONS_KEY];
  if (!Array.isArray(stored)) return [];
  // One entry an older version wrote differently must not take the others down with it.
  return stored.flatMap((entry) => {
    const parsed = automationSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

export function onAutomationsChanged(listener: () => void): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && AUTOMATIONS_KEY in changes) listener();
  });
}
