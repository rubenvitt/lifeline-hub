/**
 * Papierformat der Fernmeldeskizze (LFH-893 D13): A3 quer als Vorgabe, A4 quer wählbar. Die
 * Seite setzt `skizzenDruckKlasse(format)` an das Element, das Druckkopf, Skizze und Lücken trägt;
 * `skizzeDruck.css` macht daraus die benannte Druckseite.
 */
export type Druckformat = 'a3' | 'a4';

export const DRUCKFORMAT_VORGABE: Druckformat = 'a3';

export const DRUCKFORMAT_OPTIONEN = [
  { wert: 'a3', label: 'A3 quer' },
  { wert: 'a4', label: 'A4 quer' },
] as const satisfies readonly { wert: Druckformat; label: string }[];

export function skizzenDruckKlasse(format: Druckformat): string {
  return `lfh-skizze-druck-${format}`;
}
