import type { Person, UhsDetail } from '../../api/types';
import { sichtungsbild, type SichtungsbildSchluessel } from '../../personen/personenBilanz';
import { wartetSeit, wartezeitMinuten } from './dringlichkeit';

/**
 * Lage einer Unfallhilfsstelle in Zahlen (LLH-1136): wie viele Patienten nach Sichtung, wie viele
 * Plätze frei, wer wartet und wie lange, wer auf Transport ging. Rein und aus denselben Mengen wie
 * der Grundriss (`Grundriss.tsx`), damit Zahl und Bild nie auseinanderlaufen. Die Sichtung zählt
 * über `sichtungsbild` (eine Heimat je Zahl, `frontend/AGENTS.md`, LFH-550).
 */

/** Wer in dieser Stelle steht — auf einem Platz oder im Wartebereich. */
export function personenInUhs(uhs: Pick<UhsDetail, 'id'>, personen: readonly Person[]): Person[] {
  return personen.filter((p) => p.aktuelle_uhs_id === uhs.id);
}

/**
 * Wer diese Stelle auf Transport verlassen hat: Austritt in ihrer Belegungsreihe und aktueller
 * Verbleib „Transport“. Nach R-Nr. sortiert, wie die Transport-Spalte des Grundrisses.
 */
export function transportiertAus(
  uhs: Pick<UhsDetail, 'belegungen'>,
  personen: readonly Person[],
): Person[] {
  const ausgetreten = new Set(
    uhs.belegungen.filter((b) => b.art === 'austritt').map((b) => b.person_id),
  );
  return personen
    .filter((p) => ausgetreten.has(p.id) && p.aktueller_verbleib?.startsWith('Transport'))
    .sort((a, b) => a.registrier_nr - b.registrier_nr);
}

/** Belegte Plätze wie im Grundriss: der aktuelle Platz jeder Person in dieser UHS. */
export function belegtePlaetze(
  uhs: Pick<UhsDetail, 'id'>,
  personen: readonly Person[],
): Set<number> {
  const ids = new Set<number>();
  for (const p of personen) {
    if (!p.storniert_at && p.aktuelle_uhs_id === uhs.id && p.aktueller_platz_id != null) {
      ids.add(p.aktueller_platz_id);
    }
  }
  return ids;
}

/** Belegung der Plätze in Zahlen: belegt zählt die Personen auf einem Platz, nicht die Karten. */
export function platzZahlen(uhs: Pick<UhsDetail, 'plaetze'>, belegtePlatzIds: ReadonlySet<number>) {
  const plaetze = uhs.plaetze.filter((p) => !p.storniert_at && p.typ !== 'wartebereich');
  const belegt = plaetze.filter((p) => belegtePlatzIds.has(p.id)).length;
  const unbelegt = plaetze.filter((p) => !belegtePlatzIds.has(p.id));
  const nichtVerfuegbar = unbelegt.filter((p) => p.verfuegbarkeit !== 'frei').length;
  return {
    gesamt: plaetze.length,
    belegt,
    frei: plaetze.length - belegt - nichtVerfuegbar,
    nichtVerfuegbar,
    /** Davon gleich wieder frei: in Aufbereitung. */
    inAufbereitung: unbelegt.filter((p) => p.verfuegbarkeit === 'aufbereitung').length,
  };
}

export interface UhsLage {
  inDerStelle: number;
  sichtung: Record<SichtungsbildSchluessel, number>;
  plaetze: ReturnType<typeof platzZahlen>;
  wartend: number;
  /** Längste laufende Wartezeit in Minuten; `null` ohne Wartende oder ohne lesbaren Beginn. */
  laengsteWarteMin: number | null;
  abtransportiert: number;
}

export function uhsLage(uhs: UhsDetail, personen: readonly Person[], jetztMs: number): UhsLage {
  const drin = personenInUhs(uhs, personen);
  // Wartend ist, wer keinen Platz hat oder auf einem Platz vom Typ „Wartebereich“ steht: der Server
  // lässt solche Plätze belegen, und dort zählt die Person weder bei den Plätzen noch sonst wo.
  const wartebereichPlaetze = new Set(
    uhs.plaetze.filter((p) => p.typ === 'wartebereich').map((p) => p.id),
  );
  const wartende = drin.filter(
    (p) => p.aktueller_platz_id == null || wartebereichPlaetze.has(p.aktueller_platz_id),
  );
  const minuten = wartende
    .map((p) => {
      const seit = wartetSeit(p.id, uhs.belegungen);
      return seit == null ? null : wartezeitMinuten(seit, jetztMs);
    })
    .filter((m): m is number => m != null);
  return {
    inDerStelle: drin.length,
    sichtung: sichtungsbild(drin).je,
    plaetze: platzZahlen(uhs, belegtePlaetze(uhs, personen)),
    wartend: wartende.length,
    laengsteWarteMin: minuten.length > 0 ? Math.max(...minuten) : null,
    abtransportiert: transportiertAus(uhs, personen).length,
  };
}
