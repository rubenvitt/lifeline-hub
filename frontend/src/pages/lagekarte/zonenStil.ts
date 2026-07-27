import type { GlobalToken } from 'antd';
import { rollenFarbe, warnstufeKarte } from '../../theme/statusFarben';
import type { Warnstufe, ZoneTyp } from '../../api/types';

export interface ZoneStil {
  fillColor: string;
  fillOpacity: number;
  lineColor: string;
  lineWidth: number;
}

/** Voreingestellter Stil je typisierter Zone (eine Wahrheit; nicht gespeichert).
 *
 *  BEWUSST NICHT auf die Rollen gezogen (LFH-328/A2): `ZoneTyp` ist keines der Enums des
 *  Statusfarb-Vertrags, keiner dieser Werte steht in Gate 5, und ein Umzug wäre der
 *  Bestands-Sweep, den A2 ausdrücklich verbietet (Spec: „die ~20 Farb-/Label-Maps
 *  außerhalb der Vertrags-Enums nicht anfassen"). Gleiches gilt für
 *  {@link FREIE_SKIZZE_FALLBACK} — `#1677ff` steht identisch in `zonenStil.test.ts:20`
 *  gepinnt, während `marker.ts` denselben Literalwert verliert; das ist kein Versehen,
 *  sondern die Grenze zwischen Rollenfarbe und Nutzer-/Katalogfarbe. */
const STILE: Record<Exclude<ZoneTyp, 'freie_skizze'>, ZoneStil> = {
  gefahrengebiet: { fillColor: '#cf1322', fillOpacity: 0.2, lineColor: '#cf1322', lineWidth: 2 },
  absperrbereich: { fillColor: '#fa8c16', fillOpacity: 0.2, lineColor: '#fa8c16', lineWidth: 2 },
  absperrgrenze: { fillColor: '#cf1322', fillOpacity: 0, lineColor: '#cf1322', lineWidth: 4 },
  sperrgebiet: { fillColor: '#8c8c8c', fillOpacity: 0.3, lineColor: '#595959', lineWidth: 2 },
};

const FREIE_SKIZZE_FALLBACK = '#1677ff';

/** Stil einer Zone: typisierte aus `typ`, freie Skizze aus gespeicherter `farbe`. */
export function zoneStil(typ: ZoneTyp, farbe: string | null | undefined): ZoneStil {
  if (typ === 'freie_skizze') {
    const c = farbe && farbe.trim() ? farbe : FREIE_SKIZZE_FALLBACK;
    return { fillColor: c, fillOpacity: 0.2, lineColor: c, lineWidth: 2 };
  }
  return STILE[typ];
}

export interface ZoneTypInfo {
  typ: ZoneTyp;
  label: string;
  /** Geometrie, die der Typ erzwingt; `beides` = Nutzer wählt Fläche/Linie. */
  geometrie: 'Polygon' | 'LineString' | 'beides';
}

/** Typ-Katalog für die Zeichen-UI (Reihenfolge wie Spec-Tabelle). */
export const ZONE_TYPEN: ZoneTypInfo[] = [
  { typ: 'gefahrengebiet', label: 'Gefahrengebiet', geometrie: 'Polygon' },
  { typ: 'absperrbereich', label: 'Absperrbereich', geometrie: 'Polygon' },
  { typ: 'absperrgrenze', label: 'Absperrgrenze', geometrie: 'LineString' },
  { typ: 'sperrgebiet', label: 'Sperrgebiet', geometrie: 'Polygon' },
  { typ: 'freie_skizze', label: 'Freie Skizze', geometrie: 'beides' },
];

/** Sprechendes Label eines Typs (für Inspector/Legende). */
export function zoneTypLabel(typ: ZoneTyp): string {
  return ZONE_TYPEN.find((t) => t.typ === typ)?.label ?? typ;
}

/**
 * Stil einer gefahrengebiet-Zone, abgeleitet aus der höchsten Warnstufe ihres Gebiets.
 *
 * Die Skala steht seit A2 (LFH-328) als `warnstufeKarte` im Statusfarb-Vertrag
 * (`theme/statusFarben.ts`) — hier lag sie früher als `WARNSTUFE_KARTE` mit fünf eigenen
 * Hex-Werten. Dass `keine` weiterhin die Alarmrolle trägt (ein unbewertetes Gefahrengebiet
 * wird vorsichtshalber als Gefahr dargestellt, nicht „ruhiger" als `niedrig`), ist dort
 * dokumentiert und begründet; A2 hat die Entscheidung übernommen, nicht neu getroffen.
 *
 * DIESES MODUL ERZEUGT MapLibre-`paint`-WERTE, keine DOM-Styles — es hat also keinen
 * `useToken()`-Zugang und bekommt den Token von der aufrufenden Ebene
 * (`useLagekarteDaten`) durchgereicht. Den Modus über `document.documentElement.dataset`
 * zu raten wäre ein globaler Seiteneffekt und in Tests nicht gesetzt.
 */
export function gefahrengebietStil(warnstufe: Warnstufe, token: GlobalToken): ZoneStil {
  const c = rollenFarbe(warnstufeKarte[warnstufe].rolle, token);
  return { fillColor: c, fillOpacity: 0.25, lineColor: c, lineWidth: 2 };
}
