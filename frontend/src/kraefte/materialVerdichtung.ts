import type { EinsatzMaterial, MaterialStatus } from '../api/types';
import { materialStatus, type Statusrolle } from '../theme/statusFarben';

/**
 * Die eine Zählung des Materials (LLH-1093, design.md D10; Entscheidung 13.10.2026 Nr. 2), rein.
 *
 * Gezählt werden POSTEN, nicht Mengen, in drei Töpfe nach der ROLLE des Status im Vertrag
 * `materialStatus` (`theme/statusFarben.ts`), nie nach dem Statuswert: `normal` → einsatzbereit,
 * `bedien` → im Einsatz, `alarm` oder `achtung` → Ausfall (defekt, verbraucht, Desinfektion
 * nötig). Bekommt ein Status eine andere Rolle, scheitert `materialVerdichtung.test.ts`: dann ist
 * die Regel neu zu entscheiden, nicht still zu erweitern.
 *
 * Abnehmer: die Materialseite (`MaterialVerdichtung.tsx`) und die Material-Gruppenzeile des
 * Meldebilds über `kraeftebaumKern.ts` (LLH-1025); keiner zählt Material selbst.
 */

export type MaterialTopf = 'einsatzbereit' | 'imEinsatz' | 'ausfall';

const TOPF_DER_ROLLE: Partial<Record<Statusrolle, MaterialTopf>> = {
  normal: 'einsatzbereit',
  bedien: 'imEinsatz',
  alarm: 'ausfall',
  achtung: 'ausfall',
};

/** Der Topf eines Status über seine Rolle; `undefined` nur bei einer unentschiedenen Rolle. */
export function materialTopf(status: MaterialStatus): MaterialTopf | undefined {
  return TOPF_DER_ROLLE[materialStatus[status].rolle];
}

/**
 * Ausfall eines Materialpostens (Option A aus LLH-1087): die Status mit Rolle `alarm` oder
 * `achtung` im Vertrag — defekt, verbraucht, Desinfektion nötig.
 */
export function isMaterialAusfall(status: MaterialStatus): boolean {
  return materialTopf(status) === 'ausfall';
}

/** Zahl der ausgefallenen Posten (nicht Mengen). */
export function materialAusfall(material: readonly Pick<EinsatzMaterial, 'status'>[]): number {
  return material.filter((m) => isMaterialAusfall(m.status)).length;
}

export interface MaterialVerdichtungWerte {
  gesamt: number;
  einsatzbereit: number;
  imEinsatz: number;
  ausfall: number;
  /** Rolle des schwersten Ausfalls (`alarm` vor `achtung`) für den Ton; ohne Ausfall `null`. */
  ausfallRolle: 'alarm' | 'achtung' | null;
}

export function verdichteMaterial(
  material: readonly Pick<EinsatzMaterial, 'status'>[],
): MaterialVerdichtungWerte {
  const v: MaterialVerdichtungWerte = {
    gesamt: material.length,
    einsatzbereit: 0,
    imEinsatz: 0,
    ausfall: 0,
    ausfallRolle: null,
  };
  for (const m of material) {
    const topf = materialTopf(m.status);
    if (topf === 'einsatzbereit') v.einsatzbereit += 1;
    else if (topf === 'imEinsatz') v.imEinsatz += 1;
    else if (topf === 'ausfall') {
      v.ausfall += 1;
      const rolle = materialStatus[m.status].rolle;
      if (rolle === 'alarm' || (rolle === 'achtung' && v.ausfallRolle === null)) {
        v.ausfallRolle = rolle;
      }
    }
  }
  return v;
}
