/** Vercel sets this on every deploy; locally there is no public panel to link to. */
export function panelUrl(contactId: string): string | undefined {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}/panel/conversaciones/${encodeURIComponent(contactId)}` : undefined;
}
