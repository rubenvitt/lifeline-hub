import { describe, expect, it } from 'vitest';
import { VORLAGEN as BEFEHL_VORLAGEN } from '../befehle/vorlagen';
import { VORLAGEN as LAGEBERICHT_VORLAGEN } from '../lageberichte/vorlagen';
import { VERTEILER_FELD, kollidierendeSchluessel } from './verteilerKern';

/**
 * Die Entwurfsformulare von Befehl und Lagebericht tragen die Abschnitte als Feldnamen der obersten
 * Ebene, daneben `titel` und den Verteiler (LLH-1172, Change `kz5udbog-verteiler-vorlagendokument`,
 * D7). Hieße ein Abschnitt so, überschrieben sich die Werte still.
 */
describe('Feldnamen der Entwurfsformulare', () => {
  it('kein Abschnitt einer Befehls- oder Lageberichtsvorlage heißt wie Titel oder Verteiler', () => {
    expect(kollidierendeSchluessel(BEFEHL_VORLAGEN)).toEqual([]);
    expect(kollidierendeSchluessel(LAGEBERICHT_VORLAGEN)).toEqual([]);
  });

  it('meldet einen Abschnitt namens „verteiler“', () => {
    const vorlage = {
      abschnitte: [
        { schluessel: 'lage', label: 'Lage' },
        { schluessel: VERTEILER_FELD, label: 'Verteiler' },
      ],
    };
    expect(kollidierendeSchluessel([vorlage])).toEqual([VERTEILER_FELD]);
  });
});
