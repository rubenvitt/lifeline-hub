import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
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
  'karten/OfflineRegionPicker.tsx': {
    anzahl: 2,
    grund: 'Kartenbau oder Download scheitert bei geschlossenem Dialog, kein Ort sichtbar',
  },
};

const TOAST_OBJEKTE = new Set(['message', 'meldung', 'notification']);

/** Fehler-Toast-Aufrufe einer Quelle als Zeilennummern. */
function toastTreffer(quelle: string, dateiname = 'x.tsx'): number[] {
  const datei = ts.createSourceFile(dateiname, quelle, ts.ScriptTarget.Latest, true);
  const zeilen: number[] = [];
  const besuche = (knoten: ts.Node) => {
    if (ts.isCallExpression(knoten)) {
      const ziel = knoten.expression;
      const istToast =
        ts.isPropertyAccessExpression(ziel) &&
        ziel.name.text === 'error' &&
        ((ts.isIdentifier(ziel.expression) && TOAST_OBJEKTE.has(ziel.expression.text)) ||
          (ts.isPropertyAccessExpression(ziel.expression) &&
            TOAST_OBJEKTE.has(ziel.expression.name.text)));
      const istHook = ts.isIdentifier(ziel) && ziel.text === 'useFehlerMeldung';
      if (istToast || istHook)
        zeilen.push(datei.getLineAndCharacterOfPosition(knoten.getStart()).line + 1);
    }
    ts.forEachChild(knoten, besuche);
  };
  besuche(datei);
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
      "onError: (e) => message.error(fehlerText(e, 'Speichern fehlgeschlagen')),",
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
