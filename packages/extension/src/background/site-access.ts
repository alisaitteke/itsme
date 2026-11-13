import { BridgeError } from '@itsme/protocol';
import { allowSite, loadSettings } from '../shared/settings.ts';
import { hostOf, matchesSite } from '../shared/sites.ts';
import { callAgent } from './agent-client.ts';
import type { BrowserTab } from './tabs.ts';

const PROMPT_TIMEOUT_MS = 60_000;
const POLL_MS = 300;

/** Hosts whose prompt the user answered "Not now" since it was last shown. */
const declined = new Set<string>();

export async function refuseBlocked(url: string): Promise<void> {
  const host = hostOf(url);
  if (host && matchesSite(host, (await loadSettings()).blockedSites)) {
    throw new BridgeError('SITE_NOT_ALLOWED', `${host} is on the user's blocked list`);
  }
}

/** Records the answer to the in-page prompt. */
export async function recordDecision(host: string, allow: boolean): Promise<void> {
  if (allow) await allowSite(host);
  else declined.add(host);
}

type Verdict = 'allowed' | 'blocked' | 'undecided';

async function verdictFor(host: string): Promise<Verdict> {
  const settings = await loadSettings();
  if (matchesSite(host, settings.blockedSites)) return 'blocked';
  if (settings.siteAccess === 'all' || matchesSite(host, settings.allowedSites)) return 'allowed';
  return 'undecided';
}

/**
 * Resolves once the user has allowed the tab's site. An undecided site gets a prompt
 * in the page, and the call waits for the answer there or in the popup.
 */
export async function ensureSiteAllowed(tab: BrowserTab): Promise<void> {
  // Pages that aren't http(s) can't be scripted anyway and report that themselves.
  const host = hostOf(tab.url ?? '');
  if (!host) return;

  let verdict = await verdictFor(host);
  if (verdict === 'undecided') {
    declined.delete(host);
    await callAgent(tab.id, { kind: 'prompt', host });
    const deadline = Date.now() + PROMPT_TIMEOUT_MS;
    while (verdict === 'undecided' && !declined.has(host) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      verdict = await verdictFor(host);
    }
  }

  if (verdict === 'allowed') return;
  throw new BridgeError(
    'SITE_NOT_ALLOWED',
    verdict === 'blocked'
      ? `${host} is on the user's blocked list`
      : `The user has not allowed ${host}. They can press Allow on the page, or add the site in the itsme popup.`,
  );
}
