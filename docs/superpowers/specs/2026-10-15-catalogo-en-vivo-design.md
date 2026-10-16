# Catálogo en vivo — diseño

Fecha: 2026-10-15 · Estado: aprobado en conversación, pendiente de revisión escrita

## Objetivo

Dejar lista la pieza de Oferta 2 que faltaba ("consulta información del
negocio en vivo") antes de que exista un cliente que la pague, probada con
el demo de Clínica Dental Nogal. Cuando llegue el cliente, conectarlo debe
ser config, no código.

**Éxito:**

- En demo.3dev.mx, Lía contesta con un dato que cambió en una Google Sheet,
  sin redeploy (a lo más 5 minutos después).
- Un eval lo verifica.
- Dar de alta la fuente de un cliente nuevo = una sección en
  `assistant.config.ts` y los pasos de `docs/nuevo-cliente.md`.

## Decisiones

- **Solo catálogo público**: datos iguales para cualquiera (promociones,
  productos, existencias, precios vigentes). Nada personal (saldos,
  expedientes, citas de un paciente): eso exige verificar identidad y, en
  salud, son datos sensibles. Queda fuera de este diseño.
- **Fuente: Google Sheet publicada como CSV.** Sin llaves ni OAuth. JSON u
  otras fuentes no se construyen hasta que un cliente las necesite.
- **El tool regresa la hoja completa** y el modelo busca en ella. Un filtro
  por palabras en el servidor falla con acentos y sinónimos; meter la hoja
  al prompt rompe el caché y cobra la hoja en cada mensaje. El tope
  `maxRows` marca cuándo hará falta filtrar en el servidor.
- **La hoja solo guarda lo que cambia seguido.** Lo estable (precios de
  servicios) sigue en `knowledge/`. Una sola fuente por dato.

## Piezas

### 1. Config — `core/config/schema.ts`

```ts
export const CatalogConfig = z.object({
  /** CSV publicado de la Google Sheet (Archivo → Compartir → Publicar en la web). */
  url: z.string().url(),
  /** Qué contiene, en palabras del negocio. Entra a la descripción del tool. */
  description: z.string(),
  /** Filas por encima de esto se cortan y se avisa: hora de filtrar en el servidor. */
  maxRows: z.number().int().positive().default(300),
});
```

`AssistantConfig` gana `catalog: CatalogConfig.optional()`. Sin la sección,
el tool no existe para ese cliente.

`description` es lo que hace que el modelo llame el tool: un tool se llama
cuando el modelo sabe que ahí está un dato que no tiene en otro lado (la
lección de `check_availability`).

### 2. Lector — `core/catalog.ts` (nuevo)

`createCatalog(config: CatalogConfig)` → `{ lookup(): Promise<string> }`.

- `fetch` con timeout de 5 s (`AbortSignal.timeout`).
- Parser CSV propio, sin dependencias: campos entre comillas, comillas
  dobles escapadas (`""`), comas y saltos de línea dentro de un campo, `\r\n`.
  Se ignoran las filas vacías.
- La primera fila son los encabezados. Cada fila sale como una línea:
  `Producto: Kit blanqueamiento · Precio: $1,200 · Existencias: 3`.
  Las celdas vacías se omiten.
- Caché en memoria del módulo, 5 minutos. Por instancia de Vercel: dos
  instancias pueden ver la hoja con hasta 5 min de diferencia. Aceptable.
- Si hay más de `maxRows` filas, se cortan y se avisa con `console.warn`.
- Una respuesta con `content-type` HTML significa que la hoja ya no está
  publicada (Google regresa su página de login): se trata como error.

`lookup()` puede lanzar error; el motor decide qué texto ve el modelo.

### 3. Tool — `core/tools.ts`

`catalogTool(description: string): Anthropic.Tool`, nombre `lookup_catalog`,
sin parámetros. Descripción: texto genérico ("Consulta los datos vigentes
del negocio. Llámala antes de afirmar cualquiera de estos datos; si no la
llamaste, no los tienes: …") más `description` del cliente.

### 4. Motor — `core/engine/conversation.ts`

- `EngineDeps` gana `catalog?: { lookup(): Promise<string> }`.
- El tool entra en la lista después de `remember_contact` y antes de los de
  agenda.
- Handler `catalogText()`, mismo patrón que `availabilityText()`:

| Caso | Texto que recibe el modelo |
|---|---|
| Hay filas (frescas o en caché) | `Datos vigentes:` + las líneas |
| Falla el fetch y hay caché | El caché, aunque tenga más de 5 min; se anota en el log |
| Falla el fetch, sin caché, o la hoja ya no está publicada | "No tienes los datos vigentes en este momento. No inventes ninguno y no menciones ningún problema técnico: di que no lo puedes confirmar ahora y ofrece la cita o que el equipo lo confirme." |
| Hoja vacía | "No hay datos vigentes que puedas afirmar." |

El caché viejo vive en `core/catalog.ts`: `lookup()` regresa el último
resultado bueno si el fetch falla y solo lanza error si nunca hubo uno.

### 5. Prompt — `core/engine/prompt.ts`

Regla genérica, solo si hay catálogo, junto a la de horarios: nunca afirmes
un dato que dependa del catálogo (promoción, existencia, precio vigente)
que no te haya regresado `lookup_catalog` en este turno; si no aparece en
lo que regresó, no existe.

### 6. Conexión — `app/assistant.ts`

`config.catalog ? createCatalog(config.catalog) : undefined` → `createEngine`.

## Demo — Clínica Dental Nogal

- `clients/demo-dental/catalogo.csv`: semilla con columnas
  `Tipo,Nombre,Precio,Detalle,Existencias,Vigencia`. Unas 3 promociones
  con vigencia y unos 5 productos de higiene, al menos uno agotado
  (`Existencias: 0`). No entra al corpus (solo se cargan `.md`).
- Marco importa el CSV a una Google Sheet de su cuenta y la publica como
  CSV; la URL va en `catalog.url` del demo. Mientras tanto, la prueba local
  usa un servidor que sirve el archivo semilla.
- `knowledge/negocio.md` del demo: una línea que diga que la clínica vende
  productos de higiene dental y que las promociones y existencias se
  consultan al momento.

## Pruebas

- **Autoprueba** en `core/catalog.ts` (`assert`, mismo patrón que
  `core/tools.ts`): comillas, comas y saltos de línea en un campo, filas
  vacías, celdas vacías omitidas, formato de salida.
- **Evals** en `clients/demo-dental/evals.ts`. Leen la misma hoja en vivo y
  eligen las filas al vuelo, para no romperse si Marco la edita antes de una
  presentación:
  1. Preguntar por promociones → la respuesta trae el nombre de una
     promoción de la hoja.
  2. Preguntar por un producto agotado → la respuesta dice que no hay.
  3. Preguntar por un producto que no está en la hoja → no lo ofrece como
     disponible.
- `npm run eval:3dev` sigue pasando sin cambios (3dev no tiene `catalog`).
- `npm run check:boundary` y `npm run build`.

## Documentación

- `docs/nuevo-cliente.md`: sección "Catálogo en vivo": cómo publicar la
  Sheet como CSV, qué va en `description`, y la advertencia: **la hoja
  publicada es pública**; nunca costos internos ni datos sensibles.
- `CLAUDE.md`: `lookup_catalog` en "Tool-calling"; hoja de ruta corregida
  (seguimiento automático y consulta de catálogo ya existen).
- `clients/3dev/knowledge/ofertas.md`: Oferta 2 pasa de "No consulta por sí
  solo los sistemas del negocio" a consultar en vivo un catálogo en Google
  Sheet; conectar sistemas propios (inventario en un POS, expedientes,
  saldos) sigue siendo automatización a la medida. **Cambia lo que 3dev
  vende: Marco aprueba el texto antes de subirlo**, y se corre
  `npm run eval:3dev`.

## Fuera de alcance

- Consultas personales (requieren verificar identidad).
- Fuentes JSON, APIs de POS, bases de datos.
- Filtrado en el servidor (hasta que un catálogo pase `maxRows`).
- Caché compartido en Redis entre instancias.
