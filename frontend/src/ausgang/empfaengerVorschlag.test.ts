import { describe, expect, it } from 'vitest';
import type { KanalMitStelle } from '../api/types';
import {
  abschnittVorschau,
  empfaengerVorschlag,
  externeVerteilerNamen,
} from './empfaengerVorschlag';

const kanal = (
  id: number,
  stelle: string,
  stelleId = id,
  art: 'email' | 'matrix' = 'email',
): KanalMitStelle => ({
  agency_id: stelleId,
  agency_name: stelle,
  channel: {
    id,
    externe_stelle_id: stelleId,
    channel: art,
    address: art === 'matrix' ? `#raum${id}:example.org` : `s${id}@example.org`,
  },
});

describe('empfaengerVorschlag', () => {
  it('trifft ohne Groß/Klein und Leerraum', () => {
    const k = [kanal(1, 'leitstelle nord')];
    expect(empfaengerVorschlag(k, ['Leitstelle  Nord'])).toEqual(new Set([1]));
  });

  it('trifft nur den ganzen Namen, nicht einen Teil', () => {
    const k = [kanal(1, 'Leitstelle Nord')];
    expect(empfaengerVorschlag(k, ['Nord']).size).toBe(0);
  });

  it('vorschlag_nimmt_je_stelle_eine_adresse_matrix_vor_mail', () => {
    const k = [
      kanal(1, 'ILS', 7),
      kanal(2, 'ILS', 7, 'matrix'),
      kanal(3, 'ILS', 7, 'matrix'),
      kanal(4, 'Andere', 8),
      kanal(5, 'Andere', 8),
      kanal(6, 'Dritte', 9, 'matrix'),
    ];
    // ILS: die erste Matrix-Adresse (2), Andere: die erste Mail (4); Dritte steht nicht im Verteiler.
    expect(empfaengerVorschlag(k, ['ils', 'andere'])).toEqual(new Set([2, 4]));
  });

  it('ignoriert leere Namen', () => {
    expect(empfaengerVorschlag([kanal(1, 'ILS')], ['', '  ']).size).toBe(0);
  });
});

describe('externeVerteilerNamen und abschnittVorschau', () => {
  it('nimmt nur externe Einträge mit Bezeichnung', () => {
    expect(
      externeVerteilerNamen([
        { empfaenger_typ: 'extern', extern_bezeichnung: 'ILS Nord' },
        { empfaenger_typ: 'extern', extern_bezeichnung: null },
        { empfaenger_typ: 'abschnitt', extern_bezeichnung: 'X' },
      ]),
    ).toEqual(['ILS Nord']);
  });

  it('fügt die nichtleeren Abschnittstexte zusammen', () => {
    expect(abschnittVorschau([{ text: 'a' }, { text: ' ' }, { text: 'b' }])).toBe('a\nb');
  });
});
