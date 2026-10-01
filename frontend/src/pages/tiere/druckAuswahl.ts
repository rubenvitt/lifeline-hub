import type { TiereDruckAuswahl } from '../../routing/deeplinks';
import { SPEZIES_META, TIERE_SICHTEN } from './tierHelfer';

/** Kopfzeile „Auswahl" der Tiere-Druckansicht (LFH-727, design.md D5), mit den Wörtern der Liste. */
export function tiereDruckAuswahl(auswahl: TiereDruckAuswahl): string {
  const teile: string[] = [];
  if (auswahl.sicht !== 'alle') {
    teile.push(
      `Sicht: ${TIERE_SICHTEN.find((s) => s.key === auswahl.sicht)?.label ?? auswahl.sicht}`,
    );
  }
  if (auswahl.spezies) teile.push(`Spezies: ${SPEZIES_META[auswahl.spezies]}`);
  return teile.length > 0 ? teile.join(' · ') : 'alle Tiere';
}
