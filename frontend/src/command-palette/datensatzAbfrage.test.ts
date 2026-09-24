import { describe, expect, it } from 'vitest';
import { datensatzAbfrage, etbNummerAbfrage, FRISCH_MS } from './datensatzAbfrage';

/**
 * Die Abrufoptionen, die Palette UND Vorschau teilen (LFH-664). Die Schlüssel stehen hier als
 * LITERALE, nicht über `einsatzKeys` gebaut: sonst prüfte die Factory sich gegen sich selbst
 * (CLAUDE.md, Query-Key-Registry). Ein geänderter Schlüssel bricht nichts Sichtbares — er
 * trifft still ein anderes Fach, und die Vorschau lüde neu, statt den Stand der Trefferliste
 * zu zeigen.
 */
describe('datensatzAbfrage (LFH-664)', () => {
  it('liefert je Quelle genau das Bestandsfach der Palette', () => {
    const erwartet: Record<keyof typeof datensatzAbfrage, readonly unknown[]> = {
      personen: ['einsatz-personen', 5],
      schaeden: ['einsatz-schaeden', 5],
      uhs: ['einsatz-uhs', 5],
      meldungen: ['einsatz-meldungen', 5],
      auftraege: ['einsatz-auftraege', 5],
      fahrzeuge: ['einsatz-fahrzeuge', 5],
      personal: ['einsatz-personal', 5],
      einheiten: ['einsatz-einheiten', 5],
      lageberichte: ['einsatz-lageberichte', 5],
      gefahrengebiete: ['gefahrengebiete', 5],
      abschnitte: ['einsatz-abschnitte', 5],
    };
    for (const [quelle, schluessel] of Object.entries(erwartet)) {
      const o = datensatzAbfrage[quelle as keyof typeof datensatzAbfrage](5);
      expect(o.queryKey, quelle).toEqual(schluessel);
      expect(o.staleTime, quelle).toBe(FRISCH_MS);
      expect(typeof o.queryFn, quelle).toBe('function');
    }
  });

  it('adressiert einen ETB-Eintrag über den Nummerncursor (n + 1, limit 1)', () => {
    const o = etbNummerAbfrage(5, 42);
    expect(o.queryKey).toEqual(['etb', 5, { before_lfd_nr: 43, limit: 1 }]);
    expect(o.staleTime).toBe(FRISCH_MS);
  });
});
