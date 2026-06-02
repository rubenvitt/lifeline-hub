import type { ZoneTyp } from '../../api/types';

export interface ZoneStil {
  fillColor: string;
  fillOpacity: number;
  lineColor: string;
  lineWidth: number;
}

/** Voreingestellter Stil je typisierter Zone (eine Wahrheit; nicht gespeichert). */
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
