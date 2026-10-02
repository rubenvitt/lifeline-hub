/**
 * Was „aktive Warnung" für die Warnsperre des Helligkeitsreglers heißt (LFH-397,
 * design.md D3; LFH-774, D2). Alle drei Merkmale je Wert als Literal — die Tabellen halten
 * fest, welche Stufen sperren, statt sie aus dem Statusvertrag nachzurechnen, gegen den die
 * Funktion selbst läuft.
 */
import { describe, expect, it } from 'vitest';
import { aktiveWarnung, dwdStufenJetzt } from './aktiveWarnung';
import type { Warnstufe, WetterWarnstufe } from '../api/types';
import { dwdWarnstufe } from '../theme/statusFarben';
import { UNWETTER_STUFEN } from '../wetter/unwetter';

describe('aktiveWarnung', () => {
  const STUFEN: [Warnstufe, boolean][] = [
    ['keine', false],
    ['niedrig', false],
    ['mittel', false],
    ['hoch', true],
    ['akut', true],
  ];

  it.each(STUFEN)('Warnstufe %s ohne überfällige Bestätigung → %s', (stufe, soll) => {
    expect(aktiveWarnung({ hoechsteWarnstufe: stufe, bestaetigungUeberfaellig: 0 })).toBe(soll);
  });

  it.each(STUFEN)('Warnstufe %s MIT überfälliger Bestätigung → immer aktiv', (stufe) => {
    expect(aktiveWarnung({ hoechsteWarnstufe: stufe, bestaetigungUeberfaellig: 1 })).toBe(true);
  });

  it('eine überfällige Bestätigung allein genügt — auch ohne Gefahrenrecht', () => {
    expect(aktiveWarnung({ bestaetigungUeberfaellig: 2 })).toBe(true);
  });

  it('eine sperrende Warnstufe allein genügt — auch ohne Meldungsrecht', () => {
    expect(aktiveWarnung({ hoechsteWarnstufe: 'akut' })).toBe(true);
  });

  it('keine Quelle (kein Recht, lädt noch, Fehler) ist keine Warnung', () => {
    expect(aktiveWarnung({})).toBe(false);
  });

  const DWD_STUFEN: [WetterWarnstufe, boolean][] = [
    ['gering', false],
    ['maessig', false],
    ['schwer', true],
    ['extrem', true],
  ];

  it.each(DWD_STUFEN)('DWD-Warnung %s gilt jetzt, sonst nichts → %s', (stufe, soll) => {
    expect(
      aktiveWarnung({
        hoechsteWarnstufe: 'keine',
        bestaetigungUeberfaellig: 0,
        dwdStufenJetzt: [stufe],
      }),
    ).toBe(soll);
  });

  it('eine sperrende DWD-Stufe genügt neben harmlosen', () => {
    expect(aktiveWarnung({ dwdStufenJetzt: ['gering', 'extrem', 'maessig'] })).toBe(true);
  });

  it('keine geltende DWD-Warnung (leere Liste) ist keine Warnung', () => {
    expect(aktiveWarnung({ dwdStufenJetzt: [] })).toBe(false);
  });
});

describe('dwdStufenJetzt', () => {
  /** 2026-09-22 12:30:00 UTC. */
  const JETZT = Date.UTC(2026, 8, 22, 12, 30, 0);
  const MIN = 60_000;
  const STUNDE = 60 * MIN;
  const um = (ms: number) => new Date(JETZT + ms).toISOString();
  const warnung = (stufe: WetterWarnstufe, beginn: number, ende: number | null) => ({
    stufe,
    ereignis: 'ORKANBÖEN',
    beginn: um(beginn),
    ende: ende === null ? null : um(ende),
  });
  const teil = (daten: ReturnType<typeof warnung>[], alter = 5 * MIN, zustand = 'ok') => ({
    zustand,
    abgerufen_at: um(-alter),
    daten,
  });

  it('ohne Teil (kein Recht, lädt noch, Abruf gescheitert) → undefined', () => {
    expect(dwdStufenJetzt(undefined, JETZT)).toBeUndefined();
  });

  it('Ausfall der Quelle → undefined, auch wenn noch Daten mitkämen', () => {
    expect(
      dwdStufenJetzt(teil([warnung('extrem', -STUNDE, STUNDE)], 5 * MIN, 'ausfall'), JETZT),
    ).toBeUndefined();
  });

  it('Einsatz ohne Ort → undefined', () => {
    expect(dwdStufenJetzt({ zustand: 'kein_ort' }, JETZT)).toBeUndefined();
  });

  it('Stand jenseits der Obergrenze (offline seit Stunden) → undefined', () => {
    expect(
      dwdStufenJetzt(teil([warnung('extrem', -STUNDE, 10 * STUNDE)], 7 * STUNDE), JETZT),
    ).toBeUndefined();
  });

  it('veralteter Stand zählt noch', () => {
    expect(dwdStufenJetzt(teil([warnung('schwer', -STUNDE, STUNDE)], 2 * STUNDE), JETZT)).toEqual([
      'schwer',
    ]);
  });

  it('nur was jetzt gilt: angekündigte und abgelaufene fallen heraus, offenes Ende gilt', () => {
    expect(
      dwdStufenJetzt(
        teil([
          warnung('extrem', 2 * STUNDE, 5 * STUNDE),
          warnung('schwer', -3 * STUNDE, -MIN),
          warnung('maessig', -STUNDE, null),
          warnung('schwer', -STUNDE, STUNDE),
        ]),
        JETZT,
      ),
    ).toEqual(['maessig', 'schwer']);
  });

  it('verwertbarer Stand ohne Warnungen → leere Liste', () => {
    expect(dwdStufenJetzt(teil([]), JETZT)).toEqual([]);
  });
});

describe('Unwetter-Stufen und Statusvertrag', () => {
  // `wetter/unwetter.ts` (Hinweis, Zähler, Uhr) führt eine eigene Liste; die Sperre liest den
  // Vertrag (LFH-774, D2). Laufen beide auseinander, meinten Hinweis und Sperre still
  // verschiedene Stufen — und die Uhr der Sperre wachte an den falschen Wechseln.
  it('UNWETTER_STUFEN sind genau die Stufen, die dwdWarnstufe auf alarm legt', () => {
    const alarm = (Object.keys(dwdWarnstufe) as WetterWarnstufe[]).filter(
      (s) => dwdWarnstufe[s].rolle === 'alarm',
    );
    expect([...UNWETTER_STUFEN].sort()).toEqual(alarm.sort());
  });
});
