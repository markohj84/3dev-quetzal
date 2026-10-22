import assert from 'node:assert';

/** One deploy serving several clients. Off by default: a project is then one client's, as it always was. */
export function isMultiTenant(): boolean {
  return process.env.MULTI_TENANT === '1';
}

/** acme-co → ACME_CO: the id made safe for an environment variable name. */
export function envPrefix(clientId: string): string {
  return clientId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * A client's own secret or setting: ACME_CO__CALCOM_API_KEY. In a shared
 * deploy there is no fallback to the bare name — it would belong to whoever
 * set it first, and a booking would land in the wrong calendar. In a project
 * of one client the bare name is theirs, so it still works.
 */
export function clientEnv(clientId: string, name: string): string | undefined {
  const own = process.env[`${envPrefix(clientId)}__${name}`];
  if (own) return own;
  if (isMultiTenant()) return undefined;
  return process.env[name] || undefined;
}

// Self-check: `node core/config/env.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const saved = { ...process.env };
  const reset = () => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    delete process.env.MULTI_TENANT;
    delete process.env.CALCOM_API_KEY;
    delete process.env.ACME_CO__CALCOM_API_KEY;
  };

  assert.equal(envPrefix('acme-co'), 'ACME_CO');
  assert.equal(envPrefix('beta-store'), 'BETA_STORE');
  assert.equal(envPrefix('a.b c'), 'A_B_C', 'cualquier cosa no alfanumérica pasa a _');

  // One client per project: the project is theirs, so the bare variable is theirs too.
  reset();
  process.env.CALCOM_API_KEY = 'bare';
  assert.equal(isMultiTenant(), false);
  assert.equal(clientEnv('acme-co', 'CALCOM_API_KEY'), 'bare', 'sin multi-tenant cae a la variable sin prefijo');
  process.env.ACME_CO__CALCOM_API_KEY = 'prefixed';
  assert.equal(clientEnv('acme-co', 'CALCOM_API_KEY'), 'prefixed', 'la del cliente gana');

  // Shared deploy: a client without its own key gets none, never another client's.
  reset();
  process.env.MULTI_TENANT = '1';
  process.env.CALCOM_API_KEY = 'bare';
  assert.equal(isMultiTenant(), true);
  assert.equal(clientEnv('beta-store', 'CALCOM_API_KEY'), undefined, 'sin llave propia no hay llave');
  process.env.BETA_STORE__CALCOM_API_KEY = 'beta-key';
  assert.equal(clientEnv('beta-store', 'CALCOM_API_KEY'), 'beta-key');
  assert.equal(clientEnv('acme-co', 'CALCOM_API_KEY'), undefined, 'la llave de beta no es de acme');
  delete process.env.BETA_STORE__CALCOM_API_KEY;

  assert.equal(clientEnv('beta-store', 'EMPTY'), undefined);
  process.env.BETA_STORE__EMPTY = '';
  assert.equal(clientEnv('beta-store', 'EMPTY'), undefined, 'una variable vacía no cuenta');
  delete process.env.BETA_STORE__EMPTY;
  reset();

  console.log('env.ts self-check passed');
}
