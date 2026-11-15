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
import { byId, watchStatus } from '../../ui/status.ts';

const NOTE_MS = 1_500;

const list = byId<HTMLUListElement>('clients');
const next = byId('next');
const client = byId<HTMLSelectElement>('client');
const snippet = byId('snippet');
const copy = byId<HTMLButtonElement>('copy');

/** Copies text; false where the page isn't allowed to use the clipboard. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function say(message: string): void {
  next.textContent = message;
  next.hidden = false;
}

/** One row per app, each with the single action that adds itsme to it. */
function renderQuickActions(entry: ServerEntry): void {
  list.replaceChildren(
    ...CLIENTS.map(({ id, label }) => {
      const action = quickActionFor(id, entry);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
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
          say('Copying is not allowed here. The text is below; select it and copy it.');
        }
      });
      const item = document.createElement('li');
      item.append(label, button);
      return item;
    }),
  );
}

function renderSnippet(entry: ServerEntry): void {
  const { text, where } = snippetFor(client.value as ClientId, entry);
  snippet.textContent = text;
  byId('where').textContent = where;
}

function showByHand(id: ClientId): void {
  client.value = id;
  client.dispatchEvent(new Event('change'));
  (client.closest('details') as HTMLDetailsElement).open = true;
}

async function init(): Promise<void> {
  watchStatus(byId('dot'), byId('status'));
  const entry = serverEntry(await loadLaunch(), await loadSettings());

  renderQuickActions(entry);
  client.append(...CLIENTS.map(({ id, label }) => new Option(label, id)));
  client.addEventListener('change', () => renderSnippet(entry));
  renderSnippet(entry);

  copy.addEventListener('click', async () => {
    const copied = await copyText(snippet.textContent ?? '');
    if (!copied) getSelection()?.selectAllChildren(snippet);
    copy.textContent = copied ? 'Copied' : 'Press Ctrl/Cmd+C';
    setTimeout(() => {
      copy.textContent = 'Copy';
    }, NOTE_MS);
  });
}

void init();
