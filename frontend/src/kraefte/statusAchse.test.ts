import { describe, expect, it } from 'vitest';
import {
  KATEGORIE_REIHENFOLGE,
  KATEGORIE_WERTE,
  OHNE_STATUS,
  kategorieEtikett,
} from './statusAchse';

/**
 * Die EINE Statusachse der Kräfteseiten. Die Erwartungswerte sind HANDGESCHRIEBENE Literale,
 * sonst prüfte der Test die Konstante gegen sich selbst.
 */

describe('KATEGORIE_WERTE', () => {
  it('trägt VIER Eimer — den vierten für „kein Status"', () => {
    /**
     * Die Daten haben vier Eimer, der Vertrag drei Schlüssel. Ohne den vierten fiele jede Zeile ohne
     * Status lautlos aus Gruppe und Filter.
     */
    expect(KATEGORIE_WERTE.map((w) => w.value)).toEqual([
      'verfuegbar',
      'gebunden',
      'nicht_verfuegbar',
      'ohne',
    ]);
  });

  it('die drei Vertragslabel kommen aus dem Vertrag, das vierte ist die ABWESENHEIT', () => {
    expect(KATEGORIE_WERTE.map((w) => w.text)).toEqual([
      'verfügbar',
      'gebunden',
      'nicht verfügbar',
      'ohne Status',
    ]);
  });

  it('die Gruppenreihenfolge ist dieselbe Folge und kein zweites Inventar', () => {
    expect(KATEGORIE_REIHENFOLGE).toEqual(KATEGORIE_WERTE.map((w) => w.value));
  });

  it('kategorieEtikett kennt jeden Eimer und lässt Unbekanntes durch', () => {
    expect(kategorieEtikett('nicht_verfuegbar')).toBe('nicht verfügbar');
    expect(kategorieEtikett('ohne')).toBe('ohne Status');
    // Ein Wert, den das Backend erst später einführt, darf nicht zu `undefined` werden.
    expect(kategorieEtikett('was_neues')).toBe('was_neues');
  });

  it('OHNE_STATUS ist neutral und trägt Text — Farbe allein wäre kein Kanal', () => {
    expect(OHNE_STATUS).toEqual({ rolle: 'neutral', label: 'ohne Status' });
  });
});
