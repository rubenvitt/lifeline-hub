import { describe, it, expect } from 'vitest';
import { filtereBefehle } from './fuzzy';
import type { Befehl } from './typen';

const b = (id: string, label: string, schlagworte?: string[]): Befehl => ({
  id, gruppe: 'module', label, schlagworte, ausfuehren: () => {},
});
const liste: Befehl[] = [
  b('modul:etb', 'ETB', ['tagebuch']),
  b('modul:personen', 'Personen', ['vermisst']),
  b('modul:lagekarte', 'Lagekarte'),
];

describe('filtereBefehle', () => {
  it('gibt bei leerer Suche alles zurück', () => {
    expect(filtereBefehle(liste, '   ')).toHaveLength(3);
  });
  it('findet per Substring im Label', () => {
    expect(filtereBefehle(liste, 'lage').map((x) => x.id)).toContain('modul:lagekarte');
  });
  it('findet per Schlagwort', () => {
    expect(filtereBefehle(liste, 'tagebuch').map((x) => x.id)).toContain('modul:etb');
  });
  it('toleriert leichte Tippfehler (Fuzzy)', () => {
    expect(filtereBefehle(liste, 'persanen').map((x) => x.id)).toContain('modul:personen');
  });
});
