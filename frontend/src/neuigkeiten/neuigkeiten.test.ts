import { describe, expect, it } from 'vitest';
import type { ChangelogEintrag } from '../../scripts/changelog-zerlegen.mjs';
import { ungelesene, seitLetzterVersion, nachKanal, vorschau, kenntVersion } from './neuigkeiten';

// Neueste zuerst, wie die CHANGELOG.md.
const LISTE: ChangelogEintrag[] = [
  eintrag('1.0.0'),
  eintrag('1.0.0-alpha.106'),
  eintrag('1.0.0-alpha.105'),
  eintrag('1.0.0-alpha.104'),
  eintrag('1.0.0-alpha.101'),
  eintrag('1.0.0-alpha.100'),
  eintrag('1.0.0-alpha.99'),
];

function eintrag(version: string): ChangelogEintrag {
  const kanal = version.includes('-alpha.')
    ? 'alpha'
    : version.includes('-beta.')
      ? 'beta'
      : 'stabil';
  return { version, link: null, datum: null, kanal, text: `Text ${version}` };
}

const versionen = (liste: ChangelogEintrag[]) => liste.map((e) => e.version);

describe('ungelesene', () => {
  it('zählt die Einträge des laufenden Kanals über dem Lesestand', () => {
    expect(versionen(ungelesene(LISTE, '1.0.0-alpha.106', '1.0.0-alpha.100'))).toEqual([
      '1.0.0-alpha.106',
      '1.0.0-alpha.105',
      '1.0.0-alpha.104',
      '1.0.0-alpha.101',
    ]);
  });

  it('ist leer, wenn der Lesestand die laufende Version ist', () => {
    expect(ungelesene(LISTE, '1.0.0-alpha.106', '1.0.0-alpha.106')).toEqual([]);
  });

  it('ist leer, wenn der Lesestand unbekannt ist, statt zu drängen', () => {
    expect(ungelesene(LISTE, '1.0.0-alpha.106', '0.9.9-alpha.1')).toEqual([]);
    expect(ungelesene(LISTE, '1.0.0-alpha.106', null)).toEqual([]);
  });

  it('zählt beim Wechsel in den stabilen Kanal nur stabile Einträge', () => {
    expect(versionen(ungelesene(LISTE, '1.0.0', '1.0.0-alpha.105'))).toEqual(['1.0.0']);
  });

  it('zählt ab der laufenden Version, nicht ab dem neuesten Eintrag der Liste', () => {
    expect(versionen(ungelesene(LISTE, '1.0.0-alpha.105', '1.0.0-alpha.100'))).toEqual([
      '1.0.0-alpha.105',
      '1.0.0-alpha.104',
      '1.0.0-alpha.101',
    ]);
  });

  // Nach einem Server-Update läuft oft noch das alte Bundle, bis jemand die App aktualisiert
  // (`pwa/appAktualisierung.ts`): seine Liste kennt die laufende Version noch nicht.
  it('ist leer, wenn die Liste die laufende Version nicht kennt', () => {
    expect(ungelesene(LISTE, '1.0.0-alpha.107', '1.0.0-alpha.100')).toEqual([]);
  });

  it('ist leer nach einer Rückkehr auf eine ältere Version', () => {
    expect(ungelesene(LISTE, '1.0.0-alpha.100', '1.0.0-alpha.105')).toEqual([]);
  });
});

describe('kenntVersion', () => {
  it('erkennt, ob die Liste eine Version führt', () => {
    expect(kenntVersion(LISTE, '1.0.0-alpha.106')).toBe(true);
    expect(kenntVersion(LISTE, '1.0.0-alpha.107')).toBe(false);
  });
});

describe('seitLetzterVersion', () => {
  it('liefert den Bereich von der laufenden bis zur zuletzt gestarteten Version, neueste zuerst', () => {
    expect(versionen(seitLetzterVersion(LISTE, '1.0.0-alpha.106', '1.0.0-alpha.100'))).toEqual([
      '1.0.0-alpha.106',
      '1.0.0-alpha.105',
      '1.0.0-alpha.104',
      '1.0.0-alpha.101',
    ]);
  });

  it('ist leer ohne Versionswechsel, also ohne zuletzt gestartete Version', () => {
    expect(seitLetzterVersion(LISTE, '1.0.0-alpha.106', null)).toEqual([]);
  });

  it('zeigt beim Wechsel in den stabilen Kanal den stabilen Eintrag, nicht die Alpha-Liste', () => {
    expect(versionen(seitLetzterVersion(LISTE, '1.0.0', '1.0.0-alpha.106'))).toEqual(['1.0.0']);
  });

  it('zeigt nur die laufende Version, wenn die zuletzt gestartete nicht im Archiv steht', () => {
    expect(versionen(seitLetzterVersion(LISTE, '1.0.0-alpha.106', '0.9.9-alpha.1'))).toEqual([
      '1.0.0-alpha.106',
    ]);
  });
});

describe('nachKanal', () => {
  it('filtert nach Kanal und lässt bei „alle“ alles stehen', () => {
    expect(nachKanal(LISTE, 'alpha')).toHaveLength(6);
    expect(nachKanal(LISTE, 'stabil')).toHaveLength(1);
    expect(nachKanal(LISTE, 'beta')).toEqual([]);
    expect(nachKanal(LISTE, 'alle')).toHaveLength(LISTE.length);
  });
});

describe('vorschau', () => {
  it('lässt einen kurzen Text unverändert', () => {
    expect(vorschau('### A\n\nkurz', 4000)).toEqual({ text: '### A\n\nkurz', gekuerzt: false });
  });

  it('nimmt bei einem langen Text nur die ersten Abschnitte bis zur Grenze', () => {
    const abschnitt = (n: number) => `### Bereich ${n}\n\n${'x'.repeat(1000)}\n`;
    const text = [1, 2, 3, 4, 5].map(abschnitt).join('\n');

    const { text: kurz, gekuerzt } = vorschau(text, 2500);

    expect(gekuerzt).toBe(true);
    expect(kurz).toContain('### Bereich 1');
    expect(kurz).toContain('### Bereich 2');
    expect(kurz).not.toContain('### Bereich 3');
    expect(kurz.length).toBeLessThanOrEqual(2500);
  });

  it('kürzt nie mitten in einer Zeile, auch ohne Abschnittsüberschrift', () => {
    const text = Array.from({ length: 50 }, (_, i) => `Zeile ${i} ${'y'.repeat(100)}`).join('\n');

    const { text: kurz } = vorschau(text, 1000);

    expect(kurz.endsWith('\n')).toBe(false);
    for (const zeile of kurz.split('\n')) expect(zeile).toMatch(/^Zeile \d+ y+$/);
  });
});
