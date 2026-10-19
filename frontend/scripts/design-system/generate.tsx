/**
 * Generator des Design Systems „Lifeline Hub“ (Change `uzfj5f43-design-system-aus-code`,
 * design.md D1–D4). Erzeugt den Inhalt von `docs/design/design-system/project/` aus dem Code:
 * `tokens.json`, `README.md`, je Baustein `components/<Name>/{README.md,preview.html}`, das
 * Deckblatt `components/Cover/preview.html` und die Schriften unter `fonts/`.
 *
 * Läuft im Vitest-Lauf des Frontends (jsdom, Vite-Auflösung der TS/TSX-Quellen und Schriften):
 * schreiben mit `pnpm -C frontend design-system` (`run.mjs`), vergleichen im Wächter
 * `src/designSystem.guard.test.ts`. Die Ausgabe ist deterministisch: feste Reihenfolge, kein
 * Zeitstempel, kein Commit (den trägt der Index `design-system.json` beim Veröffentlichen).
 * Index, `tokens.css`, `manifest.json` und `api/` schreibt dieser Generator nie.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { theme } from 'antd';
import {
  antdToken,
  dichten,
  etbTypFarbenDunkel,
  etbTypFarbenHell,
  fachebeneFarbenDunkel,
  fachebeneFarbenHell,
  farbenDunkel,
  farbenHell,
  flaeche,
  form,
  koerperschemaFarben,
  navDrawerBreite,
  paletteMaske,
  rahmenFarben,
  schrift,
  schriftskala,
  seitenrinne,
  sichtungsfarben,
  sichtungsflaechen,
  sichtungsKante,
  warnstufeFarbenDunkel,
  warnstufeFarbenHell,
  type Dichte,
  type Farbrollen,
} from '../../src/theme/tokens';
import { sichtung } from '../../src/theme/statusFarben';
import { statusFlaeche, type StatusTon } from '../../src/components/instrument/statusFlaeche';
import { SCHRIFTSCHNITTE } from '../../src/theme/schriften';
import {
  THEMES,
  buildFarbTokens,
  checkTokens,
  kebab,
  px,
  type FarbToken,
  type Omitted,
  type Token,
} from './tokens';
import { docBefore, firstSentence, memberDocs } from './jsdoc';
import { buildReadme, cutBullet } from './readme';
import { LAYOUT_CSS, PREVIEWS, renderPreview, type PreviewSpec } from './previews';
import { buildCover } from './cover';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(FRONTEND, 'src');
const read = (path: string) => readFileSync(path, 'utf8');

/** Dateien, die die Seite des Artifacts oder das Veröffentlichen schreibt — nie dieser Generator. */
export const FOREIGN_FILES = ['design-system.json', 'tokens.css', 'manifest.json'];
export const FOREIGN_DIRS = ['api/'];

/** Die Ausgabe: Pfad relativ zu `project/` → Inhalt. */
export type DesignSystemFiles = Map<string, string | Uint8Array>;

/**
 * `usage` der Farbrollen, die in `Farbrollen` keinen JSDoc tragen. Kurz, aus den Kommentaren an
 * `antdToken` und den Regeln abgeschrieben; eine neue Rolle ohne JSDoc und ohne Eintrag hier
 * bricht das Erzeugen ab (`checkTokens`: usage leer).
 */
const ROLLE_USAGE: Partial<Record<keyof Farbrollen, string>> = {
  grund: 'Seitengrund (antds `colorBgLayout`).',
  flaeche: 'Fläche von Karten, Feldern und Kennzahlzellen (antds `colorBgContainer`).',
  flaeche2: 'Erhobene Fläche: Dialog, Menü, Popup (antds `colorBgElevated`).',
  linie: 'Haarlinie: Paneelrahmen, Fuge des Fugenrasters (antds `colorBorderSecondary`).',
  rasterLinie: 'Linie des Kartenrasters.',
  text: 'Haupttext (antds `colorText`).',
  gedaempft: 'Zweite Textstufe: Beschreibung, Tabellenkopf (antds `colorTextSecondary`).',
  schwach: 'Tertiärtext: Augenbraue, Meta, Platzhalter (antds `colorTextTertiary`).',
  bedien: 'Bedienfarbe: Primärknopf, Fokusring (antds `colorPrimary`). Rot bedient nichts.',
  alarm: 'Gefahr als Füllfarbe: Kante, Punkt, Balken (antds `colorError`); Text nimmt `alarmText`.',
  achtung: 'Achtung als Füllfarbe: Kante, Punkt, Balken (antds `colorWarning`).',
  normal: 'In Ordnung als Füllfarbe: Kante, Punkt, Balken (antds `colorSuccess`).',
  marke: 'Markenrot: Logo, Rail-Marke. Dekoration, keine Textfarbe.',
  alarmFuellung: 'Getönte Fläche in Alarmfarbe, untere Stufe einer Flächenskala.',
  achtungFuellung: 'Getönte Fläche in Achtungsfarbe, untere Stufe einer Flächenskala.',
  normalFuellung: 'Getönte Fläche in Normalfarbe.',
  achtungFlaeche: 'Deckende Statusfläche Achtung: Statuszelle, -chip, Hinweis.',
  alarmFlaeche: 'Deckende Statusfläche Alarm: Statuszelle, -chip, Hinweis, alarmierte Karte.',
  bedienFlaeche: 'Deckende Statusfläche Bedienung: Statuszelle, -chip, Hinweis, Deeplink-Zeile.',
  bannerLinie: 'Kante des Sammelbanners.',
  lueckeZeile: 'Zeilentönung der Zeitachse: Lücke.',
  problemZeile: 'Zeilentönung der Zeitachse: Problem.',
};

/** `usage` der Rahmenfarben ohne JSDoc. */
const RAHMEN_USAGE: Record<string, string> = {
  grund: 'Grund von Kommandoleiste und Rail, in beiden Modi dunkel.',
  linie: 'Haarlinie im Rahmen.',
  text: 'Text im Rahmen (≥ 7 : 1 auf jedem Rahmengrund).',
  marke: 'Aktive Rail-Kategorie (Markenrot).',
};

const STATUS_TOENE: readonly StatusTon[] = ['normal', 'bedien', 'achtung', 'alarm', 'neutral'];

/** Gleicher Wert in beiden Themen (modusunabhängige Paletten). */
const both = (werte: Readonly<Record<string, string>>) => [werte, werte] as const;

/** Die Abbildung der antd-Abstände auf das Raster einer Dichtestufe. */
const ABSTAND_ANTD = {
  xs: 'paddingXS/marginXS',
  sm: 'paddingSM/marginSM',
  md: 'padding/margin',
  lg: 'paddingLG/marginLG',
};

function buildColors(omitted: Omitted[]): FarbToken[] {
  const tokensSource = read(join(SRC, 'theme', 'tokens.ts'));
  const rolleDocs = memberDocs(tokensSource, 'export interface Farbrollen {');
  const rahmenDocs = memberDocs(tokensSource, 'export const rahmenFarben = {');
  const etbDocs = memberDocs(tokensSource, 'export interface EtbTypFarbe {');
  const docOf = (anchor: string) =>
    firstSentence(docBefore(tokensSource, anchor).replace(/\s+/g, ' '));

  const usageRolle = (key: string) =>
    ROLLE_USAGE[key as keyof Farbrollen] ?? firstSentence(rolleDocs.get(key) ?? '');

  const sichtungMitFarbe = Object.entries(sichtung).filter(([, d]) => d.farbe != null);
  const sichtungWert = (werte: (farbe: keyof typeof sichtungsfarben) => string) =>
    Object.fromEntries(sichtungMitFarbe.map(([k, d]) => [k, werte(d.farbe!)]));
  const sichtungLabel = (k: string) => sichtung[k as keyof typeof sichtung].label;

  const statusWerte = (rollen: Farbrollen, teil: 'grund' | 'text' | 'kante') =>
    Object.fromEntries(STATUS_TOENE.map((ton) => [ton, statusFlaeche(rollen, ton)[teil]]));
  const etbWerte = (palette: typeof etbTypFarbenDunkel, teil: 'kante' | 'wort') =>
    Object.fromEntries(Object.entries(palette).map(([typ, f]) => [typ, f[teil]]));

  const warnstufeDoc = docOf('export type WarnstufeBalken');
  const fachebeneDoc = docOf('export type FachebeneTon');
  const koerperDoc = docOf('export function koerperschemaFarben');
  const kanteDoc = docOf('export function sichtungsKante');
  const maskeDoc = docOf('export const paletteMaske');

  return [
    ...buildFarbTokens(
      'rolle',
      'farbenDunkel/farbenHell',
      farbenDunkel as unknown as Record<string, string>,
      farbenHell as unknown as Record<string, string>,
      usageRolle,
      omitted,
    ),
    ...buildFarbTokens(
      'rahmen',
      'rahmenFarben',
      ...both(rahmenFarben),
      (k) => RAHMEN_USAGE[k] ?? firstSentence(rahmenDocs.get(k) ?? ''),
      omitted,
    ),
    ...buildFarbTokens(
      'maske',
      'paletteMaske',
      ...both({ sprungpalette: paletteMaske }),
      () => maskeDoc,
      omitted,
    ),
    ...buildFarbTokens(
      'sichtung',
      'sichtungsfarben',
      ...both(sichtungWert((f) => sichtungsfarben[f])),
      (k) => `${sichtungLabel(k)} (BBK): Farbfeld der Sichtungsanzeige, immer umrandet.`,
      omitted,
    ),
    ...buildFarbTokens(
      'sichtung-flaeche',
      'sichtungsflaechen',
      ...both(sichtungWert((f) => sichtungsflaechen[f].flaeche)),
      (k) => `${sichtungLabel(k)}: Fläche der Sichtungswahl, in beiden Modi gleich.`,
      omitted,
    ),
    ...buildFarbTokens(
      'sichtung-schrift',
      'sichtungsflaechen',
      ...both(sichtungWert((f) => sichtungsflaechen[f].schrift)),
      (k) => `${sichtungLabel(k)}: Schrift auf der Fläche der Sichtungswahl.`,
      omitted,
    ),
    ...buildFarbTokens(
      'sichtung',
      'sichtungsKante',
      { kante: sichtungsKante(farbenDunkel) },
      { kante: sichtungsKante(farbenHell) },
      () => kanteDoc,
      omitted,
    ),
    ...(['grund', 'text', 'kante'] as const).flatMap((teil) =>
      buildFarbTokens(
        'status',
        `statusFlaeche.${teil}`,
        Object.fromEntries(
          Object.entries(statusWerte(farbenDunkel, teil)).map(([t, w]) => [`${t}-${teil}`, w]),
        ),
        Object.fromEntries(
          Object.entries(statusWerte(farbenHell, teil)).map(([t, w]) => [`${t}-${teil}`, w]),
        ),
        (k) =>
          `Status ${k.split('-')[0]}: ${teil === 'grund' ? 'Grund' : teil === 'text' ? 'Text' : 'Kante'} von Statuszelle, -chip und StatusTag (statusFlaeche).`,
        omitted,
      ),
    ),
    ...(['kante', 'wort'] as const).flatMap((teil) =>
      buildFarbTokens(
        'etb',
        `etbTypFarben.${teil}`,
        Object.fromEntries(
          Object.entries(etbWerte(etbTypFarbenDunkel, teil)).map(([t, w]) => [`${t}-${teil}`, w]),
        ),
        Object.fromEntries(
          Object.entries(etbWerte(etbTypFarbenHell, teil)).map(([t, w]) => [`${t}-${teil}`, w]),
        ),
        (k) => `ETB-Typ ${k.split('-')[0]}: ${etbDocs.get(teil) ?? ''}`,
        omitted,
      ),
    ),
    ...buildFarbTokens(
      'warnstufe',
      'warnstufeFarben',
      warnstufeFarbenDunkel,
      warnstufeFarbenHell,
      (k) => `Warnstufe ${k}: ${warnstufeDoc}`,
      omitted,
    ),
    ...buildFarbTokens(
      'fachebene',
      'fachebeneFarben',
      fachebeneFarbenDunkel,
      fachebeneFarbenHell,
      (k) => `Fachebene ${k}: ${fachebeneDoc}`,
      omitted,
    ),
    ...buildFarbTokens(
      'koerperschema',
      'koerperschemaFarben',
      koerperschemaFarben(farbenDunkel),
      koerperschemaFarben(farbenHell),
      (k) => `Körperschema ${k}: ${koerperDoc}`,
      omitted,
    ),
  ];
}

function buildSpacing(): Token[] {
  const tokens: Token[] = [];
  for (const [stufe, d] of Object.entries(dichten) as [Dichte, (typeof dichten)[Dichte]][]) {
    for (const [schritt, wert] of Object.entries(d.abstand) as [
      keyof typeof ABSTAND_ANTD,
      number,
    ][]) {
      tokens.push(
        px(
          `abstand-${stufe}-${schritt}`,
          wert,
          `Abstand ${schritt} der Dichte ${stufe} (antds ${ABSTAND_ANTD[schritt]}).`,
        ),
      );
    }
  }
  const source = read(join(SRC, 'theme', 'tokens.ts'));
  const docs = memberDocs(source, 'export const seitenrinne = {');
  for (const [k, wert] of Object.entries(seitenrinne)) {
    tokens.push(px(`seitenrinne-${k}`, wert, `Seitenrinne: ${docs.get(k) ?? ''}`));
  }
  return tokens;
}

function buildSize(): Token[] {
  const source = read(join(SRC, 'theme', 'tokens.ts'));
  const flaecheDocs = memberDocs(source, 'export const flaeche = {');
  const tokens: Token[] = [];
  for (const [stufe, d] of Object.entries(dichten) as [Dichte, (typeof dichten)[Dichte]][]) {
    tokens.push(
      px(
        `steuerhoehe-${stufe}`,
        d.zeilenhoehe,
        `Höhe jedes Steuerelements in der Dichte ${stufe} (antds controlHeight).`,
      ),
    );
    tokens.push(
      px(
        `steuerhoehe-klein-${stufe}`,
        d.kleineZeilenhoehe,
        `Kleine Steuerhöhe in der Dichte ${stufe} (antds controlHeightSM), Boden der kurzen Achse.`,
      ),
    );
  }
  for (const [k, wert] of Object.entries(flaeche)) {
    // `kachelMinKlein` beginnt in der Quelle mit „…und“, als Satz für sich ergänzt.
    const usage = k === 'kachelMinKlein' ? 'Mindestbreite einer Kachel im Nebenraster.' : undefined;
    tokens.push(px(kebab(k), wert, usage ?? firstSentence(flaecheDocs.get(k) ?? '')));
  }
  tokens.push(
    px(
      'nav-drawer-breite',
      navDrawerBreite,
      firstSentence(docBefore(source, 'export const navDrawerBreite').replace(/\s+/g, ' ')),
    ),
  );
  return tokens;
}

function buildRadius(): Token[] {
  const usage =
    'Radius 0 ist eine Entscheidung: die Kachel trägt der Umrissrahmen, nicht eine weiche Ecke.';
  return [
    px('radius-flaeche', form.radiusFlaeche, `Fläche. ${usage}`),
    px('radius-steuer', form.radiusSteuer, `Steuerelement. ${usage}`),
    px('radius-marke', form.radiusMarke, `Marke. ${usage}`),
  ];
}

/** Wo eine Schriftdatei auf der Platte liegt; Vite liefert im Test ihre Adresse. */
function fontPath(url: string): string {
  if (url.startsWith('/@fs/')) return url.slice('/@fs'.length);
  if (url.startsWith('/src/') || url.startsWith('/node_modules/')) return join(FRONTEND, url);
  throw new Error(`Design System: Schriftdatei „${url}“ nicht auflösbar`);
}

function buildType(files: DesignSystemFiles) {
  const fonts = SCHRIFTSCHNITTE.map((s) => {
    const file = `fonts/${s.familie.toLowerCase().replace(/\s+/g, '-')}-${s.gewicht}.woff2`;
    files.set(file, new Uint8Array(readFileSync(fontPath(s.datei.split('?')[0]))));
    return { family: s.familie, file, weight: String(s.gewicht) };
  });
  // Zeilenhöhe der Grundschrift, wie antd sie aus dem Theme der App ableitet (ein Faktor, den
  // die Bausteine erben); die Skala nimmt den der kompakten Stufe, wie die Vorschauen.
  const lineHeightOf = (dichte: Dichte) =>
    Number(theme.getDesignToken({ token: antdToken(farbenDunkel, dichte) }).lineHeight.toFixed(4));
  const lineHeight = lineHeightOf('kompakt');
  const stufen = Object.entries(schriftskala);
  const styles = (familie: keyof typeof schrift) =>
    stufen
      .filter(([, s]) => s.familie === familie)
      .map(([name, s]) => ({
        name: kebab(name),
        fontSize: `${s.groesse}px`,
        lineHeight,
        fontWeight: s.gewicht,
      }));
  return {
    fonts,
    families: { text: schrift.text, display: schrift.display, zahl: schrift.zahl },
    groups: [
      { name: 'Schriftskala Text', family: 'text', styles: styles('text') },
      { name: 'Schriftskala Zahl', family: 'zahl', styles: styles('zahl') },
      {
        name: 'Grundschrift je Dichte',
        family: 'text',
        styles: (Object.entries(dichten) as [Dichte, (typeof dichten)[Dichte]][]).map(
          ([stufe, d]) => ({
            name: `grundschrift-${stufe}`,
            fontSize: `${d.schriftgroesse}px`,
            lineHeight: lineHeightOf(stufe),
            fontWeight: 400,
          }),
        ),
      },
    ],
  };
}

/** Was das Format weder als Farbe noch als Länge oder Schriftstil liest. */
function omittedFromCode(): Omitted[] {
  const sperrung = Object.entries(schriftskala)
    .filter(([, s]) => 'sperrung' in s || 'versal' in s)
    .map(([name, s]) =>
      `${name} ${'sperrung' in s ? s.sperrung : ''}${'versal' in s && s.versal ? ' Versalien' : ''}`.trim(),
    );
  return [
    { source: 'form.versalSperrung', reason: `Sperrung der Versalien, \`${form.versalSperrung}\`` },
    { source: 'form.uebergang', reason: `Übergang, \`${form.uebergang}\`` },
    { source: 'schriftskala (Sperrung, Versalien)', reason: sperrung.join(' · ') },
    {
      source: '--lfh-abdunkelung (theme/rollen.css)',
      reason: 'Deckschicht des Helligkeitsreglers, keine Farbrolle',
    },
  ];
}

/** Die README eines Bausteins: Quelle, Hinweis zur Vorschau und der JSDoc-Kopf der Quelle. */
function componentReadme(spec: PreviewSpec, agents: string): string {
  const source = read(join(SRC, spec.source));
  const body = spec.ruleHead ? cutBullet(agents, spec.ruleHead) : docBefore(source, spec.docAnchor);
  const more = spec.moreDoc
    ? [
        `Aus \`frontend/src/${spec.moreDoc}\`:`,
        '',
        docBefore(read(join(SRC, spec.moreDoc))).split('\n\n')[0],
        '',
      ]
    : [];
  return [
    `# ${spec.title}`,
    '',
    `Quelle: \`frontend/src/${spec.source}\` im Repo \`rubenvitt/lifeline-hub\`. Die Vorschau ist aus`,
    'dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.',
    '',
    body,
    '',
    ...more,
  ].join('\n');
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Die Stile der App ohne Kommentare: Rollen, Bausteine, globale Regeln (u. a. die Sperre). */
function appCss(): string {
  return ['theme/rollen.css', 'theme/sprache.css', 'index.css']
    .map((file) => read(join(SRC, file)).replace(/\/\*[\s\S]*?\*\//g, ''))
    .join('\n')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

function previewDocument(spec: PreviewSpec, html: string, antdCss: string, css: string): string {
  const doc = [
    `<!-- @dsCard group="${spec.group}" height=${spec.height} -->`,
    '<!doctype html>',
    '<html lang="de">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(spec.title)}</title>`,
    `<style>\n${antdCss}\n</style>`,
    `<style>\n${css}\n</style>`,
    `<style>\n${LAYOUT_CSS}\n</style>`,
    '</head>',
    '<body>',
    html,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  if (/<\/script/i.test(doc)) throw new Error(`Design System: ${spec.name} enthält „</script“`);
  return doc;
}

/** Erzeugt das ganze Design System im Speicher. */
export async function generateDesignSystem(): Promise<DesignSystemFiles> {
  const files: DesignSystemFiles = new Map();
  const agents = read(join(FRONTEND, 'AGENTS.md'));

  const omitted: Omitted[] = [];
  const color = buildColors(omitted);
  const spacing = buildSpacing();
  const size = buildSize();
  const radius = buildRadius();
  checkTokens({ color, spacing, size, radius });
  const tokens = {
    name: 'Lifeline Hub',
    version: 1,
    color: { themes: THEMES, tokens: color },
    type: buildType(files),
    spacing: { tokens: spacing },
    size: { tokens: size },
    radius: { tokens: radius },
  };
  files.set('tokens.json', `${JSON.stringify(tokens, null, 2)}\n`);

  const css = appCss();
  for (const spec of PREVIEWS) {
    const { html, css: antdCss } = await renderPreview(spec);
    files.set(`components/${spec.name}/preview.html`, previewDocument(spec, html, antdCss, css));
    files.set(`components/${spec.name}/README.md`, componentReadme(spec, agents));
  }
  files.set('components/Cover/preview.html', buildCover());

  files.set('README.md', buildReadme(agents, [...omitted, ...omittedFromCode()], PREVIEWS));
  return new Map([...files.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')));
}

/** Ausgabeordner im Repo. */
export const PROJECT_DIR = join(FRONTEND, '..', 'docs', 'design', 'design-system', 'project');

export const isForeign = (path: string) =>
  FOREIGN_FILES.includes(path) || FOREIGN_DIRS.some((dir) => path.startsWith(dir));
