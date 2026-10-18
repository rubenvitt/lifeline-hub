import type {
  Fachrichtung,
  MassnahmeArt,
  Person,
  Sichtungskategorie,
  TransportArt,
  TransportPrioritaet,
  Verbleib,
  VerletzungArt,
  VerletzungSchwere,
} from '../api/types';

/**
 * Triage-Reihenfolge der Patienten-Abschnitte (SK I zuerst, tot zuletzt) — die eine Quelle
 * dafür, welche Sichtungen einen „Patienten" ausmachen.
 */
const PATIENT_SK: Sichtungskategorie[] = ['sk1', 'sk2', 'sk3', 'sk4', 'tot'];

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

/** Reihenfolge der Sichtungskategorien — Dringlichkeit zuerst, wie an der Aufnahme gesprochen.
 *  Eine Quelle für Erfassung, Nachsichtung (`SichtungsWahl`) und Sortierungen (LLH-1083). */
export const SK_REIHE: readonly Sichtungskategorie[] = [
  'sk1',
  'sk2',
  'sk3',
  'sk4',
  'tot',
  'unverletzt',
];

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

/**
 * Reihe der Transportpriorität (LLH-1325, design.md D10): ordnet innerhalb einer
 * Sichtungskategorie, nie über ihr. Ohne Priorität steht eine Person hinter „normal“.
 */
export const TRANSPORT_PRIORITAET_REIHE: readonly TransportPrioritaet[] = [
  'sofort',
  'dringlich',
  'normal',
];

/** Platz der Transportpriorität in ihrer Reihe, 0 = sofort; ohne Priorität hinter „normal“. */
export function transportRang(prioritaet: TransportPrioritaet | null | undefined): number {
  return prioritaet == null
    ? TRANSPORT_PRIORITAET_REIHE.length
    : TRANSPORT_PRIORITAET_REIHE.indexOf(prioritaet);
}

/** Das Wort der Transportart, wie es an der Trage gesprochen wird. */
export const TRANSPORT_ART_WORT: Record<TransportArt, string> = {
  liegend: 'liegend',
  sitzend: 'sitzend',
  mit_notarzt: 'mit Notarzt',
};

/** Das Wort der benötigten Fachrichtung (LLH-1325). */
export const FACHRICHTUNG_WORT: Record<Fachrichtung, string> = {
  unfallchirurgie: 'Unfallchirurgie',
  verbrennung: 'Verbrennung',
  kinder: 'Kinder',
  neuro: 'Neuro',
  innere: 'Innere',
  geburtshilfe: 'Geburtshilfe',
  psychiatrie: 'Psychiatrie',
  sonstige: 'Sonstige',
};

/**
 * Der aktuelle Transportstand in einer Zeile („dringlich · liegend · Unfallchirurgie“), aus dem
 * Cache an der Person; ohne Stand `null`. Die Priorität steht als Wort, keine Farbe (D10).
 */
export function transportText(
  p: Pick<Person, 'transport_prioritaet' | 'transport_art' | 'transport_fachrichtung'>,
): string | null {
  const teile = [
    p.transport_prioritaet ?? null,
    p.transport_art ? TRANSPORT_ART_WORT[p.transport_art] : null,
    p.transport_fachrichtung ? FACHRICHTUNG_WORT[p.transport_fachrichtung] : null,
  ].filter((t): t is string => t != null);
  return teile.length > 0 ? teile.join(' · ') : null;
}

/** Das Wort je Maßnahme aus dem festen Katalog (LLH-1324), wie die Wahl im Paneel es zeigt. */
export const MASSNAHME_WORT: Record<MassnahmeArt, string> = {
  blutstillung: 'Blutstillung',
  zugang: 'Zugang',
  infusion: 'Infusion',
  sauerstoff: 'Sauerstoff',
  atemweg: 'Atemweg',
  analgesie: 'Analgesie',
  immobilisation: 'Immobilisation',
  waermeerhalt: 'Wärmeerhalt',
  dekontamination: 'Dekontamination',
};

/** Feste Folge der Maßnahmen in der Wahl: die Katalogfolge der Spec. */
export const MASSNAHME_REIHE = Object.keys(MASSNAHME_WORT) as readonly MassnahmeArt[];

/** Das Wort je Art der Verletzung (LLH-1113). */
export const VERLETZUNG_ART_WORT: Record<VerletzungArt, string> = {
  wunde_blutung: 'Wunde/Blutung',
  fraktur_verdacht: 'Fraktur-Verdacht',
  verbrennung: 'Verbrennung',
  prellung_schwellung: 'Prellung/Schwellung',
  amputation: 'Amputation',
  schmerz: 'Schmerz',
  sonstige: 'Sonstige',
};

/** Feste Folge der Arten in der Wahl am Körperschema. */
export const VERLETZUNG_ART_REIHE = Object.keys(VERLETZUNG_ART_WORT) as readonly VerletzungArt[];

/** Das Wort je Schwere; die Schwere ist optional. */
export const VERLETZUNG_SCHWERE_WORT: Record<VerletzungSchwere, string> = {
  leicht: 'leicht',
  mittel: 'mittel',
  schwer: 'schwer',
};

/** Aus einer Liste nur, was gilt: Aufgehobenes steht im Verlauf, nicht im Kopf. */
export function gueltig<T extends { aufgehoben_at?: string | null }>(liste: readonly T[]): T[] {
  return liste.filter((e) => e.aufgehoben_at == null);
}

/** Spielraum, ab dem ein Eintrag als nachgetragen gilt: wie die Zukunftstoleranz des Servers. */
export const NACHTRAG_SPIELRAUM_MS = 60_000;

function alsMs(wire: string): number {
  return Date.parse(`${wire.replace(' ', 'T')}Z`);
}

/**
 * Ob ein Eintrag nachgetragen ist (Spec `personen-verlauf`, „Nachsichtung von vor 20 Minuten“):
 * er kam mehr als {@link NACHTRAG_SPIELRAUM_MS} nach seiner Erfassungszeit beim Server an
 * (`eingegangen_at` bzw. `erfasst_at`). Ein sofort erfasster Eintrag trägt beide Zeiten aus
 * derselben Sekunde; Einträge von vor der Migration 0217 haben keinen Eingang.
 */
export function istNachgetragen(erfassung: string, eingang: string | null | undefined): boolean {
  if (!eingang) return false;
  const a = alsMs(erfassung);
  const b = alsMs(eingang);
  return Number.isFinite(a) && Number.isFinite(b) && b - a > NACHTRAG_SPIELRAUM_MS;
}
