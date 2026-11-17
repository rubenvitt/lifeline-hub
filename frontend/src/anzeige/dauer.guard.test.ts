/**
 * Dauer-Wächter (LLH-1750, Spec `zeitdarstellung`, „Eine Formatstelle“): eine Dauer für Menschen
 * bildet nur der Kern `anzeige/dauer.ts`.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Bis November 2026 schrieben sieben Helfer und zehn eigene Stellen acht Formen nebeneinander
 * („05:01 h“, „5:01 h“, „7 h 40“, „vor 3 h 5 min“, „301 min“ …). Der Zeit-Wächter
 * (`zeitDarstellung.guard.test.ts`) sieht nur Format-Strings mit `HH`/`mm`, nie eine Dauer aus
 * `${h} h ${m}`.
 *
 * ── Was dieser Wächter sieht ────────────────────────────────────────────────────
 * Außerhalb von `anzeige/` jede Interpolation, auf die direkt eine Einheit folgt (`${n} min`,
 * `${h} h`, `${t} d`), und jede `${h}:${…padStart(2…)}`-Zusammensetzung (Stunden:Minuten).
 *
 * ── Was er NICHT sieht ──────────────────────────────────────────────────────────
 * Text ohne Interpolation („alle 6 h“ als Literal), Einheiten in eigener Spalte, den Server
 * (`src/zeitdarstellung.rs`, gehalten über `dauer.faelle.json`). {@link AUSNAHMEN} nennt jede
 * bewertete Stelle, an der der Treffer keine Dauer für Menschen ist.
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
    !pfad.startsWith('/src/anzeige/'),
);

const EINHEIT_NACH_WERT = /\$\{[^}]+\}\s?(?:min|h|d)\b(?![-\w])/;
const STUNDEN_DOPPELPUNKT = /\$\{[^}]+\}:\$\{[^}]*padStart\(2/;

/** Bewertete Treffer, die keine Dauer für Menschen sind: Pfad → Ausschnitt der Zeile. */
const AUSNAHMEN: Record<string, string[]> = {
  // Wechselzeit `HH:MM` an den Server (Maschinenformat, `src/schichtmodell/mod.rs`).
  '/src/abloesung/dauer.ts': [
    "return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`",
  ],
};

/** Schuldmenge vom 17.11.2026; MUST am Ende von LLH-1750 leer sein. */
const OFFEN = new Set<string>([]);

export function dauerTreffer(inhalt: string): string[] {
  return inhalt
    .split('\n')
    .filter((zeile) => EINHEIT_NACH_WERT.test(zeile) || STUNDEN_DOPPELPUNKT.test(zeile))
    .map((zeile) => zeile.trim());
}

describe('Eine Formatstelle für Dauern (LLH-1750)', () => {
  it('setzt außerhalb von anzeige/ keine Dauer selbst zusammen', () => {
    const verstoesse = quellen
      .filter(([pfad]) => !OFFEN.has(pfad))
      .flatMap(([pfad, inhalt]) =>
        dauerTreffer(inhalt)
          .filter((zeile) => !(AUSNAHMEN[pfad] ?? []).some((a) => zeile.includes(a)))
          .map((zeile) => `${pfad}: ${zeile}`),
      );
    expect(verstoesse).toEqual([]);
  });

  it('hält die Schuldmenge leer', () => {
    expect([...OFFEN]).toEqual([]);
  });

  it('erkennt eine selbst gebaute Dauer (Gegenprobe)', () => {
    expect(dauerTreffer('const t = `${min} min`;')).toHaveLength(1);
    expect(dauerTreffer('return `${h} h ${m}`;')).toHaveLength(1);
    expect(dauerTreffer("`${h}:${String(m).padStart(2, '0')}`")).toHaveLength(1);
    expect(dauerTreffer('`${tage} d`')).toHaveLength(1);
    expect(dauerTreffer('relativ(minuten, "seit")')).toEqual([]);
    expect(dauerTreffer('`${einsatzId}:${maske}`')).toEqual([]);
    expect(dauerTreffer('`${n} Einheiten`')).toEqual([]);
  });
});
