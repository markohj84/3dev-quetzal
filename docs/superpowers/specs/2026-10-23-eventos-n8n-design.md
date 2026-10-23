# Eventos salientes a n8n — diseño

Fecha: 2026-10-23 · Estado: aprobado en conversación, pendiente de revisión escrita

Pieza 8 de 8 de la plataforma, en su versión de eventos (las acciones que el
asistente dispara durante la charla quedan fuera).

## Objetivo

Que cada automatización a la medida de la Oferta 2 ("disparar
automatizaciones") se arme en n8n sin tocar el código de Quetzal: Quetzal
avisa a un webhook del cliente cuando pasa algo y n8n hace el resto (CRM,
hoja, correo, WhatsApp interno).

**Éxito:**

- Con la URL configurada, n8n recibe un `POST` por cada aviso que hoy sale por
  correo, con los datos estructurados.
- Sin URL, nada cambia.
- Un webhook caído o lento nunca cuesta la respuesta, el correo ni el WhatsApp.

## Decisiones

- **Un canal más del notificador.** Los cuatro eventos ya pasan por
  `createLeadNotifier` (`core/notify.ts`); el webhook se agrega ahí junto al
  correo y al WhatsApp, en el mismo `Promise.allSettled`. Las rutas no cambian.
- **Eventos (v1)**, en este orden de precedencia (el mismo del asunto del correo):
  `inbound` (escribió en una conversación tomada) > `booking` (cita agendada,
  en el chat o por Calendly) > `lead` (`capture_lead`) > `interest`
  (`hasOffered` pasó a verdadero).
- **La URL es un secreto**: el repo es público y quien la tenga puede mandarle
  datos falsos a n8n. Vive en `<PREFIJO>__NOTIFY_WEBHOOK_URL` (vía
  `clientEnv`), nunca en `assistant.config.ts`.
- **Firma opcional**: con `<PREFIJO>__NOTIFY_WEBHOOK_SECRET`, cada envío lleva
  `x-signature-256: sha256=<HMAC-SHA256 hex del cuerpo>`. Sin secreto, va sin
  firma.
- **Transcripción completa** en el cuerpo: es lo que necesita un CRM y va al
  n8n del propio cliente, como ya va en el correo.
- **Sin reintentos**: timeout de 5 s; una falla es una línea de log.
  Límite conocido: con n8n caído, ese evento se pierde. Cola de reintentos
  cuando un cliente la necesite.

## Cuerpo

```json
{
  "event": "lead",
  "clientId": "demo-dental",
  "channel": "whatsapp",
  "contactId": "5212225550000",
  "at": "2026-10-23T18:04:11.000Z",
  "lead": { "nombre": "Ana", "contacto": "222 555 0000", "necesidad": "limpieza" },
  "booking": null,
  "inbound": null,
  "reachAt": "5212225550000",
  "panelUrl": "https://demo.3dev.mx/panel/conversaciones/5212225550000",
  "transcript": [{ "role": "user", "content": "…" }, { "role": "assistant", "content": "…" }]
}
```

- `lead` = `alert.captured`, `booking` = `alert.booking`, `inbound` =
  `alert.inbound`; ausentes van como `null`. `reachAt` y `panelUrl` igual.
- `at` es la hora del envío.
- `clientId` deja a un solo n8n atender a varios clientes.

## Piezas

- `core/notify.ts`: `NotifySecrets.webhook?: { url?: string; secret?: string;
  clientId: string }`; `sendWebhook(alert, webhook)`; `alertEvent(alert)`
  (precedencia de arriba, exportada para la autoprueba). `core/` no lee
  variables: llegan por `secrets`.
- `app/assistant.ts`: `secrets.webhook = { url: clientEnv(id,
  'NOTIFY_WEBHOOK_URL'), secret: clientEnv(id, 'NOTIFY_WEBHOOK_SECRET'),
  clientId: id }`.
- Sin cambios de esquema ni de rutas.

## Pruebas

- Autoprueba de `core/notify.ts` (`node core/notify.ts`), con un servidor HTTP
  local:
  - el cuerpo trae `event`, `clientId`, `lead`, `transcript` y `null` en lo ausente;
  - `alertEvent` respeta la precedencia en los cuatro casos;
  - con secreto, la firma verifica; sin secreto, no hay encabezado;
  - sin URL no hay petición;
  - un webhook que no contesta no pasa de ~5 s y `notify()` no lanza.
- `npx tsc --noEmit`, `npm run check:boundary`, `npm run build`, evals de 3dev
  (el notificador está en su camino).

## Documentación

- `CLAUDE.md`, "Notificación de leads": el tercer canal, las variables, la firma
  y el límite; la hoja de ruta deja de listar "flujos n8n".
- `docs/nuevo-cliente.md`: las dos variables (sección 3b) y cómo recibirlas en
  n8n: nodo Webhook en `POST`, y para verificar la firma un nodo Crypto (HMAC
  SHA256, hex) sobre el cuerpo crudo comparado con el encabezado.

## Fuera de alcance

Acciones del asistente hacia n8n durante la charla, eventos por cada mensaje,
seguimiento enviado, tomar o devolver una conversación, reintentos y cola.
