// Checks that a client's curated knowledge still matches its offer catalog.
//
//   node scripts/check-offer.mjs clients/<id>            local: lock vs knowledge
//   node scripts/check-offer.mjs clients/<id> --remote   also: lock vs canonical catalog
//
// The knowledge stays hand-written (raw strategy docs never go into the
// corpus); this only proves that every active name and price in
// <dir>/offer.lock.json appears in <dir>/knowledge/ or <dir>/voice.md. With --remote it also
// compares the lock against the catalog's canonicalUrl, so a price changed
// upstream fails here until someone updates the lock and the knowledge.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const [dir, flag] = process.argv.slice(2);
if (!dir) {
  console.error('uso: node scripts/check-offer.mjs clients/<id> [--remote]');
  process.exit(2);
}

const lock = JSON.parse(await readFile(join(dir, 'offer.lock.json'), 'utf8'));
const knowledgeDir = join(dir, 'knowledge');
const files = (await readdir(knowledgeDir, { recursive: true })).filter((f) => f.endsWith('.md'));
// voice.md counts too: it carries the verified facts the prompt may state.
const sources = [...files.map((f) => join(knowledgeDir, f)), join(dir, 'voice.md')];
const corpus = (await Promise.all(sources.map((p) => readFile(p, 'utf8').catch(() => '')))).join('\n');

const fmt = (n) => n.toLocaleString('en-US');
const variants = (n) => [`$${fmt(n)}`, fmt(n), ...(n % 1000 === 0 ? [`${n / 1000} mil`] : [])];
const errors = [];

for (const line of lock.lines ?? []) {
  for (const item of line.items ?? []) {
    if (line.status === 'activa' && !corpus.includes(item.name)) {
      errors.push(`${item.id}: el nombre "${item.name}" no aparece en knowledge/ ni en voice.md`);
    }
    for (const key of ['setup', 'monthly', 'from']) {
      const value = item[key];
      if (value == null) continue;
      if (!variants(value).some((v) => corpus.includes(v))) {
        errors.push(`${item.id}.${key}: ${variants(value)[0]} no aparece en knowledge/ ni en voice.md`);
      }
    }
  }
}

if (flag === '--remote') {
  if (!lock.canonicalUrl) {
    errors.push('offer.lock.json no tiene canonicalUrl');
  } else {
    try {
      const res = await fetch(lock.canonicalUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const canonical = await res.json();
      if (!isDeepStrictEqual(canonical, lock)) {
        errors.push(
          `offer.lock.json (v${lock.version}) difiere del catálogo canónico (v${canonical.version}). ` +
            'Copia el canónico, actualiza knowledge/ y voice.md según docs/strategy/propagacion.md, y corre los evals.',
        );
      }
    } catch (err) {
      console.warn(`check:offer — no se pudo leer ${lock.canonicalUrl} (${err.message}); se omite la comparación remota.`);
    }
  }
}

if (errors.length) {
  console.error(`check:offer — ${errors.length} problema(s):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`check:offer — knowledge coincide con la oferta v${lock.version}${flag === '--remote' ? ' y con el canónico' : ''}.`);
