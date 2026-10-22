# Multi-tenant — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox syntax.

**Goal:** Un deploy atiende a varios clientes, resueltos por dominio o por número de WhatsApp, sin cambiar nada cuando `MULTI_TENANT` no está activo.

**Architecture:** Funciones puras en `core/` (`env`, `tenants`); registro y caché por cliente en `app/assistant.ts`; las credenciales viajan explícitas hacia `core/`; la sesión de Redis se namespacea por cliente.

**Tech Stack:** Next.js 15 (`next/headers`), TypeScript, Redis, Supabase.

**Spec:** `docs/superpowers/specs/2026-10-23-multi-tenant-design.md`

## Global Constraints

- Sin `MULTI_TENANT=1`, el comportamiento es el de hoy (un cliente por proyecto).
- En modo multi-tenant, los secretos del cliente no tienen respaldo sin prefijo.
- `core/` no nombra clientes ni lee variables de un cliente.
- Un host o número desconocido nunca cae en otro cliente.
- No subir ni desplegar: Marco revisa a las 8 am.

## Review Focus

1. **Host spoofing / host desconocido** → 404, nunca otro cliente (Task 4, `check-tenants`).
2. **Un cliente sin su llave de Cal.com no usa la de otro** (Task 1 autoprueba `clientEnv`).
3. **Webhook de WhatsApp con `phone_number_id` desconocido o firma de otro cliente** → no se procesa (Task 4).
4. **Dos clientes en un proceso no comparten sesión de Redis ni caché de widget** (Task 2, Task 4).
5. **Modo de un cliente intacto** (evals y build existentes).

---

### Task 1: `core/config/env.ts` y `core/tenants.ts`

- [ ] Autopruebas primero: `envPrefix('quetzal-3dev') === 'QUETZAL_3DEV'`; `clientEnv` lee `QUETZAL_3DEV__X`; sin multi-tenant cae a `X`; **con `MULTI_TENANT=1` no cae**. `normalizeHost('Demo.3dev.mx:3000.')` → `demo.3dev.mx`; `resolveTenant` por host y por `phoneNumberId`, sin coincidencia → `null`, host vacío → `null`.
- [ ] Implementar y correr `node core/config/env.ts && node core/tenants.ts`.
- [ ] Commit.

### Task 2: Namespacing de Redis y credenciales explícitas

- [ ] `createSessionStore(clientId)` → `session:<clientId>:<contactId>`; actualizar evals (`scripts/evals.ts`) y quien lo use.
- [ ] `sendTemplate(msg, creds)`; `createLeadNotifier(config, secrets)`; autopruebas de `notify.ts` y `whatsapp.ts` siguen verdes.
- [ ] `tsc`; commit.

### Task 3: Schema, configs y registro

- [ ] `domains` en el schema; en las configs de 3dev, demo y plantilla: `domains` y `clientEnv`.
- [ ] `app/assistant.ts`: `allTenants()`, `getAssistant(id?)`, `getAssistantOr404()`, `clientDir(id)`, `UnknownTenantError`; secretos con `clientEnv`.
- [ ] `app/notifier.ts` (`notifierFor(config)`).
- [ ] `tsc`; commit.

### Task 4: Rutas y prueba multi-tenant

- [ ] `scripts/check-tenants.mjs` (falla primero): dev server con `MULTI_TENANT=1` sin `CLIENT`.
- [ ] Rutas: `/`, `/widget`, `/api/chat`, `/api/calendly`, `/api/whatsapp`, cron, panel (layout, entrar, loaders, actions), `panelUrl`.
- [ ] Pasa `check-tenants`; evals de 3dev y del demo en modo de un cliente; `build`; commit.

### Task 5: Documentación y revisión final

- [ ] `CLAUDE.md`, `docs/nuevo-cliente.md`; regresión completa; revisión con subagente y pasada de arreglos; commit.
