import type { ModulFreigaben } from '../../api/types';
import { KEINE_BERECHTIGUNG, modulRegistry } from '../../einsatz/modulRegistry';
import { betreuungZugriffVon, type BetreuungZugriff } from './betreuungEbene';

/** Registry-Eintrag des Moduls „Bereitstellungsräume" — Grenze der gleichnamigen Ebene. */
export const BR_MODUL = modulRegistry.find((m) => m.key === 'bereitstellungsraeume');

/**
 * Zugriff auf die Ebene „Bereitstellungsräume" (LLH-1107) — dieselbe Grenze wie bei den
 * Betreuungsstellen (`betreuungEbene.ts`): sie sitzt an der Datenquelle, nicht am Schalter, ein 403
 * ist „gesperrt", kein Ausfall, und gesicherte Lagestände tragen die Räume (der Server lässt sie
 * ohne Modulrecht weg), also kein `'rueckblick'`.
 */
export type BrZugriff = BetreuungZugriff;

export function checkBrZugriff(a: {
  /** Freigaben des Servers; `undefined`, solange sie laden oder ihr Abruf gescheitert ist. */
  freigaben: ModulFreigaben | undefined;
  /** Die Liste der Räume kam mit 403 zurück. */
  abgelehnt: boolean;
}): BrZugriff {
  return betreuungZugriffVon({ ...a, modul: BR_MODUL });
}

/** Sichtbarer Grund an der gesperrten Zeile — derselbe Wortlaut wie bei den übrigen Ebenen. */
export const BR_SPERRGRUND = KEINE_BERECHTIGUNG;
