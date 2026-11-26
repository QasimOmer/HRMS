import { workspaceOrigin } from '@hrms/shared';
import { config } from '../config';

/**
 * Where a company's links (emails, notifications) should point: its own subdomain, e.g.
 * https://ecomalign.hrmsalign.com, when TENANT_SUBDOMAINS=1; otherwise the main site (APP_URL).
 */
export function appUrlFor(slug?: string | null): string {
  const app = config().APP_URL.replace(/\/+$/, '');
  if (!slug || process.env.TENANT_SUBDOMAINS !== '1') return app;
  try {
    return workspaceOrigin(slug, app);
  } catch {
    return app;
  }
}
