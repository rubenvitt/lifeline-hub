// frontend/src/command-palette/fuzzy.ts
import Fuse from 'fuse.js';
import type { Befehl } from './typen';

/** Substring- + Fuzzy-Filter über Label und Schlagworte; leere Suche → unverändert. */
export function filtereBefehle(befehle: Befehl[], suche: string): Befehl[] {
  const s = suche.trim();
  if (!s) return befehle;
  const fuse = new Fuse(befehle, {
    keys: ['label', 'schlagworte'],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 1,
  });
  return fuse.search(s).map((r) => r.item);
}
