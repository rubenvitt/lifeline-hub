import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { Lagebesprechung, LagebesprechungAbschlussBody, Stab } from '../api/types';
import {
  abschlussBody,
  abschlussVorbelegung,
  eigeneLagebesprechung,
  kuerzeEntschluss,
  naechsteNachBesprechung,
} from './lagebesprechungAbschluss';

dayjs.extend(utc);

const JETZT = dayjs('2026-09-13T10:00:00Z');
const wire = (iso: string) => dayjs(iso).utc().format('YYYY-MM-DD HH:mm:ss');

describe('abschlussVorbelegung', () => {
  it('belegt mit dem bestehenden Termin vor, wenn er in der Zukunft liegt', () => {
    const v = abschlussVorbelegung(wire('2026-09-13T10:45:00Z'), JETZT);
    expect(v.naechste!.valueOf()).toBe(dayjs('2026-09-13T10:45:00Z').valueOf());
    expect(v.abgehalten.valueOf()).toBe(JETZT.valueOf());
  });

  it('lässt das Feld leer bei vergangenem, genau jetzigem oder fehlendem Termin', () => {
    expect(abschlussVorbelegung(wire('2026-09-13T09:55:00Z'), JETZT).naechste).toBeNull();
    expect(abschlussVorbelegung(wire('2026-09-13T10:00:00Z'), JETZT).naechste).toBeNull();
    expect(abschlussVorbelegung(undefined, JETZT).naechste).toBeNull();
  });

  it('friert den Wire-Wert unverändert ein — absent als null, nicht undefined', () => {
    // `undefined` hier liesse jeden unveränderten Abschluss als „fremd geändert" gelten.
    expect(abschlussVorbelegung(undefined, JETZT).terminWire).toBeNull();
    expect(abschlussVorbelegung('2026-09-13 09:55:00', JETZT).terminWire).toBe(
      '2026-09-13 09:55:00',
    );
  });
});

describe('abschlussBody — Tri-State von naechste_at', () => {
  const TERMIN = wire('2026-09-13T10:45:00Z');
  const mitTermin = abschlussVorbelegung(TERMIN, JETZT);
  const ohneTermin = abschlussVorbelegung(undefined, JETZT);

  it('unverändert vorbelegter Termin → Schlüssel FEHLT', () => {
    const body = abschlussBody(
      { entschluss: 'Lage unverändert', naechste: mitTermin.naechste, abgehalten: JETZT },
      mitTermin,
      JETZT,
      TERMIN,
    );
    expect(Object.keys(body)).not.toContain('naechste_at');
  });

  it('geänderter Termin → Wert (Gegenfall zum fehlenden Schlüssel)', () => {
    const body = abschlussBody(
      {
        entschluss: 'Lage unverändert',
        naechste: dayjs('2026-09-13T11:00:00Z'),
        abgehalten: JETZT,
      },
      mitTermin,
      JETZT,
      TERMIN,
    );
    expect(body.naechste_at).toBe('2026-09-13 11:00:00');
  });

  it('geleertes Feld trotz Vorbelegung → null, nie ""', () => {
    const body = abschlussBody(
      { entschluss: 'Lage unverändert', naechste: null, abgehalten: JETZT },
      mitTermin,
      JETZT,
      TERMIN,
    );
    expect(body).toHaveProperty('naechste_at', null);
  });

  it('keine Vorbelegung, Termin gewählt → Wert', () => {
    const body = abschlussBody(
      { entschluss: 'x', naechste: dayjs('2026-09-13T11:30:00Z'), abgehalten: JETZT },
      ohneTermin,
      JETZT,
      undefined,
    );
    expect(body.naechste_at).toBe('2026-09-13 11:30:00');
  });

  it('trimmt den Entschluss und schickt den Zeitpunkt immer mit', () => {
    const body = abschlussBody(
      {
        entschluss: '  Räumung fortsetzen \n',
        naechste: null,
        abgehalten: dayjs('2026-09-13T09:40:00Z'),
      },
      ohneTermin,
      JETZT,
      undefined,
    );
    expect(body.entschluss).toBe('Räumung fortsetzen');
    expect(body.abgehalten_at).toBe('2026-09-13 09:40:00');
  });

  it('leerer Zeitpunkt → Zeitpunkt des Absendens, ausdrücklich mitgeschickt', () => {
    const absenden = dayjs('2026-09-13T10:07:00Z');
    const body = abschlussBody(
      { entschluss: 'x', naechste: null, abgehalten: null },
      ohneTermin,
      absenden,
      undefined,
    );
    expect(body.abgehalten_at).toBe('2026-09-13 10:07:00');
  });
});

/**
 * Ruling 10 (LFH-543-Ledger): die Maske ändert oder löscht nur den Termin, den sie beim Öffnen
 * gesehen hat. Jede Regel steht als Paar — verändert wird je Paar genau EINE Eingabe.
 */
describe('abschlussBody — nur der gesehene Termin wird angefasst (Ruling 10)', () => {
  const TERMIN = wire('2026-09-13T10:45:00Z');
  const VERGANGEN = wire('2026-09-13T09:55:00Z');
  const FREMD = wire('2026-09-13T11:30:00Z');
  const mitTermin = abschlussVorbelegung(TERMIN, JETZT);
  const ohneTermin = abschlussVorbelegung(undefined, JETZT);
  const vergangen = abschlussVorbelegung(VERGANGEN, JETZT);
  const leer = { entschluss: 'x', naechste: null, abgehalten: JETZT };

  it.each([
    ['vergangener Termin beim Öffnen, Feld leer', vergangen, leer],
    ['kein Termin beim Öffnen, Feld leer', ohneTermin, leer],
    ['vorbelegt, Feld bewusst geleert', mitTermin, leer],
  ])('fremd geändert (%s) → Schlüssel FEHLT', (_, vorbelegung, werte) => {
    const body = abschlussBody(werte, vorbelegung, JETZT, FREMD);
    expect(Object.keys(body)).not.toContain('naechste_at');
  });

  it('nicht fremd geändert, vergangener Termin, Feld leer → null (Gegenfall, Ruling 1)', () => {
    expect(abschlussBody(leer, vergangen, JETZT, VERGANGEN)).toHaveProperty('naechste_at', null);
  });

  it('fremd geändert, Feld unverändert vorbelegt → Schlüssel FEHLT', () => {
    const body = abschlussBody(
      { entschluss: 'x', naechste: mitTermin.naechste, abgehalten: JETZT },
      mitTermin,
      JETZT,
      FREMD,
    );
    expect(Object.keys(body)).not.toContain('naechste_at');
  });

  it('fremd geändert, anderer Wert gewählt → der Wert (die bewusste Eingabe gewinnt)', () => {
    const body = abschlussBody(
      { entschluss: 'x', naechste: dayjs('2026-09-13T12:00:00Z'), abgehalten: JETZT },
      mitTermin,
      JETZT,
      FREMD,
    );
    expect(body.naechste_at).toBe('2026-09-13 12:00:00');
  });

  it('fremd gelöscht (live absent), Feld unverändert vorbelegt → Schlüssel FEHLT', () => {
    const body = abschlussBody(
      { entschluss: 'x', naechste: mitTermin.naechste, abgehalten: JETZT },
      mitTermin,
      JETZT,
      undefined,
    );
    expect(Object.keys(body)).not.toContain('naechste_at');
  });

  /** Gegenfall: der vergangene Termin beim Öffnen → `null` (Paar oben, „nicht fremd geändert"). */
  it('kein Termin beim Öffnen, Feld leer → Schlüssel FEHLT (Ruling 10 statt Ruling 1)', () => {
    const body = abschlussBody(leer, ohneTermin, JETZT, undefined);
    expect(Object.keys(body)).not.toContain('naechste_at');
  });

  it('vorbelegt, unverändert, noch nach max(Zeitpunkt, jetzt) → Schlüssel FEHLT', () => {
    const body = abschlussBody(
      { entschluss: 'x', naechste: mitTermin.naechste, abgehalten: JETZT },
      mitTermin,
      dayjs('2026-09-13T10:40:00Z'),
      TERMIN,
    );
    expect(Object.keys(body)).not.toContain('naechste_at');
  });

  it('vorbelegt, unverändert, inzwischen überholt (jetzt nach dem Termin) → null', () => {
    const body = abschlussBody(
      { entschluss: 'x', naechste: mitTermin.naechste, abgehalten: JETZT },
      mitTermin,
      dayjs('2026-09-13T10:50:00Z'),
      TERMIN,
    );
    expect(body).toHaveProperty('naechste_at', null);
  });

  it('vorbelegt, unverändert, aber Zeitpunkt nach den Termin gelegt → null', () => {
    const body = abschlussBody(
      { entschluss: 'x', naechste: mitTermin.naechste, abgehalten: dayjs('2026-09-13T10:50:00Z') },
      mitTermin,
      JETZT,
      TERMIN,
    );
    expect(body).toHaveProperty('naechste_at', null);
  });
});

describe('naechsteNachBesprechung — Spiegel des 422', () => {
  const abgehalten = dayjs('2026-09-13T10:30:00Z');

  it('ein leeres Feld ist immer zulässig', () => {
    expect(naechsteNachBesprechung(null, abgehalten, JETZT)).toBe(true);
    expect(naechsteNachBesprechung(undefined, abgehalten, JETZT)).toBe(true);
  });

  it('nach dem Zeitpunkt → zulässig · gleich oder davor → nicht (Grenze wie der Server: ≤)', () => {
    expect(naechsteNachBesprechung(dayjs('2026-09-13T10:30:01Z'), abgehalten, JETZT)).toBe(true);
    expect(naechsteNachBesprechung(dayjs('2026-09-13T10:30:00Z'), abgehalten, JETZT)).toBe(false);
    expect(naechsteNachBesprechung(dayjs('2026-09-13T10:00:00Z'), abgehalten, JETZT)).toBe(false);
  });

  it('leerer Zeitpunkt → Bezug ist jetzt', () => {
    expect(naechsteNachBesprechung(dayjs('2026-09-13T10:15:00Z'), null, JETZT)).toBe(true);
    expect(naechsteNachBesprechung(dayjs('2026-09-13T09:45:00Z'), null, JETZT)).toBe(false);
  });
});

describe('eigeneLagebesprechung', () => {
  const gesendet: LagebesprechungAbschlussBody = {
    entschluss: 'Lage unverändert',
    abgehalten_at: '2026-09-13 10:00:00',
    naechste_at: null,
  };
  const zeile = (over: Partial<Lagebesprechung> = {}): Lagebesprechung => ({
    id: 9,
    einsatz_id: 1,
    lfd_nr: 4,
    abgehalten_at: '2026-09-13 10:00:00',
    entschluss: 'Lage unverändert',
    etb_eintrag_id: 77,
    erfasst_von_id: 1,
    erfasst_at: '2026-09-13 10:00:01',
    ...over,
  });
  const stab = (letzte?: Lagebesprechung): Stab => ({
    anzahl_lagebesprechungen: 4,
    besetzung: [],
    ...(letzte ? { letzte_lagebesprechung: letzte } : {}),
  });

  it('ordnet die Zeile zu, wenn Entschluss und Zeitpunkt passen', () => {
    expect(eigeneLagebesprechung(stab(zeile()), gesendet)?.etb_eintrag_id).toBe(77);
  });

  it('verwirft eine fremde Zeile — anderer Entschluss', () => {
    expect(eigeneLagebesprechung(stab(zeile({ entschluss: 'Fremd' })), gesendet)).toBeUndefined();
  });

  it('verwirft eine fremde Zeile — gleicher Entschluss, anderer Zeitpunkt', () => {
    expect(
      eigeneLagebesprechung(stab(zeile({ abgehalten_at: '2026-09-13 10:00:30' })), gesendet),
    ).toBeUndefined();
  });

  it('ohne letzte Lagebesprechung gibt es nichts zuzuordnen', () => {
    expect(eigeneLagebesprechung(stab(), gesendet)).toBeUndefined();
  });
});

describe('kuerzeEntschluss', () => {
  it('lässt kurze Texte stehen und fasst Leerraum zusammen', () => {
    expect(kuerzeEntschluss('Lage\n  unverändert')).toBe('Lage unverändert');
  });

  it('kürzt lange Texte auf 80 Zeichen mit Auslassungszeichen', () => {
    const lang = 'a'.repeat(120);
    const kurz = kuerzeEntschluss(lang);
    expect(kurz).toHaveLength(80);
    expect(kurz.endsWith('…')).toBe(true);
  });
});
