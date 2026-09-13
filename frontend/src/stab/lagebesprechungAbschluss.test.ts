import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { Lagebesprechung, LagebesprechungAbschlussBody, Stab } from '../api/types';
import {
  abschlussBody,
  abschlussVorbelegung,
  eigeneLagebesprechung,
  kuerzeEntschluss,
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
});

describe('abschlussBody — Tri-State von naechste_at', () => {
  const mitTermin = abschlussVorbelegung(wire('2026-09-13T10:45:00Z'), JETZT);
  const ohneTermin = abschlussVorbelegung(undefined, JETZT);

  it('unverändert vorbelegter Termin → Schlüssel FEHLT', () => {
    const body = abschlussBody(
      { entschluss: 'Lage unverändert', naechste: mitTermin.naechste, abgehalten: JETZT },
      mitTermin,
      JETZT,
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
    );
    expect(body.naechste_at).toBe('2026-09-13 11:00:00');
  });

  it('geleertes Feld trotz Vorbelegung → null, nie ""', () => {
    const body = abschlussBody(
      { entschluss: 'Lage unverändert', naechste: null, abgehalten: JETZT },
      mitTermin,
      JETZT,
    );
    expect(body).toHaveProperty('naechste_at', null);
  });

  it('ohne Vorbelegung und leer gelassen → null, nicht weggelassen (Ruling 1, LFH-543-Ledger)', () => {
    const body = abschlussBody(
      { entschluss: 'x', naechste: undefined, abgehalten: JETZT },
      ohneTermin,
      JETZT,
    );
    expect(body).toHaveProperty('naechste_at', null);
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
    );
    expect(body.abgehalten_at).toBe('2026-09-13 10:07:00');
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
