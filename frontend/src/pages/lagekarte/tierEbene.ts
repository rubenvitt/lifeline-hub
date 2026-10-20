import type { ModulFreigaben } from '../../api/types';
import { KEINE_BERECHTIGUNG, modulRegistry } from '../../einsatz/modulRegistry';
import { personenZugriffVon, type PersonenZugriff } from './personenEbene';

/** Registry-Eintrag des Moduls „Tiere" — Grenze der gleichnamigen Ebene. */
export const TIER_MODUL = modulRegistry.find((m) => m.key === 'tiere');

/**
 * Zugriff auf die Ebene „Tiere" (LLH-1123) — dieselbe Grenze wie bei Betreuungsstellen und
 * Bereitstellungsräumen: sie sitzt an der Datenquelle, nicht am Schalter. Ein 403 ist „gesperrt",
 * kein Ausfall. Gesicherte Lagestände tragen die Tiere (der Server lässt sie ohne Modulrecht weg),
 * also kein `'rueckblick'`.
 */
export type TierZugriff = Exclude<PersonenZugriff, 'rueckblick'>;

export function checkTierZugriff(a: {
  /** Freigaben des Servers; `undefined`, solange sie laden oder ihr Abruf gescheitert ist. */
  freigaben: ModulFreigaben | undefined;
  /** Die Tierliste kam mit 403 zurück. */
  abgelehnt: boolean;
}): TierZugriff {
  // `istSnapshot: false` schließt `'rueckblick'` aus — der Cast ist damit keine Behauptung.
  return personenZugriffVon({ ...a, modul: TIER_MODUL, istSnapshot: false }) as TierZugriff;
}

/** Sichtbarer Grund an der gesperrten Zeile — derselbe Wortlaut wie bei den übrigen Ebenen. */
export const TIER_SPERRGRUND = KEINE_BERECHTIGUNG;
