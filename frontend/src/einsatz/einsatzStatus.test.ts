import { describe, expect, it } from 'vitest';
import type { EinsatzStatus } from '../api/types';
import { EINSATZ_STATUS } from './einsatzStatus';

/**
 * Die Zuordnung selbst wird hier nicht erfunden, sondern zitiert (A0-Spec §6,
 * Prüflistenzeile 7: `aktiv` → `normal`, `abgeschlossen` → `neutral`). Geprüft wird
 * deshalb NICHT „sieht plausibel aus", sondern die drei Eigenschaften, die beim
 * Umzug aus `EinsaetzePage` verlorengehen könnten.
 */
describe('Einsatz-Status als Statusrolle (LFH-345 · C10, Befund M14)', () => {
  it('deckt das Enum vollständig ab — eine dritte Variante bricht hier', () => {
    // Die Liste steht als LITERAL da, nicht aus `Object.keys(EINSATZ_STATUS)` abgeleitet:
    // sonst prüfte die Zusicherung die Map gegen sich selbst und wäre auch bei einer
    // fehlenden Variante grün. Der `EinsatzStatus[]`-Typ zieht die zweite Hälfte nach —
    // kommt aus dem Codegen ein dritter Wert, bricht schon der Typcheck.
    const alle: EinsatzStatus[] = ['aktiv', 'abgeschlossen'];
    expect(Object.keys(EINSATZ_STATUS).sort()).toEqual([...alle].sort());
  });

  it('zeigt ein Wort, nicht den Wire-Wert — genau der gemeldete Mangel', () => {
    // DAS ist die Aussage des Befunds: im Titel stand `{einsatz.status}`, also der rohe
    // Enum-String klein geschrieben. Ein `label`, das gleich dem Schlüssel ist, wäre die
    // Rückkehr dorthin — mit dem Unterschied, dass sie dann wie eine gepflegte
    // Beschriftung aussähe.
    for (const [wire, d] of Object.entries(EINSATZ_STATUS)) {
      expect(d.label).not.toBe(wire);
      expect(d.label.length).toBeGreaterThan(0);
    }
    expect(EINSATZ_STATUS.aktiv.label).toBe('Aktiv');
    expect(EINSATZ_STATUS.abgeschlossen.label).toBe('Abgeschlossen');
  });

  it('trägt die zitierten Rollen — kein erfundener Farbwert', () => {
    expect(EINSATZ_STATUS.aktiv.rolle).toBe('normal');
    expect(EINSATZ_STATUS.abgeschlossen.rolle).toBe('neutral');
  });
});
