import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Erklärtext-Guard (LFH-1078, `frontend/AGENTS.md`, Bedien-Leitlinie „Text erklärt nie die
 * Bedienung“).
 *
 * ── Warum ──────────────────────────────────────────────────────────────────────
 * Ein Satz, der erklärt, wo man klickt, was ein leeres Feld bedeutet oder wie der Server arbeitet,
 * ersetzt eine Bedienung, die es selbst zeigen sollte (Platzhalter mit dem wirksamen Wert, Knopf im
 * Leerzustand, gesperrtes Element mit Grund in wenigen Wörtern). Dieser Guard hält neue solche
 * Sätze fern, während die Pakete P1–P7 den Bestand abbauen.
 *
 * ── Wie ───────────────────────────────────────────────────────────────────────
 * Gelesen werden nur ZEICHENKETTEN und JSX-Text (TypeScript-AST), keine Kommentare und keine
 * Bezeichner: `const klick = …` oder ein Dateikopf über „Enter sendet“ zählen nicht. Jede Datei
 * darf höchstens so viele Treffer haben, wie {@link OFFEN} für sie einträgt; ein Eintrag über der
 * tatsächlichen Zahl ist ebenfalls rot — die Schuld schrumpft nur, wer einen Satz entfernt,
 * verkleinert den Eintrag im selben Commit.
 *
 * ── Warum ein Vitest-Guard und keine ESLint-Regel ───────────────────────────────
 * Wie `dichte.guard.test.ts`: `pnpm lint` läuft mit `--max-warnings 0`, eine rot geborene Regel
 * würde abgeschaltet statt befolgt.
 *
 * ── Was dieser Guard NICHT sieht (Teil des Vertrags) ────────────────────────────
 *   • Erklärsätze ohne eines der {@link MUSTER} — er ist ein Netz gegen Rückfall, die Regel trägt
 *     das Review;
 *   • ein Muster, das über zwei verkettete Literale verteilt ist (`'Leer' + ': jetzt'`);
 *   • Texte, die der Server liefert.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Erklärmuster mit je einem Beispiel, das der Selbstbeweis trifft. */
const MUSTER: readonly { name: string; muster: RegExp; beispiel: string }[] = [
  // „Leer: jetzt“, „Leer = Vorgabe“: der wirksame Wert gehört als Platzhalter ins Feld.
  { name: 'leer', muster: /\b[Ll]eer(?: gelassen)?\s*[:=]/, beispiel: 'Feld leer = Vorgabe' },
  {
    name: 'klick',
    muster:
      /\b(?:[Kk]lick(?:e|en)?\s+(?:auf|zum)\b|per Klick\b|[Kk]licken\b|anklicken\b|[Dd]oppelklick|antippen\b|[Tt]ippen\b)/,
    beispiel: 'Klick auf die Karte setzt die Koordinate.',
  },
  {
    name: 'taste',
    muster:
      /\b(?:Enter|Return|Esc|Tab)\b[^·]{0,20}?\b(?:sendet|speichert|verwirft|beendet|wechselt)\b|Shift\s*\+\s*Enter|Cmd\/Strg/,
    beispiel: 'Enter speichert · Tab wechselt das Feld',
  },
  {
    name: 'netz',
    muster: /sobald (?:wieder )?(?:Verbindung|das Netz)|bei Verbindung gesendet/,
    beispiel: 'Meldung wird bei Verbindung gesendet',
  },
  {
    name: 'nachlesen',
    muster: /zum Nachlesen/,
    beispiel: 'die Werte stehen hier zum Nachlesen.',
  },
  {
    name: 'technik',
    muster: /\bread-only\b|Soft-Delete|append-only|gesnapshottet|Prep-Phase|Purge-Lauf|Shortbread/,
    beispiel: 'In der Prep-Phase herunterladen',
  },
  {
    name: 'hier',
    muster: /\b[Hh]ier (?:kannst du|können Sie|lässt sich|gibt es nichts)/,
    beispiel: 'hier lässt sich nichts erfassen',
  },
];

/**
 * Schuldmenge: Datei (relativ zu `src/`) → erlaubte Trefferzahl. Schrumpft nur; die Pakete
 * P1–P7 aus LFH-1078 bauen sie ab.
 */
const OFFEN: Record<string, number> = {
  'abloesung/AbloesungDialoge.tsx': 5,
  'betreuung/BetreuungDialoge.tsx': 3,
  'command-palette/VorschauZustand.tsx': 1,
  'einsatz/AlarmZentrale.tsx': 2,
  'einsatz/modulRegistry.ts': 1,
  'etb/EtbZeitachse.tsx': 1,
  'etb/Schnellerfassung.tsx': 2,
  'infotelefon/AnrufErfassung.tsx': 2,
  'karten/KartenOnlineSektion.tsx': 1,
  'pages/AbloesungPage.tsx': 2,
  'pages/BefehlDetailPage.tsx': 1,
  'pages/BetreuungPage.tsx': 2,
  'pages/EinheitDetailPage.tsx': 3,
  'pages/EtbPage.tsx': 1,
  'pages/LageberichtDetailPage.tsx': 1,
  'pages/LageberichtePage.tsx': 1,
  'pages/MeldungenPage.tsx': 1,
  'pages/PersonenDetailPage.tsx': 1,
  'pages/PressePage.tsx': 1,
  'pages/TiereDetailPage.tsx': 1,
  'pages/VerpflegungPage.tsx': 1,
  'pages/einstellungen/Anmeldeverfahren.tsx': 1,
  'pages/einstellungen/AnzeigeEinstellungen.tsx': 2,
  'pages/einstellungen/EinsatzAllgemein.tsx': 1,
  'pages/einstellungen/EinsatzAufbewahrung.tsx': 2,
  'pages/einstellungen/EinsatzDefaults.tsx': 9,
  'pages/einstellungen/EinsatzModule.tsx': 1,
  'pages/einstellungen/KategorieVorgabenPaneel.tsx': 1,
  'pages/einstellungen/ModulEinstellungsListe.tsx': 1,
  'pages/lagekarte/MessSteuerung.tsx': 1,
  'pages/lagekarte/Sidebar.tsx': 3,
  'pages/lagekarte/ZeichnenSteuerung.tsx': 2,
  'stab/LagebesprechungModal.tsx': 1,
  'stab/skizze/Eigenschaftspaneel.tsx': 1,
  'verpflegung/VerpflegungDialoge.tsx': 1,
};

/** Sichtbare Zeichenketten einer Quelle: Literale, Template-Teile, JSX-Text. Ohne Importpfade. */
function texteAus(quelle: string, dateiname = 'x.tsx'): { text: string; zeile: number }[] {
  const datei = ts.createSourceFile(dateiname, quelle, ts.ScriptTarget.Latest, true);
  const texte: { text: string; zeile: number }[] = [];
  const merke = (knoten: ts.Node, text: string) =>
    texte.push({ text, zeile: datei.getLineAndCharacterOfPosition(knoten.getStart()).line + 1 });
  const besuche = (knoten: ts.Node) => {
    if (ts.isImportDeclaration(knoten) || ts.isExportDeclaration(knoten)) return;
    if (ts.isStringLiteral(knoten) || ts.isNoSubstitutionTemplateLiteral(knoten))
      merke(knoten, knoten.text);
    else if (ts.isTemplateHead(knoten) || ts.isTemplateMiddle(knoten) || ts.isTemplateTail(knoten))
      merke(knoten, knoten.text);
    else if (ts.isJsxText(knoten)) merke(knoten, knoten.text);
    ts.forEachChild(knoten, besuche);
  };
  besuche(datei);
  return texte;
}

/** Treffer einer Quelle als „Zeile: Mustername“. */
function erklaerTreffer(quelle: string, dateiname = 'x.tsx'): string[] {
  const treffer: string[] = [];
  for (const { text, zeile } of texteAus(quelle, dateiname)) {
    // JSX-Text bricht Zeilen um; ein Muster soll über den Umbruch hinweg treffen.
    const flach = text.replace(/\s+/g, ' ');
    for (const { name, muster } of MUSTER)
      if (muster.test(flach)) treffer.push(`${zeile}: ${name}`);
  }
  return treffer;
}

function quelldateien(verzeichnis: string): string[] {
  return readdirSync(verzeichnis, { withFileTypes: true }).flatMap((e) => {
    const pfad = join(verzeichnis, e.name);
    if (e.isDirectory()) return quelldateien(pfad);
    if (!/\.(ts|tsx)$/.test(e.name) || /\.test\.|\.d\.ts$/.test(e.name)) return [];
    return [pfad];
  });
}

describe('Erklärtext-Guard (LFH-1078)', () => {
  it('Selbstbeweis: jedes Muster trifft sein Beispiel', () => {
    for (const { name, beispiel } of MUSTER)
      expect(erklaerTreffer(`const t = ${JSON.stringify(beispiel)};`), name).toEqual([
        `1: ${name}`,
      ]);
  });

  it('Selbstbeweis: JSX-Text über einen Umbruch, Template und Attribut zählen', () => {
    const quelle = [
      'const a = <p>Klick auf die',
      '  Karte</p>;',
      'const b = `${n} Einträge werden gesendet, sobald wieder Verbindung besteht`;',
      'const c = <Form.Item extra="Leer: jetzt" />;',
    ].join('\n');
    expect(erklaerTreffer(quelle)).toEqual(['1: klick', '3: netz', '4: leer']);
  });

  it('Selbstbeweis: Kommentare, Bezeichner und Importpfade zählen nicht', () => {
    const quelle = [
      "import x from './Klick auf';",
      '// Enter sendet, Leer: jetzt',
      '/* sobald wieder Verbindung */',
      'const klick = useLinkClickHandler(to);',
      'const d = <div>{/* Prep-Phase */}Stand</div>;',
    ].join('\n');
    expect(erklaerTreffer(quelle)).toEqual([]);
  });

  it('Selbstbeweis: Fachwörter ohne Anleitung bleiben erlaubt', () => {
    for (const erlaubt of [
      'Leerzustand',
      'Klickziel',
      'Esc',
      'Zugriff wird protokolliert.',
      'Offline vorgemerkt',
      'Nur Ansicht',
    ])
      expect(erklaerTreffer(`const t = ${JSON.stringify(erlaubt)};`), erlaubt).toEqual([]);
  });

  it('keine Datei hat mehr Erklärsätze als ihre Schuld, und die Schuld ist nicht zu groß', () => {
    const ist: Record<string, number> = {};
    const fundorte: string[] = [];
    for (const pfad of quelldateien(SRC)) {
      const datei = relative(SRC, pfad).split('\\').join('/');
      const treffer = erklaerTreffer(readFileSync(pfad, 'utf8'), datei);
      if (treffer.length === 0) continue;
      ist[datei] = treffer.length;
      fundorte.push(...treffer.map((t) => `${datei}:${t}`));
    }
    const neu = Object.entries(ist)
      .filter(([datei, n]) => n > (OFFEN[datei] ?? 0))
      .map(([datei, n]) => `${datei}: ${n} statt höchstens ${OFFEN[datei] ?? 0}`);
    const zuGross = Object.entries(OFFEN)
      .filter(([datei, n]) => n > (ist[datei] ?? 0))
      .map(
        ([datei, n]) => `${datei}: Schuld ${n}, gefunden ${ist[datei] ?? 0} — Eintrag verkleinern`,
      );
    expect(
      { neu, zuGross },
      `Fundorte:\n${fundorte.filter((f) => neu.some((n) => n.startsWith(f.split(':')[0] + ':'))).join('\n')}`,
    ).toEqual({ neu: [], zuGross: [] });
  });
});
