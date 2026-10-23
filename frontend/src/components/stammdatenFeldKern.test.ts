import { describe, expect, it } from 'vitest';
import {
  baueVorschlagsliste,
  exakterTreffer,
  herkunftDesWerts,
  HERKUNFT_WORT,
  type Vorschlagsquelle,
} from './stammdatenFeldKern';

const einsatz: Vorschlagsquelle = {
  id: 'funkrufnamenEinsatz',
  gruppe: 'einsatz',
  eintraege: [
    { label: 'Florian Musterstadt 1/10-1', wert: 'Florian Musterstadt 1/10-1' },
    { label: 'S2 – Lage (Müller)', wert: 'S2' },
  ],
};
const stammdaten: Vorschlagsquelle = {
  id: 'fahrzeugeStammdaten',
  gruppe: 'stammdaten',
  eintraege: [
    {
      label: 'Demo-ELW',
      wert: 'Demo-ELW',
      ref: { quelle: 'fahrzeugeStammdaten', id: 9 },
      demo: true,
    },
    { label: 'ELW 1', wert: 'ELW 1', ref: { quelle: 'fahrzeugeStammdaten', id: 1 } },
    // Steht schon „Im Einsatz“: zählt dort, nicht ein zweites Mal.
    {
      label: 'Florian Musterstadt 1/10-1',
      wert: 'Florian Musterstadt 1/10-1',
      ref: { quelle: 'fahrzeugeStammdaten', id: 2 },
    },
  ],
};
const zuletzt: Vorschlagsquelle = {
  id: 'zuletztVerwendet',
  gruppe: 'zuletzt',
  eintraege: [
    { label: 'Polizei vor Ort', wert: 'Polizei vor Ort' },
    { label: 'elw 1', wert: 'elw 1' },
  ],
};

describe('baueVorschlagsliste', () => {
  it('ordnet „Im Einsatz“, „Stammdaten“, „Zuletzt verwendet“, gleich in welcher Folge die Quellen kommen', () => {
    const liste = baueVorschlagsliste([zuletzt, stammdaten, einsatz], '');
    expect(liste.gruppen.map((g) => g.titel)).toEqual([
      'Im Einsatz',
      'Stammdaten',
      'Zuletzt verwendet',
    ]);
  });

  it('zählt einen doppelten Wert nur in der ersten Gruppe, ohne Groß-/Kleinschreibung', () => {
    const liste = baueVorschlagsliste([einsatz, stammdaten, zuletzt], '');
    expect(liste.gruppen[1].eintraege.map((e) => e.wert)).toEqual(['ELW 1']);
    expect(liste.gruppen[2].eintraege.map((e) => e.wert)).toEqual(['Polizei vor Ort']);
  });

  it('stellt Demo-Einträge hinter alle echten, in eine eigene Gruppe', () => {
    const liste = baueVorschlagsliste([einsatz, stammdaten, zuletzt], '');
    expect(liste.gruppen.flatMap((g) => g.eintraege).some((e) => e.demo)).toBe(false);
    expect(liste.demo.map((e) => e.wert)).toEqual(['Demo-ELW']);
  });

  it('filtert per Teilwort auf Wert und Beschriftung; leere Gruppen fallen weg', () => {
    const liste = baueVorschlagsliste([einsatz, stammdaten, zuletzt], 'lage');
    expect(liste.gruppen.map((g) => g.titel)).toEqual(['Im Einsatz']);
    expect(liste.gruppen[0].eintraege.map((e) => e.wert)).toEqual(['S2']);
    expect(baueVorschlagsliste([stammdaten], 'demo').demo).toHaveLength(1);
  });
});

describe('herkunftDesWerts', () => {
  it('nennt für einen leeren Wert nichts', () => {
    expect(herkunftDesWerts({ text: '  ' }, [einsatz])).toBeNull();
  });

  it('nennt die Gruppe eines exakten Treffers, sonst „frei“ (Modus nurText)', () => {
    expect(herkunftDesWerts({ text: 'elw 1 ' }, [einsatz, stammdaten])).toBe('stammdaten');
    expect(herkunftDesWerts({ text: 'S2' }, [einsatz, stammdaten])).toBe('einsatz');
    expect(herkunftDesWerts({ text: 'ELW' }, [einsatz, stammdaten])).toBe('frei');
  });

  it('„Zuletzt verwendet“ ist keine Quelle: ein Wert nur von dort bleibt „frei“', () => {
    expect(herkunftDesWerts({ text: 'Polizei vor Ort' }, [zuletzt])).toBe('frei');
  });

  it('eine Referenz gewinnt über den Text', () => {
    expect(
      herkunftDesWerts({ text: 'umbenannt', ref: { quelle: 'fahrzeugeStammdaten', id: 1 } }, [
        einsatz,
        stammdaten,
      ]),
    ).toBe('stammdaten');
  });

  it('die Wörter der Marke sind Wörter, kein Farbton allein', () => {
    expect(HERKUNFT_WORT).toEqual({
      einsatz: 'Im Einsatz',
      stammdaten: 'Stammdaten',
      frei: 'frei',
    });
  });
});

describe('exakterTreffer', () => {
  it('findet den ersten Treffer aus Einsatz oder Stammdaten, nie aus „Zuletzt verwendet“', () => {
    expect(exakterTreffer('ELW 1', [zuletzt, stammdaten])?.ref).toEqual({
      quelle: 'fahrzeugeStammdaten',
      id: 1,
    });
    expect(exakterTreffer('Polizei vor Ort', [zuletzt])).toBeUndefined();
  });
});
