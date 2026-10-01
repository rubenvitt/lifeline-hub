import type { PersonenDruckAuswahl } from '../routing/deeplinks';
import { FILTER_OPTIONEN } from './personenFilter';

/**
 * Kopfzeile „Auswahl" der Personen-Druckansicht (LFH-727, design.md D5) — mit den Wörtern der
 * Liste („erfasst" heißt dort „Neu"), nie ein Schlüssel.
 */
export function personenDruckAuswahl(auswahl: PersonenDruckAuswahl): string {
  const teile: string[] = [];
  if (auswahl.filter !== 'alle') {
    const label = FILTER_OPTIONEN.find((o) => o.wert === auswahl.filter)?.label ?? auswahl.filter;
    teile.push(`Status: ${label}`);
  }
  if (auswahl.nurLuecken) teile.push('nur offene Felder');
  return teile.length > 0 ? teile.join(' · ') : 'alle Personen';
}
