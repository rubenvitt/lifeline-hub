import type { PersonStatus, Sichtungskategorie } from '../api/types';

/** Triage-Reihenfolge der Patienten-Abschnitte (SK I zuerst, tot zuletzt).
 *  Single Source of Truth dafür, welche Sichtungen einen „Patienten" ausmachen —
 *  geteilt zwischen Personen-Liste (Patienten-Tab) und Lagebild-Streifen. */
export const PATIENT_SK: Sichtungskategorie[] = ['sk1', 'sk2', 'sk3', 'sk4', 'tot'];

/** Farbe + Label je Sichtungskategorie (antd-Tag-Farbnamen). Einzige Quelle (DRY). */
export const SK_META: Record<Sichtungskategorie, { label: string; color: string }> = {
  sk1: { label: 'SK I', color: 'red' },
  sk2: { label: 'SK II', color: 'gold' },
  sk3: { label: 'SK III', color: 'green' },
  sk4: { label: 'SK IV', color: 'blue' },
  tot: { label: 'tot', color: 'black' },
  unverletzt: { label: 'unverletzt', color: 'default' },
};

/** Farbe + Label je Personenstatus (antd-Tag-Farbnamen). */
export const STATUS_META: Record<PersonStatus, { label: string; color: string }> = {
  erfasst: { label: 'erfasst', color: 'default' },
  vermisst: { label: 'vermisst', color: 'orange' },
  betroffen: { label: 'betroffen', color: 'blue' },
  verstorben: { label: 'verstorben', color: 'red' },
  abgemeldet: { label: 'abgemeldet', color: 'green' },
};
