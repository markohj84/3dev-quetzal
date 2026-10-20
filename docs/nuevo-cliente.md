# Dar de alta un cliente nuevo

Un deploy por cliente: el mismo repositorio, un proyecto de Vercel por
cliente, y la variable `CLIENT` elige su carpeta en `clients/`. Cada cliente
tiene sus propias llaves, su número de WhatsApp y su calendario; nada se
comparte entre ellos mientras corren.

Tiempo estimado: medio día de configuración, más lo que tarde Meta en
aprobar el número y las plantillas (horas a un día).

---

## 0. Qué pedirle al cliente

- [ ] Servicios, precios públicos, horarios, ubicación y las preguntas que más le hacen. **Solo lo publicable**: nada de precios internos ni criterios de calificación.
- [ ] Cómo quiere sonar: ¿tú o usted?, ¿formal o cercano?, ¿qué nunca debe decir el asistente?
- [ ] Nombre del asistente, logo y colores.
- [ ] Dónde recibir los avisos: un correo y un WhatsApp **personal**.
- [ ] El número de WhatsApp que usará el asistente (ver paso 3: **no** puede estar en la app WhatsApp Business).
- [ ] Acceso a su calendario (Google o el que use) para Cal.com.
- [ ] Datos del aviso de privacidad: razón social, domicilio y correo para solicitudes ARCO. Lo valida su asesor legal.

---

## 1. La carpeta del cliente

```bash
cp -r clients/_plantilla clients/<cliente>
```

Llena todo lo que está entre `[corchetes]` o marcado `TODO` en:

| Archivo | Qué cambia |
|---|---|
| `assistant.config.ts` | `id` único, nombre, Cal.com, burbujas de inicio, correo de avisos, texto del seguimiento |
| `voice.md` | Identidad, tono, ejemplos, frase exacta para invitar a agendar. Va **literal** al prompt: borra los comentarios de plantilla |
| `knowledge/*.md` | Lo único que el asistente puede afirmar. Escrito a mano con el dueño |
| `widget.html` | Nombre, saludo y colores del chat del sitio |
| `privacidad.tsx` | Aviso de privacidad del cliente |
| `evals.ts` | La regex `offer` de la invitación y los casos propios del negocio |

`offerPattern` (config) y la regex `offer` (evals) deben atrapar la frase de
invitación de `voice.md`. Si no coinciden, la regla de "una sola oferta" deja
de cumplirse.

---

## 2. Cal.com

1. Crea la cuenta (gratis) y conecta el calendario del cliente.
2. **Availability:** días y horas en que atiende, zona `America/Mexico_City` (o la suya).
3. **Event Type:** la cita (por ejemplo, 30 min). El número en la URL del evento es su `eventTypeId`.
4. En el evento, **Advanced → Booking questions:** "Teléfono" **visible y obligatorio**, "Email" opcional. Cal.com exige uno de los dos obligatorio; con el teléfono, en WhatsApp se agenda sin pedirle nada a la persona.
5. **Settings → Developer → API Keys:** crea una llave sin vencimiento (`cal_…`).

Pon `url`, `eventTypeId` y `timeZone` en `assistant.config.ts`.

---

## 2b. Catálogo en vivo (opcional, Oferta 2)

Para datos que cambian seguido y el dueño quiere editar él mismo:
promociones, productos y existencias, precios del día. Lo estable (servicios
y sus precios) sigue en `knowledge/`: una sola fuente por dato.

1. El cliente arma una Google Sheet. La primera fila son los encabezados
   (por ejemplo `Tipo, Nombre, Precio, Detalle, Existencias, Vigencia`).
   Las vigencias en palabras ("Hasta el 30 de noviembre de 2026"): el
   asistente recibe la fecha de hoy y deja de ofrecer lo vencido. Un `0`
   en una columna llamada Existencias, Stock, Inventario o Disponibles se
   lee como agotado.
2. **Archivo → Compartir → Publicar en la web → la hoja → CSV → Publicar.**
   Copia la URL.
3. En `assistant.config.ts`:
   ```ts
   catalog: {
     url: 'https://docs.google.com/spreadsheets/d/e/…/pub?output=csv',
     description: 'qué contiene, en palabras del negocio',
   },
   ```
   `description` es lo que hace que el asistente consulte la hoja: di
   exactamente qué datos hay ahí.
4. Una línea en `knowledge/` que diga que esos datos se consultan al momento.
5. Casos en `evals.ts` que lean la misma hoja (ver `clients/demo-dental/evals.ts`).

**La hoja publicada es pública:** cualquiera con la URL la lee. Nunca costos
internos, márgenes, proveedores ni datos de personas. Un cambio tarda hasta
5 minutos en verse. Si el cliente despublica la hoja, el asistente dice que
no lo puede confirmar y ofrece la cita; nunca inventa.

---

## 3. WhatsApp (Meta)

Lecciones que ya costaron un día cada una:

- **Un número dado de alta en la app WhatsApp Business no se puede registrar en la API** ("Register endpoint is not available for SMB businesses"). Hay que borrar la cuenta en la app primero y dar el número de alta por API.
- **Los números de prueba de Meta (+1 555…) solo contestan a 5 destinatarios autorizados.** Nunca salgas a producción con uno.
- **Una app de Meta tiene una sola URL de webhook.** Si el cliente usa la misma app que 3dev, sus mensajes llegarían al deploy de 3dev, que los ignora. Fija la URL del cliente en su propia cuenta de WhatsApp Business (paso 6).

Pasos:

1. En el Business Manager (del cliente, o el tuyo si tú lo operas), crea la cuenta de WhatsApp Business (WABA). Anota su id: `WHATSAPP_WABA_ID`.
2. Da de alta el número por API: `POST /{waba}/phone_numbers` → `POST /{phone-id}/request_code` → `POST /{phone-id}/verify_code` → `POST /{phone-id}/register` con un PIN de 6 dígitos. Guarda el PIN.
3. Usuario del sistema con token **sin vencimiento** y permisos `whatsapp_business_messaging` y `whatsapp_business_management` sobre esa WABA: `WHATSAPP_ACCESS_TOKEN`.
4. Inventa dos secretos: `WHATSAPP_VERIFY_TOKEN` (cualquier texto) y usa el App Secret de la app como `WHATSAPP_APP_SECRET`.
5. Método de pago en la WABA. Sin él, las plantillas (avisos y seguimiento) no se entregan.
6. Suscribe la app a la WABA **con la URL de este cliente**:
   ```bash
   curl -X POST "https://graph.facebook.com/v21.0/$WHATSAPP_WABA_ID/subscribed_apps" \
     -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" \
     -d "override_callback_uri=https://<dominio-del-cliente>/api/whatsapp" \
     -d "verify_token=$WHATSAPP_VERIFY_TOKEN"
   ```
   Hazlo después del primer deploy (paso 5), cuando la URL ya responde.
7. Verificación del negocio en Meta: sube el tope de 250 conversaciones al día. No bloquea el arranque.

Las plantillas `aviso_lead` y `seguimiento_lead` las crea el paso 6 de esta guía.

---

## 4. Correo de avisos (Resend)

El remitente (`notify.fromEmail`) debe estar en un dominio **verificado** en la
cuenta de Resend cuya llave uses. Dos opciones:

- Rápida: usar el dominio de 3dev ya verificado (`Asistente de X <avisos@3dev.mx>`) con la llave de 3dev.
- Propia: verificar el dominio del cliente en Resend (registros DNS) y usar su llave.

---

## 5. Vercel

1. **Add New → Project** e importa el mismo repositorio (`markohj84/3dev-quetzal`). Ponle de nombre el del cliente.
2. Revisa el plan: el plan Hobby de Vercel es para uso personal, no comercial.
3. Redis: agrega una base de Upstash al proyecto (Marketplace). Una por cliente, para que sus datos no compartan base.
   **Supabase:** conecta el proyecto nuevo a la base `quetzal` desde Vercel → Storage → la base → **Connect Project** (Production, Preview y Development, sin prefijo). Es una sola base para todos los clientes: el `id` de `assistant.config.ts` separa sus filas, así que debe ser único. `client-check` revisa que responda.
4. Variables de entorno de **Production**:

| Variable | De dónde sale |
|---|---|
| `CLIENT` | El nombre de la carpeta: `<cliente>` |
| `ANTHROPIC_API_KEY` | Consola de Anthropic |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Las pone la integración de Upstash |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_WABA_ID` | Paso 3 |
| `CALCOM_API_KEY` | Paso 2 |
| `RESEND_API_KEY` | Paso 4 |
| `NOTIFY_WHATSAPP_TO` | WhatsApp personal del dueño, `52` + 10 dígitos |
| `CRON_SECRET` | `openssl rand -hex 32` |

   Si copias valores de `.env.local`, quítales las comillas: Vercel las guarda como parte del valor (la URL de Redis con comillas tumba el build).
5. Dominio: un subdominio del cliente (por ejemplo `asistente.negocio.mx`) en **Settings → Domains**.
6. El cron del seguimiento y el framework (Next.js) vienen en `vercel.json`: aplican solos a cada proyecto.

---

## 6. Revisar antes de abrirlo al público

```bash
vercel env pull .env.<cliente> --environment=production   # dentro del proyecto del cliente
node --env-file=.env.<cliente> scripts/client-check.ts <cliente> --create-templates
```

`client-check` revisa archivos, config, variables, y que cada llave funcione:
Anthropic, Redis, el número en la API, las plantillas de Meta (las crea si
faltan), el evento de Cal.com y el dominio de Resend. Las plantillas recién
creadas quedan en revisión: vuelve a correrlo cuando Meta las apruebe.
`vercel env pull` no baja las variables marcadas como secretas: agrégalas a
mano a `.env.<cliente>` para la revisión. Ese archivo no se sube a git.

Después, los evals contra el cliente:

```bash
CLIENT=<cliente> WHATSAPP_APP_SECRET=local npm run dev        # una terminal
CLIENT=<cliente> WHATSAPP_APP_SECRET=local npm run eval       # otra
```

Con `EVAL_BOOKING=1` también agenda una cita real y la cancela (le llegan dos
correos al dueño del calendario).

---

## 7. Abrirlo

1. Webhook de WhatsApp: paso 3.6.
2. Widget en el sitio del cliente, antes de `</body>`:
   ```html
   <script src="https://<dominio-del-cliente>/embed.js" defer></script>
   ```
3. Prueba de punta a punta desde un teléfono que **no** sea del cliente: preguntar, dejar datos, agendar. Confirma que llegan los avisos y que la cita está en su calendario.
4. Uso de la semana:
   ```bash
   node --env-file=.env.<cliente> scripts/report.mjs <id-de-la-config> 7
   ```
5. Panel: dale acceso al dueño.
   ```bash
   node --env-file=.env.local scripts/panel-user.mjs add <correo-del-dueño> <id-de-la-config>
   ```
   Entra en `https://<dominio-del-cliente>/panel` con el código que le llega por correo.
