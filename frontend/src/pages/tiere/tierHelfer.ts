import type { AbschlussGrund, Spezies, Tier, TierStatus } from '../../api/types';
import type { StatusTon } from '../../components/instrument';

/** Tierart als Wort — die EINE Zuordnung für Liste, Detailseite und Archivakte (LFH-23). */
export const SPEZIES_META: Record<Spezies, string> = {
  hund: 'Hund',
  katze: 'Katze',
  grosstier: 'Großtier',
  nutzgefluegel: 'Nutzgeflügel',
  kleintier: 'Kleintier',
  wildtier: 'Wildtier',
  sonstige: 'Sonstige',
};

/** Abschlussgrund eines Tiers als Wort — Detailseite und Archivakte (LFH-23). */
export const TIER_ABSCHLUSS: Record<AbschlussGrund, string> = {
  uebergabe_halter: 'Übergabe an Halter',
  uebergabe_tierarzt: 'Übergabe an Tierarzt',
  uebergabe_tierheim: 'Übergabe an Tierheim',
  verstorben: 'verstorben',
  freilauf: 'Freilauf',
  sonstiges: 'Sonstiges',
};

/**
 * Tierstatus als Wort + Ton der Statusfläche (Neuentwurf: „Status als getönte Fläche").
 * Die EINE Zuordnung für Liste und Detailseite — vorher stand dieselbe Map zweimal, mit
 * antd-Tag-Farbnamen. `vermisst` ist `achtung` wie beim Personenstatus (CLAUDE.md, LFH-455),
 * `abgeschlossen` neutral. Das Wort ist Pflicht: der Ton ist nie der einzige Kanal.
 */
export const TIER_STATUS: Record<TierStatus, { label: string; ton: StatusTon }> = {
  aktiv: { label: 'aktiv', ton: 'normal' },
  vermisst: { label: 'vermisst', ton: 'achtung' },
  abgeschlossen: { label: 'abgeschlossen', ton: 'neutral' },
};

/**
 * Filterkette der Tierliste als reine Funktion (LFH-330 · B2, Muster
 * `pages/schaeden/schadenHelfer.tsx`).
 *
 * Kein Suchanteil: die Freitextsuche hängt am `suchText` der Spalten und läuft im
 * `Datensicht`-Primitiv. Der Spezies-Filter bleibt dagegen eine SEITEN-Steuerung neben den
 * Reitern (und wird nicht zu einem Spalten-`filter`), weil er zusammen mit der Statusachse
 * gelesen wird — wie die Filterkarte der Kräfteübersicht außerhalb ihrer Sicht liegt.
 */

/** Status-Sichten: 'alle' = kein Filter; sonst Status-Filter. */
export type TiereSicht = 'aktiv' | 'vermisst' | 'abgeschlossen' | 'alle';

/**
 * Zeilenmenge aus Statussicht UND Spezies — eine SCHNITTMENGE, keine Vereinigung: wer
 * „vermisste Katzen" wählt, will nicht auch alle vermissten Hunde sehen.
 */
export function filterTiere(
  alle: readonly Tier[],
  opts: { sicht: TiereSicht; spezies?: Spezies },
): readonly Tier[] {
  const { sicht, spezies } = opts;
  return alle
    .filter((t) => sicht === 'alle' || t.status === sicht)
    .filter((t) => !spezies || t.spezies === spezies);
}
