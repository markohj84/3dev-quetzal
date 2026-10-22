import assert from 'node:assert';

/** "Beta.example.com:443" → "beta.example.com". Behind a proxy the header may list several hosts: the first is the visitor's. */
export function normalizeHost(raw: string | null | undefined): string {
  const first = (raw ?? '').split(',')[0].trim().toLowerCase();
  const withoutPort = first.startsWith('[') ? first.replace(/\]:\d+$/, ']') : first.replace(/:\d+$/, '');
  return withoutPort.replace(/\.$/, '');
}

export interface TenantKey {
  domains: string[];
  whatsappPhoneNumberId?: string;
}

export function resolveTenant<T extends TenantKey>(
  tenants: T[],
  key: { host?: string | null; phoneNumberId?: string | null },
): T | null {
  const host = normalizeHost(key.host);
  if (host) {
    const byHost = tenants.find((t) => t.domains.some((d) => normalizeHost(d) === host));
    if (byHost) return byHost;
  }
  if (key.phoneNumberId) {
    return tenants.find((t) => t.whatsappPhoneNumberId === key.phoneNumberId) ?? null;
  }
  return null;
}

// Self-check: `node core/tenants.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  assert.equal(normalizeHost('Beta.example.com:3000'), 'beta.example.com');
  assert.equal(normalizeHost('beta.example.com.'), 'beta.example.com', 'el punto final de un FQDN');
  assert.equal(normalizeHost('acme.example.com, evil.example'), 'acme.example.com', 'solo el primer host de una lista');
  assert.equal(normalizeHost(null), '');
  assert.equal(normalizeHost('[::1]:3000'), '[::1]');

  const tenants = [
    { id: 'a', domains: ['acme.example.com'], whatsappPhoneNumberId: '111' },
    { id: 'b', domains: ['beta.example.com', 'shop.example.org'] },
  ];
  assert.equal(resolveTenant(tenants, { host: 'BETA.example.com:443' })?.id, 'b');
  assert.equal(resolveTenant(tenants, { host: 'shop.example.org' })?.id, 'b', 'un cliente puede tener varios dominios');
  assert.equal(resolveTenant(tenants, { host: 'otro.example.com' }), null, 'dominio desconocido: nadie');
  assert.equal(resolveTenant(tenants, { host: 'sub.beta.example.com' }), null, 'un subdominio no hereda');
  assert.equal(resolveTenant(tenants, { host: '' }), null);
  assert.equal(resolveTenant(tenants, {}), null);
  assert.equal(resolveTenant(tenants, { phoneNumberId: '111' })?.id, 'a');
  assert.equal(resolveTenant(tenants, { phoneNumberId: '999' }), null, 'número desconocido: nadie');
  assert.equal(resolveTenant([{ id: 'c', domains: [] }], { phoneNumberId: '' }), null, 'un cliente sin número no coincide con ""');

  console.log('tenants.ts self-check passed');
}
