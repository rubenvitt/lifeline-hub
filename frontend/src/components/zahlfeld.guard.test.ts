/**
 * Zahlenfeld-Wächter (LLH-1768): Zahlenfelder kappen und runden nie.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * antds `min`, `max` und `precision` an `InputNumber` setzen einen getippten Wert beim Verlassen
 * still um (Alter 250 → 120, 2,5 → 3), und gespeichert wurde der umgesetzte Wert. Grenzen sind
 * deshalb Prüfregeln (`components/zahlRegel.ts`: `zahlRegel` an `Feld`, `useZahlSperre` in
 * Bausteinen); Regel: `frontend/AGENTS.md`, „Zahlenfelder prüfen statt kappen“.
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 * Er sucht Text: ein `InputNumber`, das seine Props per Spread (`{...grenzen}`) bekommt, fällt
 * nicht auf. Keine Ausnahmeliste.
 */
import { describe, expect, it } from 'vitest';

// Das Glob bleibt HIER, sonst landete bei einem versehentlichen Produktiv-Import der Quelltext im
// App-Bundle.
const dateien = import.meta.glob('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const quellen = Object.entries(dateien).filter(
  ([pfad]) => !/\.test\.tsx?$/.test(pfad) && !pfad.startsWith('/src/test/'),
);

/** Der Öffnungstag ab `start` bis zum schließenden `>` außerhalb geschweifter Klammern. */
function oeffnungstag(text: string, start: number): string {
  let tiefe = 0;
  for (let i = start; i < text.length; i += 1) {
    const z = text[i];
    if (z === '{') tiefe += 1;
    else if (z === '}') tiefe -= 1;
    else if (z === '>' && tiefe === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** Fundstellen `datei:zeile` von `<InputNumber` mit `min`, `max` oder `precision`. */
export function findeKappendeZahlfelder(eintraege: [string, string][]): string[] {
  const funde: string[] = [];
  for (const [pfad, text] of eintraege) {
    // Ein Typparameter (`<InputNumber<number>`) gehört zum Namen, nicht ans Tagende.
    for (const treffer of text.matchAll(/<InputNumber(<[^>]*>)?/g)) {
      const tag = oeffnungstag(text, treffer.index + treffer[0].length);
      if (/\s(min|max|precision)=/.test(tag)) {
        const zeile = text.slice(0, treffer.index).split('\n').length;
        funde.push(`${pfad}:${zeile}`);
      }
    }
  }
  return funde;
}

describe('Zahlenfeld-Wächter (LLH-1768)', () => {
  it('kein InputNumber trägt min, max oder precision', () => {
    expect(findeKappendeZahlfelder(quellen)).toEqual([]);
  });

  it('findet die Props auch über mehrere Zeilen und hinter Ausdrücken', () => {
    const probe = `<InputNumber\n  value={x > 1 ? 2 : 3}\n  max={5}\n/>`;
    expect(findeKappendeZahlfelder([['/src/probe.tsx', probe]])).toEqual(['/src/probe.tsx:1']);
    expect(findeKappendeZahlfelder([['/src/ok.tsx', '<InputNumber value={1} />']])).toEqual([]);
    // Typparameter: das `>` von `<number>` beendet den Tag nicht (Review LLH-1768).
    const generisch = `<InputNumber<number>\n  min={0}\n/>`;
    expect(findeKappendeZahlfelder([['/src/gen.tsx', generisch]])).toEqual(['/src/gen.tsx:1']);
  });
});
