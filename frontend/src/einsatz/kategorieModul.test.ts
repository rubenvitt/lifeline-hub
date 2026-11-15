import { beforeEach, describe, expect, it } from 'vitest';
import {
  KATEGORIE_MODUL_FRIST_MS,
  loadKategorieModul,
  saveKategorieModul,
  rueckkehrModul,
} from './kategorieModul';
import { modulRegistry, type ModulEintrag } from './modulRegistry';
import { freigabenFixture } from '../test/fixtures';

/** Benutzer A und B am selben Browser; Einsatz 1 und 2. */
const A = 3;
const B = 4;
const MINUTE = 60_000;

const modul = (key: string): ModulEintrag => modulRegistry.find((m) => m.key === key)!;

/** Alles frei, wie der Server es für eine Einsatzleitung meldet. */
const alleFrei = freigabenFixture();

describe('kategorieModul: gemerktes Modul je Kategorie', () => {
  // Der Polyfill in `test/setup.ts` ist prozessweit; ohne Leeren erbte jeder Test den vorigen.
  beforeEach(() => localStorage.clear());

  it('liefert ohne Besuch nichts', () => {
    expect(loadKategorieModul(A, 1, 'kraefte')).toBeNull();
  });

  it('merkt je Kategorie das zuletzt besuchte Modul', () => {
    saveKategorieModul(A, 1, modul('kraefteuebersicht'));
    saveKategorieModul(A, 1, modul('abloesung'));
    saveKategorieModul(A, 1, modul('schaeden'));
    expect(loadKategorieModul(A, 1, 'kraefte')).toBe('abloesung');
    expect(loadKategorieModul(A, 1, 'erfassung')).toBe('schaeden');
  });

  it('trennt Personen und Einsätze', () => {
    saveKategorieModul(A, 1, modul('abloesung'));
    expect(loadKategorieModul(B, 1, 'kraefte')).toBeNull();
    expect(loadKategorieModul(A, 2, 'kraefte')).toBeNull();
  });

  it('vergisst einen Besuch nach Ablauf der Frist', () => {
    const t0 = 1_000_000;
    saveKategorieModul(A, 1, modul('abloesung'), t0);
    expect(loadKategorieModul(A, 1, 'kraefte', t0 + KATEGORIE_MODUL_FRIST_MS)).toBe('abloesung');
    expect(loadKategorieModul(A, 1, 'kraefte', t0 + KATEGORIE_MODUL_FRIST_MS + MINUTE)).toBeNull();
  });

  it('hält einen abgelaufenen Eintrag nicht auf, wenn eine andere Kategorie geschrieben wird', () => {
    const t0 = 1_000_000;
    saveKategorieModul(A, 1, modul('abloesung'), t0);
    saveKategorieModul(A, 1, modul('schaeden'), t0 + KATEGORIE_MODUL_FRIST_MS + MINUTE);
    expect(loadKategorieModul(A, 1, 'kraefte', t0 + KATEGORIE_MODUL_FRIST_MS + MINUTE)).toBeNull();
    expect(loadKategorieModul(A, 1, 'erfassung', t0 + KATEGORIE_MODUL_FRIST_MS + MINUTE)).toBe(
      'schaeden',
    );
  });

  it('nimmt fremden Inhalt im Speicher als „nichts gemerkt“', () => {
    for (const roh of [
      '42',
      '["abloesung"]',
      '{"kraefte":"abloesung"}',
      '{"kraefte":{"key":1}}',
      'kaputt',
    ]) {
      localStorage.setItem(`lfh:nav:kategorie-modul:${A}:1`, roh);
      expect(loadKategorieModul(A, 1, 'kraefte')).toBeNull();
    }
  });
});

describe('rueckkehrModul: wohin der Rail-Sprung führt', () => {
  it('führt ohne Eintrag ins erste freigegebene Modul', () => {
    expect(rueckkehrModul('kraefte', null, alleFrei)?.key).toBe('kraefteuebersicht');
  });

  it('führt ins gemerkte Modul der Kategorie', () => {
    expect(rueckkehrModul('kraefte', 'abloesung', alleFrei)?.key).toBe('abloesung');
  });

  it('führt bei gesperrtem gemerktem Modul ins erste freigegebene', () => {
    const freigaben = freigabenFixture({ abloesung: { zugriff: false } });
    expect(rueckkehrModul('kraefte', 'abloesung', freigaben)?.key).toBe('kraefteuebersicht');
  });

  it('führt bei ausgeblendetem gemerktem Modul ins erste freigegebene', () => {
    const freigaben = freigabenFixture({ abloesung: { sichtbar: false } });
    expect(rueckkehrModul('kraefte', 'abloesung', freigaben)?.key).toBe('kraefteuebersicht');
  });

  /**
   * Spec `seiten-orientierung`, „Gemerktes Modul in eine andere Kategorie gewandert“ (y3zh5ymv
   * D10): vor dem Umzug ins ETB nach „Führung“ stand es unter dem Schlüssel `erfassung` im Speicher.
   */
  it('nimmt ein gemerktes Modul nicht, das inzwischen in einer anderen Kategorie steht', () => {
    expect(rueckkehrModul('erfassung', 'etb', alleFrei)?.key).toBe('personen');
  });

  it('nimmt kein Modul einer anderen Kategorie und keinen unbekannten Schlüssel', () => {
    expect(rueckkehrModul('kraefte', 'etb', alleFrei)?.key).toBe('kraefteuebersicht');
    expect(rueckkehrModul('kraefte', 'gibtsnicht', alleFrei)?.key).toBe('kraefteuebersicht');
  });

  it('gibt nichts frei, solange die Freigaben unbekannt sind', () => {
    // Wie `erstesFreigegebenesModul`: unbekannte Freigaben geben nichts frei.
    expect(rueckkehrModul('kraefte', 'abloesung', undefined)).toBeNull();
  });
});
