import type { EinsatzRolle } from '../api/types';
import { rollenOptionen } from './rollenOption';
import { EINSATZ_ROLLE } from './rollenVokabular';

/**
 * Namen der Einsatzrollen (LFH-946), geteilt von der Einsatzkachel und der Mitgliederverwaltung.
 * Sie kommen aus dem Rollen-Vokabular (LLH-1818, `einsatz/rollenVokabular.ts`); der `Record` dort
 * bricht den Build, sobald der Typ-Codegen eine Rolle ergänzt, statt still den Rohwert zu zeigen.
 */
export const EINSATZ_ROLLE_LABELS = Object.fromEntries(
  (Object.keys(EINSATZ_ROLLE) as EinsatzRolle[]).map((k) => [k, EINSATZ_ROLLE[k].name]),
) as Record<EinsatzRolle, string>;

/** Die Rollen als `Select`-Optionen samt Darf-Zeile, in der Reihenfolge des Vokabulars. */
export const EINSATZ_ROLLE_OPTIONEN = rollenOptionen(EINSATZ_ROLLE);
