import type { PersonStatus, Sichtungskategorie, Verbleib } from '../api/types';

/** Triage-Reihenfolge der Patienten-Abschnitte (SK I zuerst, tot zuletzt).
 *  Single Source of Truth dafür, welche Sichtungen einen „Patienten" ausmachen —
 *  geteilt zwischen Personen-Liste (Patienten-Tab) und Lagebild-Streifen. */
export const PATIENT_SK: Sichtungskategorie[] = ['sk1', 'sk2', 'sk3', 'sk4', 'tot'];

/** Patient = gesichtet mit behandlungsrelevanter Kategorie (SK I–IV oder tot).
 *  Strukturell typisiert, damit sowohl `Person` (Liste) als auch `PersonDetail` passen. */
export function istPatient(p: { aktuelle_sichtung?: Sichtungskategorie | null }): boolean {
  return p.aktuelle_sichtung != null && PATIENT_SK.includes(p.aktuelle_sichtung);
}

/** Einzeilige Kurzfassung eines Verbleib-Eintrags für den Personen-Verlauf. */
export function kurzVerbleib(v: Verbleib): string {
  const ziel = v.ziel ? ` → ${v.ziel}` : '';
  const tm = v.transportmittel ? ` (${v.transportmittel})` : '';
  switch (v.art) {
    case 'transport': return `Transport${ziel}${tm}`;
    case 'entlassung': return 'entlassen';
    case 'vor_ort': return 'verbleibt vor Ort';
    case 'verstorben': return 'Verbleib des Leichnams';
  }
}

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
