import { theme as antdTheme } from 'antd';
import { describe, expect, it } from 'vitest';
import { abstand, kontrast } from '../test/farbmass';
import {
  antdAlgorithmus,
  antdKomponenten,
  antdToken,
  farbenDunkel,
  farbenHell,
  type Farbrollen,
} from './tokens';

/**
 * Die Auswahlfläche (gewählte Option, gewählter Menüeintrag, gewählter Knoten), GERECHNET statt
 * behauptet (WCAG-Formel, Farbabstand CIE76).
 *
 * LFH-984, Spec `farbrollen-kontrast`: antd leitete `colorPrimaryBg` und damit
 * `controlItemBgActive` aus `bedien` ab, am Tag ein trübes `#b9c1c4`, nachts `#253a4e`; darauf
 * lagen Beschreibung (6,01 · 4,53), Tertiärtext (4,92 · 3,39), die Schrift des gewählten
 * Dropdown-Eintrags (4,68 · 3,64) und der Rand eines Steuerelements (2,16 · 2,13) unter dem Boden.
 * Geprüft wird der AUFGELÖSTE Token mit dem echten Algorithmus je Modus. Böden als Literale;
 * gemessen in `e2e/auswahl-kontrast.spec.ts`.
 */
const RANDBODEN = 3;
/** Mindestabstand der Auswahl zu Ruhe und Zeigerspur (Spec `farbrollen-kontrast`). */
const ABSTANDBODEN = 7;

/** Eine durchscheinende Farbe `rgba(r,g,b,a)` deckend über einen Grund gelegt. */
function gemischt(grund: string, rgba: string): string {
  const treffer = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(rgba);
  if (!treffer) throw new Error(`Keine rgba-Farbe: ${rgba}`);
  const alpha = Number(treffer[4]);
  return `#${[1, 3, 5]
    .map((i, k) => {
      const unten = Number.parseInt(grund.slice(i, i + 2), 16);
      const oben = Number(treffer[k + 1]);
      return Math.round(unten * (1 - alpha) + oben * alpha)
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
}

/** Ein Komponenten-Token als Hex; fehlt es, ist das ein Befund, kein Rückfall auf antd. */
function token(quelle: object | undefined, name: string): string {
  const wert = (quelle as Record<string, unknown> | undefined)?.[name];
  if (typeof wert !== 'string') throw new Error(`Komponenten-Token ${name} fehlt`);
  return wert;
}

const TEXTSTUFEN = [
  'text',
  'text2',
  'gedaempft',
  'schwach',
  'bedienText',
] as const satisfies readonly (keyof Farbrollen)[];

describe.each([
  ['Tag', farbenHell, false, 7],
  ['Nacht', farbenDunkel, true, 5],
] as const)('Auswahlfläche — %s (LFH-984)', (_modus, farben, dunkel, textboden) => {
  const aufgeloest = () =>
    antdTheme.getDesignToken({ token: antdToken(farben), algorithm: antdAlgorithmus(dunkel) });

  // `colorPrimaryBg` lesen die eigenen Stellen (Gefahrengebiete, Lagekarte, UHS-Grundriss) direkt;
  // ein Override nur der Aliase ließe sie still auf antds Ableitung fallen.
  it.each([
    'colorPrimaryBg',
    'colorPrimaryBgHover',
    'controlItemBgActive',
    'controlItemBgActiveHover',
  ] as const)('%s trägt die Rolle auswahlFlaeche', (name) => {
    expect(aufgeloest()[name]).toBe(farben.auswahlFlaeche);
  });

  it.each(TEXTSTUFEN)('%s auf der Auswahlfläche hält den Textboden', (stufe) => {
    expect(kontrast(farben[stufe], farben.auswahlFlaeche)).toBeGreaterThanOrEqual(textboden);
  });

  it('Rand eines Steuerelements auf der Auswahlfläche', () => {
    expect(kontrast(farben.steuerRahmen, farben.auswahlFlaeche)).toBeGreaterThanOrEqual(RANDBODEN);
  });

  // Auswahllisten und Menüs stehen auf `colorBgElevated` (`flaeche2`), der Baum auf `flaeche`; die
  // Zeigerspur legt antd als durchscheinendes `controlItemBgHover` darüber.
  it.each(['flaeche2', 'flaeche'] as const)(
    'die Auswahl hebt sich auf %s von Ruhe und Zeigerspur ab',
    (grund) => {
      const ruhe = farben[grund];
      const zeiger = gemischt(ruhe, aufgeloest().controlItemBgHover);
      expect(abstand(farben.auswahlFlaeche, ruhe), 'gegen Ruhe').toBeGreaterThanOrEqual(
        ABSTANDBODEN,
      );
      expect(abstand(farben.auswahlFlaeche, zeiger), 'gegen Zeiger').toBeGreaterThanOrEqual(
        ABSTANDBODEN,
      );
    },
  );

  // antd leitet den Fokus-Halo von Eingabefeld und Auswahlliste (`controlOutline`, daraus
  // `activeShadow`/`activeOutlineColor`) aus `colorPrimaryBg` ab. Aus der Auswahlfläche wäre er
  // nachts dunkler als die Fläche; er bleibt eine Tönung der Bedienfarbe (design.md E5).
  it('der Fokus-Halo ist eine Tönung der Bedienfarbe, nicht die Auswahlfläche', () => {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(farben.bedien.slice(i, i + 2), 16));
    expect(aufgeloest().controlOutline).toBe(`rgba(${r}, ${g}, ${b}, 0.25)`);
  });

  // Der gewählte Dropdown-Eintrag (Statuswahl, ETB-Typwahl) schreibt in `colorPrimary`; `bedien`
  // hielte am Tag auch auf der Auswahlfläche nur 6,83.
  it('Schrift des gewählten Dropdown-Eintrags auf der Auswahlfläche', () => {
    const schrift = token(antdKomponenten(farben, 'kompakt').Dropdown, 'colorPrimary');
    expect(kontrast(schrift, farben.auswahlFlaeche)).toBeGreaterThanOrEqual(textboden);
  });

  // Die Zeitraumwahl (LFH-1068): Beginn und die Zelle unter dem Zeiger sind Bereichsenden, Schrift
  // `colorTextLightSolid` auf `colorPrimary`; antds globales Weiß lag nachts bei 3,22. Die Tage
  // dazwischen stehen auf `cellActiveWithRangeBg` (= Auswahlfläche), deren Textstufen oben.
  // Gemessen in `e2e/zeitraum-kontrast.spec.ts`.
  it('Schrift eines Bereichsendes in der Datumswahl auf der Bedienfarbe', () => {
    const schrift = token(antdKomponenten(farben, 'kompakt').DatePicker, 'colorTextLightSolid');
    expect(kontrast(schrift, aufgeloest().colorPrimary)).toBeGreaterThanOrEqual(textboden);
  });
});
