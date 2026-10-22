# Panel de administración de 3dev — diseño

Fecha: 2026-10-24 · Estado: aprobado en conversación (alcance: uso por cliente; acceso por `platform_admins`; solo agregados).

Pieza 6 de 8.

## Objetivo

Que Marco vea en un solo lugar todos sus clientes y su uso del periodo, sin
abrir los datos de las conversaciones.

## Decisiones

- **Solo agregados**: personas, mensajes recibidos, leads, seguimientos enviados,
  último mensaje y conversaciones tomadas ahora. Sin transcripciones ni datos de
  contacto: el panel de administración no lee contenido de clientes.
- **Acceso**: tabla `platform_admins (user_id)`; mismo login por código que el
  panel del cliente, pero en `/admin` (independiente del dominio y del cliente).
- **Datos**: función SQL `admin_usage(days)` con `security definer` que solo
  responde si `auth.uid()` está en `platform_admins`; sin políticas nuevas en las
  tablas de los clientes.
- La lista de clientes sale de los datos (`contacts`), no del código: sirve con un
  proyecto por cliente y con el deploy compartido. Se excluyen contactos `eval*`.
- Fuera de alcance: citas (Cal.com, llave de cada cliente), costos (no se guardan
  tokens), detalle por cliente.

## Piezas

- Migración `20261024000000_admin.sql`: `platform_admins`, `admin_usage(days)`.
- `scripts/panel-user.mjs`: `admin add|remove|list <correo>`.
- `app/admin/shape.ts`: `activity(lastAt, now)` (activo ≤ 3 días, quieto ≤ 14, sin
  actividad), `parseDays` reutilizado. Autoprueba.
- `/admin/entrar`, `/admin/salir`, `/admin` (layout con la puerta, tabla con selector
  de 7/30/90 días). Middleware también en `/admin/*`.

## Pruebas

- `scripts/check-admin.mjs` (base real): admin ve una fila por cliente con los conteos
  correctos y sin contactos `eval*`; un usuario que no es admin recibe cero filas; un
  usuario del panel de un cliente no ve nada; anon no puede ejecutar; nadie lee
  `platform_admins` ajenos.
- Páginas contra el dev server: sin sesión → login; no admin → "No tienes acceso";
  admin → tabla.
- Regresión (evals, panel, build).
