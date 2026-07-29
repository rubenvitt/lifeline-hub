import type { Einsatzart } from '../api/types';

/**
 * Beschriftungen der Einsatzarten (LFH-332 · B4).
 *
 * Lag bis hierher als lokale Konstante in `EinsatzdatenPage`. Seit der
 * Anlegedialog auf `EinsaetzePage` die Einsatzart selbst erfasst, hat sie zwei
 * Leser — und zwei Kopien derselben Zuordnung wären die Sorte Abweichung, die
 * niemandem auffällt, weil beide Seiten für sich plausibel aussehen.
 *
 * Der `Record` über `Einsatzart` ist Absicht: kommt aus dem Typ-Codegen eine
 * fünfte Variante, bricht diese Datei den Build, statt still einen leeren
 * Eintrag anzuzeigen.
 */
export const EINSATZART_LABELS: Record<Einsatzart, string> = {
  realeinsatz: 'Realeinsatz',
  uebung: 'Übung',
  sanitaetsdienst: 'Sanitätsdienst',
  bereitstellung: 'Bereitstellung',
};

/** Die Arten als `Select`-Optionen, in der Reihenfolge des `Record`. */
export const EINSATZART_OPTIONEN = (Object.keys(EINSATZART_LABELS) as Einsatzart[]).map((k) => ({
  value: k,
  label: EINSATZART_LABELS[k],
}));
