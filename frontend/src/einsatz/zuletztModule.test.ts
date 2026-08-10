import { beforeEach, describe, expect, it } from 'vitest';
import { ZULETZT_MAX, leseZuletztModule, merkeModulBesuch } from './zuletztModule';

describe('zuletztModule', () => {
  // Der Polyfill in `test/setup.ts` ist prozessweit und behält seinen Inhalt zwischen
  // Tests — ohne das Leeren trüge der zweite Test die Besuche des ersten.
  beforeEach(() => localStorage.clear());

  it('liefert ohne Besuche eine leere Liste', () => {
    expect(leseZuletztModule(1)).toEqual([]);
  });

  it('stellt das juengste Modul nach vorn', () => {
    merkeModulBesuch(1, 'etb');
    merkeModulBesuch(1, 'personen');
    expect(leseZuletztModule(1)).toEqual(['personen', 'etb']);
  });

  it('haelt hoechstens ZULETZT_MAX Eintraege', () => {
    for (const k of ['a', 'b', 'c', 'd']) merkeModulBesuch(1, k);
    expect(leseZuletztModule(1)).toEqual(['d', 'c', 'b']);
    expect(leseZuletztModule(1)).toHaveLength(ZULETZT_MAX);
  });

  it('zaehlt einen erneuten Besuch nicht doppelt, sondern hebt ihn nach vorn', () => {
    // Ohne die Dubletten-Entfernung fuellte ein Hin-und-Her zwischen zwei Modulen die
    // Liste mit demselben Eintrag und verdraengte den dritten — die „Zuletzt"-Zeile
    // zeigte dann zwei Kopien statt drei Zielen.
    merkeModulBesuch(1, 'etb');
    merkeModulBesuch(1, 'personen');
    merkeModulBesuch(1, 'etb');
    expect(leseZuletztModule(1)).toEqual(['etb', 'personen']);
  });

  it('haelt die Einsaetze auseinander', () => {
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
    // Ein `JSON.parse`, das gelingt, ist noch kein `string[]` — ohne die Formpruefung
    // liefe `.slice` auf einer Zahl in einen TypeError im Render-Pfad der Navigation.
    localStorage.setItem('lfh:nav:zuletzt:1', '42');
    expect(leseZuletztModule(1)).toEqual([]);
  });
});
