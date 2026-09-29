import type { Einsatzart } from '../api/types';

/**
 * Beschriftungen der Einsatzarten (LFH-332), geteilt von Anlegedialog und Einsatzdaten.
 *
 * Der `Record` über `Einsatzart` ist Absicht: eine neue Variante aus dem Typ-Codegen bricht
 * den Build, statt still einen leeren Eintrag anzuzeigen.
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
