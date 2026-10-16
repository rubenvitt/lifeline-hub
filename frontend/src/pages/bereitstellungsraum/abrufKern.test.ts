import { describe, expect, it } from 'vitest';
import type { BrAbrufKurz, BrEinheitKurz, BrFahrzeugKurz, Einheit } from '../../api/types';
import {
  abrufAngabe,
  abrufFelderRechte,
  abrufFolge,
  abrufQuittung,
  teileNachAbruf,
  verbandImRaum,
} from './abrufKern';

function abruf(over: Partial<BrAbrufKurz> = {}): BrAbrufKurz {
  return { seit_at: '2026-10-15 12:32:00', ...over };
}

function brEinheit(id: number, name: string, over: Partial<BrEinheitKurz> = {}): BrEinheitKurz {
  return { id, name, fahrzeuge: [], unangemeldet: false, ...over };
}

function brFahrzeug(id: number, funkrufname: string, over: Partial<BrFahrzeugKurz> = {}) {
  return { id, funkrufname, ...over } satisfies BrFahrzeugKurz;
}

describe('Belegung nach Abruf teilen (LLH-1085, Spec „Detail nennt den Abruf“)', () => {
  it('abgerufene Kräfte stehen getrennt, die übrigen bleiben bereitgestellt', () => {
    const t = teileNachAbruf(
      [brEinheit(1, '1. Zug', { abruf: abruf() }), brEinheit(2, '2. Zug')],
      [brFahrzeug(1, 'Florian 1'), brFahrzeug(3, 'Florian 3', { abruf: abruf() })],
    );
    expect(t.einheiten.map((e) => e.name)).toEqual(['2. Zug']);
    expect(t.fahrzeuge.map((f) => f.funkrufname)).toEqual(['Florian 1']);
    expect(t.abgerufen.map((z) => [z.objekt_typ, z.objekt_id, z.name])).toEqual([
      ['einheit', 1, '1. Zug'],
      ['fahrzeug', 3, 'Florian 3'],
    ]);
  });

  it('Einheit und Fahrzeug mit gleicher Kennung kollidieren in der Schleuse nicht', () => {
    const t = teileNachAbruf(
      [brEinheit(7, 'HLF 20', { abruf: abruf() })],
      [brFahrzeug(7, 'Florian 7', { abruf: abruf() })],
    );
    const ids = t.abgerufen.map((z) => z.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('ohne Abruf ist nichts abgerufen', () => {
    const t = teileNachAbruf([brEinheit(1, 'A', { abruf: null })], [brFahrzeug(1, 'F')]);
    expect(t.abgerufen).toEqual([]);
    expect(t.einheiten).toHaveLength(1);
  });
});

describe('Folge der Abgerufenen', () => {
  it('am längsten abgerufen zuerst, bei Gleichstand nach Name', () => {
    const t = teileNachAbruf(
      [
        brEinheit(1, 'Zug B', { abruf: abruf({ seit_at: '2026-10-15 12:40:00' }) }),
        brEinheit(2, 'Zug A', { abruf: abruf({ seit_at: '2026-10-15 12:40:00' }) }),
      ],
      [brFahrzeug(3, 'Florian 3', { abruf: abruf({ seit_at: '2026-10-15 12:30:00' }) })],
    );
    const folge = [...t.abgerufen].sort((a, b) => (abrufFolge(a) < abrufFolge(b) ? -1 : 1));
    expect(folge.map((z) => z.name)).toEqual(['Florian 3', 'Zug A', 'Zug B']);
  });
});

describe('Angabe „abgerufen 1432 → EA Deich“', () => {
  it('Uhrzeit, Ziel und Auftragsnummer', () => {
    expect(abrufAngabe('1432', abruf({ ziel_anzeige: 'EA Deich', auftrag_nr: 7 }))).toBe(
      '1432 → EA Deich · Auftrag Nr. 7',
    );
  });

  it('ohne Ziel und Auftrag nur die Uhrzeit', () => {
    expect(abrufAngabe('1432', abruf())).toBe('1432');
  });

  it('eine mitgenommene Untereinheit nennt ihre Einheit', () => {
    expect(abrufAngabe('1432', abruf({ ziel_anzeige: 'EA Deich' }), '1. Zug')).toBe(
      '1432 → EA Deich · mit 1. Zug',
    );
  });
});

describe('Verband im Raum (Spec „Verband geht mit“)', () => {
  const e = (id: number, name: string, ueber: number | null) =>
    ({ id, name, ueber_einheit_id: ueber }) as Einheit;
  const alle = [
    e(1, '1. Zug', null),
    e(2, 'Gruppe 2', 1),
    e(3, 'Gruppe 1', 1),
    e(4, 'Trupp', 2),
    e(5, 'Fremd', null),
  ];

  it('nimmt Untereinheiten über alle Ebenen mit, die im Raum stehen, nach Name', () => {
    const imRaum = [brEinheit(1, '1. Zug'), brEinheit(2, 'Gruppe 2'), brEinheit(3, 'Gruppe 1')];
    imRaum.push(brEinheit(4, 'Trupp'), brEinheit(5, 'Fremd'));
    expect(verbandImRaum(1, imRaum, alle)).toEqual(['Gruppe 1', 'Gruppe 2', 'Trupp']);
  });

  it('auch unter einer Zwischenebene, die nicht im Raum steht', () => {
    const imRaum = [brEinheit(1, '1. Zug'), brEinheit(4, 'Trupp')];
    expect(verbandImRaum(1, imRaum, alle)).toEqual(['Trupp']);
  });

  it('eine schon abgerufene Untereinheit geht nicht mit, die Einheit selbst fehlt', () => {
    const imRaum = [
      brEinheit(1, '1. Zug'),
      brEinheit(2, 'Gruppe 2', { abruf: abruf() }),
      brEinheit(3, 'Gruppe 1'),
    ];
    expect(verbandImRaum(1, imRaum, alle)).toEqual(['Gruppe 1']);
  });
});

describe('Rechte der Abruf-Felder (Spec „Rechte des Abrufs“)', () => {
  const frei = { sichtbar: true, zugriff: true };
  const zu = { sichtbar: true, zugriff: false };
  const alle = { einheiten: frei, einsatzabschnitte: frei, auftraege: frei };

  it('alles frei: beide Felder offen', () => {
    expect(abrufFelderRechte(alle)).toEqual({ abschnitt: null, auftrag: null });
  });

  it('ohne Einheiten ist der Abschnitt gesperrt, mit Grund', () => {
    expect(abrufFelderRechte({ ...alle, einheiten: zu }).abschnitt).toBe(
      'Modul Einheiten gesperrt',
    );
  });

  it('ohne Einsatzabschnitte gibt es keine Liste der Abschnitte', () => {
    expect(abrufFelderRechte({ ...alle, einsatzabschnitte: zu }).abschnitt).toBe(
      'Modul Einsatzabschnitte gesperrt',
    );
  });

  it('ohne Aufträge ist der Auftrag gesperrt, der Abschnitt nicht', () => {
    expect(abrufFelderRechte({ ...alle, auftraege: zu })).toEqual({
      abschnitt: null,
      auftrag: 'Modul Aufträge gesperrt',
    });
  });

  it('solange die Freigaben laden, ist beides gesperrt, ohne erfundenen Grund', () => {
    expect(abrufFelderRechte(undefined)).toEqual({ abschnitt: '', auftrag: '' });
  });
});

describe('Quittung des Abrufs', () => {
  it('mit Ziel und Auftrag', () => {
    expect(abrufQuittung('HLF 20', { ziel: 'EA Deich', auftragNr: 7, ausgetragen: false })).toBe(
      'HLF 20 abgerufen → EA Deich · Auftrag Nr. 7',
    );
  });

  it('abgerufen und ausgetragen, ohne Ziel', () => {
    expect(abrufQuittung('HLF 20', { ziel: null, auftragNr: null, ausgetragen: true })).toBe(
      'HLF 20 abgerufen und ausgetragen',
    );
  });
});
