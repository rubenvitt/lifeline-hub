import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';

/**
 * Größen nur aus der Skala (LLH-1775, Spec `schriftskala`, „Größen nur aus der Skala“; Change
 * `i1o47voj-schrift-lesbarkeit`, design.md Entscheidung 4).
 *
 * Eine Schriftgröße kommt im Frontend nur aus dem Theme: `schriftGroesse`, `schriftStil`,
 * `zahlStil` (`components/instrument/rollenwerte.ts`), der Baustein `Schrift`, antds
 * `token.fontSize*` oder `var(--lfh-typo-…)`/`var(--lfh-groesse-…)` in CSS. Vorher standen rund
 * 240 `fontSize`-Literale in 180 Dateien neben 31 Verweisen auf die Skala, gerendert wurden 14
 * Größen. Ein Literal wächst nicht mit der Dichte und kennt keinen Boden.
 *
 * KEINE SCHULDMENGE: der Bestand wurde vor dem Scharfschalten ganz umgestellt (Entscheidung
 * 15.11.2026). Ein Vitest-Wächter statt ESLint, weil `pnpm lint` mit `--max-warnings 0` rot
 * geboren wäre und ESLint kein CSS liest.
 *
 * ── WAS ER MELDET ──
 *
 * TS/TSX (ohne Tests, ohne `theme/`, ohne `test/`):
 * 1. `fontSize:`/`fontSize=` mit einer Zahl oder einer Längenangabe im Wert derselben Zeile.
 * 2. `font-size:` mit einer Zahl in einem String (HTML für Kartenpopups, CSS in JS) und
 *    `.font = '…12px…'` (Canvas).
 * 3. `monoStil(` — der Helfer heißt `zahlStil` und nimmt eine Stufe.
 * 4. Eine Mono-Familie als Literal (`monospace`): Mono kommt nur aus `schrift.zahl`.
 *
 * CSS (ohne `theme/rollen.css` und die Druckblätter, die auf Papier in pt rechnen):
 * 5. `font-size:` ohne `var(--lfh-typo-…)`, `var(--lfh-groesse-…)` oder `inherit`; `font:` mit
 *    einer Längenangabe.
 *
 * ── BEKANNTE GRENZEN ──
 *
 * Benannte Konstanten fängt er in zwei Formen: `…_SCHRIFT`/`…FONT…` mit Zahlwert und eine
 * Konstante in Großbuchstaben am `fontSize` (auch `GROESSE.band`), die keine Stufe trägt (Review
 * LLH-1719). Als Stufe gilt nur eine Konstante dieser Datei, deren Zeile eine Stufe nennt und
 * keine Zahl (über mehrere Zeilen zusammengezogen); eine importierte meldet er lieber zu viel.
 * Er sieht nicht: eine Zahl in einer kleingeschriebenen Variable (`const g = 13; fontSize: g`).
 * Das deckt die e2e-Messung `e2e/schrift-skala.spec.ts` am gerenderten Schirm. Die Großbild-Skala
 * (`grossMass(GROSS_BEZUG.…)`, LLH-1747) wächst mit dem Fenster und ist wie die Fernsicht eine
 * benannte Ausnahme; eine Zahl in `grossMass(28)` bleibt rot.
 *
 * Gelesen wird zeilenweise ohne Kommentare (`ohneKommentare`). Ein Wert über mehrere Zeilen wird
 * nur in seiner ersten Zeile geprüft; Prettier bricht kurze Werte nicht um. Der Lagemonitor
 * liest seine Fernsicht-Skala aus `theme/tokens.ts` (`fernsicht`), sie ist damit Theme.
 */

const SRC = (() => {
  for (const kandidat of ['src', 'frontend/src']) {
    const pfad = resolve(process.cwd(), kandidat);
    if (existsSync(join(pfad, 'theme', 'rollen.css'))) return pfad;
  }
  throw new Error(`Schrift-Literal-Guard findet frontend/src nicht (cwd: ${process.cwd()})`);
})();

/**
 * Die Dateien des Lagemonitors, die die Fernsicht-Skala (`fernsicht` im Theme) als Zahl setzen.
 * Die Monitorseite nimmt sie über `grossMass` (LLH-1930), nur die Karte braucht die Zahl.
 */
export const FERNSICHT_DATEIEN: readonly string[] = ['geraet/LagemonitorKarte.tsx'];

/**
 * Zeichnungen mit eigenem Maßstab (Spec `schriftskala`): ihre Schriften sind Zeichnungseinheiten
 * und stehen als benannte Konstanten (`…_SCHRIFT`), mindestens 11; nur die Glyphen in
 * `GLYPHEN` sind Teil eines Zeichens und dürfen kleiner sein. Einzeln benannt, nicht als
 * Verzeichnis: Paneel, Dialoge und Werkzeugleiste der Skizze sind Bedienoberfläche und gehören
 * zur Skala (Review LLH-1719).
 */
export const ZEICHNUNG_DATEIEN: readonly string[] = [
  'fernmeldewesen/fernmeldeskizzeLayout.ts',
  'fernmeldewesen/skizzenZeichen.tsx',
  'fernmeldewesen/skizze/SkizzenElemente.tsx',
  'fernmeldewesen/skizze/schriftfeld.ts',
];
export const GLYPHEN: readonly string[] = ['MARKE_SCHRIFT'];
/** TS-Druckansichten auf Papier mit eigener Skala (Nordpfeil des Lageplans). */
export const DRUCK_TS: readonly string[] = ['pages/lagekarte/LageplanDruck.tsx'];

/** Druckblätter: Papier, Größen in pt, Spec `schriftskala` nimmt sie aus. */
export const DRUCKBLAETTER: readonly string[] = [
  'druck/druck.css',
  'pages/lagekarte/lageplanDruck.css',
  'fernmeldewesen/skizze/skizzeDruck.css',
];

/** Eine Zahl, auch mit Einheit (`13`, `'13px'`, `0.9`), oder eine Einheit hinter `${…}`. */
const ZAHL = /(?<![\w.$-])\d+(?:\.\d+)?(?:px|pt|r?em|%)?(?![\w])|\}(?:px|pt|r?em)\b/;

/** Befunde einer TS/TSX-Datei als `Zeile: Grund`. */
export function tsBefunde(
  inhalt: string,
  fernsichtDatei = false,
  zeichnung = false,
): { zeile: number; grund: string }[] {
  const treffer: { zeile: number; grund: string }[] = [];
  const zeilen = ohneKommentare(inhalt);
  // Konstanten dieser Datei, die eine Stufe der Skala tragen (`BAND_GROESSE = schriftGroesse(…)`,
  // `EINHEITEN_STUFE: Groessenstufe = 'text'`): am `fontSize` erlaubt.
  // Eine Konstante über mehrere Zeilen (Prettier bricht `{ … } as const` um) wird bis zur
  // schließenden Klammer zusammengezogen und als eine Zeile gelesen.
  const deklarationen = zeilen.map((z, i) => {
    if (!/\b(?:const|let)\s+[A-Z][A-Z0-9_]*\b[^=]*=\s*\{\s*$/.test(z)) return z;
    let tiefe = 0;
    const teile: string[] = [];
    for (const folge of zeilen.slice(i)) {
      teile.push(folge.trim());
      for (const zeichen of folge) {
        if (zeichen === '{') tiefe += 1;
        if (zeichen === '}') tiefe -= 1;
      }
      if (tiefe <= 0) break;
    }
    return teile.join(' ');
  });
  const stufenKonstanten = new Set(
    deklarationen.flatMap((z) => {
      const m = /\b(?:const|let)\s+([A-Z][A-Z0-9_]*)\b[^=]*=\s*(.*)$/.exec(z);
      if (!m) return [];
      // Neben der Stufe keine Zahl (`leise ? schriftGroesse('klein') : 13` ist keine Stufe);
      // `${fernsicht.…}px` ist die benannte Skala des Lagemonitors.
      const ohneSkala = m[2]
        .replace(/\$\{fernsicht\.\w+\}px/g, '')
        .replace(/var\(--lfh-[\w-]+\)/g, '');
      const istStufe =
        (/schriftGroesse\(|var\(--lfh-|\bfernsicht\b|Groessenstufe/.test(z) ||
          /^['"](fein|klein|text|titel|wert|gross)['"]/.test(m[2])) &&
        !ZAHL.test(ohneSkala);
      return istStufe ? [m[1]] : [];
    }),
  );
  zeilen.forEach((sichtbar, i) => {
    const zeile = i + 1;
    const groesse = /\bfontSize\s*[:=]\s*(.*)$/.exec(sichtbar);
    if (groesse) {
      // Bis zum Ende des Werts: das erste Komma oder `}` auf Klammertiefe 0.
      let tiefe = 0;
      let wert = '';
      for (const z of groesse[1]) {
        if ('([{'.includes(z)) tiefe += 1;
        if (')]}'.includes(z)) {
          if (tiefe === 0) break;
          tiefe -= 1;
        }
        if (z === ',' && tiefe === 0) break;
        wert += z;
      }
      // Die Fernsicht-Skala des Lagemonitors ist eine benannte Ausnahme (Spec `schriftskala`):
      // dort darf ein Wert aus `fernsicht` als `${…}px` stehen, eine Zahl aber nicht.
      const nurEinheit = fernsichtDatei && !/\d/.test(wert.replace(/\}px/g, ''));
      if (ZAHL.test(wert) && !nurEinheit) {
        treffer.push({ zeile, grund: `fontSize mit Zahl: ${wert.trim()}` });
      }
      // Eine Konstante in Großbuchstaben am `fontSize` trägt eine Zahl an der Prüfung vorbei
      // (Review LLH-1719: `BAND_SCHRIFT = 13`); erlaubt nur in Zeichnungen und im Lagemonitor.
      // Als Argument der Skala (`schriftGroesse(EINHEITEN_STUFE)`) ist die Konstante eine Stufe.
      // `grossMass(…)` ist die Großbild-Skala (LLH-1747): eine benannte Ausnahme wie die Fernsicht.
      const konstante = /schriftGroesse\(|zahlStil\(|schriftStil\(|schriftPx\(|grossMass\(/.test(
        wert,
      )
        ? null
        : /(?<![\w.])([A-Z][A-Z0-9_]{2,})(?:\.\w+)*(?![\w(])/.exec(wert);
      // Auch der Zugriff auf ein Feld (`GROESSE.band`): die Stufe steht am Namen der Konstante.
      if (konstante && !stufenKonstanten.has(konstante[1]) && !zeichnung && !fernsichtDatei) {
        treffer.push({ zeile, grund: `fontSize aus Konstante ${konstante[0]}` });
      }
    }
    // Eine Größe heißt `…_SCHRIFT` bzw. `…FONT…` und trägt eine Zahl (nicht `UEBERSCHRIFT = /h1/`).
    const benannt =
      /\b(?:const|let)\s+((?:[A-Z0-9_]*_)?SCHRIFT|[A-Z0-9_]*FONT[A-Z0-9_]*)\b\s*(?::[^=]+)?=\s*(.*)$/.exec(
        sichtbar,
      );
    if (benannt && /^(?:\d|\{[^}]*:\s*\d|\[\s*\d)/.test(benannt[2])) {
      const zahlen = [...benannt[2].matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
      const imBoden = zeichnung && (GLYPHEN.includes(benannt[1]) || zahlen.every((z) => z >= 11));
      if (!imBoden) treffer.push({ zeile, grund: `Schriftgröße als Konstante ${benannt[1]}` });
    }
    if (/font-size\s*:\s*[^;'"`]*\d/.test(sichtbar)) {
      treffer.push({ zeile, grund: 'font-size mit Zahl im String' });
    }
    if (/\.font\s*=\s*['"`][^'"`]*\d+(?:\.\d+)?px/.test(sichtbar)) {
      treffer.push({ zeile, grund: 'Canvas-Schrift mit Pixelzahl' });
    }
    if (/\bmonoStil\s*\(/.test(sichtbar)) {
      treffer.push({ zeile, grund: 'monoStil: zahlStil(stufe) nehmen' });
    }
    if (/['"`][^'"`]*\bmonospace\b/.test(sichtbar)) {
      treffer.push({ zeile, grund: 'Mono-Familie als Literal: schrift.zahl nehmen' });
    }
  });
  return treffer;
}

/**
 * Erlaubt: eine Variable der Skala, `inherit`, eine eigene Variable mit einer Stufe als Rückfall
 * (`var(--etb-inhalt-groesse, var(--lfh-groesse-text))`) und `pt`: Punkte gibt es nur auf Papier
 * (`@page`-Ränder, Druckköpfe).
 */
const CSS_ERLAUBT =
  /^\s*(?:var\(--lfh-(?:typo-[\w-]+-groesse|groesse-[\w-]+)\)|var\(--[\w-]+,\s*var\(--lfh-groesse-[\w-]+\)\)|inherit)\s*(?:!important\s*)?$/;

/** Befunde einer CSS-Datei als `Zeile: Grund`. */
export function cssBefunde(inhalt: string): { zeile: number; grund: string }[] {
  const treffer: { zeile: number; grund: string }[] = [];
  // Blockstapel: `pt` ist nur in `@media print` und `@page` erlaubt, Punkte gibt es nur auf Papier.
  const stapel: boolean[] = [];
  ohneKommentare(inhalt).forEach((sichtbar, i) => {
    const imDruck = () => stapel.some(Boolean) || /@media\s+print|@page/.test(sichtbar);
    const groesse = /(?:^|[\s;{])font-size\s*:\s*([^;}]*)/.exec(sichtbar);
    if (groesse) {
      const wert = groesse[1];
      const ptImDruck = /^\s*\d+(?:\.\d+)?pt\s*$/.test(wert) && imDruck();
      if (!CSS_ERLAUBT.test(wert) && !ptImDruck) {
        treffer.push({ zeile: i + 1, grund: `font-size: ${wert.trim()}` });
      }
    }
    const kurz = /(?:^|[\s;{])font\s*:\s*([^;}]*)/.exec(sichtbar);
    if (kurz && /\d(?:\.\d+)?(?:px|pt|em|rem|%)/.test(kurz[1])) {
      treffer.push({ zeile: i + 1, grund: `font: ${kurz[1].trim()}` });
    }
    for (const z of sichtbar) {
      if (z === '{') stapel.push(/@media\s+print|@page/.test(sichtbar));
      if (z === '}') stapel.pop();
    }
  });
  return treffer;
}

function liesBaum(verzeichnis: string, praefix = ''): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const relativ = praefix ? `${praefix}/${eintrag.name}` : eintrag.name;
    const voll = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) Object.assign(treffer, liesBaum(voll, relativ));
    else if (/\.(tsx?|css)$/.test(eintrag.name)) treffer[relativ] = readFileSync(voll, 'utf8');
  }
  return treffer;
}

/** Alle Befunde über eine Menge Dateien (Pfad relativ zu `src/` → Inhalt). Leer = in Ordnung. */
export function befunde(dateien: Record<string, string>): string[] {
  const meldungen: string[] = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (pfad.endsWith('.css')) {
      if (pfad === 'theme/rollen.css' || DRUCKBLAETTER.includes(pfad)) continue;
      for (const b of cssBefunde(inhalt)) meldungen.push(`${pfad}:${b.zeile}  ${b.grund}`);
      continue;
    }
    if (/\.test\.tsx?$/.test(pfad) || /^(theme|test)\//.test(pfad) || pfad.endsWith('.d.ts')) {
      continue;
    }
    if (DRUCK_TS.includes(pfad)) continue;
    for (const b of tsBefunde(
      inhalt,
      FERNSICHT_DATEIEN.includes(pfad),
      ZEICHNUNG_DATEIEN.includes(pfad),
    )) {
      meldungen.push(`${pfad}:${b.zeile}  ${b.grund}`);
    }
  }
  return meldungen;
}

describe('Schriftgrößen nur aus der Skala (LLH-1775)', () => {
  it('kein Größen-Literal und keine freie Mono-Familie im Frontend', () => {
    expect(befunde(liesBaum(SRC))).toEqual([]);
  });

  it('die Druckblätter gibt es noch (sonst ist die Ausnahme tot)', () => {
    for (const pfad of [
      ...DRUCKBLAETTER,
      ...FERNSICHT_DATEIEN,
      ...ZEICHNUNG_DATEIEN,
      ...DRUCK_TS,
    ]) {
      expect(existsSync(join(SRC, pfad)), pfad).toBe(true);
    }
  });
});

describe('Regeln des Wächters an Texten (Mutationsproben)', () => {
  it('meldet Zahlen und Längen im fontSize-Wert', () => {
    for (const zeile of [
      'style={{ fontSize: 12 }}',
      "style={{ fontSize: '13px' }}",
      'fontSize: leise ? schriftGroesse("klein") : 13,',
      '<text fontSize={10}>',
      'fontSize: token.fontSize * 0.9,',
      'fontSize: `${groesse}px`,',
    ]) {
      expect(tsBefunde(zeile), zeile).not.toEqual([]);
    }
  });

  it('lässt Stufen, Rollen und antd-Token durch', () => {
    for (const zeile of [
      "style={{ fontSize: schriftGroesse('klein'), fontWeight: 600 }}",
      'fontSize: token.fontSizeSM,',
      'fontSize: fernsicht.text,',
      "...zahlStil('fein', 500),",
    ]) {
      expect(tsBefunde(zeile), zeile).toEqual([]);
    }
  });

  it('Fernsicht: `${…}px` nur in den Lagemonitor-Dateien, eine Zahl nie', () => {
    expect(tsBefunde('fontSize: `${schrift}px`,', true)).toEqual([]);
    expect(tsBefunde('fontSize: `${schrift}px`,')).not.toEqual([]);
    expect(tsBefunde('fontSize: 28,', true)).not.toEqual([]);
  });

  it('benannte Konstanten: Zahl am Namen …SCHRIFT und Konstante am fontSize sind rot', () => {
    expect(tsBefunde('const BAND_SCHRIFT = 13;')).not.toEqual([]);
    expect(tsBefunde('const UEBERSCHRIFT = /^h[1-6]$/;')).toEqual([]);
    expect(
      tsBefunde("const BAND_GROESSE = schriftGroesse('text');\n          fontSize: BAND_GROESSE,"),
    ).toEqual([]);
    expect(tsBefunde('const MARKE_SCHRIFT = { klein: 11, monitor: 28 } as const;')).not.toEqual([]);
    expect(tsBefunde('          fontSize: BAND_SCHRIFT,')).not.toEqual([]);
    expect(tsBefunde('        fontSize={EINHEITEN}')).not.toEqual([]);
    // Zeichnung mit eigenem Maßstab: Konstanten ab 11, Glyphen benannt.
    expect(tsBefunde('export const HINWEIS_SCHRIFT = 11;', false, true)).toEqual([]);
    expect(tsBefunde('export const HINWEIS_SCHRIFT = 10;', false, true)).not.toEqual([]);
    expect(tsBefunde('export const MARKE_SCHRIFT = 7;', false, true)).toEqual([]);
    expect(tsBefunde('        fontSize={NAME_SCHRIFT}', false, true)).toEqual([]);
    // Zugriff auf ein Feld einer Konstante (Nach-Review LLH-1719).
    expect(
      tsBefunde('const GROESSE = { band: 13 } as const;\n  fontSize: GROESSE.band,'),
    ).not.toEqual([]);
    expect(
      tsBefunde(
        "const MARKE = { klein: schriftGroesse('fein'), monitor: `${fernsicht.text}px` } as const;\n" +
          '  fontSize: MARKE.klein,',
      ),
    ).toEqual([]);
    // Großbild-Skala (LLH-1747): Bezugsgrößen über `grossMass`, eine Zahl daneben bleibt rot.
    expect(tsBefunde('fontSize: grossMass(GROSS_BEZUG.text),')).toEqual([]);
    expect(tsBefunde('fontSize: grossMass(28),')).not.toEqual([]);
    // Über mehrere Zeilen umgebrochen zählt die ganze Konstante (Stufe ja, Zahl daneben nein).
    expect(
      tsBefunde(
        "const GROESSE = {\n  normal: schriftGroesse('titel'),\n  gross: `${fernsicht.text}px`,\n} as const;\n  fontSize: GROESSE.normal,",
      ),
    ).toEqual([]);
    expect(
      tsBefunde(
        "const GROESSE = {\n  normal: schriftGroesse('titel'),\n  klein: 13,\n} as const;\n  fontSize: GROESSE.klein,",
      ),
    ).not.toEqual([]);
    // Eine Stufe neben einer Zahl macht die Konstante nicht zur Stufe.
    expect(
      tsBefunde("const BAND = leise ? schriftGroesse('klein') : 13;\n  fontSize: BAND,"),
    ).not.toEqual([]);
  });

  it('meldet monoStil, Mono-Literale, font-size in Strings und Canvas', () => {
    expect(tsBefunde('...monoStil(11),')).not.toEqual([]);
    expect(tsBefunde("fontFamily: 'monospace',")).not.toEqual([]);
    expect(tsBefunde('html: \'<span style="font-size:11px">\'')).not.toEqual([]);
    expect(tsBefunde("ctx.font = '600 12px Archivo';")).not.toEqual([]);
  });

  it('CSS: nur Variablen der Skala oder inherit', () => {
    expect(cssBefunde('.a { font-size: 12px; }')).not.toEqual([]);
    expect(cssBefunde('.a { font-size: 0.9em; }')).not.toEqual([]);
    expect(cssBefunde('.a { font: 600 12px/1.2 sans-serif; }')).not.toEqual([]);
    expect(cssBefunde('.a { font-size: var(--lfh-typo-meta-groesse); }')).toEqual([]);
    expect(cssBefunde('.a { font-size: var(--lfh-groesse-klein); }')).toEqual([]);
    expect(cssBefunde('.a { font: inherit; font-size: inherit; }')).toEqual([]);
    expect(cssBefunde('.a { font-size: var(--x, var(--lfh-groesse-text)); }')).toEqual([]);
    expect(cssBefunde('.a { font-size: var(--x, 14px); }')).not.toEqual([]);
    expect(cssBefunde('@page x {\n  @top-center { font-size: 11pt; }\n}')).toEqual([]);
    expect(cssBefunde('@media print {\n  .a {\n    font-size: 9pt;\n  }\n}')).toEqual([]);
    // Am Schirm gibt es keine Punkte (Review LLH-1719): `pt` außerhalb des Drucks ist rot.
    expect(cssBefunde('.a {\n  font-size: 8pt;\n}')).not.toEqual([]);
  });
});
