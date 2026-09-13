import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import { istModulFreigegeben, modulRegistry, type ModulEintrag } from '../einsatz/modulRegistry';

/**
 * Die Werkzeugzeile einer Sachgebietszeile: Registry-Einträge zu den Schlüsseln, gefiltert über
 * DIE eine Freigabe-Frage (`istModulFreigegeben`: fertig · sichtbar · nicht gesperrt).
 *
 * Das Modul-Gate des Stabs deckt den eigenen Pfad, nicht die Nachbarn (Spec 11): ohne den
 * Filter zeigte die Seite Wege in ausgeblendete, gesperrte oder unfertige Module.
 */
export function werkzeugeFuer(
  keys: readonly string[],
  benutzer: BenutzerAnzeige | null,
  overrides?: ModulOverrides,
  register: ModulEintrag[] = modulRegistry,
): ModulEintrag[] {
  return keys
    .map((key) => register.find((m) => m.key === key))
    .filter((m): m is ModulEintrag => m != null && istModulFreigegeben(m, benutzer, overrides));
}
