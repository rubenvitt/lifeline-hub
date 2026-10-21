import type { GlobalToken } from 'antd';
import type { Warnstufe } from '../../api/types';
import { flaechenFarbe, warnstufeBalkenFarbe } from '../../theme/statusFarben';

/** Balken einer Matrixzelle — rein; ohne Warnstufe kein Balken. */
export function zellBalkenStil(farbe: string | null): { boxShadow?: string } {
  return farbe == null ? {} : { boxShadow: `inset 0 -3px 0 0 ${farbe}` };
}

/**
 * Fläche + Balken einer Matrixzelle zur Warnstufe — eine Stelle für Matrix und Palettenauszug. Der
 * Balken sitzt 3 px unten als Innenschatten (kein Layout, die Zeilenhöhe springt beim Umbewerten
 * nicht) und trägt die Skala niedrig → akut; die Fläche darunter die zwei Intensitäten aus dem
 * Flächenvertrag. Zweiter Kanal bleibt das Kürzel.
 */
export function zellFlaechenStil(
  stufe: Warnstufe,
  token: GlobalToken,
): { backgroundColor: string; boxShadow?: string } {
  return {
    backgroundColor: flaechenFarbe(stufe, token),
    ...zellBalkenStil(warnstufeBalkenFarbe(stufe, token)),
  };
}
