import { describe, expect, it } from 'vitest';
import type { EtbBaustein, EinsatzAnzeige } from '../api/types';
import { ermittlePlatzhalter, setzeBausteinEin } from './bausteinEinsetzen';

function baustein(p: Partial<EtbBaustein>): EtbBaustein {
  return { id: 1, label: 'B', typ: 'meldung', inhalt: '', meldeweg: null, veranlassung: null, sortier: 0, ...p };
}

const einsatz = {
  bezeichnung: 'Hochwasser Altstadt',
  stichwort: 'THL groß',
  leitstellen_nr: 'LS-2026-042',
  einsatzort: 'Marktplatz 1',
} as unknown as EinsatzAnzeige;

describe('ermittlePlatzhalter', () => {
  it('listet nur manuelle Platzhalter (Auto-Kontext ausgenommen), eindeutig und in Reihenfolge', () => {
    const b = baustein({ inhalt: 'Am {einsatzort}: {einheit} und {abschnitt}, erneut {einheit}.' });
    expect(ermittlePlatzhalter(b, einsatz)).toEqual(['einheit', 'abschnitt']);
  });

  it('stuft Auto-Platzhalter mit fehlendem Wert zu manuell herab', () => {
    const leererEinsatz = { ...einsatz, einsatzort: null } as EinsatzAnzeige;
    const b = baustein({ inhalt: 'Lage in {einsatzort}.' });
    expect(ermittlePlatzhalter(b, leererEinsatz)).toEqual(['einsatzort']);
  });

  it('berücksichtigt Platzhalter auch in veranlassung', () => {
    const b = baustein({ inhalt: 'Text', veranlassung: 'Wegen {grund}.' });
    expect(ermittlePlatzhalter(b, einsatz)).toEqual(['grund']);
  });
});

describe('setzeBausteinEin', () => {
  it('substituiert Auto-Kontext still und manuelle Werte', () => {
    const b = baustein({ typ: 'meldung', inhalt: '{einheit} an {einsatzort} (Einsatz {einsatz}).' });
    const ergebnis = setzeBausteinEin(b, einsatz, { einheit: '1. Zug' });
    expect(ergebnis).toEqual({
      typ: 'meldung',
      inhalt: '1. Zug an Marktplatz 1 (Einsatz Hochwasser Altstadt).',
    });
  });

  it('nicht ausgefüllter manueller Platzhalter wird zu leerem String', () => {
    const b = baustein({ inhalt: 'X {fehlt} Y' });
    expect(setzeBausteinEin(b, einsatz, {}).inhalt).toBe('X  Y');
  });

  it('literale Klammern ohne gültiges Token bleiben unverändert', () => {
    const b = baustein({ inhalt: 'Menge { ca. 5 } Stück {Großschreibung}' });
    expect(setzeBausteinEin(b, einsatz, {}).inhalt).toBe('Menge { ca. 5 } Stück {Großschreibung}');
  });

  it('substituiert meldeweg/veranlassung nur wenn gesetzt', () => {
    const b = baustein({ inhalt: 'a', meldeweg: 'funk', veranlassung: 'Wegen {grund}.' });
    const ergebnis = setzeBausteinEin(b, einsatz, { grund: 'Sturm' });
    expect(ergebnis.meldeweg).toBe('funk');
    expect(ergebnis.veranlassung).toBe('Wegen Sturm.');
  });

  it('lässt meldeweg weg, wenn der Baustein keines hat', () => {
    const b = baustein({ inhalt: 'x', meldeweg: null });
    expect(setzeBausteinEin(b, einsatz, {})).not.toHaveProperty('meldeweg');
  });
});
