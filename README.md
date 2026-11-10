# Quetzal

Base de código para asistentes conversacionales de negocio: responden por
web y WhatsApp con la voz y el conocimiento de cada cliente, agendan citas,
registran prospectos y le avisan al dueño. Una carpeta por cliente, un núcleo
compartido, un solo deploy para todos.

---

## La regla

**Ningún archivo bajo `core/` puede nombrar a un cliente.**

Es la única regla que importa. Todo lo demás se deriva de ella. Está
verificada automáticamente y corre en cada build:

```bash
npm run check:boundary
```

El día que falle, el núcleo dejó de ser reutilizable y extraerlo vuelve a
costar meses. La solución nunca es relajar el check: es mover el código al
lugar correcto.

---

## Estructura

```
core/                     ← reutilizable, agnóstico del cliente
  config/schema.ts        ← el contrato: todo lo que un cliente puede cambiar
  config/env.ts           ← variables y secretos por cliente
  engine/                 ← prompt, conocimiento y el loop de tool-calling
  tools.ts                ← registrar prospecto, agenda, catálogo, ficha
  channels/               ← web y WhatsApp (Meta Cloud API)
  scheduling/             ← Cal.com (agenda dentro del chat) y Calendly
  catalog.ts              ← catálogo en vivo desde una Google Sheet
  notify.ts               ← avisos por correo, WhatsApp y webhook
  followup.ts             ← un seguimiento a quien dejó teléfono y no agendó
  handoff.ts              ← el dueño toma una conversación y la devuelve
  store/                  ← Postgres (Supabase) y Redis (sesión de 24 h)
  tenants.ts              ← qué cliente atiende cada dominio o número

clients/
  _plantilla/             ← punto de partida de un cliente nuevo
  3dev/                   ← el asistente de 3dev
  demo-dental/            ← demo de venta (demo.3dev.mx)
    assistant.config.ts   ← canales, agenda, avisos, plan
    voice.md              ← tono y conducta; entra literal al prompt
    knowledge/            ← lo único que el asistente puede afirmar
    widget.html           ← el chat del sitio
    home.html             ← landing opcional en "/"
    privacidad.tsx        ← aviso de privacidad
    evals.ts              ← casos propios, sobre los que todo cliente debe pasar

app/                      ← Next.js (App Router)
  assistant.ts            ← arma el asistente de cada cliente
  api/chat                ← canal web
  api/whatsapp            ← canal WhatsApp
  api/cron/follow-up      ← seguimiento diario
  panel/                  ← panel del dueño: resumen, conversaciones, leads
  admin/                  ← uso y costo por cliente, para quien opera

scripts/                  ← evals, pruebas contra servicios reales, reportes
supabase/migrations/      ← esquema de la base
docs/nuevo-cliente.md     ← alta de un cliente, paso a paso
```

Cómo funciona cada pieza, y por qué, está en [CLAUDE.md](CLAUDE.md).

---

## Qué es configuración y qué es código

| Vive en `clients/` | Vive en `core/` |
|---|---|
| Tono, reglas de conducta, ejemplos | Cómo se ensambla el prompt |
| Conocimiento del negocio | Cómo se carga el corpus |
| Qué canales están activos | Cómo funciona cada canal |
| A quién se agenda y con qué herramienta | La interfaz de agenda |
| Qué temas se declinan | Cómo se aplica el límite |

Si una conducta no se puede expresar en `assistant.config.ts` o en
`voice.md`, se amplía el esquema (`core/config/schema.ts`). Escribirla como
un `if` es cómo se rompe la reutilización.

---

## Correr en local

Node 24. Las variables están descritas en [.env.example](.env.example).

```bash
npm install
cp .env.example .env.local     # y llena las llaves
npm run dev                    # http://localhost:3000/widget (cliente 3dev)
CLIENT=demo-dental npm run dev # otro cliente
```

## Verificar un cambio

```bash
npm test                # autopruebas de core/ y app/, sin red ni llaves
npx tsc --noEmit
npm run build           # corre antes check:boundary, check:offer y npm test
npm run eval:3dev       # con `npm run dev` en otra terminal
```

Los evals hablan con el modelo real (cuestan centavos) y pasan por
`/api/chat` y `/api/whatsapp` de verdad. Corren después de cualquier cambio a
`voice.md`, `knowledge/`, `assistant.config.ts` o al motor.

---

## Agregar un cliente

```bash
cp -r clients/_plantilla clients/<cliente>
```

Y seguir [docs/nuevo-cliente.md](docs/nuevo-cliente.md): la carpeta, Cal.com,
WhatsApp, variables, dominio y la revisión final
(`scripts/client-check.ts`).

Cero cambios en `core/`. Si necesitaste tocarlo, encontraste un hueco en el
esquema de configuración: arréglalo ahí, no en el cliente.

Dos cosas que no se negocian:

1. `voice.md` se escribe completo para cada negocio. Un documento heredado a
   medias produce una voz mestiza.
2. `knowledge/` se escribe a mano con el cliente. **Nunca entran sus
   documentos crudos**: traen precios internos, criterios de calificación y
   notas que no pueden salir por boca del asistente.

---

## Sobre el conocimiento

El corpus se carga completo en contexto. No hay recuperación, y es
deliberado.

Por debajo de unos cuarenta mil tokens todo cabe, y el contexto completo no
puede fallar como falla la recuperación: cuando el recuperador no encuentra
el fragmento correcto, el modelo responde con lo que sí recuperó y suena
igual de seguro. Un dato inventado en boca de un asistente comercial es una
promesa falsa del negocio.

`corpusWarnTokens` en la configuración avisa cuando un cliente pasa el
techo. Ahí, y solo ahí, se justifica montar recuperación.
