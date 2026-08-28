import type { Bereitstellungsraum } from '../../api/types';
import { letzteAuswahlSpeicher, waehleDefaultEintrag } from '../../components/direkteinstiegKern';

const speicher = letzteAuswahlSpeicher('br');

/** BR-Belegung des generischen Direkteinstiegs (`components/direkteinstiegKern.ts`). Storniert
 *  zählt nicht als aktiv. */
export function waehleDefaultBr(liste: Bereitstellungsraum[], letzteId: number | null): number | null {
  return waehleDefaultEintrag(liste, letzteId, (b) => b.status === 'aktiv' && !b.storniert_at);
}
export const merkeLetztenBr = speicher.merke;
export const liesLetztenBr = speicher.lies;
