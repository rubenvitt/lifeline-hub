import { describe, expect, it } from 'vitest';
import { modulRegistry } from '../einsatz/modulRegistry';
import { KAPITEL } from './kapitel';
import { KAPITEL_JE_PFAD, RUECKFALL_KAPITEL } from './kontextKapitel';

// Wächter (LLH-1824, `docs/anwender/AGENTS.md`, „Hilfe in der App“): jede Seite führt zu einem
// Kapitel, das es gibt. Ein neues Modul ohne `hilfeKapitel` scheitert schon am Typ.
const slugs = new Set(KAPITEL.map((k) => k.slug));

describe('Kapitel je Seite', () => {
  it.each(modulRegistry.map((m) => [m.key, m.hilfeKapitel]))(
    'Modul %s nennt ein vorhandenes Kapitel (%s)',
    (_key, kapitel) => {
      expect(slugs.has(kapitel)).toBe(true);
    },
  );

  it.each(KAPITEL_JE_PFAD.map((e) => [e.muster, e.kapitel]))(
    'Pfad %s nennt ein vorhandenes Kapitel (%s)',
    (_muster, kapitel) => {
      expect(slugs.has(kapitel)).toBe(true);
    },
  );

  it('das Rückfall-Kapitel gibt es', () => {
    expect(slugs.has(RUECKFALL_KAPITEL)).toBe(true);
  });
});
