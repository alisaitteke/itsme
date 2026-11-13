/** Host of a web page, or null for anything that isn't http(s). */
export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.hostname : null;
  } catch {
    return null;
  }
}

/** A site entry covers its host and every subdomain of it. */
export function matchesSite(host: string, sites: readonly string[]): boolean {
  return sites.some((site) => host === site || host.endsWith(`.${site}`));
}

/** Turns what a user typed ("https://Example.com/path", "example.com") into a site entry. */
export function normalizeSite(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  return hostOf(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
}
