import { describe, expect, it } from 'vitest';
import { kettenKoepfe } from './ketten';
import type { LageberichtAnzeige } from '../api/types';

const b = (id: number, vorgaenger_id: number | null, version: number): LageberichtAnzeige => ({
  id, vorgaenger_id, version, einsatz_id: 7, vorlage: 'freitext', titel: 'L', zeitstand: '',
  status: 'entwurf', abschnitte: [], ersteller_id: 1, ersteller_name: 'A', erstellt_at: '',
  aktualisiert_at: '', freigegeben_von_id: null, freigegeben_von_name: null, freigegeben_at: null,
  etb_eintrag_id: null,
});

describe('kettenKoepfe', () => {
  it('liefert je Kette den Kopf ohne Nachfolger, die Vorgänger jüngster zuerst', () => {
    const k = kettenKoepfe([b(11, null, 1), b(13, 11, 2), b(15, 13, 3), b(14, null, 1)]);
    expect(k.map((x) => x.kopf.id)).toEqual([15, 14]);
    expect(k[0].vorgaenger.map((x) => x.id)).toEqual([13, 11]);
    expect(k[1].vorgaenger).toEqual([]);
  });

  it('behält die Listenreihenfolge der Köpfe (Serverordnung bleibt Sache der Sicht)', () => {
    const k = kettenKoepfe([b(14, null, 1), b(11, null, 1), b(13, 11, 2)]);
    expect(k.map((x) => x.kopf.id)).toEqual([14, 13]);
  });

  it('behandelt einen Vorgänger, der nicht in der Liste ist, als Kettenanfang', () => {
    const k = kettenKoepfe([b(13, 99, 2)]);
    expect(k.map((x) => x.kopf.id)).toEqual([13]);
    expect(k[0].vorgaenger).toEqual([]);
  });

  it('bricht einen Zyklus ab, statt zu hängen', () => {
    // Datenfehler: 11 → 13 → 11. Keiner ist Kopf (beide haben einen Nachfolger) — die
    // Funktion liefert dann nichts, statt in der Schleife zu bleiben.
    expect(kettenKoepfe([b(11, 13, 1), b(13, 11, 2)])).toEqual([]);
    // Zyklus unterhalb eines Kopfes: 15 → 13 → 11 → 13 …
    const k = kettenKoepfe([b(15, 13, 3), b(13, 11, 2), b(11, 13, 1)]);
    expect(k[0].vorgaenger.map((x) => x.id)).toEqual([13, 11]);
  });
});
