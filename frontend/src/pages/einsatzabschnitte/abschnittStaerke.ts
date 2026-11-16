import type { Einheit, Einsatzabschnitt, Staerke } from '../../api/types';
import { abschnittDerEinheit } from '../../kraefte/kraeftebaumKern';

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
  /** Wer im Abschnitt selbst steht — die Bedeutung der Bestandszeile „Stärke (F/UF/M//Σ)". */
  eigene: Staerke | null;
  /** Über `nachfahrenInkl` summiert — Abschnitt inklusive aller Unterabschnitte. */
  inklUnter: Staerke | null;
}

/** Nur aktive Einheiten zählen (LLH-1079), wie im Meldebild. */
const aktive = (einheiten: readonly Einheit[]) => einheiten.filter((e) => !e.aufgeloest_at);

/**
 * Wirksamer Abschnitt je aktiver Einheit: der eigene, sonst der ihrer nächsten Obereinheit mit
 * Abschnitt (`abschnittDerEinheit`). Über die aktiven allein: eine Untereinheit einer aufgelösten
 * Obereinheit erbt deren Abschnitt nicht, wie sie im Meldebild ihre eigene Wurzel ist.
 */
function wirksamerAbschnitt(einheiten: readonly Einheit[]): Map<number, number | null> {
  const je = abschnittDerEinheit(aktive(einheiten));
  return new Map([...je].map(([id, a]) => [id, a?.id ?? null]));
}

/**
 * Die aktiven Einheiten, die im Abschnitt stehen: eigener oder geerbter Abschnitt gleich
 * `abschnittId`, ohne Unterabschnitte. Dieselbe Menge, die {@link abschnittStaerken} als
 * „eigene“ zählt (Spec `lage-verdichtung`, LLH-1744).
 */
export function einheitenImAbschnitt(
  einheiten: readonly Einheit[],
  abschnittId: number,
): Einheit[] {
  const wirksam = wirksamerAbschnitt(einheiten);
  return aktive(einheiten).filter((e) => wirksam.get(e.id) === abschnittId);
}

/**
 * Stärke einer Abschnittsmenge: Es zählt, wer in ihr steht (LLH-1744, Spec `lage-verdichtung`),
 * jede aktive Einheit mit ihrer EIGENEN Stärke (`ist`) bei ihrem wirksamen Abschnitt. So zählt
 * jede Kraft genau einmal, eine abgestellte Untereinheit bei ihrem Abschnitt und nicht bei dem
 * ihrer Obereinheit, wie im Meldebild (`loeseAbgestellte`) und im Bereitstellungsraum
 * (`staerkeImRaum`, LLH-1289). `null` heißt „keine Einheit zugeordnet“.
 */
function staerkeIn(einheiten: readonly Einheit[], abschnittIds: Set<number>): Staerke | null {
  const wirksam = wirksamerAbschnitt(einheiten);
  const drin = aktive(einheiten).filter((e) => {
    const a = wirksam.get(e.id);
    return a != null && abschnittIds.has(a);
  });
  if (drin.length === 0) return null;
  return drin.reduce<Staerke>(
    (s, e) => ({
      fuehrer: s.fuehrer + (e.ist?.fuehrer ?? 0),
      unterfuehrer: s.unterfuehrer + (e.ist?.unterfuehrer ?? 0),
      mannschaft: s.mannschaft + (e.ist?.mannschaft ?? 0),
    }),
    { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  );
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
