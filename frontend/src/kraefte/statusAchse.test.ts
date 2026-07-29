import { describe, expect, it } from 'vitest';
import {
  KATEGORIE_REIHENFOLGE,
  KATEGORIE_WERTE,
  OHNE_STATUS,
  kategorieEtikett,
  verteilungFelder,
} from './statusAchse';
import type { StatusVerteilung } from './kraeftebild';

/**
 * Die EINE Statusachse der vier Kräfteseiten (LFH-330 · B2, Bündel IV).
 *
 * Die Erwartungswerte stehen hier als HANDGESCHRIEBENE Literale, nicht als
 * `statusKategorie.x.label`. Gegen die Konstante zu prüfen, aus der der Code sie holt,
 * prüfte die Konstante gegen sich selbst — dieselbe Lektion wie bei den Wire-Strings in
 * `api/globalKeys.test.ts`.
 */

function verteilung(v: Partial<StatusVerteilung> = {}): StatusVerteilung {
  return { verfuegbar: 0, gebunden: 0, nicht_verfuegbar: 0, ohne: 0, ...v };
}

describe('KATEGORIE_WERTE', () => {
  it('trägt VIER Eimer — den vierten für „kein Status"', () => {
    /**
     * Die Daten haben vier Eimer: `EinsatzFahrzeugAnzeige`/`EinsatzPersonalAnzeige` führen
     * `status_kategorie` als `StatusKategorie | null`, `theme/statusFarben.ts` kennt aber nur
     * DREI Schlüssel. Ohne den vierten fällt jede Zeile ohne Status aus der gruppierten
     * Ansicht und aus dem Filter — lautlos.
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

describe('verteilungFelder', () => {
  it('liefert VIER Felder in fester Folge, auch wenn drei davon 0 sind', () => {
    /**
     * Ausrichtung ist der Zweck einer Vergleichsspalte (Prüflisten-Kriterium 14). Der
     * Bestand (`verteilungTags`) rendert nur Werte > 0 — dann fluchten die Zahlen zweier
     * Zeilen nicht mehr übereinander.
     */
    const felder = verteilungFelder(verteilung({ verfuegbar: 7 }));
    expect(felder.map((f) => f.etikett)).toEqual(['frei', 'geb.', 'n.v.', 'o.A.']);
    expect(felder.map((f) => f.wert)).toEqual([7, 0, 0, 0]);
  });

  it('jedes Feld trägt den Volltext als Titel — die Abkürzung ist nur die Anzeige', () => {
    expect(verteilungFelder(verteilung()).map((f) => f.titel)).toEqual([
      'verfügbar',
      'gebunden',
      'nicht verfügbar',
      'ohne Status',
    ]);
  });

  it('eine 0 trägt KEINE Stufe', () => {
    /**
     * `.lfh-feld--alarm .lfh-zahl` färbt die Zahl rot. „0 nicht verfügbar" ist das
     * Gegenteil einer Gefahr; Rot dafür bricht Kriterium 7.
     */
    expect(verteilungFelder(verteilung()).map((f) => f.stufe)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('erst ein Wert > 0 bekommt die Stufe seiner Kategorie', () => {
    const felder = verteilungFelder(
      verteilung({ verfuegbar: 1, gebunden: 2, nicht_verfuegbar: 3, ohne: 4 }),
    );
    expect(felder.map((f) => f.stufe)).toEqual(['normal', 'achtung', 'alarm', undefined]);
  });

  it('verteilungFelder(null) ist leer', () => {
    // `MeldebildZeile.personalVerteilung` ist `StatusVerteilung | null`; `mittel`-Zeilen
    // tragen `null` und dürfen dann gar keine Zählzeile bekommen.
    expect(verteilungFelder(null)).toEqual([]);
  });
});
