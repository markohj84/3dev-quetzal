import assert from 'node:assert';

export interface CatalogSource {
  url: string;
  maxRows: number;
}

export interface Catalog {
  lookup(): Promise<string[]>;
}

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
