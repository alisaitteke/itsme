import {
  type Automation,
  automationHosts,
  describeSchedule,
  describeStep,
  type RunRecord,
} from '@itsme/protocol';
import { browser } from 'wxt/browser';
import {
  type AutomationAction,
  type AutomationActionResult,
  loadAutomations,
  onAutomationsChanged,
} from '../../shared/automations.ts';
import { loadSettings, onSettingsChanged } from '../../shared/settings.ts';
import { byId } from '../../ui/status.ts';

const list = byId<HTMLUListElement>('list');
const errorLine = byId('error');

const STATUS_LABELS: Record<Automation['status'], string> = {
  pending: 'Waiting for your approval',
  on: 'On',
  paused: 'Paused',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function act(action: AutomationAction['action'], id: string): Promise<void> {
  const message: AutomationAction = { type: 'itsme/automation', action, id };
  const result: AutomationActionResult = await browser.runtime.sendMessage(message);
  errorLine.hidden = result.ok;
  if (!result.ok) errorLine.textContent = result.error;
}

function button(label: string, action: AutomationAction['action'], id: string, quiet = false) {
  const node = el('button', label, quiet ? 'secondary' : undefined);
  node.type = 'button';
  node.dataset.action = action;
  node.addEventListener('click', (event) => {
    // Only a click from a person counts, above all for Approve.
    if (event.isTrusted) void act(action, id);
  });
  return node;
}

function historyLine(run: RunRecord): HTMLLIElement {
  const when = new Date(run.at).toLocaleString();
  const times = run.times > 1 ? ` (${run.times} times)` : '';
  return run.ok
    ? el('li', `${when}: ran${times}`)
    : el('li', `${when}: failed${times}. ${run.note ?? ''}`, 'failed');
}

function card(automation: Automation): HTMLLIElement {
  const { id, status } = automation;
  const item = el('li', undefined, 'card');
  item.dataset.id = id;
  item.dataset.status = status;

  const head = el('div', undefined, 'head');
  const badge = el('span', STATUS_LABELS[status], 'badge');
  badge.dataset.status = status;
  head.append(el('h2', automation.name), badge);

  const steps = el('ol');
  steps.append(...automation.steps.map((step) => el('li', describeStep(step))));

  const buttons = el('div', undefined, 'buttons');
  if (status === 'pending') {
    buttons.append(button('Approve', 'approve', id), button('Reject', 'remove', id, true));
  } else {
    buttons.append(
      status === 'on' ? button('Pause', 'pause', id) : button('Turn on', 'resume', id),
      button('Run now', 'run', id, true),
      button('Delete', 'remove', id, true),
    );
  }

  item.append(
    head,
    el('p', `${describeSchedule(automation.schedule)}, on ${automation.url}`, 'meta'),
    steps,
    el('p', `Works only on: ${automationHosts(automation).join(', ')}`, 'meta'),
  );
  if (status === 'paused' && automation.pausedBecause) {
    item.append(el('p', `Paused: ${automation.pausedBecause}`, 'meta'));
  }
  if (automation.history.length > 0) {
    const history = el('ul', undefined, 'history');
    history.append(...automation.history.toReversed().slice(0, 5).map(historyLine));
    item.append(history);
  }
  item.append(buttons);
  return item;
}

async function render(): Promise<void> {
  const automations = await loadAutomations();
  // What waits for an answer comes first.
  const order = { pending: 0, on: 1, paused: 2 };
  automations.sort((a, b) => order[a.status] - order[b.status]);
  list.replaceChildren(...automations.map(card));
  byId('empty').hidden = automations.length > 0;
  byId('off').hidden = (await loadSettings()).enabled;
}

onAutomationsChanged(() => void render());
onSettingsChanged(() => void render());
void render();
