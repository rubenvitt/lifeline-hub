import type { GlobalToken } from 'antd';
import type { Evakuierungsbezirk } from '../../api/types';
import { rollenFarbe } from '../../theme/statusFarben';
import { sammelstelleZeichen } from '../../zeichen/fachobjektZeichen';
import type { KarteMarker, NichtVerortet } from './marker';

/**
 * Was die Karte von einem Bezirk für seine Sammelstelle liest (LLH-1393): die Übersicht des Moduls
 * Evakuierung und der gesicherte Stand (`evakuierungsbezirke`) tragen beide diese Felder.
 */
export type SammelstelleKartenEintrag = Pick<
  Evakuierungsbezirk,
  | 'id'
  | 'bezeichnung'
  | 'raeumung'
  | 'sammelstelle'
  | 'sammelstelle_lat'
  | 'sammelstelle_lon'
  | 'storniert_at'
>;

/**
 * Kurzzeichen im Kreis, nur als Rückfall: Die Sammelstelle steht als Stelle mit dem Zeichen
 * „Sammelplatz für Betroffene“ auf der Karte (`sammelstelleZeichen`). Zeichnet die Bibliothek es
 * nicht, bleibt der Kreis mit „SSt“.
 */
export const SAMMELSTELLE_KURZZEICHEN = 'SSt';

/** „Sammelstelle Nord“ — der Bezirk nennt die Stelle, ihr Freitext steht im Inspector. */
export function sammelstelleKartenLabel(b: Pick<Evakuierungsbezirk, 'bezeichnung'>): string {
  return `Sammelstelle ${b.bezeichnung}`;
}

/**
 * Sammelstellen der Evakuierungsbezirke (LLH-1393, design.md D4): aus jedem nicht stornierten
 * Bezirk, dessen Räumung nicht aufgehoben ist. Mit Koordinate ein Marker, mit Freitext, aber ohne
 * Koordinate eine Zeile in „Nicht verortet“, ohne beides nichts. „Geräumt“ bleibt: die Stelle ist
 * oft noch in Betrieb, bis alle abtransportiert sind. Die `id` ist die des Bezirks.
 */
export function buildSammelstelleMarker(
  bezirke: readonly SammelstelleKartenEintrag[],
  token: GlobalToken,
): { verortet: KarteMarker[]; nichtVerortet: NichtVerortet[] } {
  const mitZeichen = sammelstelleZeichen() !== null;
  const verortet: KarteMarker[] = [];
  const nichtVerortet: NichtVerortet[] = [];
  for (const b of bezirke) {
    if (b.storniert_at || b.raeumung === 'aufgehoben') continue;
    const label = sammelstelleKartenLabel(b);
    if (b.sammelstelle_lat != null && b.sammelstelle_lon != null) {
      verortet.push({
        schluessel: `sammelstelle-${b.id}`,
        typ: 'sammelstelle',
        id: b.id,
        lat: b.sammelstelle_lat,
        lon: b.sammelstelle_lon,
        label,
        farbe: rollenFarbe('bedien', token),
        ...(mitZeichen ? {} : { kurzzeichen: SAMMELSTELLE_KURZZEICHEN }),
        trefferDurchmesser: token.controlHeight,
      });
    } else if (b.sammelstelle?.trim()) {
      nichtVerortet.push({ typ: 'sammelstelle', id: b.id, label });
    }
  }
  return { verortet, nichtVerortet };
}
