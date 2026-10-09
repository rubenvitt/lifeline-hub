import type { UhsKraft } from '../../api/types';

/** Anzahl einer Qualifikation unter den Kräften einer UHS. */
export interface QualifikationsZahl {
  bezeichnung: string;
  anzahl: number;
}

/**
 * Qualifikationen der Kräfte einer UHS als Anzahl je Bezeichnung (LFH-1045, Spec `uhs-staerke`,
 * design.md D2). Quelle ist die `funktion` der Kraft, wie die Personalliste sie zeigt: bei
 * Stamm-Personal die Katalogbezeichnungen „A, B“, bei Ad-hoc der Freitext. Eine Kraft mit zwei
 * Qualifikationen zählt in beiden, dieselbe Bezeichnung zweimal an einer Kraft nur einmal.
 * Folge: häufigste zuerst, bei Gleichstand alphabetisch.
 */
export function zaehleQualifikationen(kraefte: readonly UhsKraft[]): QualifikationsZahl[] {
  const zahlen = new Map<string, number>();
  for (const k of kraefte) {
    const eigene = new Set(
      (k.funktion ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== ''),
    );
    for (const q of eigene) zahlen.set(q, (zahlen.get(q) ?? 0) + 1);
  }
  return [...zahlen]
    .map(([bezeichnung, anzahl]) => ({ bezeichnung, anzahl }))
    .sort((a, b) => b.anzahl - a.anzahl || a.bezeichnung.localeCompare(b.bezeichnung, 'de'));
}

/** Eine Einheit, deren Kräfte ohne UHS sich als Ganzes zuordnen lassen. */
export interface FreieEinheit {
  id: number;
  name: string;
  anzahl: number;
}

/** Einheiten unter den Kräften ohne UHS, mit der Zahl ihrer freien Kräfte, nach Namen. */
export function freieEinheiten(ohneUhs: readonly UhsKraft[]): FreieEinheit[] {
  const einheiten = new Map<number, FreieEinheit>();
  for (const k of ohneUhs) {
    if (k.einheit_id == null) continue;
    const e = einheiten.get(k.einheit_id) ?? {
      id: k.einheit_id,
      name: k.einheit ?? '',
      anzahl: 0,
    };
    e.anzahl += 1;
    einheiten.set(k.einheit_id, e);
  }
  return [...einheiten.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Auswahltext einer Kraft: „Name · Funktion · Einheit“. */
export function kraftAuswahlText(k: UhsKraft): string {
  return [k.name, k.funktion, k.einheit].filter((t) => t != null && t !== '').join(' · ');
}
