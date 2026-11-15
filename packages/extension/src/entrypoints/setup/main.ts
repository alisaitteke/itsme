import { loadLaunch } from '../../shared/launch.ts';
import {
  CLIENTS,
  type ClientId,
  quickActionFor,
  type ServerEntry,
  serverEntry,
  snippetFor,
} from '../../shared/mcp-clients.ts';
import { loadSettings } from '../../shared/settings.ts';
import { byId, copyButton, copyText, el } from '../../ui/dom.ts';
import { mountShell } from '../../ui/shell.ts';

const list = byId<HTMLUListElement>('clients');
const next = byId('next');
const client = byId<HTMLSelectElement>('client');
const snippet = byId('snippet');

function say(message: string): void {
  next.textContent = message;
  next.hidden = false;
}

function showByHand(id: ClientId): void {
  client.value = id;
  client.dispatchEvent(new Event('change'));
  (client.closest('details') as HTMLDetailsElement).open = true;
}

/** One row per app, each with the single action that adds itsme to it. */
function renderQuickActions(entry: ServerEntry): void {
  list.replaceChildren(
    ...CLIENTS.map(({ id, label, note }) => {
      const action = quickActionFor(id, entry);
      const button = el(
        'button',
        id === 'claude-desktop' ? 'button' : 'button quiet',
        action.label,
      );
      button.type = 'button';
      button.dataset.client = id;
      button.dataset.kind = action.kind;
      button.dataset.payload = action.kind === 'open' ? action.url : action.text;
      button.addEventListener('click', async () => {
        if (action.kind === 'open') {
          // A download, or a link the app registered: the browser asks before handing it over.
          location.href = action.url;
          say(action.next);
        } else if (await copyText(action.text)) {
          say(action.next);
        } else {
          showByHand(id);
          say('Copying isn’t allowed here. The text is below: select it and copy it.');
        }
      });

      const app = el('span', 'app');
      app.append(el('span', 'app-name', label), el('span', 'muted small', note));
      const item = el('li');
      item.append(app, button);
      return item;
    }),
  );
}

function renderSnippet(entry: ServerEntry): void {
  const { text, where } = snippetFor(client.value as ClientId, entry);
  snippet.textContent = text;
  byId('where').textContent = where;
}

async function init(): Promise<void> {
  const connection = byId('connection');
  mountShell('connect', (view) => {
    connection.dataset.state = view.state;
    byId('connection-title').textContent =
      view.state === 'connected'
        ? 'Connected'
        : view.state === 'waiting'
          ? 'Waiting for your AI app…'
          : view.label;
    byId('connection-help').textContent = view.help;
  });

  const entry = serverEntry(await loadLaunch(), await loadSettings());
  renderQuickActions(entry);
  client.append(...CLIENTS.map(({ id, label }) => new Option(label, id)));
  client.addEventListener('change', () => renderSnippet(entry));
  renderSnippet(entry);

  const selectSnippet = () => getSelection()?.selectAllChildren(snippet);
  copyButton(byId('copy'), () => snippet.textContent ?? '', selectSnippet);
  copyButton(byId('copy-example'), () => byId('example').textContent ?? '');
}

void init();
