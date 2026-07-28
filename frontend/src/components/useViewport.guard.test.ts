import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard (LFH-329 · B1/H24): **`useViewport` ist der einzige Zugang zur Medienabfrage-API.**
 *
 * Ohne Guard wäre „einziger Zugang" eine Behauptung. Der Schaden einer Umgehung ist still:
 * eine zweite, handgeschriebene Breitenabfrage bricht nichts sichtbar, sie driftet nur von
 * antds Schwellen weg — und die Suite bleibt grün, weil der Test-Stub jede Abfrage brav
 * beantwortet, egal wer sie stellt.
 *
 * ── SCAN-MARKE ─────────────────────────────────────────────────────────────────────────
 * Groß-/kleinschreibungsempfindlich und OHNE offene Klammer. Beide Eigenschaften sind
 * gemessen, nicht geraten:
 *
 * - **Ohne Klammer**, weil `test/viewport.ts` die API nicht aufruft, sondern per
 *   `Object.defineProperty` INSTALLIERT — mit Klammer wäre der Eintrag dort tot, und die
 *   Installation (der zweite Weg, sich an der Regel vorbeizumogeln) bliebe ungesehen.
 * - **Groß-/kleinschreibungsempfindlich**, weil `setup.ts` nur noch `installiereMatchMedia`
 *   ruft. Der Bezeichner trägt ein großes M und trifft die Marke strukturell nicht — sonst
 *   müsste die setupFile mit auf die Allowlist, obwohl sie die API gar nicht mehr anfasst.
 *
 * ── BEKANNTE GRENZEN, und sie sind Teil des Vertrags ───────────────────────────────────
 *
 * 1. **Dynamische Zugriffe entgehen dem Scan.** `window['match' + 'Media']` steht in keiner
 *    Fundstelle. Bewusst nicht abgedeckt: ein Scanner dafür bräuchte eine Auswertung von
 *    Zeichenketten-Arithmetik und fände mehr Fehlalarme als Funde.
 * 2. **Testdateien sind ausgenommen** (`*.test.*`). Sie dürfen die API direkt stellen — die
 *    Stub-Tests in `test/viewport.test.ts` tun genau das, und dieser Guard selbst trägt die
 *    Marke in seiner eigenen Prosa und in seinen Selbst-Beweis-Fällen.
 * 3. **Codegen ist ausgenommen** (`*.generated.*`), wie in den übrigen Guards.
 * 4. **Die Allowlist steht dateiweise, nicht zeilenweise.** `ThemeModeProvider.tsx` wird von
 *    der Dichte-Arbeit ohnehin angefasst und verschiebt dabei seine Zeilennummern; ein
 *    Zeilenanker wäre nach dem ersten fremden Umbau falsch. Gegen stilles Veralten hilft
 *    stattdessen die Meldung TOTER Einträge: verschwindet die letzte Fundstelle einer
 *    freigestellten Datei, verlangt der Guard das Streichen des Eintrags.
 *
 * Der Kommentar-Stripper ist aus `theme/gate5.guard.test.ts` (dort Zeilen 79–110) BEWUSST
 * kopiert statt importiert: ein Import aus einer anderen `*.test.ts` würde deren
 * `describe`-Blöcke ein zweites Mal registrieren, und eine Auslagerung in ein geteiltes
 * Modul hieße, eine fremde, gepinnte Gate-Datei anzufassen.
 */

/**
 * Wurzel des Scans: `frontend/src`. Über `process.cwd()` aufgelöst, NICHT über
 * `import.meta.url` — unter Vitest ist das keine `file:`-URL, `fileURLToPath` wirft dort.
 * Beide üblichen Arbeitsverzeichnisse (`frontend/` und Repo-Wurzel) werden probiert.
 */
const SRC = (() => {
  for (const kandidat of ['src', 'frontend/src']) {
    const pfad = resolve(process.cwd(), kandidat);
    if (existsSync(join(pfad, 'components', 'useViewport.ts'))) return pfad;
  }
  throw new Error(`Viewport-Guard findet frontend/src nicht (cwd: ${process.cwd()})`);
})();

/** `.tsx` ist Pflicht — `ThemeModeProvider` ist eine `.tsx`, ohne sie wäre die Allowlist tot. */
const ENDUNGEN = /\.(ts|tsx)$/;

/**
 * Die Scan-Marke. Siehe Dateikopf: ohne Klammer, groß-/kleinschreibungsempfindlich.
 *
 * ZWEI Muster, nicht eines. `matchMedia` allein deckte nur den halben Vertrag:
 * antds `Grid.useBreakpoint()` ruft die Browser-API nicht selbst auf, sondern über
 * `responsiveObserver` — gemessen enthält `antd/es/grid/hooks/useBreakpoint.js`
 * NULL Vorkommen von `matchMedia`, und die Fundstelle liegt in `node_modules`,
 * also außerhalb dieses Scans. Ein direktes `Grid.useBreakpoint()` in einer
 * Komponente wäre am Guard vorbeigelaufen — und hätte genau die Semantik
 * umgangen, für die es das Primitiv gibt: `useBreakpoint` liefert auf dem ersten
 * Render eine leere Map, jedes `!screens.lg` ist dort wahr, und am Fükw-Schirm
 * blitzte für einen Frame das Handlayout auf. `abBreiteAus` dreht genau das um
 * („unbekannt ⇒ breit").
 */
const MARKE = /matchMedia|\buseBreakpoint\b/;

/** Dateiweise freigestellt — Begründung je Eintrag. */
const ALLOWLIST = [
  // Dunkelmodus-Frage (`prefers-color-scheme`), keine Breiten-/Zeigerfrage.
  '/src/theme/ThemeModeProvider.tsx',
  // Das Primitiv selbst — es stellt die Zeigerabfrage, die es allen anderen abnimmt.
  '/src/components/useViewport.ts',
  // Der jsdom-Stub: installiert die API, statt sie zu nutzen.
  '/src/test/viewport.ts',
];

/** Alle Quelldateien als Rohtext, Pfad relativ zu `src/` (führendes `/src/…`). */
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

/**
 * Blendet Kommentarinhalt aus und behält die Zeilenzahl bei (Index = Zeile − 1).
 * Trägt den Block-Zustand über Zeilengrenzen, damit auch Fortsetzungszeilen fallen.
 * Kopie aus `theme/gate5.guard.test.ts:79-110` — Begründung im Dateikopf.
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

/**
 * Beide Befundarten in einer Liste: nicht freigestellte Fundstellen UND tote
 * Allowlist-Einträge. Exportiert, damit die Selbst-Beweis-Fälle sie ohne Dateisystem prüfen.
 */
export function verstoesse(dateien: Record<string, string>, allowlist: string[]): string[] {
  const befunde: string[] = [];
  const belegt = new Set<string>();

  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (/\.test\.[jt]sx?$/.test(pfad)) continue;
    if (/\.generated\.[jt]sx?$/.test(pfad)) continue;
    const freigestellt = allowlist.includes(pfad);
    ohneKommentare(inhalt).forEach((zeile, i) => {
      if (!MARKE.test(zeile)) return;
      if (freigestellt) {
        belegt.add(pfad);
        return;
      }
      befunde.push(`${pfad}:${i + 1}  ${zeile.trim()}`);
    });
  }

  for (const eintrag of allowlist) {
    if (!belegt.has(eintrag)) befunde.push(`tote Allowlist: ${eintrag}`);
  }
  return befunde;
}

const dateien = lieseQuellen(SRC);

describe('Viewport-Guard (LFH-329): useViewport ist der einzige Zugang', () => {
  it('findet keine Medienabfrage außerhalb der freigestellten Dateien', () => {
    expect(
      verstoesse(dateien, ALLOWLIST),
      `Die Breiten-/Zeigerfrage gehört in useViewport (components/useViewport.ts) — von dort ` +
        `abBreite('md'|'lg'), istSchmal oder istBeruehrung beziehen, statt die Abfrage selbst ` +
        `zu stellen. Ein toter Allowlist-Eintrag wird gestrichen, nicht behalten.`,
    ).toEqual([]);
  });

  it('Sentinel: mehr als 200 Dateien gescannt', () => {
    // Ohne diesen Fall wäre ein kaputtes Scan-Muster (falsche Wurzel, falsche Endung)
    // still grün — der Guard fände dann schlicht nichts mehr.
    expect(Object.keys(dateien).length).toBeGreaterThan(200);
    expect(dateien['/src/theme/ThemeModeProvider.tsx'] ?? '').not.toBe('');
  });

  it('Selbst-Beweis: eine erfundene Fundstelle wird gemeldet', () => {
    const zeile = "const mql = window.matchMedia('(min-width: 992px)');";
    const baum = {
      '/src/pages/Irgendwas.tsx': zeile,
      '/src/components/useViewport.ts': zeile,
    };

    expect(verstoesse(baum, ['/src/components/useViewport.ts'])).toEqual([
      `/src/pages/Irgendwas.tsx:1  ${zeile}`,
    ]);
  });

  it('Kommentar-Fundstellen zählen nicht, auch als Fortsetzungszeile im Block', () => {
    const baum = {
      '/src/pages/Reden.tsx': [
        '/* Zeile eins',
        '   erwähnt window.matchMedia mitten im Block',
        '   und endet hier */',
        '// und hier auch: window.matchMedia',
        'const echt = window.matchMedia(ZEIGER);',
      ].join('\n'),
    };

    expect(verstoesse(baum, [])).toEqual([
      '/src/pages/Reden.tsx:5  const echt = window.matchMedia(ZEIGER);',
    ]);
  });

  it('tote Allowlist-Einträge werden gemeldet', () => {
    // Damit die Liste nicht still veraltet: wer die letzte Fundstelle entfernt, streicht
    // den Eintrag mit — sonst stünde dort dauerhaft eine Freistellung ohne Gegenstand.
    const baum = { '/src/theme/Egal.tsx': 'const x = 1;' };

    expect(verstoesse(baum, ['/src/test/viewport.ts'])).toEqual([
      'tote Allowlist: /src/test/viewport.ts',
    ]);
  });
});
