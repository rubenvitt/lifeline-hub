/**
 * Stärke-Wächter (LLH-1750, Spec `lage-verdichtung`, „Eine Formatierung …“ und „Die Stärke nennt
 * ihre Schreibweise“): eine Stärke entsteht nur über `anzeige/staerke.ts` und heißt `F/UF/M//Σ`.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Im November 2026 standen „F/UF/M//Ges“, „F/UF/M//Σ“, „Gesamtstärke“ und im Lagemonitor
 * „F/UF/M“ ohne Summe nebeneinander; der Lagemonitor baute den Wert selbst.
 *
 * ── Was er sieht ────────────────────────────────────────────────────────────────
 * Außerhalb von `anzeige/staerke.ts` jede Summe namens „//Ges“ oder „//Gesamt“ und jedes
 * `${…fuehrer}/${…}/${…mannschaft}`, auf das kein „//“ folgt. Er sieht keine Stärke, die aus Wörtern gebaut wird.
 */
import { describe, expect, it } from 'vitest';

const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const quellen = Object.entries(dateien).filter(
  ([pfad]) =>
    !/\.test\.tsx?$/.test(pfad) &&
    !pfad.startsWith('/src/test/') &&
    pfad !== '/src/anzeige/staerke.ts',
);

const SUMME_FALSCH = /\/\/\s?(?:Ges|GES|Gesamt)\b/;
/** Drei Interpolationen Führer/Unterführer/Mannschaft ohne folgendes „//“ (keine URL-Pfade). */
const OHNE_SUMME =
  /\$\{[^}]*(?:fuehrer|\bf\b)[^}]*\}\/\$\{[^}]*\}\/\$\{[^}]*(?:mannschaft|\bm\b)[^}]*\}(?!\/\/)/;

export function staerkeTreffer(inhalt: string): string[] {
  return inhalt
    .split('\n')
    .filter((zeile) => SUMME_FALSCH.test(zeile) || OHNE_SUMME.test(zeile))
    .map((zeile) => zeile.trim());
}

describe('Eine Schreibweise der Stärke (LLH-1750)', () => {
  it('baut außerhalb von anzeige/staerke.ts keine Stärke und nennt die Summe nur „Σ“', () => {
    const verstoesse = quellen.flatMap(([pfad, inhalt]) =>
      staerkeTreffer(inhalt).map((zeile) => `${pfad}: ${zeile}`),
    );
    expect(verstoesse).toEqual([]);
  });

  it('erkennt eine eigene Stärke (Gegenprobe)', () => {
    expect(staerkeTreffer('`Stärke F/UF/M//Ges: ${t}`')).toHaveLength(1);
    expect(staerkeTreffer('`${s.f}/${s.uf}/${s.m}`')).toHaveLength(1);
    expect(staerkeTreffer('`${a}/${b}/${c}//${d}`')).toEqual([]);
    expect(staerkeTreffer('staerkeText(s)')).toEqual([]);
    expect(staerkeTreffer('`/api/einsaetze/${einsatzId}/${modul}/${id}/zeitachse`')).toEqual([]);
  });
});
