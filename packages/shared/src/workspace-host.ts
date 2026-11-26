/**
 * Company subdomains: each company opens at https://<workspace>.<root domain>, e.g. ecomalign.hrmsalign.com.
 * Links switch to subdomains with TENANT_SUBDOMAINS=1 (API) and NEXT_PUBLIC_TENANT_SUBDOMAINS=1 (web),
 * once the wildcard DNS (*.hrmsalign.com) is live.
 */

/** Names a company can never get as its workspace, because they are used by the site, email or DNS. */
export const RESERVED_WORKSPACES: readonly string[] = [
  'www', 'api', 'app', 'apps', 'admin', 'administrator', 'platform', 'owner', 'root', 'system',
  'mail', 'email', 'webmail', 'smtp', 'imap', 'pop', 'pop3', 'mx', 'autodiscover', 'autoconfig',
  'ftp', 'sftp', 'ssh', 'cpanel', 'hpanel', 'whm', 'ns', 'ns1', 'ns2', 'ns3', 'dns',
  'cdn', 'static', 'assets', 'files', 'storage', 'uploads', 'media', 'img', 'images',
  'status', 'support', 'help', 'docs', 'blog', 'news', 'billing', 'pay', 'payments',
  'login', 'signin', 'signup', 'register', 'auth', 'account', 'accounts', 'dashboard',
  'dev', 'staging', 'stage', 'test', 'qa', 'preview', 'sandbox', 'beta',
  'hrms', 'hrmsalign', 'iclock', 'health', 'internal', 'localhost',
];

export function isReservedWorkspace(slug: string): boolean {
  return RESERVED_WORKSPACES.includes(slug.trim().toLowerCase());
}

/** Root domain of the site URL: https://www.hrmsalign.com → hrmsalign.com. */
export function rootDomainOf(siteUrl: string): string {
  try {
    return new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * The company workspace a hostname belongs to: "ecomalign.hrmsalign.com" → "ecomalign".
 * Null for the main site, www, reserved names, deeper subdomains and other domains.
 */
export function workspaceFromHost(host: string | null | undefined, rootDomain: string): string | null {
  const h = (host ?? '').trim().toLowerCase().split(':')[0]!.replace(/\.$/, '');
  const root = rootDomain.trim().toLowerCase().replace(/^www\./, '');
  if (!root || !h.endsWith('.' + root)) return null;
  const sub = h.slice(0, -(root.length + 1));
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(sub) || isReservedWorkspace(sub)) return null;
  return sub;
}

/** Address of a company's workspace, e.g. https://ecomalign.hrmsalign.com (no trailing slash). */
export function workspaceOrigin(slug: string, siteUrl: string): string {
  const u = new URL(siteUrl);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  return `${u.protocol}//${slug}.${host}${u.port ? ':' + u.port : ''}`;
}
