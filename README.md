# Quetzal

Base de código para asistentes conversacionales. Una instancia por cliente,
un núcleo compartido.

---

## La regla

**Ningún archivo bajo `core/` puede nombrar a un cliente.**

Es la única regla que importa. Todo lo demás se deriva de ella. Está
verificada automáticamente:

```bash
npm run check:boundary
```

Ponlo en CI. El día que falle, el núcleo dejó de ser reutilizable y
extraerlo vuelve a costar meses.

---

## Estructura

```
core/                     ← reutilizable, agnóstico del cliente
  config/schema.ts        ← el contrato: todo lo que un cliente puede cambiar
  engine/
    knowledge.ts          ← carga el corpus a contexto
    prompt.ts             ← ensambla el system prompt
    conversation.ts       ← llama a la API, sostiene el estado
  channels/
    types.ts              ← la interfaz de adaptador
    web.ts                ← widget embebido
    whatsapp.ts           ← Meta Cloud API, ventana de 24h
  scheduling/             ← Calendly hoy, otra cosa mañana

clients/
  3dev/
    assistant.config.ts   ← canales, agenda, límites
    voice.md              ← tono y conducta
    knowledge/            ← lo único que el asistente puede afirmar
    README.md             ← pendientes de este cliente

app/
  assistant.ts            ← el único archivo que nombra un cliente
  api/chat/route.ts       ← canal web
  api/whatsapp/route.ts   ← canal WhatsApp
```

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
`voice.md`, no pertenece al núcleo — pertenece al documento de voz del
cliente. Escribirla como un `if` es cómo se rompe la reutilización.

---

## Agregar un cliente

```bash
cp -r clients/3dev clients/acme
```

Después:

1. Reescribe `voice.md` completo. No lo edites por encima — el tono es de
   cada negocio y un documento heredado a medias produce una voz mestiza.
2. Vacía `knowledge/` y escríbelo con el cliente. **Nunca metas sus
   documentos crudos**: contienen precios internos, criterios de
   calificación y notas que no pueden salir por boca del asistente.
3. Ajusta `assistant.config.ts`: agenda, canales, límites.
4. Cambia el import y `CLIENT_DIR` en `app/assistant.ts`.

Cero cambios en `core/`. Si necesitaste tocarlo, encontraste un hueco en el
esquema de configuración — arréglalo ahí, no en el cliente.

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
techo. Ahí — y solo ahí — se justifica montar recuperación.

---

## Estado

Esqueleto funcional. Falta antes de producción:

- [ ] Almacenamiento real de sesiones — hoy son `Map` en memoria y se
      pierden en cada despliegue
- [ ] Registro de conversaciones y métricas
- [ ] Límite de peticiones por sesión
- [ ] Validación de firma en el webhook de Meta
- [ ] Widget conectado a `/api/chat` (el mockup todavía simula respuestas)
