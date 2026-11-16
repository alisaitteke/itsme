import { OLD_SERVER, type StatusResponse } from './runtime-messages.ts';

export interface StatusView {
  state: 'connected' | 'waiting' | 'off' | 'problem';
  /** A word or two for the status pill. */
  label: string;
  /** What it means and what to do about it. */
  help: string;
}

/** Puts the connection's state in the user's terms: they know apps, not servers and sockets. */
export function describeStatus(status: StatusResponse): StatusView {
  if (!status) {
    return {
      state: 'off',
      label: 'Off',
      help: 'Nothing can use this browser until you turn itsme on.',
    };
  }
  if (status.state === 'connected') {
    return {
      state: 'connected',
      label: 'Connected',
      help: `Your AI app can use this browser. It runs itsme ${status.serverVersion ?? ''}.`.trim(),
    };
  }
  const reason = status.lastError ?? '';
  if (reason === OLD_SERVER) {
    return {
      state: 'problem',
      label: 'Restart your AI apps',
      help: 'One of them still runs an itsme from before the last update. Quit and reopen the apps you added itsme to.',
    };
  }
  if (reason.startsWith('Version mismatch')) {
    return {
      state: 'problem',
      label: 'Update needed',
      help: 'The extension and your AI app run different versions of itsme. Reload the extension, then restart the app.',
    };
  }
  return {
    state: 'waiting',
    label: 'Waiting for an AI app',
    help: 'Open the app you added itsme to. It starts itsme by itself.',
  };
}
