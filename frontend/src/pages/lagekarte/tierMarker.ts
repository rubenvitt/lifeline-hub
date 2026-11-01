import type { GlobalToken } from 'antd';
import type { Tier } from '../../api/types';
import { rollenFarbe } from '../../theme/statusFarben';
import { registrierNummer } from '../../anzeige/registrierNummer';
import { SPEZIES_META } from '../tiere/tierHelfer';
import { tierZeichen } from '../../zeichen/fachobjektZeichen';
import type { KarteMarker, NichtVerortet } from './marker';

/**
 * Was die Karte von einem Tier liest (LLH-1123): die Liste der Modulseite (`TierAnzeige`) und der
 * gesicherte Stand (`TierKarte` in `src/tier/mod.rs`) tragen beide diese Felder. Der Stand ist
 * schmal und führt weder Halter noch Notiz.
 */
export type TierKartenEintrag = Pick<
  Tier,
  | 'id'
  | 'registrier_nr'
  | 'status'
  | 'spezies'
  | 'rufname'
  | 'antreff_ort'
  | 'antreff_lat'
  | 'antreff_lon'
> & { storniert_at?: string | null };

/**
 * Kurzzeichen im Kreis, nur als Rückfall: Das Tier steht als Zeichen „Tier ohne Zustand“ aus
 * @einsatzzeichen auf der Karte (LLH-1343, `tierZeichen`). Zeichnet die Bibliothek es nicht, bleibt
 * der Kreis mit „T“ (LLH-1123).
 */
export const TIER_KURZZEICHEN = 'T';

/** „T-007 (Hund)“ — wie die ETB-Spur, ohne Rufname: die Karte steht an der Wand. */
export function tierKartenLabel(t: Pick<Tier, 'registrier_nr' | 'spezies'>): string {
  return `${registrierNummer('T', t.registrier_nr)} (${SPEZIES_META[t.spezies]})`;
}

/**
 * Tiere (LLH-1123): offene und vermisste mit Koordinate als Marker, ohne Koordinate in „Nicht
 * verortet“. Abgeschlossene und stornierte fallen heraus, auch aus einem gesicherten Stand. Ein
 * vermisstes Tier trägt Rolle `achtung` und das Wort „vermisst“ hinter dem Namen, ein offenes
 * `bedien` wie UHS und Betreuungsstelle. Das Zeichen (LLH-1343) ist für beide dasselbe; damit ein
 * vermisstes Tier auch ohne Beschriftung, also unter deren Mindestzoom, auffällt, liegt hinter
 * seinem Zeichen eine Scheibe in der Achtung-Farbe (`statusFarbe`, derselbe Layer wie der
 * FMS-Status der Fahrzeuge).
 */
export function buildTierMarker(
  tiere: readonly TierKartenEintrag[],
  token: GlobalToken,
): { verortet: KarteMarker[]; nichtVerortet: NichtVerortet[] } {
  const mitZeichen = tierZeichen() !== null;
  const achtung = rollenFarbe('achtung', token);
  const verortet: KarteMarker[] = [];
  const nichtVerortet: NichtVerortet[] = [];
  for (const t of tiere) {
    if (t.storniert_at || (t.status !== 'aktiv' && t.status !== 'vermisst')) continue;
    const label = tierKartenLabel(t);
    if (t.antreff_lat != null && t.antreff_lon != null) {
      const vermisst = t.status === 'vermisst';
      verortet.push({
        schluessel: `tier-${t.id}`,
        typ: 'tier',
        id: t.id,
        lat: t.antreff_lat,
        lon: t.antreff_lon,
        label,
        farbe: vermisst ? achtung : rollenFarbe('bedien', token),
        ...(mitZeichen ? {} : { kurzzeichen: TIER_KURZZEICHEN }),
        trefferDurchmesser: token.controlHeight,
        ...(vermisst
          ? { beschriftungZusatz: 'vermisst', ...(mitZeichen ? { statusFarbe: achtung } : {}) }
          : {}),
      });
    } else {
      nichtVerortet.push({ typ: 'tier', id: t.id, label });
    }
  }
  return { verortet, nichtVerortet };
}
