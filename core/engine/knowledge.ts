import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Corpus {
  /** Concatenated documents, ready to place in the system prompt. */
  text: string;
  /** Rough token estimate, used to decide when retrieval becomes necessary. */
  estimatedTokens: number;
  files: string[];
}

/**
 * Loads every markdown file in a client's knowledge directory.
 *
 * Deliberately not RAG. Below roughly 40k tokens the whole corpus fits in
 * context, and full context cannot fail the way retrieval fails — a missed
 * chunk produces a confident wrong answer, which is the one outcome these
 * assistants must never have. Move to retrieval when a client's corpus
 * exceeds the configured ceiling, not before.
 */
export async function loadCorpus(dir: string): Promise<Corpus> {
  const entries = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parts: string[] = [];
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(entry.parentPath ?? dir, entry.name);
    const body = (await readFile(path, 'utf8')).trim();
    if (!body) continue;
    files.push(entry.name);
    parts.push(`<document source="${entry.name}">\n${body}\n</document>`);
  }

  const text = parts.join('\n\n');
  return { text, files, estimatedTokens: Math.ceil(text.length / 3.5) };
}
