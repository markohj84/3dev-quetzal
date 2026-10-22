# Multi-tenant (un deploy, muchos clientes) — diseño

Fecha: 2026-10-23 · Estado: aprobado **por delegación** (Marco: "continúa sin
mí, reviso a las 8 am"); pendiente de su revisión.

Pieza 5 de 8 (base de datos ✔ → panel ✔ → handoff ✔ → memoria ✔ →
**multi-tenant** → panel de 3dev → capa multi-proveedor → flujos n8n).

## Objetivo

Que un solo proyecto de Vercel atienda a varios clientes: cada petición se
resuelve a su cliente por el dominio (web, widget, panel) o por el número de
WhatsApp (webhook), y dar de alta uno nuevo es una carpeta, una lista de
dominios y unas variables, no un proyecto nuevo.

**Éxito:**

- Con `MULTI_TENANT=1`, `quetzal.3dev.mx` y `demo.3dev.mx` en el mismo deploy
  responden cada uno como su cliente (widget, chat, panel, avisos).
- Un dominio desconocido responde 404; nunca cae en otro cliente.
- Los secretos de un cliente nunca se usan para otro.
- **Sin `MULTI_TENANT`, nada cambia**: un cliente por proyecto, `CLIENT`,
  variables sin prefijo. Subir esta rama no altera producción.

## Decisiones

- **Configuración en el repo** (`clients/<id>/`), como hoy: git, `check:offer` y
  los evals siguen siendo la puerta. Los dominios van en `assistant.config.ts`.
- **Secretos por cliente en variables con prefijo**: `QUETZAL_3DEV__CALCOM_API_KEY`
  (id en mayúsculas, no alfanumérico → `_`, `__`, nombre). En modo multi-tenant
  **no hay respaldo a la variable sin prefijo** para los secretos del cliente
  (Cal.com, Calendly, token y número de WhatsApp, Resend): si falta, esa
  capacidad queda apagada. En modo de un cliente por proyecto sí se acepta la
  variable sin prefijo (el proyecto es de ese cliente).
- **Compartidos (nivel plataforma)**: `ANTHROPIC_API_KEY`, `CRON_SECRET`, Redis,
  Supabase, `WHATSAPP_APP_SECRET` y `WHATSAPP_VERIFY_TOKEN` (la app de Meta es
  de 3dev; un cliente con app propia define los suyos con prefijo).
- **Resolución (opción A)**:
  - web/widget/inicio/panel/`/api/chat`: por `x-forwarded-host` (o `host`).
  - webhook de WhatsApp: por `metadata.phone_number_id` del payload, y la firma
    se verifica con el secreto de ese cliente.
  - cron de seguimiento: recorre todos los clientes con `followUp`.
  - Calendly: por dominio.
- **Redis**: la sesión pasa a `session:<clientId>:<contactId>`. Las sesiones
  abiertas al desplegar se pierden (24 h); la memoria de la pieza 4 reconstruye
  el contexto desde Postgres.

## Piezas

### `core/config/env.ts` (nuevo, genérico)

- `isMultiTenant(): boolean` — `process.env.MULTI_TENANT === '1'`.
- `envPrefix(clientId): string` — `quetzal-3dev` → `QUETZAL_3DEV`.
- `clientEnv(clientId, name, opts?)`: `process.env[PREFIX__NAME]`; si no existe
  y no es multi-tenant, `process.env[name]`.
- Las configs de cliente usan `clientEnv('<su id>', 'NOTIFY_WHATSAPP_TO')` en
  lugar de `process.env` suelto (con varias configs en un proceso, una variable
  global las mezclaría).

### `core/tenants.ts` (nuevo, genérico, puro)

- `normalizeHost(raw): string` — minúsculas, sin puerto, sin punto final.
- `resolveTenant<T>(tenants: T[], key: { host?: string; phoneNumberId?: string }): T | null`
  con `T extends { domains: string[]; whatsappPhoneNumberId?: string }`.

### `core/config/schema.ts`

`domains: z.array(z.string()).default([])` (normalizados a minúsculas).

### `app/assistant.ts` (reescrito)

- `allTenants()`: lee `clients/*/assistant.config.ts` (excepto los que empiezan
  con `_`); en modo de un cliente, solo `CLIENT || '3dev'`.
- `getAssistant(clientId?)`: caché por cliente; sin argumento resuelve desde las
  cabeceras de la petición (`next/headers`). Un host desconocido lanza
  `UnknownTenantError`.
- `getAssistantOr404()`: igual, pero `notFound()` para páginas.
- `clientDir(id)`.
- Modo de un cliente: ignora el host (como hoy). `localhost` en modo multi usa
  `CLIENT` si existe.
- Construye cada motor con las credenciales de ese cliente (`clientEnv`).

### Credenciales explícitas en `core/`

`sendTemplate(msg, creds)`, `createLeadNotifier(config, secrets)`; nada en
`core/` lee `process.env` de un cliente. `app/notifier.ts` arma los secretos
con `clientEnv`.

### Rutas

`/api/chat`, `/widget`, `/` y `/api/calendly` → 404 si el host no es de nadie.
`/api/whatsapp` (POST): parsea, resuelve por `phone_number_id`, verifica firma
con el secreto del cliente; número desconocido → 200 sin hacer nada (Meta
reintenta lo que no es 200); GET de verificación con el token compartido.
`/api/cron/follow-up`: un bucle por cliente. `panelUrl(config, id)` usa
`config.domains[0]` en modo multi.

## Pruebas

- `node core/config/env.ts`, `node core/tenants.ts` (autopruebas).
- `scripts/check-tenants.mjs` contra un dev server con `MULTI_TENANT=1`:
  `x-forwarded-host` de 3dev y del demo devuelven widgets distintos; `/api/chat`
  escribe en el `client_id` correcto; host desconocido → 404; `/panel` de un
  host sin acceso del usuario → "No tienes acceso"; `localhost` sin `CLIENT` → 404.
- Los evals existentes (un cliente por proceso) deben seguir verdes.
- `tsc`, `check:boundary`, `build`.

## Documentación

`CLAUDE.md` ("Clientes", nueva sección "Multi-tenant") y `docs/nuevo-cliente.md`
(alta en modo multi-tenant: carpeta + `domains` + variables con prefijo + dominio
en Vercel + `override_callback_uri` si el cliente tiene su WABA).

## Fuera de alcance

Configuración en la base, panel de administración de 3dev (pieza 6), migrar
producción a un solo proyecto (se hace después, con Marco), `client-check`
multi-tenant.
