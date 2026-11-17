import { describe, expect, it } from 'vitest';
import kapitel from '../../../docs/anwender/kapitel/zeiten-und-kuerzel.md?raw';
import { EINGEFUEHRTE_KUERZEL } from './kuerzel';

/** Die Zeilen der Tabelle unter „### Eingeführte Kürzel“ als `[kürzel, bedeutung]`. */
function kapitelTabelle(text: string): [string, string][] {
  const abschnitt = text.split('### Eingeführte Kürzel')[1] ?? '';
  return abschnitt
    .split('\n')
    .filter((z) => /^\|/.test(z) && !/^\|\s*(Kürzel|-)/.test(z))
    .map(
      (z) =>
        z
          .split('|')
          .slice(1, -1)
          .map((s) => s.trim()) as [string, string],
    );
}

describe('Eingeführte Kürzel (LLH-1750, Spec bedien-wortlaut)', () => {
  it('stehen im Anwenderkapitel genau wie in der Liste der App', () => {
    expect(kapitelTabelle(kapitel)).toEqual(
      EINGEFUEHRTE_KUERZEL.map((k) => [k.kuerzel, k.bedeutung]),
    );
  });

  it('fällt auf, wenn eine Zeile fehlt (Gegenprobe)', () => {
    const ohneUhs = kapitel.replace('| UHS | Unfallhilfsstelle |\n', '');
    expect(kapitelTabelle(ohneUhs)).not.toEqual(
      EINGEFUEHRTE_KUERZEL.map((k) => [k.kuerzel, k.bedeutung]),
    );
  });
});
