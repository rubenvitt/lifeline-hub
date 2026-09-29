/**
 * Was „aktive Warnung" für die Warnsperre des Helligkeitsreglers heißt (LFH-397,
 * design.md D3). Beide Merkmale je Wert als Literal — die Tabelle hält fest, welche
 * Warnstufen sperren, statt sie aus dem Statusvertrag nachzurechnen, gegen den die
 * Funktion selbst läuft.
 */
import { describe, expect, it } from 'vitest';
import { aktiveWarnung } from './aktiveWarnung';
import type { Warnstufe } from '../api/types';

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
});
