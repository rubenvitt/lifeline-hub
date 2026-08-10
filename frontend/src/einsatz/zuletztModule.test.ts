import { beforeEach, describe, expect, it } from 'vitest';
import {
  ZULETZT_MAX, leseZuletztModule, loeseZuletztModule, merkeModulBesuch,
} from './zuletztModule';

describe('zuletztModule', () => {
  // Der Polyfill in `test/setup.ts` ist prozessweit und behält seinen Inhalt zwischen
  // Tests — ohne das Leeren trüge der zweite Test die Besuche des ersten.
  beforeEach(() => localStorage.clear());

  it('liefert ohne Besuche eine leere Liste', () => {
    expect(leseZuletztModule(1)).toEqual([]);
  });

  it('stellt das jüngste Modul nach vorn', () => {
    merkeModulBesuch(1, 'etb');
    merkeModulBesuch(1, 'personen');
    expect(leseZuletztModule(1)).toEqual(['personen', 'etb']);
  });

  it('hält höchstens ZULETZT_MAX Einträge', () => {
    for (const k of ['a', 'b', 'c', 'd']) merkeModulBesuch(1, k);
    expect(leseZuletztModule(1)).toEqual(['d', 'c', 'b']);
    expect(leseZuletztModule(1)).toHaveLength(ZULETZT_MAX);
  });

  it('zählt einen erneuten Besuch nicht doppelt, sondern hebt ihn nach vorn', () => {
    // Ohne die Dubletten-Entfernung füllte ein Hin-und-Her zwischen zwei Modulen die
    // Liste mit demselben Eintrag und verdrängte den dritten — die „Zuletzt"-Zeile
    // zeigte dann zwei Kopien statt drei Zielen.
    merkeModulBesuch(1, 'etb');
    merkeModulBesuch(1, 'personen');
    merkeModulBesuch(1, 'etb');
    expect(leseZuletztModule(1)).toEqual(['etb', 'personen']);
  });

  it('hält die Einsätze auseinander', () => {
    merkeModulBesuch(1, 'etb');
    merkeModulBesuch(2, 'personen');
    expect(leseZuletztModule(1)).toEqual(['etb']);
    expect(leseZuletztModule(2)).toEqual(['personen']);
  });

  it('liefert bei kaputtem Inhalt eine leere Liste statt zu werfen', () => {
    localStorage.setItem('lfh:nav:zuletzt:1', '{kein json');
    expect(leseZuletztModule(1)).toEqual([]);
  });

  it('liefert bei fremdem JSON-Typ eine leere Liste', () => {
    // Ein `JSON.parse`, das gelingt, ist noch kein `string[]` — ohne die Formprüfung
    // liefe `.slice` auf einer Zahl in einen TypeError im Render-Pfad der Navigation.
    localStorage.setItem('lfh:nav:zuletzt:1', '42');
    expect(leseZuletztModule(1)).toEqual([]);
  });
});

/**
 * Die Auflösung wohnt seit der Fix-Welle (LFH-337 · B3) hier statt inline im
 * `EinsatzLayout`. Die Filter selbst sind über den gerenderten Rahmen gepinnt
 * (`EinsatzLayout.test.tsx`); was dort NICHT vorkommt, ist der Aufruf OHNE
 * Ausschlüsse — der Rahmen übergibt immer beide. Genau der ist hier die Aussage:
 * `ausser` ist optional, und ein Aufruf ohne es darf nichts wegfiltern.
 */
describe('loeseZuletztModule', () => {
  beforeEach(() => localStorage.clear());

  it('löst ohne Ausschlüsse alle gemerkten Schlüssel auf', () => {
    merkeModulBesuch(1, 'etb');
    merkeModulBesuch(1, 'lagekarte');
    expect(loeseZuletztModule(1, null).map((m) => m.key)).toEqual(['lagekarte', 'etb']);
  });

  it('verwirft einen Schlüssel, den die Registry nicht kennt', () => {
    // Ein umbenanntes oder entferntes Modul steht noch im Speicher der Person. Ohne
    // diesen Zweig führte der Eintrag ins Leere — hier fällt er still heraus.
    merkeModulBesuch(1, 'gibtesnicht');
    merkeModulBesuch(1, 'etb');
    expect(loeseZuletztModule(1, null).map((m) => m.key)).toEqual(['etb']);
  });

  it('nimmt die beiden Ausschlüsse einzeln entgegen', () => {
    merkeModulBesuch(1, 'etb');
    merkeModulBesuch(1, 'lagekarte');
    // 'etb' liegt in 'erfassung', 'lagekarte' in 'lage' — je Ausschluss bleibt genau
    // das andere übrig. Getrennt geprüft, weil ein gemeinsamer Aufruf die leere Liste
    // liefert und damit nicht sagt, WELCHER Ausschluss gegriffen hat.
    expect(loeseZuletztModule(1, null, undefined, { key: 'lagekarte' }).map((m) => m.key))
      .toEqual(['etb']);
    expect(loeseZuletztModule(1, null, undefined, { kategorie: 'erfassung' }).map((m) => m.key))
      .toEqual(['lagekarte']);
  });
});
