import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildFarbTokens,
  checkTokens,
  formatFarbe,
  isValidName,
  kebab,
  type Omitted,
} from '../scripts/design-system/tokens';
import { cleanDoc, docBefore, firstSentence, memberDocs } from '../scripts/design-system/jsdoc';
import {
  buildReadme,
  cutBullet,
  cutSection,
  DESIGN_SYSTEM_COMMAND,
  README_RULES,
  README_SECTIONS,
} from '../scripts/design-system/readme';
import {
  checkComponentReadme,
  checkFonts,
  checkLimits,
  checkPreviewCss,
  fontFaceCss,
  LIMITS,
  listFiles,
} from '../scripts/design-system/output';

/**
 * Die reinen Teile des Design-System-Generators (Change `uzfj5f43-design-system-aus-code`):
 * Umsetzung der Werte ins Format des Artifact-Typs, Namen, ausgelassene Werte, JSDoc und
 * Regelabschnitte. Das Ganze prüft der Wächter `designSystem.guard.test.ts`.
 */

describe('Tokens im Format des Typs', () => {
  it('bildet Namen in Kebab-Case, Ziffern bleiben am Wort', () => {
    expect(kebab('linieStark')).toBe('linie-stark');
    expect(kebab('flaeche2')).toBe('flaeche2');
    expect(kebab('alarmFuellungStark')).toBe('alarm-fuellung-stark');
  });

  it('nimmt nur Namen ohne Leerzeichen und Schrägstrich, höchstens 64 Zeichen', () => {
    expect(isValidName('rolle-text2')).toBe(true);
    expect(isValidName('rolle text2')).toBe(false);
    expect(isValidName('rolle/text2')).toBe(false);
    expect(isValidName('-rolle')).toBe(false);
    expect(isValidName('a'.repeat(65))).toBe(false);
  });

  it('liest hex und Farbfunktionen ohne innere Funktion, löst transparent auf', () => {
    expect(formatFarbe('#08090b')).toBe('#08090b');
    expect(formatFarbe('#fff')).toBe('#fff');
    expect(formatFarbe('rgba(26, 95, 160, 0.07)')).toBe('rgba(26, 95, 160, 0.07)');
    expect(formatFarbe('transparent')).toBe('rgba(0, 0, 0, 0)');
    expect(formatFarbe('var(--lfh-text)')).toBeNull();
    expect(formatFarbe('color-mix(in srgb, red, blue)')).toBeNull();
    expect(formatFarbe('rgb(var(--r), 0, 0)')).toBeNull();
    expect(formatFarbe('currentColor')).toBeNull();
    expect(formatFarbe('0 0 10px 0 rgba(168, 7, 26, 0.3)')).toBeNull();
  });

  it('lässt einen Schlüssel ganz weg, wenn ein Thema keinen lesbaren Wert hat, und nennt ihn', () => {
    const omitted: Omitted[] = [];
    const tokens = buildFarbTokens(
      'rolle',
      'quelle',
      { text: '#111111', glut: '0 0 4px red' },
      { text: '#eeeeee', glut: '#aa0000' },
      (k) => `usage ${k}`,
      omitted,
    );
    expect(tokens).toEqual([
      { name: 'rolle-text', value: { nacht: '#111111', tag: '#eeeeee' }, usage: 'usage text' },
    ]);
    expect(omitted).toHaveLength(1);
    expect(omitted[0].source).toBe('quelle.glut');
  });

  it('meldet doppelte Namen über Familien, leere usage und falsche Längen', () => {
    const farbe = { name: 'a', value: { nacht: '#000', tag: '#fff' }, usage: 'x' };
    expect(() =>
      checkTokens({ color: [farbe], size: [{ name: 'a', value: '4px', usage: 'y' }] }),
    ).toThrow(/steht schon in color/);
    expect(() => checkTokens({ size: [{ name: 'b', value: '4px', usage: ' ' }] })).toThrow(
      /ohne usage/,
    );
    expect(() => checkTokens({ size: [{ name: 'c', value: '4pt', usage: 'z' }] })).toThrow(
      /keine Länge/,
    );
    expect(() =>
      checkTokens({ color: [farbe], size: [{ name: 'd', value: '0px', usage: 'z' }] }),
    ).not.toThrow();
  });
});

describe('JSDoc aus der Quelle', () => {
  const quelle = [
    'export interface X {',
    '  /** Erste Rolle. Mit mehr Text. */',
    '  eins: string;',
    '  zwei: string;',
    '  /**',
    '   * Dritte mit {@link Y}.',
    '   */',
    '  drei?: string;',
    '}',
    '',
    '/**',
    ' * Kopf des Bausteins.',
    ' *',
    ' * Zweiter Absatz.',
    ' */',
    'export default function Baustein() {}',
  ].join('\n');

  it('ordnet Blöcke dem nächsten Mitglied zu, nicht dem übernächsten', () => {
    const docs = memberDocs(quelle, 'export interface X {');
    expect(docs.get('eins')).toBe('Erste Rolle. Mit mehr Text.');
    expect(docs.has('zwei')).toBe(false);
    expect(docs.get('drei')).toBe('Dritte mit `Y`.');
  });

  it('liest den Block direkt vor dem Anker, mit Absätzen', () => {
    expect(docBefore(quelle, 'export default function Baustein')).toBe(
      'Kopf des Bausteins.\n\nZweiter Absatz.',
    );
    expect(() => docBefore(quelle, 'export interface X')).toThrow(/kein JSDoc-Block/);
    expect(() => docBefore(quelle, 'gibt es nicht')).toThrow(/fehlt/);
  });

  it('kürzt auf den ersten Satz, aber nicht an „z. B.“', () => {
    expect(firstSentence('Rahmen eines Feldes. Mehr dazu.')).toBe('Rahmen eines Feldes.');
    expect(firstSentence('Nur ein Satz')).toBe('Nur ein Satz');
    expect(cleanDoc(' * a\n * b')).toBe('a\nb');
  });
});

describe('Regelabschnitte aus frontend/AGENTS.md', () => {
  const agents = [
    '## Frontend — Gestaltung (1.1.2026)',
    '',
    'Absatz mit **Fett:** mitten drin.',
    '- **Regel A** (X-1): erste Zeile',
    '  zweite Zeile',
    '- **Regel B**: anders',
    '',
    '**Farbe** (Vertrag)',
    '',
    '- Farbregel',
    '',
    '## Frontend — Nächstes',
  ].join('\n');

  it('schneidet bis zum nächsten Absatzkopf nach einer Leerzeile oder zur nächsten ##', () => {
    expect(cutSection(agents, '## Frontend — Gestaltung')).toBe(
      '(1.1.2026)\n\nAbsatz mit **Fett:** mitten drin.\n- **Regel A** (X-1): erste Zeile\n  zweite Zeile\n- **Regel B**: anders',
    );
    expect(cutSection(agents, '**Farbe**')).toBe('(Vertrag)\n\n- Farbregel');
  });

  it('bricht ab, wenn ein Abschnitt fehlt', () => {
    expect(() => cutSection(agents, '**Gibt es nicht**')).toThrow(/fehlt in frontend\/AGENTS.md/);
  });

  it('schneidet einen Spiegelstrich samt Fortsetzungszeilen', () => {
    expect(cutBullet(agents, 'Regel A')).toBe('- **Regel A** (X-1): erste Zeile\n  zweite Zeile');
    expect(() => cutBullet(agents, 'Regel C')).toThrow(/fehlt/);
  });

  it('lässt ausgenommene Spiegelstriche samt Fortsetzung weg und bricht ab, wenn einer fehlt', () => {
    expect(cutSection(agents, '## Frontend — Gestaltung', ['Regel A'])).toBe(
      '(1.1.2026)\n\nAbsatz mit **Fett:** mitten drin.\n- **Regel B**: anders',
    );
    expect(() => cutSection(agents, '## Frontend — Gestaltung', ['Regel C'])).toThrow(
      /Regel C.*fehlt/,
    );
  });
});

describe('README des Design Systems', () => {
  const prozessRegel = 'Größere UI-Entwürfe über das Design System';
  // Der Ablauf steht als Spiegelstrich im ersten Abschnitt, der Gestaltungssprache.
  const agents = README_SECTIONS.map(({ head }, i) =>
    [
      `${head} (Kopfzeile)`,
      '',
      ...(i === 0
        ? [
            `- **${prozessRegel}** (Ruben): Ablauf für Agenten,`,
            '  Veröffentlichen nach dem Merge.',
            '',
          ]
        : []),
      '- **Gestaltungsregel**: bleibt.',
      '',
    ].join('\n'),
  )
    .concat(
      README_RULES.map(({ head }) => `- **${head}** (X-1): Regel aus einem anderen Abschnitt.`),
    )
    .join('\n');
  const readme = buildReadme(agents, [], []);

  it('trägt die Gestaltungsregeln, nicht den Ablauf der Entwürfe', () => {
    expect(readme).toContain('**Gestaltungsregel**');
    expect(readme).not.toContain(prozessRegel);
    expect(readme).not.toContain('Veröffentlichen nach dem Merge');
  });

  it('trägt die einzelnen Regeln aus anderen Abschnitten (Zeitdarstellung, LLH-1053)', () => {
    expect(README_RULES.map((r) => r.head)).toContain('Zeitdarstellung');
    expect(readme).toContain('## Zeitdarstellung');
    expect(readme).toContain('- **Zeitdarstellung** (X-1): Regel aus einem anderen Abschnitt.');
  });

  it('nennt den Befehl mit mise', () => {
    expect(DESIGN_SYSTEM_COMMAND).toBe('mise exec -- pnpm -C frontend design-system');
    expect(readme).toContain(`\`${DESIGN_SYSTEM_COMMAND}\``);
  });
});

describe('Ausgabe im Format des Typs', () => {
  const vorschau = (antd: string, markup: string) =>
    [
      '<!-- @dsCard group="X" height=100 -->',
      '<!doctype html>',
      `<style data-quelle="antd">\n${antd}\n</style>`,
      '<style>\n.eigen{color:red}\n</style>',
      markup,
    ].join('\n');

  it('verlangt antd-CSS in jeder Vorschau und einen Block für jede css-var-Klasse', () => {
    const leer = '.data-ant-cssinjs-cache-path{content:"";}';
    expect(checkPreviewCss('components/A/preview.html', vorschau(leer, ''))).toEqual([
      'components/A/preview.html: antd-CSS fehlt',
    ]);
    const css = '.css-var-nacht{--ant-blue:#1677FF;}\n.css-var-nacht.ant-btn{color:red}';
    const markup =
      '<button class="ant-btn css-var-nacht ant-input-css-var"></button><i class="css-var-tag"></i>';
    expect(checkPreviewCss('components/A/preview.html', vorschau(css, markup))).toEqual([
      'components/A/preview.html: kein CSS für .css-var-tag',
    ]);
    expect(
      checkPreviewCss('components/A/preview.html', vorschau(`${css}\n.css-var-tag{}`, markup)),
    ).toEqual([]);
    // `css-var-nacht` deckt nicht `css-var-na`.
    expect(
      checkPreviewCss('components/A/preview.html', vorschau(css, '<b class="css-var-na"></b>')),
    ).toEqual(['components/A/preview.html: kein CSS für .css-var-na']);
  });

  const fonts = [
    { family: 'LFH Archivo', file: 'fonts/lfh-archivo-400.woff2', weight: '400' },
    { family: 'LFH Archivo', file: 'fonts/lfh-archivo-600.woff2', weight: '600' },
  ];

  it('setzt @font-face je Schnitt relativ zur Vorschau unter components/<Name>/', () => {
    const css = fontFaceCss(fonts);
    expect(css).toContain(
      "@font-face{font-family:'LFH Archivo';src:url('../../fonts/lfh-archivo-400.woff2') format('woff2');font-weight:400;",
    );
    expect(checkFonts('components/A/preview.html', `<style>\n${css}\n</style>`, fonts)).toEqual([]);
    expect(
      checkFonts('components/A/preview.html', `<style>\n${fontFaceCss(fonts.slice(0, 1))}`, fonts),
    ).toEqual(['components/A/preview.html: keine Schrift LFH Archivo 600']);
  });

  it('beginnt die README eines Bausteins mit der Zusammenfassung, nicht mit der Herkunft', () => {
    const pfad = 'components/A/README.md';
    expect(checkComponentReadme(pfad, '# A\n\nA — die Fläche.\n\nQuelle: `x`.\n')).toEqual([]);
    expect(checkComponentReadme(pfad, '# A\n\nQuelle: `x`. Die Vorschau …\n')).toEqual([
      `${pfad}: erster Satz ist keine Zusammenfassung`,
    ]);
    expect(checkComponentReadme(pfad, '# A\n\n- **Regel** (X): Text.\n')).toEqual([
      `${pfad}: erster Satz ist keine Zusammenfassung`,
    ]);
  });

  it('hält die Grenzen des Typs: Datei unter 15 MiB, unter 1.008 Dateien, 256 MiB gesamt', () => {
    expect(LIMITS).toEqual({ fileBytes: 15 * 2 ** 20, files: 1008, totalBytes: 256 * 2 ** 20 });
    const klein = new Map<string, string | Uint8Array>([['a.txt', 'x']]);
    expect(checkLimits(klein)).toEqual([]);
    const gross = new Map<string, string | Uint8Array>([
      ['fonts/a.woff2', new Uint8Array(LIMITS.fileBytes)],
    ]);
    expect(checkLimits(gross)).toEqual([
      `fonts/a.woff2: ${LIMITS.fileBytes} Bytes, höchstens ${LIMITS.fileBytes - 1}`,
    ]);
    // Der Index `design-system.json` kommt beim Veröffentlichen dazu.
    const viele = new Map<string, string | Uint8Array>(
      Array.from({ length: LIMITS.files }, (_, i) => [`d${i}.txt`, 'x']),
    );
    expect(checkLimits(viele)).toEqual([
      `${LIMITS.files} Dateien und der Index, höchstens ${LIMITS.files}`,
    ]);
    viele.delete('d0.txt');
    expect(checkLimits(viele)).toEqual([]);
    const schwer = new Map<string, string | Uint8Array>(
      Array.from({ length: 18 }, (_, i) => [`v${i}.mp4`, new Uint8Array(15 * 2 ** 20 - 1)]),
    );
    expect(checkLimits(schwer)).toEqual([
      `${18 * (15 * 2 ** 20 - 1)} Bytes gesamt, höchstens ${LIMITS.totalBytes}`,
    ]);
  });

  it('listet Dateien ohne .DS_Store und andere Punktdateien', () => {
    const dir = mkdtempSync(join(tmpdir(), 'design-system-'));
    try {
      mkdirSync(join(dir, 'components', 'A'), { recursive: true });
      mkdirSync(join(dir, '.git'));
      writeFileSync(join(dir, 'README.md'), '');
      writeFileSync(join(dir, '.DS_Store'), '');
      writeFileSync(join(dir, 'components', 'A', 'preview.html'), '');
      writeFileSync(join(dir, 'components', 'A', '._preview.html'), '');
      writeFileSync(join(dir, '.git', 'HEAD'), '');
      expect(listFiles(dir)).toEqual(['README.md', 'components/A/preview.html']);
      expect(listFiles(join(dir, 'gibt-es-nicht'))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
