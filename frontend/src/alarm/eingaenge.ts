import { useViewport } from '../components/useViewport';

/**
 * Bausteine der Eingänge (LLH-1143), ohne Abfragen: Knopf, Band und Alarmzentrale teilen sie, ohne
 * einander zu importieren.
 *
 * window-Ereignis, mit dem Band oder Alarmzentrale den Verlauf am Knopf „Eingänge“ öffnen
 * (`detail.einsatzId`). Ein Ereignis statt eines geteilten Zustands: sie hängen an verschiedenen
 * Stellen des Rahmens.
 */
export const EINGAENGE_OEFFNEN_EVENT = 'lfh:eingaenge-oeffnen';

/** Bittet den Knopf „Eingänge“ dieses Einsatzes, seinen Verlauf zu öffnen. */
export function oeffneEingaenge(einsatzId: number): void {
  window.dispatchEvent(new CustomEvent(EINGAENGE_OEFFNEN_EVENT, { detail: { einsatzId } }));
}

/** Die sichtbare Zahl: leer bei 0, ab 100 „99+“. Rein und exportiert. */
export function eingaengeZahlText(zahl: number): string {
  if (zahl <= 0) return '';
  return zahl > 99 ? '99+' : String(zahl);
}

/** Der zugängliche Name: Zahl und Wort, nie die Zahl allein (Vorleser, WCAG 1.1.1). */
export function eingaengeName(zahl: number): string {
  return zahl > 0 ? `Eingänge, ${zahl} ungelesen` : 'Eingänge, keine ungelesen';
}

/**
 * Bündelt der Kopf die Alarmzentrale zu EINEM Ziel (Handschirm, Tablet mit Finger unter `xl`,
 * LFH-950), stehen auch die Eingänge in diesem Ziel: ein eigener Knopf brach den Kopf bei 820 px
 * um (LLH-1143). Knopf und Alarmzentrale fragen dieselbe Bedingung.
 */
export function useKopfBuendelt(): boolean {
  const { istSchmal, abBreite, istBeruehrung } = useViewport();
  return istSchmal || (!abBreite('xl') && istBeruehrung);
}
