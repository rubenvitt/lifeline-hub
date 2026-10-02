import { IconOrtsmarke } from '../icons';
import { formatiere, type LatLon } from '../anzeige/koordinaten';
import type { Koordinatenformat } from '../api/types';
import { lagekartePfad } from '../routing/deeplinks';
import { sprungZu, type Befehl, type Oeffnung } from './typen';

/**
 * Der Koordinatensprung der Sprungpalette: wer eine Koordinate tippt, bekommt ganz oben „Auf
 * Lagekarte zeigen“.
 *
 * KEIN PRÄFIX, SONDERN DIE FORM: `#` ist das ETB-Präfix, und eine Koordinate ist an ihrer Form so
 * eindeutig wie eine gedruckte Kennung. Die Erkennung selbst steht in
 * `anzeige/koordinatenErkennung.ts` (geteilt mit der Ortssuche der Lagekarte).
 *
 * Rein und exportiert. Die Rechteprüfung (Lagekarte sichtbar?) liegt beim Aufrufer.
 */

/** Fünf Nachkommastellen ≙ rund 1 m — dieselbe Rundung wie `lagekartePfad`. */
function kurz(x: number): string {
  return String(Number(x.toFixed(5)));
}

/**
 * Die Zeile „Auf Lagekarte zeigen · <Punkt>“.
 *
 * Gruppe `koordinate`, nicht `datensaetze`: kein Datensatz, kein Modulschlüssel
 * (`sichtbareDatensaetze` filtert über den). Nicht merkbar (`GRUPPE_MERKBAR`).
 *
 * Die id trägt den gerundeten Punkt: die Auswahl hängt an der Befehls-id, eine feste id ließe
 * die Markierung beim Weitertippen an einem veralteten Punkt kleben.
 */
export function koordinatenBefehl({
  einsatzId,
  punkt,
  format,
  navigate,
}: {
  einsatzId: number;
  punkt: LatLon;
  format: Koordinatenformat;
  /** `oeffnung` fehlt = im aktuellen Tab. */
  navigate: (pfad: string, oeffnung?: Oeffnung) => void;
}): Befehl {
  return {
    id: `koordinate:${kurz(punkt.lat)},${kurz(punkt.lon)}`,
    gruppe: 'koordinate',
    label: `Auf Lagekarte zeigen · ${formatiere(punkt.lat, punkt.lon, format)}`,
    kontext: 'Koordinate',
    icon: IconOrtsmarke,
    ...sprungZu(lagekartePfad(einsatzId, { zentrum: punkt }), navigate),
  };
}
