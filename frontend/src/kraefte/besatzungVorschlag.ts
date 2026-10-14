import type { EinsatzFahrzeug, EinsatzPersonal, Staerke } from '../api/types';

/**
 * Besatzungsvorschlag aus der Einheit (LLH-1073, design.md D12, Spec `fahrzeug-bearbeitung`,
 * „Besatzungsvorschlag aus der Einheit“). Rein: die Fahrzeugliste liest ihn für den Knopf
 * „Personal der Einheit übernehmen“ und die Vorbelegung des Dialogs.
 */

type Position = keyof Staerke;

/** Ohne F/UF-Position zählt eine Kraft als Mannschaft, wie in `besatzungsStaerke`. */
function positionVon(p: EinsatzPersonal): Position {
  if (p.staerke_position === 'fuehrer') return 'fuehrer';
  if (p.staerke_position === 'unterfuehrer') return 'unterfuehrer';
  return 'mannschaft';
}

const RANG: Record<Position, number> = { fuehrer: 0, unterfuehrer: 1, mannschaft: 2 };

/**
 * Freie Kräfte der Einheit des Fahrzeugs: aktiv, derselben Einheit zugeordnet und auf keinem
 * Fahrzeug. Ohne Einheit gibt es keine.
 */
export function besatzungKandidaten(
  personal: readonly EinsatzPersonal[],
  ef: EinsatzFahrzeug,
): EinsatzPersonal[] {
  if (ef.einheit_id == null) return [];
  return personal.filter(
    (p) => p.beendet_at == null && p.einheit_id === ef.einheit_id && p.fahrzeug_id == null,
  );
}

export interface BesatzungVorschlagEingabe {
  kandidaten: readonly EinsatzPersonal[];
  /** Die schon sitzende Besatzung des Fahrzeugs; sie belegt Plätze. */
  crew: readonly EinsatzPersonal[];
  /** Soll des Fahrzeugs; ohne Soll sind alle Kandidaten vorgewählt. */
  soll: Staerke | null;
  /** Führer der Einheit (nur mit Freigabe `einheiten` bekannt); er steht zuerst. */
  fuehrerId: number | null;
}

export interface BesatzungVorschlag {
  /** Die Kandidaten in Anzeigefolge: Führer der Einheit, dann Position (F, UF, M), dann Name. */
  kandidaten: EinsatzPersonal[];
  /** Vorgewählte `ep_id`s in Anzeigefolge. */
  vorgewaehlt: number[];
}

/** Plätze je Position bis zum Soll, abzüglich der sitzenden Besatzung, in Anzeigefolge besetzt. */
export function besatzungVorschlag({
  kandidaten,
  crew,
  soll,
  fuehrerId,
}: BesatzungVorschlagEingabe): BesatzungVorschlag {
  const geordnet = [...kandidaten].sort(
    (a, b) =>
      Number(b.id === fuehrerId) - Number(a.id === fuehrerId) ||
      RANG[positionVon(a)] - RANG[positionVon(b)] ||
      a.name.localeCompare(b.name, 'de'),
  );
  if (soll == null) return { kandidaten: geordnet, vorgewaehlt: geordnet.map((p) => p.id) };
  const frei: Staerke = { ...soll };
  for (const m of crew) frei[positionVon(m)] -= 1;
  const vorgewaehlt: number[] = [];
  for (const p of geordnet) {
    const position = positionVon(p);
    if (frei[position] > 0) {
      frei[position] -= 1;
      vorgewaehlt.push(p.id);
    }
  }
  return { kandidaten: geordnet, vorgewaehlt };
}
