import type { SchaedenDruckAuswahl } from '../../routing/deeplinks';
import { SCHAEDEN_SICHTEN } from './schadenHelfer';

/** Kopfzeile „Auswahl" der Schäden-Druckansicht (LFH-727, design.md D5), mit den Wörtern der Liste. */
export function schaedenDruckAuswahl(auswahl: SchaedenDruckAuswahl): string {
  if (auswahl.sicht === 'alle') return 'alle Schäden';
  return `Sicht: ${SCHAEDEN_SICHTEN.find((s) => s.key === auswahl.sicht)?.label ?? auswahl.sicht}`;
}
