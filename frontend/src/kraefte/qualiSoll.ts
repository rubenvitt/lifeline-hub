import type { QualiSollEingabe, QualiSollEintrag } from '../api/types';

/**
 * Qualifikationssoll in Textform (LLH-1553, design.md D6): „mind. 1 Rettungssanitäter,
 * 2 Sanitäter“. Ohne Soll leer.
 */
export function qualiSollText(soll: readonly QualiSollEintrag[] | null | undefined): string {
  if (!soll || soll.length === 0) return '';
  return `mind. ${soll.map((e) => `${e.anzahl} ${e.label}`).join(', ')}`;
}

/** Eingabeform eines gelesenen Solls. */
export function qualiSollEingabe(
  soll: readonly QualiSollEintrag[] | null | undefined,
): QualiSollEingabe[] {
  return (soll ?? []).map((e) => ({ qualifikation_id: e.qualifikation_id, anzahl: e.anzahl }));
}

/** Gleiche Einträge in gleicher Reihenfolge. */
export function gleichesQualiSoll(
  a: readonly QualiSollEingabe[],
  b: readonly QualiSollEingabe[],
): boolean {
  return (
    a.length === b.length &&
    a.every((e, i) => e.qualifikation_id === b[i].qualifikation_id && e.anzahl === b[i].anzahl)
  );
}
