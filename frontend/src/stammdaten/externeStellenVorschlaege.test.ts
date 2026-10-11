import { describe, expect, it } from 'vitest';
import type { ExterneStelle } from '../api/types';
import { teilwortSuche } from '../components/teilwortSuche';
import { externeStellenOptionen, zustaendigeLeitstelle } from './externeStellenVorschlaege';

/** LFH-1194, design.md D6: Vorschläge aus dem Katalog „Externe Stellen“. */

function stelle(teil: Partial<ExterneStelle> & Pick<ExterneStelle, 'bezeichnung'>): ExterneStelle {
  return { id: 1, art: 'sonstige', aktiv: true, zustaendig: false, ...teil };
}

const KATALOG: ExterneStelle[] = [
  stelle({ id: 1, bezeichnung: 'Ordnungsamt', art: 'behoerde' }),
  stelle({ id: 2, bezeichnung: 'ILS Nachbarkreis', art: 'leitstelle' }),
  stelle({ id: 3, bezeichnung: 'ILS Musterkreis', art: 'leitstelle', zustaendig: true }),
  stelle({ id: 4, bezeichnung: 'Polizei Musterstadt', art: 'polizei' }),
  stelle({ id: 5, bezeichnung: 'Landratsamt', art: 'behoerde', aktiv: false }),
  stelle({ id: 6, bezeichnung: 'DRK Kreisverband', art: 'hilfsorganisation' }),
];

describe('externeStellenOptionen', () => {
  it('gruppiert nach Art in fester Reihenfolge, zuständige Leitstelle vorn mit Wort', () => {
    expect(externeStellenOptionen(KATALOG)).toEqual([
      {
        label: 'Leitstelle',
        options: [
          { value: 'ILS Musterkreis', label: 'ILS Musterkreis · zuständig' },
          { value: 'ILS Nachbarkreis', label: 'ILS Nachbarkreis' },
        ],
      },
      {
        label: 'Polizei',
        options: [{ value: 'Polizei Musterstadt', label: 'Polizei Musterstadt' }],
      },
      { label: 'Behörde', options: [{ value: 'Ordnungsamt', label: 'Ordnungsamt' }] },
      {
        label: 'Hilfsorganisation',
        options: [{ value: 'DRK Kreisverband', label: 'DRK Kreisverband' }],
      },
    ]);
  });

  it('lässt inaktive Stellen und leere Gruppen weg', () => {
    const werte = externeStellenOptionen(KATALOG).flatMap((g) => g.options.map((o) => o.value));
    expect(werte).not.toContain('Landratsamt');
    expect(externeStellenOptionen(KATALOG).map((g) => g.label)).not.toContain('Sonstige');
    expect(externeStellenOptionen([])).toEqual([]);
  });

  it('Teilwortsuche ohne Groß-/Kleinschreibung trifft die Optionen', () => {
    const optionen = externeStellenOptionen(KATALOG).flatMap((g) => g.options);
    const treffer = optionen.filter((o) => teilwortSuche.filterOption('mus', o));
    expect(treffer.map((o) => o.value)).toEqual(['ILS Musterkreis', 'Polizei Musterstadt']);
  });
});

describe('zustaendigeLeitstelle', () => {
  it('liefert die Bezeichnung der zuständigen Leitstelle', () => {
    expect(zustaendigeLeitstelle(KATALOG)).toBe('ILS Musterkreis');
  });

  it('ohne Markierung undefined', () => {
    expect(zustaendigeLeitstelle(KATALOG.map((s) => ({ ...s, zustaendig: false })))).toBe(
      undefined,
    );
  });
});
