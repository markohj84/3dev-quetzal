import { isMultiTenant } from '../../core/config/env';

/**
 * Where the owner reads and answers a conversation. In a shared deploy each
 * client has its own domain; in a project of one client Vercel names it.
 * Locally there is no public panel to link to.
 */
export function panelUrl(config: { domains?: string[] }, contactId: string): string | undefined {
  const host = isMultiTenant() ? config.domains?.[0] : process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}/panel/conversaciones/${encodeURIComponent(contactId)}` : undefined;
}
