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
import { cutBullet, cutSection } from '../scripts/design-system/readme';

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
});
