/**
 * Pflichtfehler-Wächter (LLH-1766, Regel: `frontend/AGENTS.md`, „Erfassungs-Norm“, „Ein
 * Pflichtfehler „‹Feld› fehlt““): jede Pflichtregel nimmt `pflicht()` aus `pflichtRegel.ts`, kein
 * Fehlertext hat die alten Formen.
 *
 * ── Was dieser Wächter sieht ────────────────────────────────────────────────────
 * In jeder Quelldatei außer Tests, nachdem Kommentare entfernt sind: (a) ein `required: true`
 * außerhalb von `pflichtRegel.ts`; (b) eine Zeichenkette direkt hinter `message:` oder `Error(`
 * mit „ist erforderlich“, „ist Pflicht“, „darf nicht leer sein“ oder der Form „Bitte … angeben /
 * eingeben / wählen / eintragen“.
 *
 * ── Was er NICHT sieht ──────────────────────────────────────────────────────────
 * Eine bedingte Pflicht (`required: ausdruck`), deren Text von Hand „‹Feld› fehlt“ heißt, Texte
 * des Servers und Prüffehler, die keine Pflicht sind (Format, Länge, Bereich).
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
    pfad !== '/src/components/pflichtRegel.ts' &&
    pfad !== '/src/api/types.generated.ts',
);

const KOMMENTAR_BLOCK = /\/\*[\s\S]*?\*\//g;
const KOMMENTAR_ZEILE = /(^|[^:'"`\\])\/\/.*$/gm;
const REQUIRED_TRUE = /\brequired:\s*true\b/g;
const FEHLERTEXT = /(?:message:|Error\()\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
const ALTE_FORM =
  /ist erforderlich|ist Pflicht|darf nicht leer sein|^.Bitte .*(?:angeben|eingeben|wählen|eintragen).$/;

/** Verstöße einer Quelle gegen die Pflichtfehler-Form. */
export function pflichtVerstoesse(inhalt: string): string[] {
  const code = inhalt.replace(KOMMENTAR_BLOCK, '').replace(KOMMENTAR_ZEILE, '$1');
  const nackt = Array.from(code.matchAll(REQUIRED_TRUE), () => 'required: true ohne pflicht()');
  const texte = Array.from(code.matchAll(FEHLERTEXT), (m) => m[1]).filter((t) =>
    ALTE_FORM.test(t),
  );
  return [...nackt, ...texte];
}

describe('Pflichtfehler „‹Feld› fehlt“ (LLH-1766)', () => {
  it('erkennt jede alte Form (Gegenprobe)', () => {
    expect(pflichtVerstoesse("rules={[{ required: true, message: 'x' }]}")).toHaveLength(1);
    expect(pflichtVerstoesse("{ message: 'Inhalt ist erforderlich' }")).toHaveLength(1);
    expect(pflichtVerstoesse("new Error('Art ist Pflicht')")).toHaveLength(1);
    expect(pflichtVerstoesse("{ message: 'Name darf nicht leer sein' }")).toHaveLength(1);
    expect(pflichtVerstoesse("{ message: 'Bitte eine Bezeichnung angeben' }")).toHaveLength(1);
    expect(pflichtVerstoesse("{ message: 'Bezeichnung fehlt' }")).toEqual([]);
    expect(pflichtVerstoesse("rules={[pflicht('Ort')]} // required: true")).toEqual([]);
  });

  it('jede Pflichtregel nimmt pflicht() und keine alte Form', () => {
    const verstoesse = quellen.flatMap(([pfad, inhalt]) =>
      pflichtVerstoesse(inhalt).map((v) => `${pfad}: ${v}`),
    );
    expect(verstoesse).toEqual([]);
  });
});
