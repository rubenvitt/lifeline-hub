import { describe, expect, it } from 'vitest';
import type { EinheitVorlage } from '../api/types';
import { orderAsTree, sollText, subtreeIds, treeIds, vorlagePfad } from './einheitVorlagenBaum';

function vorlage(id: number, name: string, ueber?: number): EinheitVorlage {
  return {
    id,
    name,
    typ_id: 1,
    typ_label: 'Zug',
    ueber_vorlage_id: ueber,
    soll_eigen: false,
    sortier: 0,
    aktiv: true,
    ist_demo: false,
    fahrzeuge: [],
    personal: [],
    material: [],
  };
}

const rows = (liste: EinheitVorlage[]) =>
  orderAsTree(liste).map((r) => `${'-'.repeat(r.depth)}${r.vorlage.name}`);

describe('orderAsTree (LLH-1042)', () => {
  it('stellt Untereinheiten unter ihre Wurzel, tiefer zuerst, sonst in Serverreihenfolge', () => {
    expect(
      rows([
        vorlage(1, 'Löschzug'),
        vorlage(2, 'Staffel', 3),
        vorlage(3, 'Sanitätszug'),
        vorlage(4, 'Trupp', 2),
        vorlage(5, 'Gruppe', 3),
      ]),
    ).toEqual(['Löschzug', 'Sanitätszug', '-Staffel', '--Trupp', '-Gruppe']);
  });

  it('eine Elternvorlage außerhalb der Menge macht die Vorlage zur Wurzel', () => {
    expect(rows([vorlage(2, 'Staffel', 99)])).toEqual(['Staffel']);
  });

  it('ein korrupter Zyklus endet, jede Vorlage steht genau einmal', () => {
    expect(rows([vorlage(1, 'A', 2), vorlage(2, 'B', 1)])).toEqual(['A', '-B']);
  });
});

describe('subtreeIds (LLH-1042)', () => {
  it('liefert die Vorlage und alle Nachfahren, nicht die Geschwister', () => {
    const liste = [
      vorlage(1, 'Zug'),
      vorlage(2, 'Staffel', 1),
      vorlage(3, 'Trupp', 2),
      vorlage(4, 'Gruppe', 1),
    ];
    expect([...subtreeIds(liste, 2)].sort()).toEqual([2, 3]);
    expect([...subtreeIds(liste, 1)].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('sollText (LLH-1042)', () => {
  it('eigenes Soll nackt, das des Typs als Vorgabe, ohne Soll ein Strich', () => {
    const soll = { fuehrer: 1, unterfuehrer: 2, mannschaft: 6 };
    expect(sollText({ ...vorlage(1, 'A'), soll, soll_eigen: true })).toBe('1/2/6//9');
    expect(sollText({ ...vorlage(1, 'A'), soll })).toBe('1/2/6//9 (Vorgabe)');
    expect(sollText(vorlage(1, 'A'))).toBe('—');
  });
});

describe('treeIds (LLH-1042)', () => {
  it('liefert den ganzen Baum ab der Wurzel, auch von einem Blatt aus', () => {
    const liste = [
      vorlage(1, 'Zug'),
      vorlage(2, 'Staffel', 1),
      vorlage(3, 'Trupp', 2),
      vorlage(4, 'Gruppe', 1),
      vorlage(5, 'Anderer Zug'),
    ];
    expect([...treeIds(liste, 3)].sort()).toEqual([1, 2, 3, 4]);
    expect([...treeIds(liste, 5)]).toEqual([5]);
  });

  it('endet auch an einem korrupten Zyklus', () => {
    expect([...treeIds([vorlage(1, 'A', 2), vorlage(2, 'B', 1)], 1)].sort()).toEqual([1, 2]);
  });
});

describe('vorlagePfad (LLH-1049)', () => {
  it('nennt eine Untervorlage mit ihren Eltern, eine fehlende Elternvorlage bricht den Pfad ab', () => {
    const vorlagen = [vorlage(1, 'Zug'), vorlage(2, 'Staffel', 1), vorlage(3, 'Trupp', 2)];
    expect(vorlagePfad(vorlagen, vorlagen[2])).toBe('Zug › Staffel › Trupp');
    expect(vorlagePfad(vorlagen, vorlagen[0])).toBe('Zug');
    // Deaktivierte Elternvorlage (nicht in der aktiven Liste): die Untervorlage steht allein.
    expect(vorlagePfad([vorlagen[1]], vorlagen[1])).toBe('Staffel');
  });
});
