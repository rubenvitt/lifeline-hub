import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { Abloesung } from '../api/types';
import { abloesungsMarken, einstufungVon, rhythmusText, zaehleFaellige } from './einstufung';

dayjs.extend(utc);

const t = (s: string) => dayjs.utc(s);

function schicht(teil: Partial<Abloesung> & { id: number }): Abloesung {
  return {
    einsatz_id: 1,
    einheit_id: teil.id,
    einheit_name: `Florian ${teil.id}`,
    beginn_at: '2026-09-22 09:30:00',
    rhythmus_minuten: 360,
    rhythmus_quelle: 'einheit',
    faellig_at: '2026-09-22 15:30:00',
    status: 'laufend',
    ruecknehmbar: false,
    angelegt_at: '2026-09-22 09:30:00',
    ...teil,
  };
}

describe('einstufungVon — dieselben Grenzfälle wie im Backend', () => {
  const f = '2026-09-22 15:30:00';
  it('genau fällig ist überfällig', () => {
    expect(einstufungVon(f, t('2026-09-22 15:30:00'))).toBe('ueberfaellig');
    expect(einstufungVon(f, t('2026-09-22 15:31:00'))).toBe('ueberfaellig');
  });
  it('genau 30 min vorher ist Vorwarnung, 30 min + 1 s planmäßig', () => {
    expect(einstufungVon(f, t('2026-09-22 15:29:59'))).toBe('vorwarnung');
    expect(einstufungVon(f, t('2026-09-22 15:00:00'))).toBe('vorwarnung');
    expect(einstufungVon(f, t('2026-09-22 14:59:59'))).toBe('planmaessig');
  });
  it('liest die Wire-Zeit als UTC, nicht als Ortszeit', () => {
    // Ein Ortszeit-Lesen verschöbe um den Zonenversatz — gegen einen absoluten Zeitpunkt
    // geprüft, sonst wäre ein Fehler, der beide Seiten gleich verschiebt, grün.
    expect(einstufungVon(f, dayjs('2026-09-22T15:29:00Z'))).toBe('vorwarnung');
  });
  it('unlesbar gilt als überfällig', () => {
    expect(einstufungVon('kaputt', t('2026-09-22 10:00:00'))).toBe('ueberfaellig');
  });
});

describe('zaehleFaellige', () => {
  it('zählt Vorwarnung und Überfälliges, nicht Planmäßiges und nicht Abgelöstes', () => {
    const jetzt = t('2026-09-22 15:10:00');
    const liste = [
      schicht({ id: 1, faellig_at: '2026-09-22 15:00:00' }), // überfällig
      schicht({ id: 2, faellig_at: '2026-09-22 15:30:00' }), // in 20 min
      schicht({ id: 3, faellig_at: '2026-09-22 18:10:00' }), // in 3 h
      schicht({ id: 4, faellig_at: '2026-09-22 15:00:00', status: 'abgeloest' }),
    ];
    expect(zaehleFaellige(liste, jetzt)).toBe(2);
  });
});

describe('abloesungsMarken', () => {
  it('fasst Einheiten desselben Abschnitts mit gleicher Fälligkeit zusammen', () => {
    const marken = abloesungsMarken([
      schicht({ id: 1, abschnitt_id: 7, abschnitt_name: 'Deichwache Nord' }),
      schicht({ id: 2, abschnitt_id: 7, abschnitt_name: 'Deichwache Nord' }),
    ]);
    expect(marken).toHaveLength(1);
    expect(marken[0].text).toBe('Ablösung Deichwache Nord, 2 Einheiten');
    expect(marken[0].zeit).toBe('2026-09-22 15:30:00');
  });
  it('fasst minutengenau: Sekunden trennen nicht, eine Minute schon', () => {
    const marken = abloesungsMarken([
      schicht({
        id: 1,
        abschnitt_id: 7,
        abschnitt_name: 'Nord',
        faellig_at: '2026-09-22 15:30:00',
      }),
      schicht({
        id: 2,
        abschnitt_id: 7,
        abschnitt_name: 'Nord',
        faellig_at: '2026-09-22 15:30:40',
      }),
      schicht({
        id: 3,
        abschnitt_id: 7,
        abschnitt_name: 'Nord',
        faellig_at: '2026-09-22 15:31:00',
      }),
    ]);
    expect(marken.map((m) => m.einheiten).sort()).toEqual([1, 2]);
  });
  it('eine einzelne Schicht heißt nach ihrer Einheit, ohne Abschnitt je eine Marke', () => {
    const marken = abloesungsMarken([schicht({ id: 1 }), schicht({ id: 2 })]);
    expect(marken.map((m) => m.text).sort()).toEqual(['Ablösung Florian 1', 'Ablösung Florian 2']);
  });
  it('lässt abgelöste Schichten weg', () => {
    expect(abloesungsMarken([schicht({ id: 1, status: 'abgeloest' })])).toEqual([]);
  });
});

describe('rhythmusText', () => {
  it('liest sich wie im ETB', () => {
    expect(rhythmusText(360)).toBe('6 h');
    expect(rhythmusText(390)).toBe('6 h 30 min');
    expect(rhythmusText(45)).toBe('45 min');
  });
});
