import type { AbschlussGrund, Spezies, Tier, TierStatus } from '../../api/types';
import { registrierNummer } from '../../anzeige/registrierNummer';
import type { StatusTon } from '../../components/instrument';

/** Tierart als Wort — die eine Zuordnung für Liste, Detailseite und Archivakte. */
export const SPEZIES_META: Record<Spezies, string> = {
  hund: 'Hund',
  katze: 'Katze',
  grosstier: 'Großtier',
  nutzgefluegel: 'Nutzgeflügel',
  kleintier: 'Kleintier',
  wildtier: 'Wildtier',
  sonstige: 'Sonstige',
};

/**
 * Verbleib eines Tiers in Handlungsform (LLH-1092): was mit dem Tier geschah, als es die Obhut der
 * Einsatzkräfte verließ — Dialog, Detailseite, Liste und Druck. Der Drahtwert heißt weiter
 * `abschluss_grund` (`freilauf` bleibt `freilauf`); dieselben Wörter nennt das ETB
 * (`AbschlussGrund::etb_label` in `src/tier/mod.rs`).
 */
export const TIER_VERBLEIB: Record<AbschlussGrund, string> = {
  uebergabe_halter: 'an Halter übergeben',
  uebergabe_tierarzt: 'an Tierarzt übergeben',
  uebergabe_tierheim: 'an Tierheim übergeben',
  verstorben: 'verstorben',
  freilauf: 'freigelassen',
  sonstiges: 'Sonstiges',
};

/**
 * Verbleib als eine Zeile für Liste und Druck: Handlung, mit Ziel dahinter. Nur am abgeschlossenen
 * Tier — beim Wiederaufnehmen bleiben Grund und Ziel gespeichert, gelten aber nicht mehr.
 */
export function verbleibText(
  t: Pick<Tier, 'status' | 'abschluss_grund' | 'abschluss_ziel'>,
): string | null {
  if (t.status !== 'abgeschlossen' || t.abschluss_grund == null) return null;
  const wort = TIER_VERBLEIB[t.abschluss_grund];
  return t.abschluss_ziel ? `${wort}: ${t.abschluss_ziel}` : wort;
}

/**
 * Tierstatus als Wort + Ton der Statusfläche, die eine Zuordnung für Liste und Detailseite.
 * `vermisst` ist `achtung` wie beim Personenstatus, `abgeschlossen` neutral. Das Wort ist Pflicht:
 * der Ton ist nie der einzige Kanal.
 */
export const TIER_STATUS: Record<TierStatus, { label: string; ton: StatusTon }> = {
  aktiv: { label: 'aktiv', ton: 'normal' },
  vermisst: { label: 'vermisst', ton: 'achtung' },
  abgeschlossen: { label: 'abgeschlossen', ton: 'neutral' },
};

/**
 * Filterkette der Tierliste als reine Funktion. Die Freitextsuche läuft im `Datensicht`-Primitiv
 * (`suchText` der Spalten), der Spezies-Filter im Spaltenkopf (LLH-1096). Hier gefiltert wird nur
 * für den Druck: Statussicht und die Spezies aus dem Kopffilter der Liste.
 */

/** Status-Sichten: 'alle' = kein Filter; sonst Status-Filter. */
export type TiereSicht = 'aktiv' | 'vermisst' | 'abgeschlossen' | 'alle';

/** Reiter der Tierliste in Bedienreihenfolge — dieselben Wörter im Kopf der Druckansicht. */
export const TIERE_SICHTEN: readonly { key: TiereSicht; label: string }[] = [
  // „Offen“, nicht „Aktiv“ (LFH-954): „Aktiv“ ist der Status des Einsatzes; der Wert bleibt `aktiv`.
  { key: 'aktiv', label: 'Offen' },
  { key: 'vermisst', label: 'Vermisst' },
  { key: 'abgeschlossen', label: 'Abgeschlossen' },
  { key: 'alle', label: 'Alle' },
];

/** Registriernummer des Halters in Anzeigeschreibweise, oder `null` — Liste und Druck. */
export function halterNummer(t: Pick<Tier, 'halter_registrier_nr'>): string | null {
  return t.halter_registrier_nr != null ? registrierNummer('R', t.halter_registrier_nr) : null;
}

/**
 * Vorbelegung von „Übergeben an / Ort“ bei „an Halter übergeben“: der bekannte Halter, sonst
 * nichts. Eine stornierte Halterperson ist kein Übergabeziel.
 */
export function halterVorbelegung(
  t: Pick<Tier, 'halter_registrier_nr' | 'halter_kontakt' | 'halter_storniert_at'>,
): string | null {
  if (t.halter_registrier_nr != null) return t.halter_storniert_at ? null : halterNummer(t);
  return t.halter_kontakt || null;
}

/** Zeilenmenge aus Statussicht UND Spezies — Schnittmenge, keine Vereinigung. */
export function filterTiere(
  alle: readonly Tier[],
  opts: { sicht: TiereSicht; spezies?: readonly Spezies[] },
): readonly Tier[] {
  const { sicht, spezies } = opts;
  return alle
    .filter((t) => sicht === 'alle' || t.status === sicht)
    .filter((t) => !spezies?.length || spezies.includes(t.spezies));
}
