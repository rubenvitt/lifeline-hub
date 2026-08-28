import type { Uhs } from '../../api/types';
import { letzteAuswahlSpeicher, waehleDefaultEintrag } from '../../components/direkteinstiegKern';

const speicher = letzteAuswahlSpeicher('uhs');

/** UHS-Belegung des generischen Direkteinstiegs (`components/direkteinstiegKern.ts`). */
export function waehleDefaultUhs(liste: Uhs[], letzteId: number | null): number | null {
  return waehleDefaultEintrag(liste, letzteId, (u) => u.status === 'aktiv');
}
export const merkeLetzteUhs = speicher.merke;
export const liesLetzteUhs = speicher.lies;
