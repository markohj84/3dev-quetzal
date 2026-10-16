# Catálogo en vivo — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un tool genérico `lookup_catalog` que lee una Google Sheet publicada como CSV, probado en el demo de Clínica Dental Nogal.

**Architecture:** `core/catalog.ts` baja y parsea el CSV (caché de 5 min en memoria, última copia buena si falla). El motor ofrece `lookup_catalog` solo si la config del cliente trae `catalog`; el tool regresa la hoja completa como líneas de texto y el modelo busca en ella. Una regla genérica en el prompt prohíbe afirmar datos del catálogo que el tool no regresó.

**Tech Stack:** Next.js 15, TypeScript (Node 24 corre `.ts` directo para autopruebas y evals), `@anthropic-ai/sdk`, Zod. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-10-15-catalogo-en-vivo-design.md`

## Global Constraints

- Ningún archivo bajo `core/` nombra a un cliente: `npm run check:boundary` debe pasar.
- Sin dependencias nuevas: parser CSV propio.
- Nombres en inglés en el código; texto de cara al usuario en español.
- Comentarios solo donde expliquen *por qué*.
- Sin `catalog` en la config, el tool no existe para ese cliente (3dev no cambia).
- Caché en memoria de 5 minutos; timeout de fetch de 5 s; `maxRows` default 300.
- El texto de `knowledge/` y `voice.md` se escribe a mano; el CSV nunca entra al corpus.
- No correr `npm run build` con el dev server encendido (rompe `.next`). Dev server en segundo plano: `caffeinate -i`.
- No subir a git ni desplegar sin que Marco lo pida.

## Review Focus

1. **La hoja deja de estar publicada** (Google responde HTML de login): sin copia previa, el modelo recibe el texto de "no tienes los datos" — nunca el HTML. → Task 1, autoprueba `html`.
2. **Google tarda más de 5 s o falla la red** a media conversación: se usa la última copia buena, no un error. → Task 1, autoprueba `stale`.
3. **Precios con coma dentro de comillas** (`"$1,200 MXN"`) y celdas con salto de línea: no parten la fila. → Task 1, autoprueba `parseCsv`.
4. **Columnas vacías al final** (Google exporta `,,,` en filas cortas) y filas en blanco: no aparecen como `Existencias: ` vacío ni como filas vacías. → Task 1, autoprueba `formatRows`.
5. **Promoción vencida que sigue en la hoja**: el modelo no la ofrece, porque el resultado del tool trae la fecha de hoy en la zona del negocio y la regla del prompt dice que una vigencia pasada ya no aplica. → Task 1, autoprueba `describeCatalog` (la fecha va en el texto); Task 2, autoprueba de la regla en `prompt.ts`.

---

## Mapa de archivos

| Archivo | Cambio | Responsabilidad |
|---|---|---|
| `core/catalog.ts` | Crear | Bajar, parsear, formatear y cachear el CSV; texto que ve el modelo |
| `core/config/schema.ts` | Modificar | `CatalogConfig` y `catalog` opcional en `AssistantConfig` |
| `core/tools.ts` | Modificar | `catalogTool(description)` |
| `core/engine/prompt.ts` | Modificar | Sección `# Live catalog` cuando hay catálogo |
| `core/engine/conversation.ts` | Modificar | Ofrecer el tool y responder su llamada |
| `app/assistant.ts` | Modificar | Crear el catálogo desde la config |
| `clients/demo-dental/catalogo.csv` | Crear | Semilla de la hoja del demo |
| `clients/demo-dental/assistant.config.ts` | Modificar | Sección `catalog` |
| `clients/demo-dental/knowledge/negocio.md` | Modificar | Una línea: vende productos; promociones y existencias al momento |
| `clients/demo-dental/evals.ts` | Modificar | 3 casos de catálogo |
| `docs/nuevo-cliente.md` | Modificar | Sección "Catálogo en vivo" |
| `CLAUDE.md` | Modificar | Tool nuevo y hoja de ruta corregida |
| `clients/3dev/knowledge/ofertas.md` | Modificar | Oferta 2 consulta un catálogo (con aprobación de Marco) |

---

### Task 1: Lector del catálogo (`core/catalog.ts`)

**Files:**
- Create: `core/catalog.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export interface CatalogSource { url: string; maxRows: number }`
  - `export interface Catalog { lookup(): Promise<string[]> }` — líneas ya formateadas; lanza error solo si nunca hubo una copia buena.
  - `export function parseCsv(text: string): string[][]`
  - `export function formatRows(rows: string[][]): string[]`
  - `export function createCatalog(source: CatalogSource, fetchImpl?: typeof fetch): Catalog`
  - `export function describeCatalog(lines: string[], today: string): string`
  - `export const CATALOG_UNAVAILABLE: string`

- [ ] **Step 1: Escribir la autoprueba (falla porque no hay implementación)**

Crear `core/catalog.ts` solo con los exports vacíos y la autoprueba:

```ts
import assert from 'node:assert';

export interface CatalogSource {
  url: string;
  maxRows: number;
}

export interface Catalog {
  lookup(): Promise<string[]>;
}

export const CATALOG_UNAVAILABLE = '';

export function parseCsv(text: string): string[][] {
  return [];
}

export function formatRows(rows: string[][]): string[] {
  return [];
}

export function describeCatalog(lines: string[], today: string): string {
  return '';
}

export function createCatalog(source: CatalogSource, fetchImpl: typeof fetch = fetch): Catalog {
  return { lookup: async () => [] };
}

// Self-check: `node core/catalog.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  // parseCsv: comillas, comas y saltos de línea dentro de un campo, \r\n, filas en blanco.
  assert.deepEqual(
    parseCsv('Nombre,Precio\r\n"Kit, casero","$1,200"\r\n\r\n"Dice ""hola""","línea 1\nlínea 2"\n'),
    [
      ['Nombre', 'Precio'],
      ['Kit, casero', '$1,200'],
      ['Dice "hola"', 'línea 1\nlínea 2'],
    ],
  );
  assert.deepEqual(parseCsv('a,b\n,,\n'), [['a', 'b']], 'una fila de puras comas es una fila en blanco');

  // formatRows: encabezado por columna, celdas vacías omitidas, columnas de más al final.
  assert.deepEqual(
    formatRows([
      ['Tipo', 'Nombre', 'Existencias', ''],
      ['Producto', 'Hilo dental', '25', ''],
      ['Promoción', 'Limpieza doble', '', ''],
    ]),
    ['Tipo: Producto · Nombre: Hilo dental · Existencias: 25', 'Tipo: Promoción · Nombre: Limpieza doble'],
  );

  // describeCatalog: la fecha de hoy va en el texto, para que una vigencia pasada se note.
  const described = describeCatalog(['Nombre: Hilo dental'], 'jueves, 15 de octubre de 2026');
  assert.match(described, /15 de octubre de 2026/);
  assert.match(described, /- Nombre: Hilo dental/);
  assert.match(describeCatalog([], 'hoy'), /No hay datos vigentes/);
  assert.ok(CATALOG_UNAVAILABLE.length > 0, 'hay texto para cuando no se pudo leer la hoja');

  const csv = (body: string, type = 'text/csv') => new Response(body, { headers: { 'content-type': type } });
  const sheet = 'Nombre,Existencias\nHilo dental,25\nCepillo,0\n';

  // Caché: dos lookups seguidos, un solo fetch.
  let calls = 0;
  const cached = createCatalog({ url: 'https://x.test/a.csv', maxRows: 300 }, async () => {
    calls++;
    return csv(sheet);
  });
  assert.deepEqual(await cached.lookup(), ['Nombre: Hilo dental · Existencias: 25', 'Nombre: Cepillo · Existencias: 0']);
  await cached.lookup();
  assert.equal(calls, 1, 'el segundo lookup sale del caché');

  // maxRows: se corta.
  const capped = createCatalog({ url: 'https://x.test/b.csv', maxRows: 1 }, async () => csv(sheet));
  assert.equal((await capped.lookup()).length, 1);

  // html: hoja despublicada, sin copia previa → error.
  const unpublished = createCatalog({ url: 'https://x.test/c.csv', maxRows: 300 }, async () =>
    csv('<html>Inicia sesión</html>', 'text/html; charset=utf-8'),
  );
  await assert.rejects(unpublished.lookup(), /not a published CSV/);

  // stale: con copia previa, una falla regresa la copia (aunque haya vencido el caché).
  let fail = false;
  let now = 0;
  const realNow = Date.now;
  Date.now = () => now;
  const stale = createCatalog({ url: 'https://x.test/d.csv', maxRows: 300 }, async () => {
    if (fail) throw new Error('timeout');
    return csv(sheet);
  });
  const first = await stale.lookup();
  fail = true;
  now = 10 * 60_000;
  assert.deepEqual(await stale.lookup(), first, 'una falla regresa la última copia buena');
  Date.now = realNow;

  console.log('catalog.ts self-check passed');
}
```

- [ ] **Step 2: Correr la autoprueba y verla fallar**

Run: `node core/catalog.ts`
Expected: FAIL con `AssertionError` en el primer `deepEqual` de `parseCsv`.

- [ ] **Step 3: Implementar**

Reemplazar los cuerpos vacíos (la autoprueba se queda igual):

```ts
/** Long enough that a busy chat doesn't hit Google on every turn, short
 * enough that an owner who edits the Sheet sees it reflected before a call. */
const TTL_MS = 5 * 60_000;

export const CATALOG_UNAVAILABLE =
  'No tienes los datos vigentes en este momento. No inventes ninguno y no menciones ningún problema técnico: ' +
  'di que no lo puedes confirmar ahora y ofrece la cita o que el equipo lo confirme.';

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

/** One line per row, each value under its header — the model reads
 * "Existencias: 0" unambiguously, where a bare "0" in a table it may not. */
export function formatRows(rows: string[][]): string[] {
  const [headers = [], ...body] = rows;
  return body.map((r) =>
    r
      .map((cell, i) => (cell.trim() ? `${headers[i]?.trim() || `Columna ${i + 1}`}: ${cell.trim()}` : ''))
      .filter(Boolean)
      .join(' · '),
  );
}

/** Today's date travels with the rows: without it the model cannot tell
 * that a promotion "hasta el 31 de octubre" has already ended. */
export function describeCatalog(lines: string[], today: string): string {
  if (!lines.length) return 'No hay datos vigentes que puedas afirmar. No inventes ninguno.';
  return [`Hoy es ${today}. Datos vigentes:`, ...lines.map((l) => `- ${l}`)].join('\n');
}

export function createCatalog({ url, maxRows }: CatalogSource, fetchImpl: typeof fetch = fetch): Catalog {
  let last: { lines: string[]; at: number } | null = null;

  return {
    async lookup() {
      if (last && Date.now() - last.at < TTL_MS) return last.lines;
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
        if (!res.ok) throw new Error(`catalog responded ${res.status}`);
        // A Sheet that is no longer published answers 200 with Google's login page.
        if (/text\/html/i.test(res.headers.get('content-type') ?? '')) {
          throw new Error('catalog is not a published CSV');
        }
        let lines = formatRows(parseCsv(await res.text()));
        if (lines.length > maxRows) {
          console.warn(`catalog has ${lines.length} rows, above ${maxRows}: time to filter server-side`);
          lines = lines.slice(0, maxRows);
        }
        last = { lines, at: Date.now() };
        return lines;
      } catch (error) {
        // Yesterday's stock is a better answer than "no sé" in the middle of a sale.
        if (!last) throw error;
        console.warn('catalog fetch failed, serving last good copy', error);
        return last.lines;
      }
    },
  };
}
```

- [ ] **Step 4: Correr la autoprueba y verla pasar**

Run: `node core/catalog.ts`
Expected: `catalog.ts self-check passed`

- [ ] **Step 5: Revisar frontera y tipos**

Run: `npm run check:boundary && npx tsc --noEmit`
Expected: sin salida de error.

- [ ] **Step 6: Commit**

```bash
git add core/catalog.ts
git commit -m "feat: lector de catálogo en Google Sheet publicada como CSV"
```

---

### Task 2: Config, tool, prompt, motor y conexión

**Files:**
- Modify: `core/config/schema.ts` (después de `ModelConfig`, y dentro de `AssistantConfig`)
- Modify: `core/tools.ts` (antes del bloque de autoprueba)
- Modify: `core/engine/prompt.ts` (`PromptInput`, `buildSystemPrompt`, autoprueba)
- Modify: `core/engine/conversation.ts` (imports, `EngineDeps`, `createEngine`, lista de tools, handler)
- Modify: `app/assistant.ts` (`build()`)

**Interfaces:**
- Consumes (Task 1): `Catalog`, `createCatalog`, `describeCatalog`, `CATALOG_UNAVAILABLE` de `core/catalog.ts`.
- Produces:
  - `CatalogConfig` (Zod) y `AssistantConfig.catalog?: { url: string; description: string; maxRows: number }`.
  - `catalogTool(description: string): Anthropic.Tool` con `name: 'lookup_catalog'`.
  - `PromptInput.hasCatalog?: boolean`.
  - `EngineDeps.catalog?: Catalog`.

- [ ] **Step 1: Autoprueba de la regla en `prompt.ts` (falla)**

Agregar al final del bloque `if (import.meta.url === ...)` de `core/engine/prompt.ts`, antes del `console.log`:

```ts
  const base = {
    config: { outOfScope: [], scheduling: { durationMinutes: 30 } } as any,
    voice: 'voz',
    corpus: { text: 'conocimiento', estimatedTokens: 1 } as any,
    capabilities: { maxLength: 4000, maxChips: 0, markup: 'plain' } as any,
    scheduler: { provider: 'none', bookingUrl: () => '' } as any,
    hasOffered: false,
  };
  assert.ok(!buildSystemPrompt(base).includes('lookup_catalog'), 'sin catálogo no se menciona el tool');
  const withCatalog = buildSystemPrompt({ ...base, hasCatalog: true });
  assert.match(withCatalog, /lookup_catalog/);
  assert.match(withCatalog, /validity date has already passed/, 'una vigencia vencida ya no aplica');
```

Run: `node core/engine/prompt.ts`
Expected: FAIL en `assert.match(withCatalog, /lookup_catalog/)`.

- [ ] **Step 2: Regla en `prompt.ts`**

En `PromptInput` agregar:

```ts
  /** True when the client has a live catalog the model can look up. */
  hasCatalog?: boolean;
```

En `buildSystemPrompt`, cambiar la desestructuración a
`const { config, voice, corpus, capabilities, scheduler, hasOffered, hasCatalog } = input;`
y, justo después del `sections.push` de `# Knowledge base`, agregar:

```ts
  if (hasCatalog) {
    sections.push(
      [
        '# Live catalog',
        '',
        'Some business data changes often and lives outside the knowledge base: call `lookup_catalog` to get it.',
        'Never state a promotion, stock level or current price that `lookup_catalog` did not return this turn.',
        'If something is not in what it returned, the business does not have it: say so, never invent it.',
        'A row whose validity date has already passed is no longer current: do not offer it.',
        'Where the tool and the knowledge base disagree, the tool is current.',
      ].join('\n'),
    );
  }
```

Run: `node core/engine/prompt.ts`
Expected: `prompt.ts self-check passed`

- [ ] **Step 3: Esquema**

En `core/config/schema.ts`, después de `ModelConfig`:

```ts
/**
 * Business data that changes too often for the knowledge base — promotions,
 * stock, current prices — read live from a Google Sheet published as CSV.
 * Only public data: anyone with the URL can read a published Sheet.
 */
export const CatalogConfig = z.object({
  /** File → Share → Publish to web → CSV. */
  url: z.string().url(),
  /** What the sheet holds, in the business's words. It is what makes the model call the tool. */
  description: z.string(),
  /** Rows past this are cut and logged: the sign to filter server-side. */
  maxRows: z.number().int().positive().default(300),
});
```

En `AssistantConfig`, después de `followUp`:

```ts
  catalog: CatalogConfig.optional(),
```

Y al final, junto a los demás `export type`:

```ts
export type CatalogConfig = z.infer<typeof CatalogConfig>;
```

- [ ] **Step 4: Tool**

En `core/tools.ts`, antes del bloque de autoprueba:

```ts
/**
 * The client's description is what gets this called: the model reaches for a
 * tool when it knows the answer lives there and nowhere else.
 */
export function catalogTool(description: string): Anthropic.Tool {
  return {
    name: 'lookup_catalog',
    description:
      `Consulta los datos vigentes del negocio: ${description}. ` +
      'Llámala antes de afirmar cualquiera de estos datos, aunque creas saberlos: si no la llamaste en este turno, no los tienes. ' +
      'Si algo no aparece en lo que regresa, el negocio no lo tiene: dilo así, sin inventarlo.',
    input_schema: { type: 'object', properties: {}, required: [] },
  };
}
```

Y en la autoprueba de `core/tools.ts`, antes del `console.log`:

```ts
  assert.match(catalogTool('promociones del mes').description, /promociones del mes/);
```

Run: `node core/tools.ts`
Expected: `tools.ts self-check passed`

- [ ] **Step 5: Motor**

En `core/engine/conversation.ts`:

Imports — agregar `catalogTool` a la lista importada de `'../tools'` y:

```ts
import { CATALOG_UNAVAILABLE, describeCatalog, type Catalog } from '../catalog';
```

En `EngineDeps`:

```ts
  catalog?: Catalog;
```

En `createEngine`, cambiar la desestructuración a
`const { config, voice, corpus, scheduler, client, catalog } = deps;`
y, después de `bookingText`, agregar:

```ts
  async function catalogText(): Promise<string> {
    const today = new Intl.DateTimeFormat(config.locale, {
      dateStyle: 'full',
      timeZone: config.scheduling.timeZone,
    }).format(new Date());
    try {
      return describeCatalog(await catalog!.lookup(), today);
    } catch (error) {
      console.error(`[${config.id}] catalog lookup failed`, error);
      return CATALOG_UNAVAILABLE;
    }
  }
```

En la llamada a `buildSystemPrompt`, agregar `hasCatalog: Boolean(catalog && config.catalog),`.

En la lista `tools`, después de la línea de `rememberContactTool`:

```ts
        ...(catalog && config.catalog ? [catalogTool(config.catalog.description)] : []),
```

En el `for (const block of toolUses)`, antes de `results.push({ ... content: 'ok' })`:

```ts
          if (block.name === 'lookup_catalog') {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: await catalogText() });
            continue;
          }
```

- [ ] **Step 6: Conexión**

En `app/assistant.ts`, importar `import { createCatalog } from '../core/catalog';` y en `createEngine({ ... })` agregar:

```ts
    catalog: config.catalog ? createCatalog(config.catalog) : undefined,
```

- [ ] **Step 7: Verificar**

Run: `node core/catalog.ts && node core/tools.ts && node core/engine/prompt.ts && npm run check:boundary && npx tsc --noEmit`
Expected: tres `self-check passed` y sin errores.

- [ ] **Step 8: Commit**

```bash
git add core/config/schema.ts core/tools.ts core/engine/prompt.ts core/engine/conversation.ts app/assistant.ts
git commit -m "feat: lookup_catalog consulta el catálogo en vivo del cliente"
```

---

### Task 3: El demo dental consulta su catálogo

**Files:**
- Create: `clients/demo-dental/catalogo.csv`
- Modify: `clients/demo-dental/assistant.config.ts`
- Modify: `clients/demo-dental/knowledge/negocio.md`
- Modify: `clients/demo-dental/evals.ts`

**Interfaces:**
- Consumes: `AssistantConfig.catalog` (Task 2), `parseCsv` (Task 1).
- Produces: `config.catalog.url` del demo, que lee la eval.

- [ ] **Step 1: Semilla**

Crear `clients/demo-dental/catalogo.csv`:

```csv
Tipo,Nombre,Precio,Detalle,Existencias,Vigencia
Promoción,Blanqueamiento en consultorio con 20% de descuento,"$3,040 MXN","Precio normal $3,800 MXN. Una sesión de 90 minutos.",,Hasta el 31 de diciembre de 2026
Promoción,Limpieza para dos personas,"$1,200 MXN","Dos limpiezas el mismo día, para quien venga acompañado.",,Hasta el 30 de noviembre de 2026
Promoción,Radiografía panorámica a mitad de precio,$225 MXN,"Precio normal $450 MXN, con tu consulta de valoración.",,Hasta el 31 de diciembre de 2026
Producto,Kit de blanqueamiento en casa,"$1,200 MXN","Guardas a la medida y gel para dos semanas. Requiere valoración previa.",3,
Producto,Cepillo eléctrico recargable,$950 MXN,Incluye un cabezal de repuesto.,0,
Producto,Pasta dental para sensibilidad,$120 MXN,,15,
Producto,Hilo dental expandible,$65 MXN,,25,
Producto,Cabezales de repuesto para cepillo eléctrico (2 piezas),$280 MXN,,8,
```

- [ ] **Step 2: Config**

En `clients/demo-dental/assistant.config.ts`, después de `notify`:

```ts
  catalog: {
    // Google Sheet de muestra publicada como CSV. Para probar sin ella:
    // python3 -m http.server 8787 --bind 127.0.0.1 --directory clients/demo-dental
    // y CATALOG_URL=http://127.0.0.1:8787/catalogo.csv en el dev server y en los evals.
    url: process.env.CATALOG_URL ?? 'http://127.0.0.1:8787/catalogo.csv',
    description:
      'promociones vigentes de la clínica y productos de higiene dental a la venta, con su precio y existencias',
  },
```

(El default local se reemplaza por la URL de la Sheet en Task 5.)

- [ ] **Step 3: Conocimiento**

Agregar al final de `clients/demo-dental/knowledge/negocio.md`:

```md
- **Productos y promociones:** la clínica vende productos de higiene dental en recepción. Qué hay en existencia y qué promociones están vigentes cambia seguido: Lía lo consulta al momento.
```

- [ ] **Step 4: Evals**

En `clients/demo-dental/evals.ts`, agregar después de los imports existentes:

```ts
import { parseCsv } from '../../core/catalog.ts';

// The same live Sheet the assistant reads, so editing it before a pitch
// doesn't break the suite: the cases pick their rows from whatever is there.
const [header = [], ...sheet] = config.catalog
  ? parseCsv(await (await fetch(config.catalog.url)).text())
  : [];
const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
const rowsOf = (tipo: RegExp) => sheet.filter((r) => tipo.test(r[col('tipo')] ?? ''));
const promos = rowsOf(/promo/i);
const soldOut = rowsOf(/producto/i).find((r) => (r[col('existencias')] ?? '').trim() === '0');
const plain = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** Paraphrase-proof: any long word of the row's name in the reply. */
const mentions = (reply: string, name: string) =>
  plain(name).split(/\W+/).filter((w) => w.length >= 6).some((w) => plain(reply).includes(w));
```

Y al final del arreglo `cases`, antes del `];`:

```ts
  {
    name: 'catálogo: menciona una promoción de la hoja',
    turns: ['¿Tienen alguna promoción ahorita?'],
    check([r]) {
      assert.ok(promos.length, 'la hoja del demo no tiene promociones');
      assert.ok(promos.some((p) => mentions(r, p[col('nombre')])), `no mencionó ninguna promoción de la hoja: ${r}`);
    },
  },
  {
    name: 'catálogo: un producto agotado se dice agotado',
    turns: [`¿Tienen ${soldOut?.[col('nombre')] ?? 'cepillo eléctrico'}? Lo quiero comprar`],
    check([r]) {
      assert.ok(soldOut, 'la hoja del demo no tiene ningún producto con existencias 0');
      assert.match(r, /agotad|no (lo )?tenemos|no hay|sin existencia|no (est[áa]|tenemos) disponible/i, `debería decir que no hay: ${r}`);
    },
  },
  {
    name: 'catálogo: no inventa un producto que no está en la hoja',
    turns: ['¿Venden irrigador bucal? ¿Cuánto cuesta?'],
    check([r]) {
      assert.ok(!/irrigador[^.\n]{0,40}\$\s?\d|\$\s?\d[\d,]*[^.\n]{0,40}irrigador/i.test(r), `no debe dar precio de irrigador: ${r}`);
      assert.ok(!/s[ií],? (lo )?(tenemos|vendemos|manejamos)/i.test(r), `no debe decir que lo vende: ${r}`);
    },
  },
```

- [ ] **Step 5: Correr los evals del demo**

Tres terminales (o procesos en segundo plano):

```bash
python3 -m http.server 8787 --bind 127.0.0.1 --directory clients/demo-dental
CLIENT=demo-dental CATALOG_URL=http://127.0.0.1:8787/catalogo.csv caffeinate -i npm run dev
CATALOG_URL=http://127.0.0.1:8787/catalogo.csv node --env-file=.env.demo-dental clients/demo-dental/evals.ts
```

Expected: `11/11 passed, 1 saltados` (8 de antes + 3 nuevos; el de agenda real se salta sin `EVAL_BOOKING`). Si un caso falla, leer la respuesta antes de culpar al cambio: la suite asserta frases, no conductas.

- [ ] **Step 6: Prueba de caída**

Apagar el `http.server` y **reiniciar** el dev server (el catálogo ya tiene copia en memoria de los evals, y con copia la caída no se nota). En un chat nuevo del widget (`http://localhost:3000`), preguntar "¿tienen promociones?".
Expected: Lía dice que no lo puede confirmar ahora y ofrece la valoración; no menciona errores ni inventa promociones. Volver a encender el `http.server`.

- [ ] **Step 7: Commit**

```bash
git add clients/demo-dental/catalogo.csv clients/demo-dental/assistant.config.ts clients/demo-dental/knowledge/negocio.md clients/demo-dental/evals.ts
git commit -m "feat: Lía consulta promociones y existencias del catálogo del demo"
```

---

### Task 4: Documentación y oferta de 3dev

**Files:**
- Modify: `docs/nuevo-cliente.md` (nueva sección después de "## 2. Cal.com")
- Modify: `CLAUDE.md` (sección "Tool-calling" y "Hoja de ruta")
- Modify: `clients/3dev/knowledge/ofertas.md:40`

**Interfaces:**
- Consumes: `CatalogConfig` (Task 2).
- Produces: nada que use otro task.

- [ ] **Step 1: Guía de alta**

En `docs/nuevo-cliente.md`, después de la sección "## 2. Cal.com" y su `---`, agregar:

```md
## 2b. Catálogo en vivo (opcional, Oferta 2)

Para datos que cambian seguido y el dueño quiere editar él mismo:
promociones, productos y existencias, precios del día. Lo estable (servicios
y sus precios) sigue en `knowledge/`: una sola fuente por dato.

1. El cliente arma una Google Sheet. La primera fila son los encabezados
   (por ejemplo `Tipo, Nombre, Precio, Detalle, Existencias, Vigencia`).
   Las vigencias en palabras ("Hasta el 30 de noviembre de 2026"): el
   asistente recibe la fecha de hoy y deja de ofrecer lo vencido.
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
```

- [ ] **Step 2: `CLAUDE.md`**

En "## Tool-calling", después del párrafo de `remember_contact`, agregar:

```md
`lookup_catalog` (`core/catalog.ts`) lee una Google Sheet publicada como CSV
— promociones, productos, existencias: lo que cambia demasiado para
`knowledge/`. Solo existe si la config trae `catalog`; `catalog.description`
entra a la descripción del tool, y es lo que hace que el modelo lo llame.
Regresa la hoja completa (tope `maxRows`) con la fecha de hoy, para que
una vigencia vencida se note. Caché de 5 min por instancia; si Google
falla, sirve la última copia buena, y sin copia el modelo dice que no
lo puede confirmar. Solo datos públicos: la hoja publicada la lee cualquiera.
```

En "## Hoja de ruta", reemplazar el párrafo que empieza con
"**Oferta 2 ("que actúe") ya captura leads y agenda citas dentro del chat
(Cal.com).** Faltan..." por:

```md
**Oferta 2 ("que actúe") está completa:** captura leads, agenda dentro del
chat (Cal.com), avisa por correo y WhatsApp, da seguimiento automático y
consulta un catálogo en vivo (Google Sheet). Conectar sistemas propios del
cliente (POS, expedientes, saldos) sigue siendo automatización a la medida:
no hay tool genérico, y las consultas de datos personales necesitan
verificar identidad antes de existir.
```

- [ ] **Step 3: Texto de Oferta 2 — STOP: aprobación de Marco**

Proponer a Marco este reemplazo de `clients/3dev/knowledge/ofertas.md:40`:

Antes:
> No consulta por sí solo los sistemas del negocio (inventario, expedientes, saldos): cada negocio los tiene en un lugar distinto, así que conectarlos es una de las automatizaciones a la medida que se definen en la llamada de diagnóstico. El seguimiento es un solo mensaje: no insiste ni manda campañas.

Después:
> Consulta al momento un catálogo que el negocio edita en una hoja de Google: promociones, productos, existencias o precios del día. Conectar sistemas propios (un punto de venta, expedientes, saldos de clientes) es una de las automatizaciones a la medida que se definen en la llamada de diagnóstico. El seguimiento es un solo mensaje: no insiste ni manda campañas.

Y en la lista de lo que incluye Oferta 2 (líneas 33–38), agregar:

```md
- Consulta al momento un catálogo que el negocio mantiene en una hoja de Google (promociones, productos, existencias).
```

No editar el archivo hasta que Marco apruebe o corrija el texto.

- [ ] **Step 4: Aplicar el texto aprobado y correr los evals de 3dev**

Aplicar el texto que Marco aprobó. Luego:

```bash
caffeinate -i npm run dev                       # una terminal
npm run eval:3dev                               # otra
```

Expected: misma cuenta que la última corrida (18/18 o la vigente), sin fallas nuevas. 3dev no tiene `catalog`, así que el tool no existe ahí; solo cambió el conocimiento.

- [ ] **Step 5: Build**

Apagar el dev server. Run: `npm run build`
Expected: `check:boundary` y `check:offer` pasan, y `next build` termina sin errores de tipo.

- [ ] **Step 6: Commit**

```bash
git add docs/nuevo-cliente.md CLAUDE.md clients/3dev/knowledge/ofertas.md docs/superpowers/specs/2026-10-15-catalogo-en-vivo-design.md docs/superpowers/plans/2026-10-15-catalogo-en-vivo.md
git commit -m "docs: catálogo en vivo en la guía de alta, CLAUDE.md y la Oferta 2"
```

---

### Task 5: La Sheet real del demo y despliegue

**Files:**
- Modify: `clients/demo-dental/assistant.config.ts` (default de `catalog.url`)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: demo.3dev.mx con catálogo en vivo.

- [ ] **Step 1: STOP — Marco publica la Sheet**

Pedir a Marco: importar `clients/demo-dental/catalogo.csv` a una Google Sheet nueva (Archivo → Importar → Subir → Reemplazar hoja), luego Archivo → Compartir → Publicar en la web → la hoja → CSV → Publicar, y pasar la URL.

- [ ] **Step 2: Verificar la URL**

Run: `curl -sL -o /dev/null -w '%{content_type}\n' '<URL>' && curl -sL '<URL>' | head -3`
Expected: `text/csv` y las primeras filas de la semilla.

- [ ] **Step 3: Cambiar el default**

En `clients/demo-dental/assistant.config.ts`, reemplazar
`url: process.env.CATALOG_URL ?? 'http://127.0.0.1:8787/catalogo.csv',`
por `url: process.env.CATALOG_URL ?? '<URL>',` y actualizar el comentario de arriba:

```ts
    // Google Sheet de muestra publicada como CSV (cuenta de Marco). Para probar
    // sin ella: python3 -m http.server 8787 --bind 127.0.0.1 --directory clients/demo-dental
    // y CATALOG_URL=http://127.0.0.1:8787/catalogo.csv.
```

- [ ] **Step 4: Evals contra la Sheet real**

```bash
CLIENT=demo-dental caffeinate -i npm run dev                         # una terminal
node --env-file=.env.demo-dental clients/demo-dental/evals.ts        # otra
```

Expected: `11/11 passed, 1 saltados`.

- [ ] **Step 5: Commit**

```bash
git add clients/demo-dental/assistant.config.ts
git commit -m "feat: el demo dental lee su catálogo de una Google Sheet real"
```

- [ ] **Step 6: STOP — subir y desplegar solo si Marco lo pide**

Con su visto bueno: `git push`, y confirmar que Vercel desplegó `quetzal-demo-dental` y `quetzal-3dev`.

- [ ] **Step 7: Prueba de humo en producción**

1. En https://demo.3dev.mx, preguntar "¿tienen promociones?" → menciona las de la hoja.
2. Marco cambia en la Sheet las existencias del cepillo eléctrico de `0` a `4`.
3. Esperar 5 minutos (más lo que Google tarde en republicar, normalmente 1–5 min), chat nuevo: "¿tienen cepillo eléctrico?" → dice que sí hay.
4. Regresar las existencias a `0`.
