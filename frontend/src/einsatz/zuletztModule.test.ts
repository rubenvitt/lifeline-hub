import { beforeEach, describe, expect, it } from 'vitest';
import {
  ZULETZT_FRIST_MS,
  ZULETZT_MAX,
  leseZuletztModule,
  merkeModulBesuch,
} from './zuletztModule';

/** Benutzer A und B am selben Browser; Einsatz 1 und 2. */
const A = 3;
const B = 4;
const MINUTE = 60_000;

describe('zuletztModule', () => {
  // Der Polyfill in `test/setup.ts` ist prozessweit und behält seinen Inhalt zwischen
  // Tests — ohne das Leeren trüge der zweite Test die Besuche des ersten.
  beforeEach(() => localStorage.clear());

  it('liefert ohne Besuche eine leere Liste', () => {
    expect(leseZuletztModule(A, 1)).toEqual([]);
  });

  it('stellt das jüngste Modul nach vorn', () => {
    merkeModulBesuch(A, 1, 'etb');
    merkeModulBesuch(A, 1, 'personen');
    expect(leseZuletztModule(A, 1)).toEqual(['personen', 'etb']);
  });

  it('hält höchstens ZULETZT_MAX Einträge', () => {
    for (const k of ['a', 'b', 'c', 'd']) merkeModulBesuch(A, 1, k);
    expect(leseZuletztModule(A, 1)).toEqual(['d', 'c', 'b']);
    expect(leseZuletztModule(A, 1)).toHaveLength(ZULETZT_MAX);
  });

  it('zählt einen erneuten Besuch nicht doppelt, sondern hebt ihn nach vorn', () => {
    // Ohne die Dubletten-Entfernung füllte ein Hin-und-Her zwischen zwei Modulen die Liste mit
    // demselben Eintrag und verdrängte den dritten.
    merkeModulBesuch(A, 1, 'etb');
    merkeModulBesuch(A, 1, 'personen');
    merkeModulBesuch(A, 1, 'etb');
    expect(leseZuletztModule(A, 1)).toEqual(['etb', 'personen']);
  });

  it('hält die Einsätze auseinander', () => {
    merkeModulBesuch(A, 1, 'etb');
    merkeModulBesuch(A, 2, 'personen');
    expect(leseZuletztModule(A, 1)).toEqual(['etb']);
    expect(leseZuletztModule(A, 2)).toEqual(['personen']);
  });

  /** Schichtwechsel am gemeinsamen Fükw-Rechner (LFH-436): B erbt nichts von A. */
  it('hält die Benutzer auseinander', () => {
    merkeModulBesuch(A, 1, 'etb');
    expect(leseZuletztModule(B, 1)).toEqual([]);
    merkeModulBesuch(B, 1, 'personen');
    expect(leseZuletztModule(A, 1)).toEqual(['etb']);
    expect(leseZuletztModule(B, 1)).toEqual(['personen']);
  });

  describe('Frist', () => {
    const t0 = Date.UTC(2026, 8, 29, 6, 0);

    it('beträgt zwölf Stunden', () => {
      expect(ZULETZT_FRIST_MS).toBe(12 * 60 * MINUTE);
    });

    it('zeigt einen Eintrag knapp innerhalb der Frist', () => {
      merkeModulBesuch(A, 1, 'etb', t0);
      expect(leseZuletztModule(A, 1, t0 + ZULETZT_FRIST_MS - MINUTE)).toEqual(['etb']);
    });

    it('lässt einen Eintrag knapp nach der Frist fallen', () => {
      merkeModulBesuch(A, 1, 'etb', t0);
      expect(leseZuletztModule(A, 1, t0 + ZULETZT_FRIST_MS + MINUTE)).toEqual([]);
    });

    it('prüft die Frist je Eintrag, nicht für die ganze Liste', () => {
      // Ein Zeitstempel für die Liste hielte den alten Eintrag mit der frischen Wahl am Leben.
      merkeModulBesuch(A, 1, 'etb', t0);
      merkeModulBesuch(A, 1, 'personen', t0 + 11 * 60 * MINUTE);
      expect(leseZuletztModule(A, 1, t0 + 13 * 60 * MINUTE)).toEqual(['personen']);
    });

    it('beginnt die Frist bei erneuter Wahl neu', () => {
      merkeModulBesuch(A, 1, 'etb', t0);
      merkeModulBesuch(A, 1, 'personen', t0);
      merkeModulBesuch(A, 1, 'etb', t0 + 11 * 60 * MINUTE);
      expect(leseZuletztModule(A, 1, t0 + 20 * 60 * MINUTE)).toEqual(['etb']);
    });

    it('schreibt abgelaufene Einträge beim nächsten Merken nicht zurück', () => {
      // Sonst belegte ein verfallener Eintrag weiter einen der drei Plätze im Speicher.
      for (const k of ['a', 'b', 'c']) merkeModulBesuch(A, 1, k, t0);
      merkeModulBesuch(A, 1, 'd', t0 + ZULETZT_FRIST_MS + MINUTE);
      const roh = JSON.parse(localStorage.getItem(`lfh:nav:zuletzt:${A}:1`) ?? '[]') as unknown[];
      expect(roh).toHaveLength(1);
    });
  });

  it('liefert bei kaputtem Inhalt eine leere Liste statt zu werfen', () => {
    localStorage.setItem(`lfh:nav:zuletzt:${A}:1`, '{kein json');
    expect(leseZuletztModule(A, 1)).toEqual([]);
  });

  it('liefert bei fremdem JSON-Typ eine leere Liste', () => {
    // Ein `JSON.parse`, das gelingt, ist noch kein Eintragsfeld — ohne die Formprüfung
    // liefe `.filter` auf einer Zahl in einen TypeError im Render-Pfad der Navigation.
    localStorage.setItem(`lfh:nav:zuletzt:${A}:1`, '42');
    expect(leseZuletztModule(A, 1)).toEqual([]);
  });

  it('übergeht Einträge im alten Format (reine Schlüssel ohne Zeitstempel)', () => {
    localStorage.setItem(`lfh:nav:zuletzt:${A}:1`, '["etb","personen"]');
    localStorage.setItem('lfh:nav:zuletzt:1', '["etb"]');
    expect(leseZuletztModule(A, 1)).toEqual([]);
  });
});
