import type { Einheit, Einsatzabschnitt, Staerke } from '../../api/types';
import { summiereStaerke } from '../../anzeige/staerke';

/** Der Abschnitt selbst plus alle Nachfahren (Tiefensuche, zyklussicher). */
export function nachfahrenInkl(abschnitte: Einsatzabschnitt[], id: number): Set<number> {
  const kinder = new Map<number, number[]>();
  for (const a of abschnitte) {
    if (a.ueber_abschnitt_id != null) {
      if (!kinder.has(a.ueber_abschnitt_id)) kinder.set(a.ueber_abschnitt_id, []);
      kinder.get(a.ueber_abschnitt_id)!.push(a.id);
    }
  }
  const ergebnis = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const n = stack.pop()!;
    if (ergebnis.has(n)) continue;
    ergebnis.add(n);
    for (const c of kinder.get(n) ?? []) stack.push(c);
  }
  return ergebnis;
}

export interface AbschnittStaerken {
  /** Nur direkt zugeordnete Einheiten — die Bedeutung der Bestandszeile „Stärke (F/UF/M//Σ)". */
  eigene: Staerke | null;
  /** Über `nachfahrenInkl` — der Wert, den der Einsatzleiter sonst im Kopf addieren muss (H37). */
  inklUnter: Staerke | null;
}

export function abschnittStaerken(
  abschnitte: Einsatzabschnitt[],
  einheiten: Einheit[],
  abschnittId: number,
): AbschnittStaerken {
  const menge = nachfahrenInkl(abschnitte, abschnittId);
  return {
    eigene: summiereStaerke(einheiten.filter((e) => e.abschnitt_id === abschnittId)),
    inklUnter: summiereStaerke(
      einheiten.filter((e) => e.abschnitt_id != null && menge.has(e.abschnitt_id)),
    ),
  };
}
