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

  it('bricht einen Zyklus unterhalb eines Kopfes ab, statt zu hängen', () => {
    // Zyklus unterhalb eines Kopfes: 15 → 13 → 11 → 13 …
    const k = kettenKoepfe([b(15, 13, 3), b(13, 11, 2), b(11, 13, 1)]);
    expect(k.map((x) => x.kopf.id)).toEqual([15]);
    expect(k[0].vorgaenger.map((x) => x.id)).toEqual([13, 11]);
  });

  it('zeigt auch einen VOLLSTÄNDIGEN Zyklus, statt die Berichte fallen zu lassen', () => {
    // Datenfehler 11 → 13 → 11: jedes Glied hat einen Nachfolger, es gibt also keinen Kopf.
    // Bis LFH-495 war das Ergebnis eine LEERE Liste — beide Berichte verschwanden lautlos
    // aus der Übersicht. Jetzt trägt das erste Glied der Listenreihenfolge die Kette.
    const k = kettenKoepfe([b(11, 13, 1), b(13, 11, 2)]);
    expect(k.map((x) => x.kopf.id)).toEqual([11]);
    expect(k[0].vorgaenger.map((x) => x.id)).toEqual([13]);
  });

  it('hängt die Restmenge NACH den echten Köpfen an (Reihenfolge bleibt)', () => {
    // Ein sauberer Strang (15 → 14) neben einem vollständigen Zyklus (11 ↔ 13). Der echte
    // Kopf bleibt vorn; der Zyklus schiebt sich nicht zwischen die Serverordnung.
    const k = kettenKoepfe([b(11, 13, 1), b(15, 14, 2), b(13, 11, 2), b(14, null, 1)]);
    expect(k.map((x) => x.kopf.id)).toEqual([15, 11]);
    expect(k[0].vorgaenger.map((x) => x.id)).toEqual([14]);
    expect(k[1].vorgaenger.map((x) => x.id)).toEqual([13]);
  });

  it('lässt KEINEN Bericht aus der Sicht fallen — auch nicht bei zwei Zyklen', () => {
    // Die tragende Aussage des Nachzugs, als Mengenvergleich statt als Einzelfall: was in
    // die Funktion geht, kommt als Kopf oder als Vorgänger wieder heraus.
    const liste = [b(11, 13, 1), b(13, 11, 2), b(21, 22, 1), b(22, 21, 2), b(30, null, 1)];
    const k = kettenKoepfe(liste);
    const sichtbar = new Set(k.flatMap((x) => [x.kopf.id, ...x.vorgaenger.map((v) => v.id)]));
    expect([...sichtbar].sort((x, y) => x - y)).toEqual([11, 13, 21, 22, 30]);
  });
});
