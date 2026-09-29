import type { Sichtungskategorie, Verbleib } from '../api/types';

/**
 * Triage-Reihenfolge der Patienten-Abschnitte (SK I zuerst, tot zuletzt) — die eine Quelle
 * dafür, welche Sichtungen einen „Patienten" ausmachen.
 */
export const PATIENT_SK: Sichtungskategorie[] = ['sk1', 'sk2', 'sk3', 'sk4', 'tot'];

/** Patient = gesichtet mit SK I–IV oder tot. Strukturell typisiert für `Person` und
    `PersonDetail`. */
export function istPatient(p: { aktuelle_sichtung?: Sichtungskategorie | null }): boolean {
  return p.aktuelle_sichtung != null && PATIENT_SK.includes(p.aktuelle_sichtung);
}

/** Einzeilige Kurzfassung eines Verbleib-Eintrags für den Personen-Verlauf. */
export function kurzVerbleib(v: Verbleib): string {
  const ziel = v.ziel ? ` → ${v.ziel}` : '';
  const tm = v.transportmittel ? ` (${v.transportmittel})` : '';
  switch (v.art) {
    case 'transport':
      return `Transport${ziel}${tm}`;
    case 'entlassung':
      return 'entlassen';
    case 'vor_ort':
      return 'verbleibt vor Ort';
    case 'verstorben':
      return 'Verbleib des Leichnams';
    case 'notunterkunft':
      return `Notunterkunft${ziel}`;
  }
}

// Kompatible Exportnamen; die Farbachsen liegen im Theme.
export { sichtung as SK_META, personStatus as STATUS_META } from '../theme/statusFarben';

/**
 * Das Bedeutungswort je Sichtungskategorie für Legenden (BBK-Einteilung). Das Kürzel selbst
 * bleibt `SK_META[k].label` — dies ist der Beisatz.
 */
export const SK_WORT: Record<Sichtungskategorie | 'ohne', string> = {
  sk1: 'akut',
  sk2: 'schwer',
  sk3: 'leicht',
  sk4: 'abwartend',
  tot: 'verstorben',
  unverletzt: 'ohne Verletzung',
  ohne: 'ohne Sichtung',
};
