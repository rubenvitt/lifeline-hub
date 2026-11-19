/**
 * Anrede-Wächter (LLH-1830, Regel: `frontend/AGENTS.md`, „Anrede“): UI-Texte sprechen niemanden
 * an, weder mit Du noch mit Sie.
 *
 * ── Was dieser Wächter sieht ────────────────────────────────────────────────────
 * In jeder Quelldatei außer Tests und generierten Typen: den Inhalt von Zeichenketten ('…', "…",
 * `…`) und JSX-Text zwischen `>` und `<`, nachdem Kommentare entfernt sind. Darin jedes Du- oder
 * Sie-Pronomen als ganzes Wort.
 *
 * ── Was er NICHT sieht ──────────────────────────────────────────────────────────
 * Texte, die der Server schickt (`src/`), Zeichenketten über mehrere Zeilen in JSX-Text, und
 * Imperative ohne Pronomen („Wähle …“). {@link AUSNAHMEN} nennt bewertete Stellen, an denen
 * „Sie“ eine Sache meint (Satzanfang), nicht den Leser.
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
    pfad !== '/src/api/types.generated.ts',
);

const ANREDE = /\b(?:[Dd]u|[Dd]ein\w*|[Dd]ich|[Dd]ir|Sie|Ihr|Ihre[nmrs]?|Ihnen)\b/;

/** Bewertete Treffer, in denen „Sie“ eine Sache meint: Pfad → Ausschnitt des Textes. */
const AUSNAHMEN: Record<string, string[]> = {
  // „Sie“ = die externe Stelle.
  '/src/stammdaten/ExterneStellenTab.tsx': [
    'Sie ist die zuständige Leitstelle',
    'Sie erscheint nicht mehr als Vorschlag',
  ],
  // „Sie“ = die unzugestellten Ereignisse.
  '/src/pages/einstellungen/AnbindungWebhook.tsx': ['Sie lagen länger als sieben Tage'],
};

const KOMMENTAR_BLOCK = /\/\*[\s\S]*?\*\//g;
const KOMMENTAR_ZEILE = /(^|[^:'"`\\])\/\/.*$/gm;
const ZEICHENKETTE = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const JSX_TEXT = /[>}]([^<>{}]+)[<{]/g;

/** Die Texte einer Quelle, in denen eine Anrede steht. */
export function anredeTreffer(inhalt: string): string[] {
  const ohneKommentare = inhalt.replace(KOMMENTAR_BLOCK, '').replace(KOMMENTAR_ZEILE, '$1');
  const texte = [
    ...Array.from(ohneKommentare.matchAll(ZEICHENKETTE), (m) => m[0]),
    ...Array.from(ohneKommentare.matchAll(JSX_TEXT), (m) => m[1]),
  ];
  return texte.filter((t) => ANREDE.test(t)).map((t) => t.replace(/\s+/g, ' ').trim());
}

describe('UI-Texte ohne Anrede (LLH-1830)', () => {
  it('spricht niemanden mit Du oder Sie an', () => {
    const verstoesse = quellen.flatMap(([pfad, inhalt]) =>
      anredeTreffer(inhalt)
        .filter((text) => !(AUSNAHMEN[pfad] ?? []).some((a) => text.includes(a)))
        .map((text) => `${pfad}: ${text}`),
    );
    expect(verstoesse).toEqual([]);
  });

  it('erkennt Du und Sie in Zeichenkette und JSX-Text (Gegenprobe)', () => {
    expect(anredeTreffer("const t = 'Deine Rolle';")).toHaveLength(1);
    expect(anredeTreffer('<p>Bestätigen Sie die Eingabe</p>')).toHaveLength(1);
    expect(anredeTreffer('// Sie steht im Kommentar\nconst x = 1;')).toEqual([]);
    expect(anredeTreffer("const t = 'Eigene Rolle';")).toEqual([]);
  });
});
