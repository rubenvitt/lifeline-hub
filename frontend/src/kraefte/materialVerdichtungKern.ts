import type { EinsatzMaterial } from '../api/types';
import { materialStatus, type Statusrolle } from '../theme/statusFarben';
import { isAufgebraucht } from './materialPosten';

/**
 * Die eine Zählung des Materials (LLH-1093, design.md D10; Entscheidung 13.10.2026 Nr. 2), rein.
 *
 * Gezählt werden POSTEN, nicht Mengen, in drei Töpfe nach der ROLLE des Status im Vertrag
 * `materialStatus` (`theme/statusFarben.ts`), nie nach dem Statuswert: `normal` → einsatzbereit,
 * `bedien` → im Einsatz, `alarm` oder `achtung` → Ausfall (defekt, verbraucht, Desinfektion
 * nötig). Bekommt ein Status eine andere Rolle, scheitert `materialVerdichtungKern.test.ts`:
 * dann ist die Regel neu zu entscheiden, nicht still zu erweitern. Ein aufgebrauchtes
 * Verbrauchsgut ist Ausfall in der Rolle von „verbraucht“, gleich welcher Status (LLH-1224,
 * design.md D15: das frühere „verbraucht“ eines Verbrauchsguts heißt jetzt „aufgebraucht“).
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

/** Was die Zählung von einer Zeile braucht: Status, Art und Ausgabe. */
export type MaterialZaehlZeile = Pick<EinsatzMaterial, 'status' | 'art' | 'menge' | 'ausgegeben'>;

/** Die Rolle, nach der ein Posten zählt: aufgebraucht wie „verbraucht“, sonst sein Status. */
function zaehlRolle(em: MaterialZaehlZeile): Statusrolle {
  return isAufgebraucht(em) ? materialStatus.verbraucht.rolle : materialStatus[em.status].rolle;
}

/** Der Topf eines Postens über seine Rolle; `undefined` nur bei einer unentschiedenen Rolle. */
export function materialTopf(em: MaterialZaehlZeile): MaterialTopf | undefined {
  return TOPF_DER_ROLLE[zaehlRolle(em)];
}

/**
 * Ausfall eines Materialpostens (Option A aus LLH-1087, LLH-1224): die Status mit Rolle `alarm`
 * oder `achtung` im Vertrag — defekt, verbraucht, Desinfektion nötig — oder aufgebraucht.
 */
export function isMaterialAusfall(em: MaterialZaehlZeile): boolean {
  return materialTopf(em) === 'ausfall';
}

/** Zahl der ausgefallenen Posten (nicht Mengen). */
export function materialAusfall(material: readonly MaterialZaehlZeile[]): number {
  return material.filter(isMaterialAusfall).length;
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
  material: readonly MaterialZaehlZeile[],
): MaterialVerdichtungWerte {
  const v: MaterialVerdichtungWerte = {
    gesamt: material.length,
    einsatzbereit: 0,
    imEinsatz: 0,
    ausfall: 0,
    ausfallRolle: null,
  };
  for (const m of material) {
    const topf = materialTopf(m);
    if (topf === 'einsatzbereit') v.einsatzbereit += 1;
    else if (topf === 'imEinsatz') v.imEinsatz += 1;
    else if (topf === 'ausfall') {
      v.ausfall += 1;
      const rolle = zaehlRolle(m);
      if (rolle === 'alarm' || (rolle === 'achtung' && v.ausfallRolle === null)) {
        v.ausfallRolle = rolle;
      }
    }
  }
  return v;
}
