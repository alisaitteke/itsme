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
import { loadSettings, onSettingsChanged, saveSettings } from '../../shared/settings.ts';
import { byId, copyButton, el } from '../../ui/dom.ts';
import { mountShell } from '../../ui/shell.ts';

const list = byId<HTMLUListElement>('list');
const errorLine = byId('error');

const STATUS: Record<Automation['status'], { label: string; state: string }> = {
  pending: { label: 'Needs your approval', state: 'waiting' },
  on: { label: 'On', state: 'connected' },
  paused: { label: 'Paused', state: 'off' },
};

const runTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const signedDay = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });

/** The automation whose Delete was pressed once and waits for the second, deciding press. */
let confirming: string | null = null;

async function act(action: AutomationAction['action'], id: string): Promise<void> {
  const message: AutomationAction = { type: 'itsme/automation', action, id };
  const result: AutomationActionResult = await browser.runtime.sendMessage(message);
  errorLine.hidden = result.ok;
  if (!result.ok) errorLine.textContent = result.error;
}

function button(label: string, className: string, key: string, onPress: () => void) {
  const node = el('button', `button ${className}`, label);
  node.type = 'button';
  node.dataset.key = key;
  node.addEventListener('click', (event) => {
    // Only a click from a person counts, above all for Approve.
    if (event.isTrusted) onPress();
  });
  return node;
}

function actionButton(
  label: string,
  action: AutomationAction['action'],
  id: string,
  className = 'quiet',
) {
  const node = button(label, className, action, () => void act(action, id));
  node.dataset.action = action;
  return node;
}

function fact(term: string, value: string | HTMLElement): HTMLElement[] {
  const detail = el('dd');
  detail.append(value);
  return [el('dt', undefined, term), detail];
}

function runLine(run: RunRecord): HTMLLIElement {
  const times = run.times > 1 ? ` ${run.times} times in a row` : '';
  const what = run.ok ? `Ran${times}` : `Failed${times}${run.note ? `: ${run.note}` : ''}`;
  const item = el('li', run.ok ? undefined : 'failed');
  item.append(el('span', undefined, runTime.format(run.at)), el('span', undefined, what));
  return item;
}

function foot(automation: Automation): HTMLElement {
  const { id, status, name } = automation;
  const node = el('div', 'foot');

  if (confirming === id) {
    const remove = actionButton('Delete automation', 'remove', id, 'danger');
    remove.dataset.key = 'confirm-remove';
    node.append(
      el('p', 'ask', `Delete “${name}”? Its run history goes with it.`),
      remove,
      button('Keep it', 'quiet', 'keep', () => {
        confirming = null;
        void render();
      }),
    );
    return node;
  }

  if (status === 'pending') {
    node.append(actionButton('Approve', 'approve', id, ''), actionButton('Reject', 'remove', id));
    return node;
  }

  node.append(
    status === 'on'
      ? actionButton('Pause', 'pause', id)
      : actionButton('Turn on', 'resume', id, ''),
    actionButton('Run now', 'run', id),
    button('Delete', 'quiet', 'ask-remove', () => {
      confirming = id;
      void render().then(() => focusButton(id, 'keep'));
    }),
  );
  if (status === 'on' && automation.enabledAt) {
    node.append(el('p', 'signed', `Turned on by you on ${signedDay.format(automation.enabledAt)}`));
  }
  return node;
}

function card(automation: Automation): HTMLLIElement {
  const { id, status } = automation;
  const item = el('li', 'sheet card');
  item.dataset.id = id;
  item.dataset.status = status;

  const head = el('div', 'head');
  const badge = el('span', 'status', STATUS[status].label);
  badge.dataset.state = STATUS[status].state;
  head.append(el('h2', undefined, automation.name), badge);
  item.append(head);

  if (status === 'pending') {
    item.append(
      el(
        'p',
        'notice warn',
        'Your AI app wants to add this. Once approved it runs by itself, so read the steps first.',
      ),
    );
  }
  if (status === 'paused' && automation.pausedBecause) {
    item.append(el('p', 'notice danger', `Paused by itsme. ${automation.pausedBecause}.`));
  }

  const steps = el('ol');
  steps.append(...automation.steps.map((step) => el('li', undefined, describeStep(step))));
  const facts = el('dl', 'facts');
  facts.append(
    ...fact('When', describeSchedule(automation.schedule)),
    ...fact('Page', automation.url),
    ...fact('Steps', steps),
    ...fact('Works only on', automationHosts(automation).join(', ')),
  );
  item.append(facts);

  if (automation.history.length > 0) {
    const runs = el('ul', 'runs');
    runs.setAttribute('aria-label', 'Latest runs');
    runs.append(...automation.history.toReversed().slice(0, 4).map(runLine));
    item.append(runs);
  }
  item.append(foot(automation));
  return item;
}

function focusButton(id: string, key: string): void {
  list
    .querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] [data-key="${CSS.escape(key)}"]`)
    ?.focus();
}

async function render(): Promise<void> {
  const automations = await loadAutomations();
  // What waits for an answer comes first.
  const order = { pending: 0, on: 1, paused: 2 };
  automations.sort((a, b) => order[a.status] - order[b.status]);
  if (!automations.some(({ id }) => id === confirming)) confirming = null;

  // A run every few seconds redraws the list; the button under the keyboard must survive that.
  const focused = list.contains(document.activeElement)
    ? (document.activeElement as HTMLElement)
    : null;
  const focusedId = focused?.closest<HTMLElement>('[data-id]')?.dataset.id;
  const focusedKey = focused?.dataset.key;

  list.replaceChildren(...automations.map(card));
  if (focusedId && focusedKey) focusButton(focusedId, focusedKey);

  byId('empty').hidden = automations.length > 0;
  byId('off').hidden = (await loadSettings()).enabled;
}

mountShell('automations');
byId('turn-on').addEventListener('click', () => void saveSettings({ enabled: true }));
copyButton(byId('copy-example'), () => byId('example').textContent ?? '');
onAutomationsChanged(() => void render());
onSettingsChanged(() => void render());
void render();
