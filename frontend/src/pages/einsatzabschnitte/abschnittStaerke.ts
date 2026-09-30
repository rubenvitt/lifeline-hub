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
  /** Über `nachfahrenInkl` summiert — Abschnitt inklusive aller Unterabschnitte. */
  inklUnter: Staerke | null;
}

const KEINE: Staerke = { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 };

/**
 * Stärke der Einheiten in einer Abschnittsmenge. Es zählen nur die OBERSTEN Einheiten (ohne
 * übergeordnete) mit ihrer kumulierten Stärke — eine unterstellte Einheit zählt beim Abschnitt
 * ihrer obersten Einheit, wie im Meldebild (`baueKraeftebild`, LFH-550). Steht im Abschnitt eine
 * Einheit, aber keine oberste, ist die Stärke 0/0/0, nicht `null`: `null` heißt „keine Einheit
 * zugeordnet".
 */
function staerkeIn(einheiten: Einheit[], abschnittIds: Set<number>): Staerke | null {
  const zugeordnet = einheiten.filter(
    (e) => e.abschnitt_id != null && abschnittIds.has(e.abschnitt_id),
  );
  if (zugeordnet.length === 0) return null;
  return summiereStaerke(zugeordnet.filter((e) => e.ueber_einheit_id == null)) ?? KEINE;
}

export function abschnittStaerken(
  abschnitte: Einsatzabschnitt[],
  einheiten: Einheit[],
  abschnittId: number,
): AbschnittStaerken {
  return {
    eigene: staerkeIn(einheiten, new Set([abschnittId])),
    inklUnter: staerkeIn(einheiten, nachfahrenInkl(abschnitte, abschnittId)),
  };
}
