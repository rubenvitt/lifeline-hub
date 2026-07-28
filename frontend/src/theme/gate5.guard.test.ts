import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Gate-5-Guard (LFH-328 · A2, Gate 5 aus A1): **kein A0-Farbwert außerhalb `src/theme/`.**
 *
 * Die zehn Rollenwerte aus `tokens.ts`/`rollen.css` sind die einzige Quelle für Farbe.
 * Eine Kopie desselben Hex an anderer Stelle bricht nichts sichtbar — sie divergiert
 * still, sobald die Rolle sich ändert, und genau das ist der Bestand, den A2 auflöst
 * (acht `#a8071a`-Kopien, gemessen in Spec §1.2). Neue Farbe kommt aus `theme/`:
 * TSX über `theme.useToken()` bzw. `rollenFarbe()`, handgeschriebenes CSS über
 * `var(--lfh-*)` aus `rollen.css`.
 *
 * ── BEKANNTE GRENZEN, und sie sind Teil des Vertrags ────────────────────────────
 *
 * 1. **rgba-getarnte Werte entgehen dem Hex-Scan.** Gemessen: `pages/lagekarte/Sidebar.tsx:462`
 *    trägt `rgba(22, 119, 255, .06)` (= `#1677ff`), `pages/lagekarte/bildHandles.ts` nutzt
 *    dieselbe `,.5`-Kurznotation. Der Guard sieht keinen davon. Wer eine Rollenfarbe als
 *    rgba schreibt, umgeht das Gate — bewusst nicht abgedeckt, weil ein rgba-Scanner ohne
 *    Farbraum-Normalisierung mehr Fehlalarme als Funde erzeugt.
 * 2. **Der Guard liest die Dateien über `node:fs`, NICHT über `import.meta.glob`.** Gemessen:
 *    `import.meta.glob('/src/**\/*.css', {query:'?raw'})` listet unter Vitest zwar alle zehn
 *    CSS-Dateien, liefert aber für jede den **Leerstring** — Vitest verarbeitet CSS
 *    standardmäßig nicht (`css: false`). Mit dem Glob wäre die CSS-Hälfte des Gates eine
 *    Attrappe gewesen, und genau die Hälfte der A2-Fundstellen (`index.css`,
 *    `Markdown.css`) lag in CSS. Der fs-Scan deckt zugleich `.svg` mit ab und liegt damit
 *    näher am erweiterungsagnostischen Shell-Kommando aus den Global Constraints.
 * 3. **Kommentare sind ausgenommen** (`ohneKommentare`): über einen Farbwert darf man reden,
 *    z. B. `pages/LoginPage.css:80`, das den erledigten Umbau dokumentiert. Der Stripper
 *    trägt einen Block-Zustand über Zeilengrenzen — ein Präfix-Test (`startsWith('*')`)
 *    reichte nicht, weil genau diese Zeile eine FORTSETZUNG im Block ist und mit `still`
 *    beginnt. Nebenwirkung: ein `//` in einem String (URL) blendet den Zeilenrest aus —
 *    das erzeugt Falsch-Negative, nie Falsch-Positive.
 * 4. **Tests sind ausgenommen** (`*.test.*`): sie pinnen Werte bewusst (`zonenStil.test.ts`
 *    prüft den Nicht-Rollen-Fallback `#1677ff`). Das Shell-Gate sieht sie, dieser Test nicht.
 */

/**
 * Wurzel des Scans: `frontend/src`. Über `process.cwd()` aufgelöst, NICHT über
 * `import.meta.url` — unter Vitest ist das keine `file:`-URL, `fileURLToPath` wirft dort
 * („The URL must be of scheme file", gemessen). Beide üblichen Arbeitsverzeichnisse
 * (`frontend/` und Repo-Wurzel) werden probiert; findet sich keins, bricht der Test laut.
 */
const SRC = (() => {
  for (const kandidat of ['src', 'frontend/src']) {
    const pfad = resolve(process.cwd(), kandidat);
    if (existsSync(join(pfad, 'theme', 'tokens.ts'))) return pfad;
  }
  throw new Error(`Gate-5-Guard findet frontend/src nicht (cwd: ${process.cwd()})`);
})();

const ENDUNGEN = /\.(ts|tsx|css|svg)$/;

/** Alle Quelldateien als Rohtext, Pfad relativ zu `src/` (führendes `/src/…` wie beim Glob). */
function lieseQuellen(verzeichnis: string, praefix = '/src'): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      Object.assign(treffer, lieseQuellen(pfad, `${praefix}/${eintrag.name}`));
    } else if (ENDUNGEN.test(eintrag.name)) {
      treffer[`${praefix}/${eintrag.name}`] = readFileSync(pfad, 'utf8');
    }
  }
  return treffer;
}

const dateien = lieseQuellen(SRC);

/** Die zehn A0-Rollenwerte aus `farbenHell`/`farbenDunkel` (Gate 5 aus A1, wortgleich). */
const ROLLENWERT =
  /#(b02318|ff7a7f|f5b942|5cc48d|1c6640|7a5200|1a5fa0|6fb4ec|a8071a|e04552)/i;

/**
 * Blendet Kommentarinhalt aus und behält die Zeilenzahl bei (Index = Zeile − 1).
 * Trägt den Block-Zustand über Zeilengrenzen, damit auch Fortsetzungszeilen fallen.
 */
function ohneKommentare(inhalt: string): string[] {
  const zeilen: string[] = [];
  let imBlock = false;
  for (const roh of inhalt.split('\n')) {
    let rest = roh;
    let sichtbar = '';
    while (rest.length > 0) {
      if (imBlock) {
        const ende = rest.indexOf('*/');
        if (ende === -1) break; // Rest der Zeile liegt im Block
        imBlock = false;
        rest = rest.slice(ende + 2);
        continue;
      }
      const block = rest.indexOf('/*');
      const einzeilig = rest.indexOf('//');
      if (block === -1 && einzeilig === -1) {
        sichtbar += rest;
        break;
      }
      if (einzeilig !== -1 && (block === -1 || einzeilig < block)) {
        sichtbar += rest.slice(0, einzeilig);
        break;
      }
      sichtbar += rest.slice(0, block);
      rest = rest.slice(block + 2);
      imBlock = true;
    }
    zeilen.push(sichtbar);
  }
  return zeilen;
}

describe('Gate-5-Guard (LFH-328): kein A0-Farbwert außerhalb src/theme/', () => {
  it('findet keinen kopierten Rollenfarbwert', () => {
    const verstoesse: string[] = [];
    for (const [pfad, inhalt] of Object.entries(dateien)) {
      if (pfad.startsWith('/src/theme/')) continue; // Home der Wahrheitsquelle
      if (/\.test\.[jt]sx?$/.test(pfad)) continue; // Tests pinnen Werte bewusst
      if (/\.generated\.[jt]sx?$/.test(pfad)) continue; // Codegen
      ohneKommentare(inhalt).forEach((zeile, i) => {
        if (ROLLENWERT.test(zeile)) {
          verstoesse.push(`${pfad}:${i + 1}  ${zeile.trim()}`);
        }
      });
    }
    expect(
      verstoesse,
      `Kopierte A0-Farbwerte gefunden — der Wert gehört nach theme/: in TSX über ` +
        `theme.useToken() bzw. rollenFarbe(rolle, token), in CSS über var(--lfh-*) ` +
        `aus rollen.css:\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });

  it('sieht die CSS-Dateien wirklich — sonst ist das halbe Gate eine Attrappe', () => {
    // Selbsttest gegen Grenze 2: mit `import.meta.glob(…?raw)` war `index.css` hier LEER.
    expect(dateien['/src/index.css'] ?? '').not.toBe('');
    expect(Object.keys(dateien).filter((p) => p.endsWith('.css')).length).toBeGreaterThan(5);
  });

  it('blendet Kommentar-Erwähnungen aus, auch als Fortsetzungszeile im Block', () => {
    const sichtbar = ohneKommentare(
      ['/* Zeile eins', '   erwähnt #a8071a mitten im Block', '   und endet hier */', 'echt: #a8071a;'].join('\n'),
    );
    expect(sichtbar.filter((z) => ROLLENWERT.test(z))).toEqual(['echt: #a8071a;']);
  });
});
