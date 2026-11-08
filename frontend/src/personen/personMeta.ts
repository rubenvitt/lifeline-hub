import type {
  EntlassenAn,
  Fachrichtung,
  GegenRat,
  MassnahmeArt,
  Person,
  PersonAnlass,
  Sichtungskategorie,
  TransportArt,
  TransportPrioritaet,
  Unterschrift,
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

/** An wen entlassen wurde (LLH-1568, Spec `verbleib-angaben`); Reihenfolge der Auswahl. */
export const ENTLASSEN_AN_WORT: Record<EntlassenAn, string> = {
  selbst: 'selbst',
  begleitung: 'Angehörige / Begleitung',
  sorgeberechtigte: 'Sorgeberechtigte',
  polizei: 'Polizei',
};

/** Was gegen Rat abgelehnt wurde (LLH-1568). */
export const GEGEN_RAT_WORT: Record<GegenRat, string> = {
  behandlung: 'Behandlung abgelehnt',
  transport: 'Transport abgelehnt',
};

/** Unterschrift zur Ablehnung gegen Rat (LLH-1568); sie selbst bleibt auf Papier. */
export const UNTERSCHRIFT_WORT: Record<Unterschrift, string> = {
  liegt_vor: 'Unterschrift liegt vor',
  verweigert: 'Unterschrift verweigert',
};

/** Felder eines Verbleibs, die `kurzVerbleib` liest. */
export type VerbleibKurz = Pick<Verbleib, 'art' | 'ziel' | 'transportmittel'> &
  Partial<
    Pick<
      Verbleib,
      | 'status'
      | 'transport_durch'
      | 'leitstelle_einsatznummer'
      | 'entlassen_an'
      | 'gegen_rat'
      | 'unterschrift'
    >
  >;

/**
 * Einzeilige Kurzfassung eines Verbleib-Eintrags für den Personen-Verlauf, mit den Angaben aus
 * LLH-1568 (an wen entlassen, Einsatznummer, gegen Rat).
 */
export function kurzVerbleib(v: VerbleibKurz): string {
  return `${verbleibKopf(v)}${verbleibZusatz(v)}`;
}

function verbleibKopf(v: VerbleibKurz): string {
  const ziel = v.ziel ? ` → ${v.ziel}` : '';
  const tm = v.transportmittel ? ` (${v.transportmittel})` : '';
  switch (v.art) {
    case 'transport':
      // Eigentransport und quittierte Übergabe heißen so (LLH-1332, wie die Kurzform des Servers).
      if (v.transport_durch === 'eigen') {
        return v.status === 'uebergeben' ? `übergeben${ziel}${tm}` : `Eigentransport${ziel}${tm}`;
      }
      return `Transport${ziel}${tm}`;
    case 'entlassung':
      if (v.entlassen_an === 'selbst') return 'entlassen, geht selbst';
      return v.entlassen_an ? `entlassen an ${ENTLASSEN_AN_WORT[v.entlassen_an]}` : 'entlassen';
    case 'vor_ort':
      return 'verbleibt vor Ort';
    case 'verstorben':
      return 'Verbleib des Leichnams';
    case 'notunterkunft':
      return `Notunterkunft${ziel}`;
  }
}

/** „ · Einsatznr. …“ und „ · gegen Rat: …“ hinter dem Kopf; leer ohne Angabe. */
function verbleibZusatz(v: VerbleibKurz): string {
  let zusatz = '';
  if (v.leitstelle_einsatznummer) zusatz += ` · Einsatznr. ${v.leitstelle_einsatznummer}`;
  if (v.gegen_rat) {
    zusatz += ` · gegen Rat: ${GEGEN_RAT_WORT[v.gegen_rat]}`;
    if (v.unterschrift) zusatz += `, ${UNTERSCHRIFT_WORT[v.unterschrift]}`;
  }
  return zusatz;
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

/**
 * Das Wort je Anlass der Hilfeleistung aus dem festen Katalog (LLH-1566, Konzept LLH-1562 5.1),
 * in der Folge der Wahl. Ein Gesundheitsdatum: steht nie im ETB.
 */
export const ANLASS_WORT: Record<PersonAnlass, string> = {
  verletzung: 'Verletzung',
  internistisch: 'Internistisch',
  neurologisch: 'Neurologisch',
  intoxikation: 'Intoxikation',
  hitze_kaelte: 'Hitze / Kälte',
  allergie: 'Allergie / Insektenstich',
  psychisch: 'Psychisch',
  sonstiges: 'Sonstiges',
};

/** Feste Folge der Anlässe in Wahl und Zählung: die Katalogfolge. */
export const ANLASS_REIHE = Object.keys(ANLASS_WORT) as readonly PersonAnlass[];

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
  // Die häufigen Maßnahmen des Sanitätsdienstes (LLH-1572, design.md D8).
  wundversorgung: 'Wundversorgung',
  kuehlung: 'Kühlung',
  lagerung: 'Lagerung',
  betreuung_gespraech: 'Betreuung / Gespräch',
};

/** Feste Folge der Maßnahmen in der Wahl: die Katalogfolge der Spec. */
export const MASSNAHME_REIHE = Object.keys(MASSNAHME_WORT) as readonly MassnahmeArt[];

/**
 * Die Maßnahmen eines leichten Falls (LLH-1572, Dialog „Versorgt und entlassen“): was vor Ort
 * versorgt und danach entlassen wird. Zugang, Infusion, Atemweg, Analgesie und Dekontamination
 * fehlen: wer sie braucht, ist kein leichter Fall und geht über die gewohnte Erfassung.
 */
export const LEICHTE_MASSNAHMEN: readonly MassnahmeArt[] = [
  'wundversorgung',
  'kuehlung',
  'lagerung',
  'betreuung_gespraech',
  'waermeerhalt',
  'blutstillung',
  'immobilisation',
  'sauerstoff',
];

/** Höchstens so viele Maßnahmen nimmt der leichte Fall (LLH-1572, Konzept 5.2). */
export const LEICHTE_MASSNAHMEN_MAX = 3;

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

/** Das Wort je Geschlecht, wie die Erfassung es nennt; der Wire-Wert steht nie im Text. */
export const GESCHLECHT_WORT: Record<NonNullable<Person['geschlecht']>, string> = {
  maennlich: 'männlich',
  weiblich: 'weiblich',
  divers: 'divers',
  unbekannt: 'unbekannt',
};

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
