import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AstKnoten, parseQuelltext, walk, zeileVon } from '../lib/quelltextAst';
import { describe, expect, it } from 'vitest';

/**
 * Speicherfehler-Guard (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“).
 *
 * ── Warum ──────────────────────────────────────────────────────────────────────
 * Ein Fehler-Toast ist nach rund drei Sekunden weg; danach steht Dialog, Formular oder Zeile
 * unverändert da und wirkt gespeichert. Der Grund einer Ablehnung gehört an den Ort der Handlung
 * (`SpeicherFehler`, `ZeilenFehler`, `SeitenHinweise`, die `speicherung` der Erfassungs-Hülle).
 * Seit P5 ist der Bestand abgebaut; dieser Guard hält neue Fehler-Toasts fern.
 *
 * ── Wie ───────────────────────────────────────────────────────────────────────
 * Gezählt werden Aufrufe (TypeScript-AST, keine Kommentare) von `message.error(…)`,
 * `meldung.error(…)`, `notification.error(…)` und `useFehlerMeldung(…)` je Datei außerhalb der
 * Tests. Den Toast-Hook `useFehlerMeldung` gibt es seit P5 nicht mehr; er zählt weiter, damit ein
 * Wiedereinführen rot wird. Erlaubt sind nur die Einträge in {@link ERLAUBT} (Toast ohne Ort,
 * mit Grund). Mehr Treffer → rot; ein Eintrag größer als der Fund → ebenfalls rot: wer eine
 * Stelle umstellt, verkleinert den Eintrag im selben Commit.
 *
 * ── Warum ein Vitest-Guard und keine ESLint-Regel ───────────────────────────────
 * Wie `erklaertext.guard.test.ts`: `pnpm lint` läuft mit `--max-warnings 0`, eine rot geborene
 * Regel würde abgeschaltet statt befolgt.
 *
 * ── Was dieser Guard NICHT sieht (Teil des Vertrags) ────────────────────────────
 *   • eine umbenannte Toast-Instanz (`const m = message; m.error(…)`);
 *   • `message.open({ type: 'error' })`;
 *   • ob ein Fehler am Ort auch wirklich erscheint — das prüfen die Seitentests
 *     (`.ant-message-notice` = 0, Grund am Ort sichtbar).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Toast ohne Ort: Datei → Anzahl und Grund. Wächst nur mit Begründung. */
const ERLAUBT: Record<string, { anzahl: number; grund: string }> = {
  'components/KopierbarerText.tsx': { anzahl: 1, grund: 'Zwischenablage abgelehnt' },
  'pages/ProfilPage.tsx': { anzahl: 1, grund: 'Zwischenablage abgelehnt' },
  'pages/LagekartePage.tsx': {
    anzahl: 1,
    grund: 'Kartenbilder laden ohne Handlung im Hintergrund nach, kein Ort sichtbar',
  },
  'pages/lagekarte/kontextmenue.ts': { anzahl: 1, grund: 'Zwischenablage abgelehnt' },
  // „Text kopieren“ eines Abschnitts (LLH-1601): das Menü ist beim Ablehnen schon zu.
  'entwurf/DokumentEntwurf.tsx': { anzahl: 1, grund: 'Zwischenablage abgelehnt' },
  'karten/OfflineRegionPicker.tsx': {
    anzahl: 2,
    grund: 'Kartenbau oder Download scheitert bei geschlossenem Dialog, kein Ort sichtbar',
  },
};

const TOAST_OBJEKTE = new Set(['message', 'meldung', 'notification']);

/** Fehler-Toast-Aufrufe einer Quelle als Zeilennummern. */
export function toastTreffer(quelle: string, dateiname = 'x.tsx'): number[] {
  const zeilen: number[] = [];
  /** Name einer nicht berechneten Eigenschaft (`a.b` → 'b'). */
  const eigenschaft = (k: AstKnoten): string | undefined =>
    k.type === 'MemberExpression' && !k.computed && (k.property as AstKnoten).type === 'Identifier'
      ? ((k.property as AstKnoten).name as string)
      : undefined;
  walk(parseQuelltext(dateiname, quelle), (knoten) => {
    if (knoten.type !== 'CallExpression') return;
    const ziel = knoten.callee as AstKnoten;
    const objekt = ziel.object as AstKnoten | undefined;
    const istToast =
      eigenschaft(ziel) === 'error' &&
      objekt != null &&
      ((objekt.type === 'Identifier' && TOAST_OBJEKTE.has(objekt.name as string)) ||
        TOAST_OBJEKTE.has(eigenschaft(objekt) ?? ''));
    const istHook = ziel.type === 'Identifier' && ziel.name === 'useFehlerMeldung';
    if (istToast || istHook) zeilen.push(zeileVon(quelle, knoten.start));
  });
  return zeilen;
}

function quelldateien(verzeichnis: string): string[] {
  return readdirSync(verzeichnis, { withFileTypes: true }).flatMap((e) => {
    const pfad = join(verzeichnis, e.name);
    if (e.isDirectory()) return quelldateien(pfad);
    if (!/\.(ts|tsx)$/.test(e.name) || /\.test\.|\.d\.ts$/.test(e.name)) return [];
    return [pfad];
  });
}

describe('Speicherfehler-Guard (LFH-1077)', () => {
  it('Selbstbeweis: Toast-Aufrufe und der Hook zählen', () => {
    const quelle = [
      "const o = { onError: (e) => message.error(fehlerText(e, 'Speichern fehlgeschlagen')) };",
      'const fehler = useFehlerMeldung();',
      "app.message.error('x');",
      "meldung.error('Kopieren nicht möglich');",
      "notification.error({ message: 'x' });",
    ].join('\n');
    expect(toastTreffer(quelle)).toEqual([1, 2, 3, 4, 5]);
  });

  it('Selbstbeweis: Kommentare, Erfolg, Konsole und Importe zählen nicht', () => {
    const quelle = [
      "import { useFehlerMeldung } from './useFehlerMeldung';",
      '// message.error(fehlerText(e))',
      "message.success('Gespeichert');",
      'console.error(e);',
      'HttpResponse.error();',
      'const text = fehlerText(mutation.error);',
    ].join('\n');
    expect(toastTreffer(quelle)).toEqual([]);
  });

  it('keine Datei hat mehr Fehler-Toasts als erlaubt, und die Schuld ist nicht zu groß', () => {
    const ist: Record<string, number> = {};
    const fundorte: string[] = [];
    for (const pfad of quelldateien(SRC)) {
      const datei = relative(SRC, pfad).split('\\').join('/');
      const treffer = toastTreffer(readFileSync(pfad, 'utf8'), datei);
      if (treffer.length === 0) continue;
      ist[datei] = treffer.length;
      fundorte.push(...treffer.map((z) => `${datei}:${z}`));
    }
    const grenze = (datei: string) => ERLAUBT[datei]?.anzahl ?? 0;
    const neu = Object.entries(ist)
      .filter(([datei, n]) => n > grenze(datei))
      .map(([datei, n]) => `${datei}: ${n} statt höchstens ${grenze(datei)}`);
    const zuGross = Object.keys(ERLAUBT)
      .filter((datei) => grenze(datei) > (ist[datei] ?? 0))
      .map(
        (datei) =>
          `${datei}: erlaubt ${grenze(datei)}, gefunden ${ist[datei] ?? 0} — Eintrag verkleinern`,
      );
    expect(
      { neu, zuGross },
      `Fundorte:\n${fundorte.filter((f) => neu.some((n) => n.startsWith(f.split(':')[0] + ':'))).join('\n')}`,
    ).toEqual({ neu: [], zuGross: [] });
  });
});
