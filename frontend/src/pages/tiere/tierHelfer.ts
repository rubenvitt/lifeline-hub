import type { AbschlussGrund, Spezies, Tier, TierStatus } from '../../api/types';
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

/** Abschlussgrund eines Tiers als Wort — Detailseite und Archivakte. */
export const TIER_ABSCHLUSS: Record<AbschlussGrund, string> = {
  uebergabe_halter: 'Übergabe an Halter',
  uebergabe_tierarzt: 'Übergabe an Tierarzt',
  uebergabe_tierheim: 'Übergabe an Tierheim',
  verstorben: 'verstorben',
  freilauf: 'Freilauf',
  sonstiges: 'Sonstiges',
};

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
 * (`suchText` der Spalten); der Spezies-Filter ist eine Seiten-Steuerung neben den Reitern, weil er
 * zusammen mit der Statusachse gelesen wird.
 */

/** Status-Sichten: 'alle' = kein Filter; sonst Status-Filter. */
export type TiereSicht = 'aktiv' | 'vermisst' | 'abgeschlossen' | 'alle';

/** Zeilenmenge aus Statussicht UND Spezies — Schnittmenge, keine Vereinigung. */
export function filterTiere(
  alle: readonly Tier[],
  opts: { sicht: TiereSicht; spezies?: Spezies },
): readonly Tier[] {
  const { sicht, spezies } = opts;
  return alle
    .filter((t) => sicht === 'alle' || t.status === sicht)
    .filter((t) => !spezies || t.spezies === spezies);
}
